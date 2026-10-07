"""
"What changed": the list of what has happened to this site's cookies while
cookieZ has been open.

The privacy policy says nothing about the site's changes is kept once
cookieZ closes, and that cookie values are never stored. So besides showing
the right things in the right words, the list must hold names only, and it
must be empty again after a reload.
"""

import json
import sys

from playwright.sync_api import sync_playwright

from helpers import Results, extension_id, launch, open_popup, visible_state

SITE = "https://changes.test/"


def link_text(page):
    link = page.locator("#changes-open")
    return link.text_content().strip() if link.is_visible() else None


def listed(page):
    return page.evaluate("""() => [...document.querySelectorAll('#changes-rows tr')].map(row => [
        row.querySelector('.changes-name').textContent,
        row.querySelector('.changes-site').textContent,
        row.querySelector('.changes-what').textContent,
    ])""")


def set_cookie(page, details):
    page.evaluate("async (d) => { await chrome.cookies.set(d); }", details)
    page.wait_for_timeout(250)


def main():
    r = Results("What changed")

    with sync_playwright() as p:
        context = launch(p, "changes")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)

        r.check("with nothing changed, there's no link", link_text(page) is None, repr(link_text(page)))

        # The site sets a cookie, changes it, then removes it. Another site
        # sets one too, which is none of this page's business.
        set_cookie(page, {"url": SITE, "name": "visit", "value": "SECRETVALUE-1"})
        set_cookie(page, {"url": SITE, "name": "visit", "value": "SECRETVALUE-2"})
        set_cookie(page, {"url": "https://unrelated.test/", "name": "other", "value": "x"})
        page.evaluate("async (u) => { await chrome.cookies.remove({ url: u, name: 'visit' }); }", SITE)
        page.wait_for_timeout(250)
        # A date in the past is how a site deletes a cookie itself.
        set_cookie(page, {"url": SITE, "name": "stale", "value": "SECRETVALUE-3"})
        set_cookie(page, {"url": SITE, "name": "stale", "value": "SECRETVALUE-3", "expirationDate": 1000})
        page.wait_for_timeout(1300)

        r.check("the link counts each change once", link_text(page) == "5 changes", repr(link_text(page)))

        page.locator("#changes-open").click()
        page.wait_for_timeout(400)
        r.check("the link opens the What changed screen",
                visible_state(page) == "state-changes", str(visible_state(page)))

        rows = listed(page)
        expected = [
            ["stale", "changes.test", "Removed, by setting a date in the past"],
            ["stale", "changes.test", "Added"],
            ["visit", "changes.test", "Removed"],
            ["visit", "changes.test", "Changed"],
            ["visit", "changes.test", "Added"],
        ]
        r.check("newest first, in plain words, and a change isn't listed as remove-then-add",
                rows == expected, json.dumps(rows))
        r.check("another site's cookies aren't listed",
                all(row[0] != "other" for row in rows))
        screen = page.locator("#state-changes").text_content()
        r.check("no cookie value appears anywhere on the screen", "SECRETVALUE" not in screen)

        # --- it keeps up while it's the screen showing ---
        set_cookie(page, {"url": SITE, "name": "late", "value": "SECRETVALUE-4"})
        r.check("a change that happens while the list is open is added at the top",
                listed(page)[0] == ["late", "changes.test", "Added"] and len(listed(page)) == 6,
                json.dumps(listed(page)[:2]))

        # --- back, by Esc ---
        page.keyboard.press("Escape")
        page.wait_for_timeout(1500)
        names = page.evaluate(
            "() => Array.from(document.querySelectorAll('#cookie-rows td.name')).map(td => td.textContent)"
        )
        r.check("Esc goes back, and the table has caught up meanwhile",
                visible_state(page) == "state-main" and names == ["late"] and link_text(page) == "6 changes",
                f"{visible_state(page)}, rows {names}, link {link_text(page)!r}")

        # --- cookieZ's own actions are changes too ---
        page.locator("#add-button").click()
        page.wait_for_timeout(300)
        page.fill("#field-name", "mine")
        page.fill("#field-value", "x")
        page.locator("#edit-save").click()
        page.wait_for_timeout(1300)
        page.locator("#changes-open").click()
        page.wait_for_timeout(400)
        r.check("a cookie you add in cookieZ is listed like any other change",
                listed(page)[0] == ["mine", "changes.test", "Added"], json.dumps(listed(page)[:1]))
        page.locator("#changes-back").click()
        page.wait_for_timeout(400)

        # --- nothing is kept ---
        stored = page.evaluate("""async () => JSON.stringify([
            await chrome.storage.local.get(null), await chrome.storage.session.get(null), {...localStorage},
        ])""")
        r.check("the list isn't written to any storage",
                "late" not in stored and "stale" not in stored and "Removed" not in stored, stored[:300])
        page.reload()
        page.wait_for_timeout(1200)
        r.check("after closing and reopening, the list has gone", link_text(page) is None, repr(link_text(page)))

        r.check("no console errors throughout", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
