"""
Blocking known trackers' cookies (1.8).

One switch on the Block cookies screen hands Chrome a block rule for every
domain in src/lists/trackers.js, and an allow rule per tracker for each
site set to "Allow all cookies". As in test_rules.py, nothing here is
taken on trust: each check loads a real page and reads what Chrome stored.

The test's copy of the extension gets its own tracker list: embed-site.test
(the company embedded on top-site.test, see TwoSites in test_rules.py) and
a few made-up domains. So "the trackers' cookies" here are embed-site's
three: embed_3p, embed_3pjs and embed_chips (partitioned).

What this file can't check: Chrome's permission prompt, incognito, and how
long the real list of about 130 takes. Those are checked by hand.
"""

import json
import sys

from playwright.sync_api import sync_playwright

from helpers import PROFILES, Results, extension_id, launch, pregranted_extension
from test_rules import (
    EVERYTHING,
    NO_RULES_PERMISSION,
    OWN,
    TwoSites,
    back,
    checked,
    label,
    listed,
    lit,
    message,
    new_popup,
    open_rules,
    saved,
    stored_names,
    visit,
)

TEST_TRACKERS = ["made-up-ads.test", "embed-site.test", "pretend-analytics.test", "not-a-tracker.test"]

# Every message and on/off state the rules screen goes through, so a
# "Saving…" that only lasts a moment is still seen.
RECORD_SAVING = """() => {
    window.savingSeen = [];
    const note = () => window.savingSeen.push([
        document.getElementById('rules-message').textContent,
        document.getElementById('rules-body').disabled,
    ]);
    const watcher = new MutationObserver(note);
    watcher.observe(document.getElementById('rules-message'), { childList: true, characterData: true, subtree: true });
    watcher.observe(document.getElementById('rules-body'), { attributes: true });
}"""


def use_test_list():
    """Swaps the list in the test's copy of the extension. Must run before launch()."""
    path = pregranted_extension() / "lists" / "trackers.js"
    path.write_text("export const TRACKER_DOMAINS = " + json.dumps(TEST_TRACKERS) + ";\n", encoding="utf-8")


def wait_saved(page):
    """Waits until a change has been handed to Chrome and the screen is usable again."""
    page.wait_for_function("() => !document.getElementById('rules-body').disabled", timeout=15000)
    page.wait_for_timeout(500)


def switch(page, on):
    """Clicks the switch if it isn't already `on`. click(), not check(): when
    Chrome refuses, the box goes back off, and check() fails on that."""
    box = page.locator("#rules-trackers")
    if box.is_checked() != on:
        box.click()
    wait_saved(page)


def switch_on(page):
    return page.locator("#rules-trackers").is_checked()


def trackers_saved(page):
    return (saved(page) or {}).get("trackers")


def check_translation(r, page):
    out = page.evaluate("""async () => {
        const m = await import(chrome.runtime.getURL('lib/rules.js'));
        const show = (rules) => m.chromeRulesFor(rules)
            .map(x => [x.primaryPattern, x.secondaryPattern || '', x.setting].join(' | '));
        return {
            off: show({ everywhere: 'allow', sites: {}, trackers: false }),
            on: show({ everywhere: 'allow', sites: {}, trackers: true }),
            mixed: show({ everywhere: 'allow', sites: { 'a.test': 'allow', 'b.test': 'block', 'c.test': 'session' }, trackers: true }),
        };
    }""")
    blocks = ["*://*." + t + "/* | <all_urls> | block" for t in TEST_TRACKERS]
    r.check("with the switch off, no tracker rules are handed to Chrome", out["off"] == [], str(out["off"]))
    r.check("with it on, one block rule per listed tracker, on every site's pages",
            out["on"] == blocks, str(out["on"]))
    pairs = ["*://*." + t + "/* | *://*.a.test/* | allow" for t in TEST_TRACKERS]
    r.check("a site set to 'Allow all cookies' gets an allow rule per tracker; other rules get none",
            out["mixed"][-len(pairs):] == pairs and len(out["mixed"]) == 4 + len(blocks) + len(pairs),
            str(out["mixed"]))


