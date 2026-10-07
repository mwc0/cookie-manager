"""
The "Kept cookies" screen: every cookie marked as Kept, on every site.

It shows the list cookieZ has saved, and lets you stop keeping any of them.
Two things matter most. It must show the whole list, including sites other
than the one the popup is open on, because nowhere else shows those. And it
must never show a cookie's value: the saved list doesn't hold values, and
this screen mustn't go and fetch them.
"""

import json
import sys

from playwright.sync_api import sync_playwright

from helpers import Results, extension_id, keep_button, launch, open_popup, row_for, visible_state

SITE = "https://kept.test/"
HOST = "kept.test"

SEED = [
    {"url": SITE, "name": "login", "value": "SECRETVALUE-one"},
    {"url": SITE, "name": "theme", "value": "SECRETVALUE-two"},
    {"url": "https://elsewhere.test/", "name": "basket", "value": "SECRETVALUE-three"},
]

# How a kept cookie is saved: domain, path, name and partition, one per line.
# These two are for other sites, as if they'd been kept on an earlier visit.
ELSEWHERE = "elsewhere.test\n/\nbasket\n"
PARTITIONED = 'embed.test\n/widget\nframe_id\n{"topLevelSite":"https://shop.test"}'


def saved(page):
    return page.evaluate("async () => (await chrome.storage.local.get('protectedCookies')).protectedCookies || []")


def listed(page):
    return page.evaluate("""() => [...document.querySelectorAll('#kept-rows tr')].map(row => [
        row.querySelector('.kept-name').textContent,
        row.querySelector('.kept-site').firstChild.textContent.trim(),
        row.querySelector('.kept-path').textContent,
    ])""")


def link_text(page):
    link = page.locator("#kept-open")
    return link.text_content().strip() if link.is_visible() else None


def main():
    r = Results("The Kept cookies screen")

    with sync_playwright() as p:
        context = launch(p, "kept-list")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)

        page.evaluate("async (seed) => { for (const s of seed) await chrome.cookies.set(s); }", SEED)
        page.reload()
        page.wait_for_timeout(1200)
        r.check("with nothing kept, there's no link to the list", link_text(page) is None, repr(link_text(page)))

        # One kept here, two that were kept on other sites.
        keep_button(row_for(page, "login")).click()
        page.wait_for_timeout(600)
        page.evaluate(
            "async (extra) => { const k = 'protectedCookies'; const now = (await chrome.storage.local.get(k))[k] || [];"
            " await chrome.storage.local.set({ [k]: now.concat(extra) }); }",
            [ELSEWHERE, PARTITIONED],
        )
        page.reload()
        page.wait_for_timeout(1200)
        r.check("the link counts the whole list, not just this site's",
                link_text(page) == "Kept cookies: 3", repr(link_text(page)))

        # --- the list ---
        page.locator("#kept-open").click()
        page.wait_for_timeout(500)
        r.check("the link opens the Kept cookies screen", visible_state(page) == "state-kept", str(visible_state(page)))
        rows = listed(page)
        r.check("every kept cookie is listed, sorted by site, other sites included",
                rows == [["basket", "elsewhere.test", "/"], ["frame_id", "embed.test", "/widget"], ["login", "kept.test", "/"]],
                json.dumps(rows))
        badge = page.locator("#kept-rows .badge")
        r.check("a partitioned cookie says so, and which site it's kept for",
                badge.count() == 1 and badge.first.text_content() == "Partitioned"
                and "https://shop.test" in (badge.first.get_attribute("title") or ""),
                repr(badge.first.get_attribute("title") if badge.count() else None))
        screen = page.locator("#state-kept").text_content()
        r.check("no cookie value appears anywhere on the screen", "SECRETVALUE" not in screen)

        # --- stop keeping one ---
        page.locator("#kept-rows tr", has_text="basket").locator("button.kept-stop").click()
        page.wait_for_timeout(500)
        message = page.locator("#kept-message").text_content().strip()
        r.check("Stop keeping removes that one from the saved list",
                ELSEWHERE not in saved(page) and len(saved(page)) == 2
                and [row[0] for row in listed(page)] == ["frame_id", "login"],
                f"{message!r}, saved {len(saved(page))}")
        r.check("and says which one", message == "No longer keeping basket on elsewhere.test.", repr(message))

        # --- Esc goes back, and the table agrees ---
        page.keyboard.press("Escape")
        page.wait_for_timeout(600)
        still_kept = "kept-row" in (row_for(page, "login").get_attribute("class") or "")
        r.check("Esc goes back to the table, with the count updated",
                visible_state(page) == "state-main" and link_text(page) == "Kept cookies: 2" and still_kept,
                f"{visible_state(page)}, {link_text(page)!r}, login kept: {still_kept}")
        r.check("the list's rows are cleared when it closes",
                page.locator("#kept-rows tr").count() == 0)

        # --- stop keeping all, which asks first ---
        page.locator("#kept-open").click()
        page.wait_for_timeout(500)
        page.locator("#kept-clear").click()
        page.wait_for_timeout(300)
        question = page.locator("#kept-confirm-text").text_content().strip()
        r.check("Stop keeping all asks first and changes nothing yet",
                question == "Stop keeping all 2 cookies?" and len(saved(page)) == 2
                and not page.locator("#kept-clear").is_visible(),
                f"{question!r}, saved {len(saved(page))}")
        page.locator("#kept-confirm-no").click()
        page.wait_for_timeout(300)
        r.check("Cancel leaves the list alone",
                len(saved(page)) == 2 and page.locator("#kept-clear").is_visible()
                and not page.locator("#kept-confirm").is_visible())

        page.locator("#kept-clear").click()
        page.wait_for_timeout(300)
        page.locator("#kept-confirm-yes").click()
        page.wait_for_timeout(600)
        empty = page.locator("#kept-empty")
        r.check("Yes empties the saved list and says the list is empty",
                saved(page) == [] and empty.is_visible()
                and not page.locator("#kept-table").is_visible()
                and not page.locator("#kept-clear").is_visible(),
                f"saved {saved(page)}, message {page.locator('#kept-message').text_content()!r}")

        page.locator("#kept-back").click()
        page.wait_for_timeout(600)
        no_longer = "kept-row" not in (row_for(page, "login").get_attribute("class") or "")
        r.check("back at the table, nothing is kept and the link has gone",
                no_longer and link_text(page) is None,
                f"login unkept: {no_longer}, link {link_text(page)!r}")

        r.check("no console errors throughout", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
