"""
The quick filters above the table, and sorting by size.

The filters share the search box's risk: once the table shows fewer cookies,
Delete mustn't remove the ones that were filtered out. So "Just the cookies
shown" has to appear for a filter exactly as it does for a search, and delete
exactly the rows on screen. These tests read Chrome's cookie store to check.
"""

import json
import sys
import time

from playwright.sync_api import sync_playwright

from helpers import Results, cookies_for, extension_id, keep_button, launch, open_popup, row_for

SITE = "https://filters.test/"
HOST = "filters.test"

SOON = time.time() + 5 * 3600
LATER = time.time() + 30 * 86400

SEED = [
    {"url": SITE, "name": "plain", "value": "1", "expirationDate": LATER},
    {"url": SITE, "name": "secure_session", "value": "1", "secure": True},
    {"url": SITE, "name": "secure_later", "value": "1", "secure": True, "expirationDate": LATER},
    {"url": SITE, "name": "hidden_session", "value": "1", "httpOnly": True},
    {"url": SITE, "name": "soon", "value": "1", "expirationDate": SOON},
    {"url": SITE, "name": "big", "value": "b" * 3600, "expirationDate": LATER},
]


def names(page):
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('#cookie-rows td.name')).map(td => td.textContent)"
    )


def chips(page):
    """The filters on screen, and which are switched on."""
    return page.evaluate("""() => {
        const out = {};
        if (document.getElementById('filters').hidden) return out;
        for (const chip of document.querySelectorAll('#filters .chip')) {
            if (!chip.hidden) out[chip.dataset.filter] = chip.getAttribute('aria-pressed') === 'true';
        }
        return out;
    }""")


def press(page, name):
    page.locator(f'#filters .chip[data-filter="{name}"]').click()
    page.wait_for_timeout(500)


def main():
    r = Results("Quick filters and sorting by size")

    with sync_playwright() as p:
        context = launch(p, "filters")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)

        r.check("with no cookies there are no filters to show", chips(page) == {}, json.dumps(chips(page)))

        page.evaluate("async (seed) => { for (const s of seed) await chrome.cookies.set(s); }", SEED)
        page.reload()
        page.wait_for_timeout(1200)

        # --- which filters are offered ---
        shown = chips(page)
        r.check("only filters that match a cookie on this site are offered",
                sorted(shown) == ["httponly", "large", "secure", "session", "soon"]
                and not any(shown.values()),
                json.dumps(shown))

        sizes = page.evaluate("""() => [...document.querySelectorAll('#filters .chip')]
            .filter(c => !c.hidden).map(c => { const b = c.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })""")
        r.check("every filter is at least 24 x 24px",
                all(w >= 24 and h >= 24 for w, h in sizes), str(sizes))

        keep_button(row_for(page, "plain")).click()
        page.wait_for_timeout(600)
        r.check("marking a cookie as Kept adds the Kept filter", "kept" in chips(page), json.dumps(chips(page)))

        # --- one filter ---
        press(page, "secure")
        r.check("Secure shows only the Secure cookies",
                sorted(names(page)) == ["secure_later", "secure_session"] and chips(page)["secure"] is True,
                str(names(page)))
        count = page.locator("#cookie-count").text_content()
        r.check("the count says how many of how many", count.startswith("2 cookies of 6 cookies"), repr(count))
        r.check("Clear appears", page.locator("#search-clear").is_visible())

        # --- two filters add up ---
        press(page, "session")
        r.check("Secure and Session together shows cookies that are both",
                names(page) == ["secure_session"], str(names(page)))

        # --- a filter and the search box together ---
        press(page, "secure")
        page.fill("#search-input", "hidden")
        page.wait_for_timeout(700)
        r.check("a filter and a search narrow the table together",
                names(page) == ["hidden_session"], str(names(page)))
        page.fill("#search-input", "")
        page.wait_for_timeout(700)

        # --- deleting what a filter shows ---
        scope_row = page.locator("#scope-matches-row")
        r.check("'Just the cookies shown' appears for a filter, as it does for a search",
                scope_row.is_visible()
                and page.locator("#scope-target-matches").text_content().strip() == "2 matches",
                repr(page.locator("#scope-target-matches").text_content()))
        page.locator('input[name="scope"][value="matches"]').check()
        page.wait_for_timeout(500)
        summary = page.locator("#scope-summary").text_content()
        page.locator("#delete-button").click()
        page.wait_for_timeout(300)
        page.locator("#confirm-yes").click()
        page.wait_for_timeout(1200)
        left = sorted(c["name"] for c in cookies_for(page, HOST))
        r.check("deleting the cookies shown deletes exactly the filtered rows",
                left == ["big", "plain", "secure_later", "soon"] and "2 cookies" in summary,
                f"summary {summary!r}, left {left}")

        # --- a filter that's on stays on screen with nothing to show ---
        state = chips(page)
        r.check("a filter that's switched on stays, so it can be switched off",
                state.get("session") is True and names(page) == [],
                json.dumps(state))
        empty = page.locator("#empty-message").text_content().strip()
        r.check("and the table says nothing matches the filters",
                empty == "No cookies here match those filters.", repr(empty))

        page.locator("#search-clear").click()
        page.wait_for_timeout(600)
        after = chips(page)
        r.check("Clear switches every filter off and brings the cookies back",
                not any(after.values()) and len(names(page)) == 4 and "session" not in after,
                f"{json.dumps(after)}, {names(page)}")

        # --- sorting by size ---
        sort = page.locator('button.sort[data-sort="size"]')
        sort.click()
        page.wait_for_timeout(400)
        first = names(page)[0]
        aria = sort.evaluate("b => b.parentElement.getAttribute('aria-sort')")
        r.check("the Value heading sorts by size, biggest first",
                first == "big" and aria == "descending", f"first {first!r}, aria-sort {aria!r}")
        sort.click()
        page.wait_for_timeout(400)
        r.check("clicking it again puts the biggest last",
                names(page)[-1] == "big"
                and sort.evaluate("b => b.parentElement.getAttribute('aria-sort')") == "ascending",
                str(names(page)))

        # --- the Size column ---
        hidden_here = page.evaluate("getComputedStyle(document.querySelector('#cookie-rows td.size')).display")
        page.evaluate("document.body.classList.add('in-tab')")
        in_tab = page.evaluate("""() => ({
            display: getComputedStyle(document.querySelector('#cookie-rows td.size')).display,
            text: [...document.querySelectorAll('#cookie-rows tr')]
                .find(row => row.querySelector('td.name').textContent === 'big').querySelector('td.size').textContent,
        })""")
        page.evaluate("document.body.classList.remove('in-tab')")
        r.check("the Size column is hidden in the popup and shown in the tab view",
                hidden_here == "none" and in_tab["display"] == "table-cell" and in_tab["text"] == "3.5 KB",
                f"popup {hidden_here!r}, tab {json.dumps(in_tab)}")

        r.check("no console errors throughout", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