def check_switch(r, context, ext_id, server):
    top = server.url(server.TOP_HOST)
    embed = server.url(server.EMBED_HOST)
    host = server.TOP_HOST
    site = context.new_page()
    page = new_popup(context, ext_id, top)

    r.check("(before: the site gets all five cookies)", visit(context, site, top) == EVERYTHING,
            str(stored_names(context, site)))
    page.evaluate("async () => { await chrome.storage.local.set({ protectedCookies: ['embed-site.test\\n/\\nembed_3pjs\\n'] }); }")

    open_rules(page)
    r.check("the switch is there, and off", page.locator("#rules-trackers").is_visible() and not switch_on(page))

    # --- on ---
    page.evaluate(RECORD_SAVING)
    switch(page, True)
    seen = page.evaluate("() => window.savingSeen")
    r.check("while the rules are set, the screen says 'Saving…' and its controls are off",
            ["Saving…", True] in seen, str(seen))
    r.check("afterwards the controls are back and the result replaces 'Saving…'",
            not page.locator("#rules-body").is_disabled()
            and not page.locator("#rules-trackers").is_disabled()
            and message(page).startswith("Known trackers' cookies are now blocked on every site."), message(page))
    r.check("it's saved", trackers_saved(page) is True, json.dumps(saved(page)))

    offer = page.locator("#rules-trackers-cleanup-text")
    r.check("it offers to delete the trackers' cookies already saved, with the count, kept ones left out",
            offer.is_visible()
            and offer.text_content() == "These companies already have 2 cookies saved. 1 kept cookie will be left alone.",
            offer.text_content())
    r.check("turning it on doesn't delete anything by itself",
            stored_names(context, site) == EVERYTHING, str(stored_names(context, site)))

    page.locator("#rules-trackers-cleanup-yes").click()
    page.wait_for_timeout(900)
    left = stored_names(context, site)
    r.check("TRAP: 'Delete them' removes those two, partitioned one included, and the kept one stays",
            left == ["embed_3pjs", "top_header", "top_js"], str(left))
    r.check("it says so, with Undo", "Deleted 2 cookies." in message(page)
            and page.locator("#rules-message .undo-button").is_visible(), message(page))
    page.locator("#rules-message .undo-button").click()
    page.wait_for_timeout(900)
    r.check("Undo puts them back", stored_names(context, site) == EVERYTHING, str(stored_names(context, site)))
    page.evaluate("async () => { await chrome.storage.local.remove('protectedCookies'); }")

    r.check("TRAP: the tracker's cookies are blocked on the site, and the site keeps its own",
            visit(context, site, top) == OWN, str(stored_names(context, site)))
    on_embed = visit(context, site, embed)
    r.check("on the tracker's own site its cookies are blocked too, and other companies' aren't",
            not any(name.startswith("embed_") for name in on_embed) and "top_3p" in on_embed, str(on_embed))
    r.check("Chrome is following what's saved",
            page.evaluate("""async () => {
                const m = await import(chrome.runtime.getURL('lib/rules.js'));
                return await m.rulesInForce((await m.loadRules()).rules);
            }""") is True)

    back(page)
    r.check("with no rule for the site, the Block button says 'Blocking trackers', lit",
            label(page) == "Blocking trackers" and lit(page), label(page))

    # --- the site set to allow all ---
    open_rules(page)
    r.check("the site's choices show none ticked, since it isn't getting 'Allow all cookies'",
            checked(page, "site-rule") is None, str(checked(page, "site-rule")))
    page.locator('input[name="site-rule"][value="allow"]').check()
    wait_saved(page)
    r.check("choosing 'Allow all cookies' gives the site a rule of its own, and says trackers are included",
            listed(page) == [[host, "Allow all cookies"]]
            and message(page) == host + " may set any cookie, known trackers' included.", message(page))
    r.check("TRAP: on the allowed site the tracker's cookies get through",
            visit(context, site, top) == EVERYTHING, str(stored_names(context, site)))
    in_force = page.evaluate("""async () => {
        const m = await import(chrome.runtime.getURL('lib/rules.js'));
        const rules = (await m.loadRules()).rules;
        const before = await m.rulesInForce(rules);
        await chrome.contentSettings.cookies.clear({});
        const lost = await m.rulesInForce(rules);
        await m.applyRules(rules);
        return [before, lost, await m.rulesInForce(rules)];
    }""")
    r.check("the check on opening probes the trackers: right, then wrong once Chrome loses them, then right",
            in_force == [True, False, True], str(in_force))
    back(page)
    r.check("a site's own rule wins on the Block button: 'Block', not lit",
            label(page) == "Block" and not lit(page), label(page))

    # --- off ---
    open_rules(page)
    switch(page, False)
    r.check("turning it off is saved and says so",
            trackers_saved(page) is False and message(page) == "Known trackers' cookies are no longer blocked on every site.",
            message(page))
    page.locator("#rules-rows .rules-remove").first.click()
    wait_saved(page)
    r.check("TRAP: with it off, everything is back as it was",
            visit(context, site, top) == EVERYTHING and len(visit(context, site, embed)) == 5,
            str(stored_names(context, site)))

    # --- delete without asking ---
    visit(context, site, top)
    page.locator("#rules-delete-on-block").check()
    wait_saved(page)
    switch(page, True)
    left = stored_names(context, site)
    r.check("with 'delete without asking', turning it on deletes their cookies straight away, with Undo",
            left == OWN and "Deleted 3 cookies." in message(page)
            and page.locator("#rules-message .undo-button").is_visible()
            and not page.locator("#rules-trackers-cleanup").is_visible(), message(page) + " | " + str(left))

    # --- a copy of the rules ---
    copy = page.evaluate("""async () => {
        const m = await import(chrome.runtime.getURL('lib/rules.js'));
        return m.rulesToBackup((await m.loadRules()).rules);
    }""")
    data = json.loads(copy)
    r.check("the copy carries the switch, and is still version 1",
            data.get("trackers") is True and data.get("version") == 1, copy)
    old = page.evaluate("""async () => {
        const m = await import(chrome.runtime.getURL('lib/rules.js'));
        return m.rulesFromBackup(JSON.stringify({ kind: 'cookieZ site rules', version: 1, everywhere: 'allow', sites: {} }));
    }""")
    r.check("a copy from before 1.8 loads, with the switch off",
            old["error"] is None and old["rules"]["trackers"] is False, json.dumps(old))

    path = PROFILES / "trackers-backup.json"
    path.write_text(copy, encoding="utf-8")
    page.evaluate("async () => { const m = await import(chrome.runtime.getURL('lib/rules.js')); await m.clearRules(); }")
    page.reload()
    page.wait_for_timeout(1100)
    open_rules(page)
    page.locator("#rules-load").set_input_files(str(path))
    page.wait_for_timeout(600)
    r.check("loading it says it blocks known trackers",
            "It also blocks known trackers' cookies." in page.locator("#rules-load-text").text_content(),
            page.locator("#rules-load-text").text_content())
    page.locator("#rules-load-yes").click()
    wait_saved(page)
    r.check("TRAP: after loading, the switch is on and Chrome is blocking them again",
            trackers_saved(page) is True and switch_on(page) and visit(context, site, top) == OWN,
            json.dumps(saved(page)))

    # --- turn off all rules ---
    r.check("with only the switch on, 'Turn off all rules' is offered",
            page.locator("#rules-clear").is_visible())
    page.locator("#rules-clear").click()
    page.wait_for_timeout(300)
    page.locator("#rules-confirm-yes").click()
    wait_saved(page)
    r.check("TRAP: 'Turn off all rules' turns the switch off too, and Chrome lets them through",
            trackers_saved(page) is False and not switch_on(page) and visit(context, site, top) == EVERYTHING,
            json.dumps(saved(page)))

    # --- Chrome refuses ---
    page.evaluate("""() => {
        const cookies = chrome.contentSettings.cookies;
        const real = cookies.set.bind(cookies);
        cookies.set = (details) => details.primaryPattern.includes('made-up-ads')
            ? Promise.reject(new Error('refused by the test')) : real(details);
    }""")
    switch(page, True)
    r.check("TRAP: if Chrome refuses a rule, it says so, the switch goes back off, and nothing is saved",
            message(page) == "Chrome wouldn't accept the rules: refused by the test"
            and not switch_on(page) and trackers_saved(page) is False
            and not page.locator("#rules-body").is_disabled(), message(page))
    r.check("and Chrome is left letting them through", visit(context, site, top) == EVERYTHING,
            str(stored_names(context, site)))

    page.evaluate("async () => { await chrome.storage.local.remove('siteRules'); await chrome.contentSettings.cookies.clear({}); }")
    page.close()
    site.close()


