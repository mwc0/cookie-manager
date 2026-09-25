"""
The Keep button.

A kept cookie is skipped by everything this extension deletes. It doesn't
stop a website changing the cookie. That would need a service worker, and
it's left for later.

The most important check is that a kept cookie survives "All sites", the
biggest delete there is. If it doesn't, the button is useless.
"""

import sys

from playwright.sync_api import sync_playwright

from helpers import (
    Results,
    cookies_for,
    delete_button,
    extension_id,
    keep_button,
    launch,
    open_popup,
    row_for,
)

SITE = "https://keep.test/"
HOST = "keep.test"

SEED = [
    {"url": SITE, "name": "important", "value": "keep-me"},
    {"url": SITE, "name": "disposable", "value": "bin-me"},
    {"url": SITE, "name": "also_disposable", "value": "bin-me-too"},
]


def names_left(page):
    return sorted(c["name"] for c in cookies_for(page, HOST))


def main():
    r = Results("Keep / protect flag")

    with sync_playwright() as p:
        context = launch(p, "protect")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)

        page.evaluate("async (seed) => { for (const s of seed) await chrome.cookies.set(s); }", SEED)
        page.reload()
        page.wait_for_timeout(1200)

        # --- turning it on ---
        row = row_for(page, "important")
        r.check("cookies start unkept", keep_button(row).text_content().strip() == "Keep")

        keep_button(row).click()
        page.wait_for_timeout(700)
        row = row_for(page, "important")
        r.check("the button reflects the kept state",
                keep_button(row).text_content().strip() == "Kept"
                and keep_button(row).get_attribute("aria-pressed") == "true")
        r.check("the row is marked as kept",
                "kept-row" in (row.get_attribute("class") or ""),
                row.get_attribute("class"))
        r.check("a kept cookie's Delete button is disabled", delete_button(row).is_disabled())

        # --- still kept after reopening, so it really was saved ---
        page.reload()
        page.wait_for_timeout(1200)
        row = row_for(page, "important")
        r.check("the kept flag survives closing and reopening the popup",
                keep_button(row).text_content().strip() == "Kept")

        # --- the delete summary mentions it ---
        summary = page.locator("#scope-summary").text_content().strip()
        r.check("the scope says what it will leave alone",
                "2 cookies" in summary and "kept" in summary.lower(), summary)

        # --- deleting at page scope spares it ---
        page.locator("#delete-button").click()
        page.wait_for_timeout(300)
        page.locator("#confirm-yes").click()
        page.wait_for_timeout(1200)
        r.check("a page-scope delete spares the kept cookie",
                names_left(page) == ["important"], str(names_left(page)))

        # --- the important one: it survives "All sites" ---
        page.evaluate(
            """async () => {
                await chrome.cookies.set({url:'https://keep.test/', name:'fresh', value:'1'});
                await chrome.cookies.set({url:'https://elsewhere.test/', name:'other', value:'2'});
            }"""
        )
        page.reload()
        page.wait_for_timeout(1200)
        page.locator('input[name="scope"][value="all"]').check()
        page.wait_for_timeout(900)
        all_summary = page.locator("#scope-summary").text_content().strip()
        r.check("'All sites' also reports what it will keep",
                "kept" in all_summary.lower(), all_summary)

        page.locator("#delete-button").click()
        page.wait_for_timeout(300)
        page.locator("#confirm-yes").click()
        page.wait_for_timeout(1500)

        everything = page.evaluate("async () => (await chrome.cookies.getAll({})).map(c => c.name)")
        r.check("a kept cookie survives deleting ALL cookies in the profile",
                everything == ["important"], str(everything))

        # --- turning it off again ---
        row = row_for(page, "important")
        keep_button(row).click()
        page.wait_for_timeout(700)
        row = row_for(page, "important")
        r.check("un-keeping re-enables the Delete button",
                keep_button(row).text_content().strip() == "Keep"
                and not delete_button(row).is_disabled())

        delete_button(row).click()
        page.wait_for_timeout(250)
        delete_button(row).click()
        page.wait_for_timeout(900)
        r.check("and then it can be deleted normally", names_left(page) == [], str(names_left(page)))

        r.check("no console errors", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
