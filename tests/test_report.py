"""
The Site report: what a site has stored, by purpose, and what's worth checking.

The counts must match the table, and "Show them" must switch on the same
filter, so the report and the main screen can't disagree. Every purpose is a
guess from a cookie's name, and the screen has to say so.
"""

import sys
import time

from playwright.sync_api import sync_playwright

from helpers import Results, extension_id, launch, open_popup

SITE = "https://report.test/"
EMPTY_SITE = "https://empty-report.test/"
LATER = time.time() + 30 * 86400

SEED = [
    {"url": SITE, "name": "_ga", "value": "GA1", "expirationDate": LATER},
    {"url": SITE, "name": "_gid", "value": "GA2", "expirationDate": LATER},
    {"url": SITE, "name": "my_own_thing", "value": "1", "secure": True, "httpOnly": True, "expirationDate": LATER},
    {"url": SITE, "name": "soon_gone", "value": "1", "secure": True, "httpOnly": True,
     "expirationDate": time.time() + 3600},
    {"url": SITE, "name": "big_one", "value": "b" * 3600, "secure": True, "httpOnly": True, "expirationDate": LATER},
]


def rows(page, selector):
    return page.evaluate(
        "(s) => [...document.querySelectorAll(s)].map((row) => row.innerText.replace(/\\s+/g, ' ').trim())",
        selector,
    )


def main():
    r = Results("Site report")

    with sync_playwright() as p:
        context = launch(p, "report")
        ext_id = extension_id(context)

        page, errors = open_popup(context, ext_id, SITE)
        page.evaluate("async (cs) => { for (const c of cs) await chrome.cookies.set(c); }", SEED)
        page.reload()
        page.wait_for_timeout(1200)

        page.locator("#report-open").click()
        page.wait_for_timeout(300)
        r.check("the report opens", page.locator("#state-report").is_visible())
        intro = page.locator("#report-intro").inner_text()
        r.check("it names the site", "report.test" in intro, intro)
        r.check("it says a purpose is a guess from the name", "guess" in intro, intro)

        purposes = rows(page, "#report-rows tr")
        r.check("analytics cookies are grouped, with who usually sets them",
          any(row.startswith("Analytics 2") and "Google" in row for row in purposes), str(purposes))
        r.check("a name not on the list says so, and comes last",
          purposes[-1].startswith("Not recognised 3"), str(purposes))
        counted = page.evaluate(
            "() => [...document.querySelectorAll('#report-rows .report-count')].reduce((n, c) => n + Number(c.textContent), 0)"
        )
        r.check("every cookie is counted once", counted == len(SEED), str(counted))

        checks = rows(page, "#report-check-rows tr")
        r.check("scripts can read the two without HttpOnly",
          any(row.startswith("Readable by the page's scripts") and " 2 " in row for row in checks), str(checks))
        r.check("the large cookie is listed",
          any(row.startswith("Close to Chrome's 4 KB limit") for row in checks), str(checks))
        r.check("a cookie expiring within a day is listed",
          any(row.startswith("Expire within a day") for row in checks), str(checks))

        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        r.check("Esc goes back to the main screen", page.locator("#state-main").is_visible())
        r.check("focus returns to the link",
          page.evaluate("() => document.activeElement.id") == "report-open")

        page.locator("#report-open").click()
        page.wait_for_timeout(300)
        page.locator("#report-check-rows tr", has_text="Close to Chrome").locator("button").click()
        page.wait_for_timeout(500)
        r.check("Show them goes back and switches that filter on",
          page.locator('#filters .chip[data-filter="large"]').get_attribute("aria-pressed") == "true"
          and page.locator("#cookie-rows tr").count() == 1)
        scope = page.locator('input[name="scope"][value="matches"]')
        r.check("and the delete bar offers just the cookies shown", scope.is_visible() or scope.count() == 1)

        stored = page.evaluate("async () => Object.keys(await chrome.storage.local.get(null))")
        r.check("the report saves nothing", not any("report" in key.lower() for key in stored), str(stored))
        r.check("no console errors", not errors, str(errors[:3]))
        page.close()

        # --- a site with no cookies ---
        page, errors = open_popup(context, ext_id, EMPTY_SITE)
        page.wait_for_timeout(600)
        page.locator("#report-open").click()
        page.wait_for_timeout(300)
        r.check("a site with no cookies says so, in place of empty tables",
          page.locator("#report-empty").is_visible() and not page.locator("#report-body").is_visible())
        r.check("no console errors on an empty site", not errors, str(errors[:3]))
        page.close()

        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
