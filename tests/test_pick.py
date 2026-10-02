"""
Ticking cookies in the table.

"Just the ticked cookies" has to delete exactly the ticked cookies and
nothing else, the same promise every other scope makes. Kept cookies are
still left alone, even when ticked.
"""

import json
import sys

from playwright.sync_api import sync_playwright

from helpers import (
    Results,
    cookies_for,
    extension_id,
    keep_button,
    launch,
    open_popup,
    row_for,
)

SITE = "https://pick.test/"
HOST = "pick.test"

SEED = [{"url": SITE, "name": name, "value": name + "-value"}
        for name in ("alpha", "bravo", "charlie", "delta", "echo")]


def names_left(page):
    return sorted(c["name"] for c in cookies_for(page, HOST))


def tick(page, name):
    row_for(page, name).locator("td.pick input").click()
    page.wait_for_timeout(500)


def summary(page):
    return page.locator("#scope-summary").text_content().strip()


def selected_scope(page):
    return page.evaluate("() => document.querySelector('input[name=\"scope\"]:checked').value")


def ticked_rows(page):
    return page.evaluate("""() => [...document.querySelectorAll('#cookie-rows tr')]
        .filter(tr => tr.querySelector('td.pick input').checked)
        .map(tr => tr.querySelector('td.name').textContent).sort()""")


def main():
    r = Results("Ticked cookies")

    with sync_playwright() as p:
        context = launch(p, "pick")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)
        page.evaluate("async (seed) => { for (const s of seed) await chrome.cookies.set(s); }", SEED)
        page.reload()
        page.wait_for_timeout(1200)

        keep_button(row_for(page, "echo")).click()
        page.wait_for_timeout(700)
        r.check("the ticked option is hidden until something is ticked",
                page.locator("#scope-picked-row").is_hidden())

        # --- ticking switches the delete panel to the ticked cookies ---
        tick(page, "alpha")
        tick(page, "charlie")
        r.check("the first tick selects 'Just the ticked cookies'",
                selected_scope(page) == "picked" and page.locator("#scope-picked-row").is_visible(),
                selected_scope(page))
        r.check("and it counts exactly the ticked cookies",
                summary(page).startswith("Will delete 2 cookies"), summary(page))

        # --- export uses the same choice ---
        page.locator("#export-button").click()
        page.wait_for_timeout(300)
        page.locator('input[name="format"][value="json"]').check()
        exported = sorted(c["name"] for c in json.loads(page.locator("#export-output").input_value()))
        header_ok = page.locator('input[name="format"][value="header"]').is_enabled()
        page.locator("#export-back").click()
        page.wait_for_timeout(300)
        r.check("export has exactly the ticked cookies", exported == ["alpha", "charlie"], str(exported))
        r.check("and the Cookie header is offered, since they're one page's",
                header_ok)

        # --- a kept cookie is still left alone ---
        tick(page, "echo")
        r.check("ticking a kept cookie doesn't add it to the delete",
                summary(page).startswith("Will delete 2 cookies") and "1 kept cookie" in summary(page),
                summary(page))

        page.locator("#delete-button").click()
        page.wait_for_timeout(300)
        page.locator("#confirm-yes").click()
        page.wait_for_timeout(1200)
        r.check("the delete removes exactly the ticked cookies, not the kept one",
                names_left(page) == ["bravo", "delta", "echo"], str(names_left(page)))
        r.check("ticks for deleted cookies are forgotten",
                ticked_rows(page) == ["echo"], str(ticked_rows(page)))

        # --- unticking the last one goes back to This page ---
        tick(page, "echo")
        r.check("unticking everything hides the option and goes back to 'This page'",
                page.locator("#scope-picked-row").is_hidden() and selected_scope(page) == "page",
                selected_scope(page))

        # --- the header box ticks every cookie shown ---
        page.locator("#pick-all").click()
        page.wait_for_timeout(500)
        r.check("the header box ticks every row",
                ticked_rows(page) == ["bravo", "delta", "echo"]
                and page.locator("#scope-target-picked").text_content() == "3 cookies",
                str(ticked_rows(page)))
        page.locator("#pick-all").click()
        page.wait_for_timeout(500)
        r.check("and unticks them again", ticked_rows(page) == [], str(ticked_rows(page)))

        # --- with a search, only the cookies shown ---
        page.fill("#search-input", "bravo")
        page.wait_for_timeout(500)
        page.locator("#pick-all").click()
        page.wait_for_timeout(500)
        page.fill("#search-input", "")
        page.wait_for_timeout(500)
        r.check("during a search, the header box only ticks what's shown",
                ticked_rows(page) == ["bravo"], str(ticked_rows(page)))

        r.check("no console errors throughout", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
