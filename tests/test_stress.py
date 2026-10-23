"""
A heavy browser profile: about 3,000 cookies across about 300 sites.

Every other test uses a handful of cookies. Real profiles hold thousands,
and "All sites" counts, lists, deletes, puts back and exports every one of
them. This checks that cookieZ stays correct at that size, and that it
stays quick enough to use.

Correctness is checked strictly: everything deleted really goes, Kept
cookies stay, and Undo puts back every cookie exactly. Timings are checked
loosely, with plenty of headroom, because the suite runs on ordinary
machines. The table of timings at the end is the useful part when
something gets slower.

Every name and value here is made up. Chrome keeps at most about 180
cookies per site and about 3,300 in all, and quietly throws away the
oldest beyond that, so the numbers stay under both.
"""

import json
import sys
import time

from playwright.sync_api import sync_playwright

from helpers import Results, extension_id, launch, popup_url, stub_active_tab, visible_state

HEAVY = "https://www.heavy.test/"
HEAVY_COOKIES = 150      # on the heavy site itself
LARGE_VALUES = 20        # of those, how many have a 3.5 KB value
SITES = 285              # ordinary sites
PER_SITE = 10            # cookies on each

# Partitioned (CHIPS) cookies. The first five are kept for heavy.test by
# frames from other sites, so they show in its table. The rest are kept for
# ordinary sites, and only "All sites" reaches them.
EMBEDDED_ON_HEAVY = 5
OTHER_PARTITIONED = 5

# Pass marks, in milliseconds. Generous on purpose: see the note at the top.
#
# Two are high because of Chrome, not cookieZ:
#   - Delete. chrome.cookies.remove takes about 5 ms a cookie inside Chrome
#     however the calls are made (all at once, in batches or one at a time
#     were all measured), so 3,000 cookies took 15 to 26 seconds here.
#   - Export. Building the text takes about 10 ms. Showing 870 KB of it in
#     the export box takes Chrome 1.5 to 3.5 seconds, whether the lines wrap
#     or not, because a text box lays out all of its text at once.
LIMITS = {
    "open the heavy site's table": 1500,
    "All sites: show the count": 2000,
    "All sites: open the list of sites": 1000,
    "All sites: delete, until the result shows": 60000,
    "All sites: delete, until the popup has caught up": 60000,
    "Undo the delete": 15000,
    "Export at All sites, JSON": 6000,
    "Export at All sites, Netscape": 6000,
    "search: slowest key press": 500,
    "search: domain:": 500,
}


def site(n):
    return f"site-{n:03d}.test"


def build_seed():
    """Every cookie to create, as chrome.cookies.set details."""
    seed = []
    for i in range(HEAVY_COOKIES):
        value = ("v" * 3500) if i < LARGE_VALUES else f"fake-heavy-value-{i}"
        seed.append({
            "url": HEAVY, "name": f"fake_heavy_{i:03d}", "value": value,
            "secure": True, "expirationDate": 2000000000 + i,
        })
    for n in range(SITES):
        for i in range(PER_SITE):
            cookie = {
                "url": f"https://{site(n)}/", "name": f"fake_{i}", "value": f"fake-{n}-{i}",
                "secure": i % 2 == 0,
            }
            if i % 3 == 0:
                cookie["domain"] = "." + site(n)          # domain-wide
            if i % 4 != 0:
                cookie["expirationDate"] = 2000000000     # the rest are session cookies
            seed.append(cookie)
    for k in range(EMBEDDED_ON_HEAVY):
        seed.append({
            "url": f"https://embed-{k}.test/", "name": f"fake_embedded_{k}", "value": "fake",
            "secure": True, "partitionKey": {"topLevelSite": "https://heavy.test"},
        })
    for k in range(OTHER_PARTITIONED):
        seed.append({
            "url": f"https://{site(k)}/", "name": f"fake_partitioned_{k}", "value": "fake",
            "secure": True, "partitionKey": {"topLevelSite": f"https://{site(100 + k)}"},
        })
    return seed


# Kept cookies, as src/lib/protect.js saves them: domain, path, name and
# partition, one per line.
KEPT = [
    ("www.heavy.test", "/", "fake_heavy_100"),
    ("www.heavy.test", "/", "fake_heavy_101"),
    ("www.heavy.test", "/", "fake_heavy_102"),
    (site(10), "/", "fake_1"),
    (site(20), "/", "fake_3"),        # a domain-wide one
    (site(30), "/", "fake_5"),
    (site(40), "/", "fake_7"),
]

