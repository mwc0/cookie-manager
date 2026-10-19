"""
"Clear site data", and the "What's new" line.

Clear site data deletes a site's cookies the usual way and asks Chrome to
clear everything else the site has stored. The traps are the edges: Kept
cookies must stay, Undo must bring the cookies back, and another site's
data must not be touched. So the check uses a real page on a local HTTPS
server, puts something in each site's local storage, and looks again
afterwards.

"What's new" shows once, the first time cookieZ opens on a new version.
"""

import sys

from playwright.sync_api import sync_playwright

from helpers import PROFILES, Results, extension_id, launch
from test_rules import NO_RULES_PERMISSION, TwoSites, new_popup, stored_names, visit

NO_DATA_PERMISSION = NO_RULES_PERMISSION.replace("'contentSettings'", "'browsingData'")


def stored_value(page, url):
    page.goto(url)
    page.wait_for_timeout(500)
    return page.evaluate("() => localStorage.getItem('k')")


def main():
    r = Results("Clear site data, and What's new")

    server = TwoSites(PROFILES / "certs")
    if not server.certificate_available():
        r.check("openssl is available to make a test certificate", False, "install openssl and run again")
        return r.summarise()

    server.start()
    top, embed = server.url(server.TOP_HOST), server.url(server.EMBED_HOST)
    host = server.TOP_HOST
    try:
        with sync_playwright() as p:
            context = launch(p, "site-data", extra_args=server.chrome_args)
            ext_id = extension_id(context)
            site = context.new_page()

            # Both sites get cookies and something in local storage. Loading
            # the other site also gives this one four cookies it set there as
            # "another company", which count as this site's: 4 to delete.
            visit(context, site, top)
            site.evaluate("() => localStorage.setItem('k', 'top')")
            visit(context, site, embed, clear=False)
            site.evaluate("() => localStorage.setItem('k', 'embed')")

            page = new_popup(context, ext_id, top)
            page.evaluate("async (key) => { await chrome.storage.local.set({ protectedCookies: [key] }); }",
                          host + "\n/\ntop_js\n")
            page.reload()
            page.wait_for_timeout(1200)

            page.locator("#data-button").click()
            page.wait_for_timeout(600)
            question = page.locator("#data-confirm-text").text_content()
            r.check("it asks first, with the count, the kept cookie, and that Undo can't bring the rest back",
                    page.locator("#data-confirm").is_visible()
                    and question.startswith("Delete 4 cookies from " + host + " and clear everything else")
                    and "1 kept cookie will be left alone." in question
                    and "Undo can put the cookies back, but not the rest." in question, question)
            r.check("the other delete buttons step aside while it asks",
                    not page.locator("#delete-button").is_visible() and not page.locator("#data-button").is_visible())
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            r.check("Esc backs out, and nothing was cleared",
                    not page.locator("#data-confirm").is_visible()
                    and "top_header" in stored_names(context, site), str(stored_names(context, site)))

            page.locator("#data-button").click()
            page.wait_for_timeout(600)
            page.locator("#data-yes").click()
            page.wait_for_timeout(1500)
            left = stored_names(context, site)
            r.check("TRAP: the site's cookies are gone, the kept one stays, and the other site's are untouched",
                    not {"top_header", "top_3p", "top_3pjs", "top_chips"} & set(left) and "top_js" in left
                    and {"embed_header", "embed_js"} <= set(left), str(left))
            message = page.locator("#main-message").text_content()
            r.check("it says what it did, with Undo",
                    message.startswith("Deleted 4 cookies and cleared " + host + "'s other stored data.")
                    and page.locator("#main-message .undo-button").is_visible(), message)
            r.check("TRAP: the site's local storage is cleared, and the other site's isn't",
                    stored_value(site, top) is None and stored_value(site, embed) == "embed",
                    "top={}, embed={}".format(stored_value(site, top), stored_value(site, embed)))
            page.locator("#main-message .undo-button").click()
            page.wait_for_timeout(1000)
            r.check("Undo puts the cookie back", "top_header" in stored_names(context, site),
                    str(stored_names(context, site)))
            page.close()

            # Saying no to the permission.
            declined = new_popup(context, ext_id, top, before=NO_DATA_PERMISSION)
            declined.locator("#data-button").click()
            declined.wait_for_timeout(500)
            r.check("saying no to the permission clears nothing, and says so",
                    declined.locator("#main-message").text_content() == "Chrome didn't give permission, so nothing was cleared."
                    and not declined.locator("#data-confirm").is_visible()
                    and "top_header" in stored_names(context, site),
                    declined.locator("#main-message").text_content())
            declined.close()

            # What's new.
            news = new_popup(context, ext_id, top)
            news.evaluate("async () => { await chrome.storage.local.remove('seenVersion'); }")
            news.reload()
            news.wait_for_timeout(1200)
            r.check("the first open on a new version shows what's new",
                    news.locator("#whats-new").is_visible()
                    and "Block button" in news.locator("#whats-new-text").text_content(),
                    news.locator("#whats-new-text").text_content())
            saved = news.evaluate("async () => (await chrome.storage.local.get('seenVersion')).seenVersion")
            r.check("only the version number is saved", saved == news.evaluate("() => chrome.runtime.getManifest().version"),
                    str(saved))
            news.locator("#whats-new-close").click()
            r.check("OK hides it", not news.locator("#whats-new").is_visible())
            news.reload()
            news.wait_for_timeout(1200)
            r.check("and it doesn't come back next time", not news.locator("#whats-new").is_visible())
            news.close()
            context.close()
    finally:
        server.stop()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
