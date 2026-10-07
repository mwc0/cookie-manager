"""
The live table: it follows the site's cookie changes without Refresh.

The site is stood in for by chrome.cookies.set and remove, called from the
popup's own page. Chrome reports those changes exactly as it reports a
site's, through chrome.cookies.onChanged.

The other half is that it never pulls the rug: nothing is redrawn while
"Delete these cookies?" is showing, while a row says "Sure?", or while the
editor is open. And a redraw keeps the search, ticks and opened values.
"""

import sys

from playwright.sync_api import sync_playwright

from helpers import (
    Results,
    delete_button,
    edit_button,
    extension_id,
    launch,
    open_popup,
    row_for,
)

SITE = "https://live.test/"

SEED = """async () => {
    const set = (d) => chrome.cookies.set(d);
    await set({url: 'https://live.test/', name: 'alpha', value: 'a1'});
    await set({url: 'https://live.test/', name: 'beta', value: 'b1'});
    await set({url: 'https://live.test/', name: 'long_one',
               value: 'a-long-value-that-is-cut-short-in-the-table-0123456789'});
}"""


def site_sets(page, name, value, url="https://live.test/"):
    page.evaluate("([url, name, value]) => chrome.cookies.set({url, name, value})", [url, name, value])


def site_removes(page, name):
    page.evaluate("(name) => chrome.cookies.remove({url: 'https://live.test/', name})", name)


def has_row(page, name):
    return row_for(page, name).count() > 0


def value_of(page, name):
    return row_for(page, name).locator("td.value").text_content().strip()


def live_note(page):
    return page.locator("#live-note").text_content().strip()


# Counts how many times the table is drawn: each draw empties the table body
# in one go.
COUNT_DRAWS = """() => {
    window.__draws = 0;
    new MutationObserver((records) => {
        if (records.some((r) => [...r.removedNodes].some((n) => n.nodeName === 'TR'))) window.__draws += 1;
    }).observe(document.getElementById('cookie-rows'), {childList: true});
}"""

# Contrast of the "just changed" tint against the text drawn on it, in both
# themes. WCAG 2.2: 4.5:1 for text.
CONTRAST = """() => {
    const lum = (hex) => {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
            .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    };
    const out = {};
    for (const theme of ['light', 'dark']) {
        document.documentElement.dataset.theme = theme;
        const style = getComputedStyle(document.documentElement);
        const v = (name) => style.getPropertyValue(name).trim();
        out[theme] = Math.min(ratio(v('--changed'), v('--fg')), ratio(v('--changed'), v('--muted')));
    }
    return out;
}"""