# Reads every cookie in the store, partitioned ones included, as one line
# each, so two snapshots can be compared exactly.
SNAPSHOT = """async () => {
    const all = [...await chrome.cookies.getAll({}),
                 ...await chrome.cookies.getAll({partitionKey: {}})];
    const lines = new Set(all.map(c => [c.domain, c.path, c.name, c.value, c.secure,
        c.hostOnly, c.session, c.expirationDate || '',
        c.partitionKey ? c.partitionKey.topLevelSite : ''].join('|')));
    return [...lines].sort();
}"""

# Counts every chrome.cookies call the popup makes, for the timings table.
# Runs before the popup's own code. Nothing is changed but the counting.
COUNT_CALLS = """
(() => {
    window.__cookieCalls = {};
    for (const name of ['getAll', 'get', 'set', 'remove']) {
        const real = chrome.cookies[name].bind(chrome.cookies);
        chrome.cookies[name] = (...args) => {
            window.__cookieCalls[name] = (window.__cookieCalls[name] || 0) + 1;
            return real(...args);
        };
    }
})();
"""


def timed(page, action, until, limit_ms=60000):
    """
    Runs `action` (JavaScript) in the page, then waits for `until` (a
    JavaScript expression) to be true. Returns the milliseconds between,
    measured in the page itself, so Playwright's own delays don't count.
    """
    return page.evaluate(
        """async ({action, until, limit}) => {
            const start = performance.now();
            (new Function(action))();
            const done = new Function('return (' + until + ')');
            while (!done()) {
                if (performance.now() - start > limit) return -1;
                await new Promise(resolve => setTimeout(resolve, 2));
            }
            return performance.now() - start;
        }""",
        {"action": action, "until": until, "limit": limit_ms},
    )


def calls(page):
    """chrome.cookies calls since the last reset, then resets the count."""
    return page.evaluate(
        "() => { const c = window.__cookieCalls; window.__cookieCalls = {}; "
        "return Object.entries(c).map(([k, v]) => k + ' ' + v).join(', ') || 'none'; }"
    )


def text(page, element_id):
    return page.locator("#" + element_id).text_content().strip()


