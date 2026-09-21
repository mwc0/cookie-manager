"""
Search / filter, and its interaction with the delete scopes.

The interaction is the dangerous part. Filtering the table to three rows and
then pressing Delete must not quietly remove the forty cookies the scope
covers -- the screen would be saying one thing and doing another, which is the
failure this whole extension exists to avoid. So search adds a "just the
cookies shown" scope, and these tests pin down that it deletes exactly what is
on screen and nothing else.
"""

import json
import sys

from playwright.sync_api import sync_playwright

from helpers import Results, cookies_for, extension_id, launch, open_popup

SITE = "https://search.test/"
HOST = "search.test"

SEED = [
    {"url": SITE, "name": "session_id", "value": "abc123"},
    {"url": SITE, "name": "session_token", "value": "def456"},
    {"url": SITE, "name": "tracking_id", "value": "xyz789"},
    {"url": SITE, "name": "theme", "value": "dark"},
    {"url": "https://other.search.test/", "name": "sub_cookie", "value": "SESSION-in-value"},
]


def rows(page):
    return page.evaluate("() => document.getElementById('cookie-rows').children.length")


def row_names(page):
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('#cookie-rows td.name')).map(td => td.textContent)"
    )


def search(page, text):
    page.fill("#search-input", text)
    page.wait_for_timeout(700)


def main():
    r = Results("Search / filter")

    with sync_playwright() as p:
        context = launch(p, "search")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)

        page.evaluate(
            "async (seed) => { for (const s of seed) await chrome.cookies.set(s); }", SEED
        )
        page.reload()
        page.wait_for_timeout(1200)
        r.check("all seeded cookies are listed to begin with", rows(page) == 5, str(row_names(page)))

        # --- matching by name ---
        search(page, "session")
        names = row_names(page)
        r.check("searching by name narrows the table",
                sorted(names) == ["session_id", "session_token", "sub_cookie"],
                str(names))
        r.check("the count shows the filtered total and the real one",
                "3 cookies of 5 cookies" in page.locator("#cookie-count").text_content(),
                repr(page.locator("#cookie-count").text_content().strip()))

        # sub_cookie matches on its VALUE ("SESSION-in-value"), which also
        # proves the search is case-insensitive.
        r.check("search covers values too, case-insensitively", "sub_cookie" in names)

        # --- matching by domain ---
        search(page, "other.")
        r.check("searching by domain works", row_names(page) == ["sub_cookie"], str(row_names(page)))

        # --- no matches ---
        search(page, "nothing-matches-this")
        no_match_message = page.locator("#empty-message").text_content()
        r.check("a search with no matches says so, without claiming the site has no cookies",
                rows(page) == 0 and "match" in no_match_message.lower()
                and "No cookies are set for this site" not in no_match_message,
                repr(no_match_message.strip()))

        # --- clearing ---
        page.locator("#search-clear").click()
        page.wait_for_timeout(600)
        r.check("clearing the search restores every row", rows(page) == 5)
        r.check("the clear button hides when there's nothing to clear",
                page.evaluate("() => document.getElementById('search-clear').hidden"))

        # --- the scope only appears while filtering ---
        r.check("no 'cookies shown' scope when not filtering",
                page.evaluate("() => document.getElementById('scope-matches-row').hidden"))
        search(page, "session")
        r.check("'cookies shown' scope appears while filtering",
                not page.evaluate("() => document.getElementById('scope-matches-row').hidden"))

        # --- THE IMPORTANT ONE: filtered delete removes only what's shown ---
        page.locator('input[name="scope"][value="matches"]').check()
        page.wait_for_timeout(700)
        summary = page.locator("#scope-summary").text_content().strip()
        r.check("the scope summary counts only the matches", "3 cookies" in summary, summary)

        page.locator("#delete-button").click()
        page.wait_for_timeout(300)
        confirm = page.locator("#confirm-text").text_content().strip()
        page.locator("#confirm-yes").click()
        page.wait_for_timeout(1200)
        result = page.locator("#delete-result").text_content().strip()

        left = sorted(c["name"] for c in cookies_for(page, HOST))
        r.check("the claim, the confirm and the result agree on 3",
                "3 cookies" in summary and "3 cookies" in confirm and "3 cookies" in result,
                f"{summary!r} -> {confirm!r} -> {result!r}")
        r.check("ONLY the matching cookies were deleted",
                left == ["theme", "tracking_id"], str(left))

        # --- falling back when the filter is cleared ---
        page.fill("#search-input", "")
        page.wait_for_timeout(700)
        r.check("clearing the filter drops the now-meaningless scope",
                page.evaluate("""() => document.querySelector('input[name=\\"scope\\"]:checked').value""") != "matches",
                page.evaluate("""() => document.querySelector('input[name=\\"scope\\"]:checked').value"""))

        r.check("no console errors", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