def main():
    r = Results("Live table")

    with sync_playwright() as p:
        context = launch(p, "live")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)
        page.evaluate(SEED)
        page.reload()
        page.wait_for_timeout(1200)
        r.check("nothing is marked on first load",
                page.locator("#cookie-rows tr.changed").count() == 0)

        # --- added, changed, removed: all without Refresh ---
        site_sets(page, "fresh", "f1")
        page.wait_for_timeout(1500)
        r.check("a cookie the site sets appears without Refresh",
                has_row(page, "fresh"), str(page.locator("#cookie-rows tr").count()))
        r.check("and its row is marked as just changed",
                "changed" in (row_for(page, "fresh").get_attribute("class") or ""))
        r.check("screen readers hear about it", live_note(page) == "1 cookie added.", live_note(page))
        r.check("no status message covers the status line",
                page.locator("#main-message").is_hidden(), page.locator("#main-message").text_content())

        site_sets(page, "alpha", "a2")
        page.wait_for_timeout(1500)
        r.check("a changed value shows, and is marked",
                value_of(page, "alpha") == "a2"
                and "changed" in (row_for(page, "alpha").get_attribute("class") or "")
                and "changed" not in (row_for(page, "beta").get_attribute("class") or ""),
                value_of(page, "alpha"))
        r.check("screen readers hear that too", live_note(page) == "1 cookie changed.", live_note(page))

        site_removes(page, "beta")
        page.wait_for_timeout(1500)
        r.check("a cookie the site removes goes", not has_row(page, "beta"))
        r.check("and that's announced", live_note(page) == "1 cookie removed.", live_note(page))

        page.wait_for_timeout(3200)
        r.check("the marks clear after a few seconds",
                page.locator("#cookie-rows tr.changed").count() == 0)

        # --- other sites don't redraw this one ---
        page.evaluate(COUNT_DRAWS)
        site_sets(page, "elsewhere", "e", url="https://other.test/")
        page.wait_for_timeout(1500)
        r.check("a change on another site doesn't redraw the table",
                page.evaluate("() => window.__draws") == 0, str(page.evaluate("() => window.__draws")))

        # --- bursts are gathered up ---
        page.evaluate("""async () => {
            for (let i = 0; i < 12; i += 1) {
                await chrome.cookies.set({url: 'https://live.test/', name: 'burst', value: 'v' + i});
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }""")
        page.wait_for_timeout(1500)
        draws = page.evaluate("() => window.__draws")
        r.check("12 changes over 1.2 seconds draw the table at most a few times",
                1 <= draws <= 3 and value_of(page, "burst") == "v11", f"{draws} draws")

        # --- ticks, search and opened values survive a redraw ---
        row_for(page, "alpha").locator("td.pick input").check()
        row_for(page, "long_one").locator(".value-toggle").click()
        page.wait_for_timeout(300)
        site_sets(page, "fresh", "f2")
        page.wait_for_timeout(1500)
        r.check("a tick survives a redraw",
                row_for(page, "alpha").locator("td.pick input").is_checked())
        r.check("an opened value stays open",
                "expanded" in (row_for(page, "long_one").locator("td.value").get_attribute("class") or ""))
        page.fill("#search-input", "fre")
        page.wait_for_timeout(300)
        site_sets(page, "fresh", "f3")
        page.wait_for_timeout(1500)
        r.check("the search still applies after a redraw",
                page.locator("#cookie-rows tr").count() == 1 and value_of(page, "fresh") == "f3",
                str(page.locator("#cookie-rows tr").count()))
        page.locator("#search-clear").click()
        page.wait_for_timeout(300)

        # --- it waits while "Delete these cookies?" is showing ---
        page.locator("#delete-button").click()
        page.wait_for_timeout(300)
        site_sets(page, "during_confirm", "x")
        page.wait_for_timeout(1500)
        r.check("nothing is redrawn while the delete asks to be confirmed",
                page.locator("#confirm-row").is_visible() and not has_row(page, "during_confirm"))
        page.locator("#confirm-no").click()
        page.wait_for_timeout(1700)
        r.check("and the change shows once it's cancelled", has_row(page, "during_confirm"))

        # --- and while a row says "Sure?" ---
        delete_button(row_for(page, "fresh")).click()
        page.wait_for_timeout(300)
        site_sets(page, "during_sure", "x")
        page.wait_for_timeout(1500)
        r.check("nothing is redrawn while a row says Sure?",
                delete_button(row_for(page, "fresh")).text_content().strip() == "Sure?"
                and not has_row(page, "during_sure"))
        row_for(page, "fresh").locator("button.cancel").click()
        page.wait_for_timeout(1700)
        r.check("and the change shows once it's cancelled", has_row(page, "during_sure"))

        # --- the editor says when its cookie changes underneath it ---
        edit_button(row_for(page, "alpha")).click()
        page.wait_for_timeout(400)
        r.check("the editor opens without the note", page.locator("#edit-changed").is_hidden())
        site_sets(page, "alpha", "a3")
        page.wait_for_timeout(600)
        r.check("the editor says the site changed this cookie",
                page.locator("#edit-changed").is_visible()
                and "Saving will overwrite it" in " ".join(page.locator("#edit-changed").text_content().split()))
        site_sets(page, "during_edit", "x")
        page.wait_for_timeout(1500)
        r.check("the editor stays open", page.locator("#state-edit").is_visible())
        page.locator("#edit-cancel").click()
        page.wait_for_timeout(1700)
        r.check("back on the table, the changes are there",
                value_of(page, "alpha") == "a3" and has_row(page, "during_edit"), value_of(page, "alpha"))

        edit_button(row_for(page, "alpha")).click()
        page.wait_for_timeout(400)
        page.fill("#field-value", "mine")
        page.locator("#edit-save").click()
        page.wait_for_timeout(400)
        edit_button(row_for(page, "alpha")).click()
        page.wait_for_timeout(400)
        r.check("saving from the editor isn't taken for the site changing it",
                page.locator("#edit-changed").is_hidden())
        page.locator("#edit-cancel").click()
        page.wait_for_timeout(500)

        contrast = page.evaluate(CONTRAST)
        r.check("text on the just-changed tint reads at 4.5:1 or more in both themes",
                all(value >= 4.5 for value in contrast.values()), str(contrast))

        r.check("no console errors throughout", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