def main():
    r = Results("A heavy profile: about 3,000 cookies")
    timings = []

    def record(name, ms, note=""):
        timings.append((name, ms, note))
        limit = LIMITS.get(name)
        if limit is not None:
            r.check(f"{name} within {limit} ms", 0 <= ms < limit, f"{ms:.0f} ms")

    seed = build_seed()

    with sync_playwright() as p:
        context = launch(p, "stress")
        ext_id = extension_id(context)

        # --- seed, from an extension page that isn't pretending to be a site
        seeder = context.new_page()
        seeder.goto(popup_url(ext_id))
        seeder.wait_for_timeout(500)
        started = time.perf_counter()
        failed = seeder.evaluate(
            """async (seed) => {
                const failed = [];
                for (let i = 0; i < seed.length; i += 200) {
                    const batch = seed.slice(i, i + 200);
                    const made = await Promise.all(batch.map(s => chrome.cookies.set(s).catch(() => null)));
                    made.forEach((c, j) => { if (!c) failed.push(batch[j].name + ' ' + batch[j].url); });
                }
                return failed;
            }""",
            seed,
        )
        seconds = time.perf_counter() - started
        r.check("seeded every cookie", not failed, f"{len(seed)} in {seconds:.1f} s; failed: {failed[:5]}")

        keys = ["\n".join([domain, path, name, ""]) for domain, path, name in KEPT]
        seeder.evaluate("async (keys) => chrome.storage.local.set({protectedCookies: keys})", keys)

        before = seeder.evaluate(SNAPSHOT)
        r.check("Chrome kept every cookie (none thrown away for being over its limits)",
                len(before) == len(seed), f"{len(before)} in the store, {len(seed)} seeded")
        seeder.close()

        # --- open the heavy site ---------------------------------------------
        page = context.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.add_init_script(COUNT_CALLS)
        stub_active_tab(page, HEAVY)
        page.goto(popup_url(ext_id))
        page.bring_to_front()

        table_size = HEAVY_COOKIES + EMBEDDED_ON_HEAVY
        # Measured from when the page started loading, so it includes loading
        # the popup's own code, as a real open would.
        opened = page.wait_for_function(
            f"() => document.querySelectorAll('#cookie-rows tr').length >= {table_size}"
            " && document.getElementById('scope-summary').textContent.startsWith('Will delete')"
            " && performance.now()",
            timeout=30000,
        ).json_value()
        record("open the heavy site's table", opened, f"{table_size} rows; {calls(page)}")
        r.check("main screen reached", visible_state(page) == "state-main")
        r.check("the table has every one of the site's cookies",
                page.locator("#cookie-rows tr").count() == table_size,
                str(page.locator("#cookie-rows tr").count()))

        # --- All sites: the count ---------------------------------------------
        ms = timed(
            page,
            "const r = document.querySelector('input[name=\"scope\"][value=\"all\"]');"
            " r.checked = true; r.dispatchEvent(new Event('change'));",
            "document.getElementById('scope-summary').textContent.startsWith('Will delete')",
        )
        record("All sites: show the count", ms, calls(page))
        deletable = len(seed) - len(KEPT)
        summary = text(page, "scope-summary")
        r.check("All sites counts every cookie but the kept ones",
                f"{deletable:,} cookies" in summary and f"{len(KEPT)} kept cookies" in summary,
                summary)

        # --- All sites: the list of sites -------------------------------------
        ms = timed(
            page,
            "document.getElementById('scope-domains-summary').click();"
            " document.getElementById('scope-domains-list').offsetHeight;",
            "document.getElementById('scope-domains').open",
        )
        listed = page.locator("#scope-domains-list li").count()
        record("All sites: open the list of sites", ms, f"{listed} sites listed")
        # The sites with a cookie that can be deleted: the heavy site, the
        # ordinary ones and the frames' sites. A Kept cookie's site is still
        # listed, because its other cookies go.
        r.check("the list names every site", listed == 1 + SITES + EMBEDDED_ON_HEAVY,
                f"{listed} listed, {1 + SITES + EMBEDDED_ON_HEAVY} expected")
        page.locator("#scope-domains-summary").click()

        # --- search on the heavy site -----------------------------------------
        page.evaluate(
            "() => { const r = document.querySelector('input[name=\"scope\"][value=\"page\"]');"
            " r.checked = true; r.dispatchEvent(new Event('change')); }"
        )
        page.wait_for_function(
            "() => document.getElementById('scope-summary').textContent.startsWith('Will delete')"
        )
        slowest = 0
        typed = ""
        for letter in "heavy_14":
            typed += letter
            # The table is drawn as part of the input event. This waits for
            # the frame after it too, so laying it out counts.
            ms = page.evaluate(
                """async (typed) => {
                    const box = document.getElementById('search-input');
                    const start = performance.now();
                    box.value = typed;
                    box.dispatchEvent(new Event('input'));
                    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
                    return performance.now() - start;
                }""",
                typed,
            )
            slowest = max(slowest, ms)
        shown = page.locator("#cookie-rows tr").count()
        record("search: slowest key press", slowest, f"'{typed}', {shown} rows left")
        r.check("the search finds just the matching cookies", shown == 10, f"{shown} rows")

        ms = page.evaluate(
            """async () => {
                const box = document.getElementById('search-input');
                const start = performance.now();
                box.value = 'domain:embed';
                box.dispatchEvent(new Event('input'));
                await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
                return performance.now() - start;
            }"""
        )
        shown = page.locator("#cookie-rows tr").count()
        record("search: domain:", ms, f"'domain:embed', {shown} rows")
        r.check("domain: finds the frames' cookies", shown == EMBEDDED_ON_HEAVY, f"{shown} rows")

        page.evaluate(
            "() => { const box = document.getElementById('search-input');"
            " box.value = ''; box.dispatchEvent(new Event('input')); }"
        )
        page.wait_for_function(
            f"() => document.querySelectorAll('#cookie-rows tr').length === {table_size}"
            " && document.getElementById('scope-summary').textContent.startsWith('Will delete')"
        )

        # --- Export at All sites ----------------------------------------------
        page.evaluate(
            "() => { const r = document.querySelector('input[name=\"scope\"][value=\"all\"]');"
            " r.checked = true; r.dispatchEvent(new Event('change')); }"
        )
        page.wait_for_function(
            "() => document.getElementById('scope-summary').textContent.startsWith('Will delete')"
        )
        calls(page)
        for fmt, name in (("json", "JSON"), ("netscape", "Netscape")):
            ms = timed(
                page,
                "document.getElementById('export-button').click();"
                f" const f = document.querySelector('input[name=\"format\"][value=\"{fmt}\"]');"
                " f.checked = true; f.dispatchEvent(new Event('change'));",
                "document.getElementById('export-output').value.length > 0",
            )
            output = page.locator("#export-output").input_value()
            record(f"Export at All sites, {name}", ms, f"{len(output) / 1024:.0f} KB; {calls(page)}")
            if fmt == "json":

                exported = json.loads(output)
                r.check("the JSON export has every cookie, kept ones too",
                        len(exported) == len(seed), f"{len(exported)} of {len(seed)}")
            else:
                lines = [ln for ln in output.splitlines() if ln and not ln.startswith("# ")]
                r.check("the Netscape export has a line for every cookie",
                        len(lines) == len(seed), f"{len(lines)} of {len(seed)}")
            page.locator("#export-back").click()
            page.wait_for_timeout(200)

        # --- delete at All sites ----------------------------------------------
        page.locator("#delete-button").click()
        page.wait_for_timeout(200)
        confirm = text(page, "confirm-text")
        r.check("the confirm says the same number", f"{deletable:,} cookies" in confirm, confirm)
        calls(page)
        times = page.evaluate(
            """async () => {
                const message = document.getElementById('main-message');
                const summary = document.getElementById('scope-summary');
                const start = performance.now();
                document.getElementById('confirm-yes').click();
                let shown = null;
                while (performance.now() - start < 60000) {
                    if (shown === null && message.textContent.startsWith('Deleted ')) {
                        shown = performance.now() - start;
                    }
                    // Caught up: Undo is offered and the count has been redone.
                    if (message.querySelector('.undo-button') &&
                        !summary.textContent.startsWith('Counting') &&
                        !document.getElementById('confirm-yes').disabled) {
                        return [shown, performance.now() - start];
                    }
                    await new Promise(resolve => setTimeout(resolve, 2));
                }
                return [shown === null ? -1 : shown, -1];
            }"""
        )
        result = text(page, "main-message")
        record("All sites: delete, until the result shows", times[0], result.split(".")[0])
        record("All sites: delete, until the popup has caught up", times[1], calls(page))
        r.check("the result says the same number", f"Deleted {deletable:,} cookies" in result, result)

        left = page.evaluate(SNAPSHOT)
        left_names = sorted(line.split("|")[0].lstrip(".") + "|" + line.split("|")[2] for line in left)
        expected = sorted(domain + "|" + name for domain, _, name in KEPT)
        r.check("every cookie but the kept ones is really gone, and the kept ones stay",
                left_names == expected, f"{len(left)} left: {left_names[:10]}")

        # --- Undo -------------------------------------------------------------
        ms = timed(
            page,
            "document.querySelector('#main-message .undo-button').click();",
            "document.getElementById('main-message').textContent.startsWith('Restored')",
            limit_ms=120000,
        )
        record("Undo the delete", ms, calls(page))
        undone = text(page, "main-message")
        r.check("Undo says it put every one back", f"Restored {deletable:,} cookies" in undone, undone[:200])

        after = page.evaluate(SNAPSHOT)
        missing = sorted(set(before) - set(after))
        extra = sorted(set(after) - set(before))
        r.check("Undo put back every cookie exactly as it was",
                not missing and not extra,
                f"missing {len(missing)} {missing[:3]}, extra {len(extra)} {extra[:3]}")

        r.check("no console errors", not errors, str(errors[:3]))
        context.close()

    print("\nTimings (ms):")
    width = max(len(name) for name, _, _ in timings)
    for name, ms, note in timings:
        limit = LIMITS.get(name)
        print(f"  {name:<{width}}  {ms:8.0f}  {'(limit ' + str(limit) + ')' if limit else '':<14}  {note}")

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