def check_without_permission(r, context, ext_id, server):
    top = server.url(server.TOP_HOST)
    page = new_popup(context, ext_id, top)
    page.evaluate("async () => { await chrome.storage.local.set({ siteRules:"
                  " { everywhere: 'allow', sites: {}, trackers: true } }); }")
    page.close()

    page = new_popup(context, ext_id, top, before=NO_RULES_PERMISSION)
    r.check("TRAP: with the switch saved but no permission, the Block button doesn't claim to be blocking",
            label(page) == "Block" and not lit(page), label(page))
    open_rules(page)
    r.check("the screen asks for the permission, and shows the saved switch ticked but greyed",
            page.locator("#rules-gate").is_visible() and page.locator("#rules-gate-saved").is_visible()
            and switch_on(page) and page.locator("#rules-trackers").is_disabled())
    before = saved(page)
    page.locator("#rules-grant").click()
    page.wait_for_timeout(500)
    r.check("saying no gives a readable message and changes nothing",
            "nothing has changed" in message(page) and saved(page) == before, message(page))
    page.evaluate("async () => { await chrome.storage.local.remove('siteRules'); }")
    page.close()


def main():
    r = Results("Known trackers")

    server = TwoSites(PROFILES / "certs")
    if not server.certificate_available():
        r.check("openssl is available to make a test certificate", False,
                "these checks need a real HTTPS server; install openssl and run again")
        return r.summarise()

    use_test_list()
    server.start()
    try:
        with sync_playwright() as p:
            context = launch(p, "trackers", extra_args=server.chrome_args)
            ext_id = extension_id(context)

            first = new_popup(context, ext_id, server.url(server.TOP_HOST))
            errors = []
            first.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            check_translation(r, first)
            first.close()

            check_switch(r, context, ext_id, server)
            check_without_permission(r, context, ext_id, server)
            r.check("no errors were logged", not errors, str(errors))
            context.close()
    finally:
        server.stop()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
