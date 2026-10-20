"""
Sorting the table, and how expiry dates read.

Sorting is display only: it mustn't change which cookies a delete or export
reaches, so this file only checks the order rows appear in. Expiry dates
within 30 days read as "in 3 days", and within a day they're marked.
"""

import sys

from playwright.sync_api import sync_playwright

from helpers import (
    Results,
    extension_id,
    launch,
    open_popup,
    row_for,
    keep_button,
)

SITE = "https://table.test/"

SEED = """async () => {
    const now = Math.floor(Date.now() / 1000);
    const set = (d) => chrome.cookies.set(d);
    await set({url: 'https://table.test/', name: 'zulu', value: 'z'});
    await set({url: 'https://table.test/', name: 'alpha', value: 'findme', expirationDate: now + 2 * 3600});
    await set({url: 'https://table.test/', name: 'mike', value: 'm', expirationDate: now + 3 * 86400});
    await set({url: 'https://table.test/', name: 'bravo', value: 'findme', domain: 'table.test',
               expirationDate: now + 200 * 86400});
}"""


def order(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('#cookie-rows td.name')].map(td => td.textContent)"
    )


def sort_by(page, key):
    page.locator(f'button.sort[data-sort="{key}"]').click()
    page.wait_for_timeout(300)


def aria_sort(page, key):
    return page.locator(f'button.sort[data-sort="{key}"]').evaluate(
        "b => b.parentElement.getAttribute('aria-sort')"
    )


def expiry_cell(page, name):
    return row_for(page, name).locator("td.expires")


def main():
    r = Results("Table: sorting and expiry")

    with sync_playwright() as p:
        context = launch(p, "table")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)
        page.evaluate(SEED)
        page.reload()
        page.wait_for_timeout(1200)

        # --- sorting ---
        # Host-only table.test and domain-wide .table.test sort together.
        r.check("by default, sorted by domain then name",
                order(page) == ["alpha", "bravo", "mike", "zulu"] and aria_sort(page, "domain") == "ascending",
                str(order(page)))

        sort_by(page, "name")
        r.check("clicking Name sorts A to Z",
                order(page) == ["alpha", "bravo", "mike", "zulu"] and aria_sort(page, "name") == "ascending"
                and aria_sort(page, "domain") is None,
                str(order(page)))
        sort_by(page, "name")
        r.check("clicking it again sorts Z to A",
                order(page) == ["zulu", "mike", "bravo", "alpha"] and aria_sort(page, "name") == "descending",
                str(order(page)))

        sort_by(page, "expires")
        r.check("Expires sorts soonest first, with session cookies last",
                order(page) == ["alpha", "mike", "bravo", "zulu"], str(order(page)))
        sort_by(page, "expires")
        r.check("reversed, session cookies are still last",
                order(page) == ["bravo", "mike", "alpha", "zulu"], str(order(page)))

        page.fill("#search-input", "findme")
        page.wait_for_timeout(400)
        r.check("the order survives a search",
                order(page) == ["bravo", "alpha"], str(order(page)))
        page.fill("#search-input", "")
        page.wait_for_timeout(400)

        # --- expiry text ---
        soon = expiry_cell(page, "alpha")
        r.check("under a day away reads 'in 2 hours' and is marked",
                soon.text_content() == "in 2 hours" and "expires-soon" in soon.get_attribute("class"),
                f"{soon.text_content()!r} / {soon.get_attribute('class')!r}")
        days = expiry_cell(page, "mike")
        r.check("a few days away reads 'in 3 days', not marked",
                days.text_content() == "in 3 days" and "expires-soon" not in days.get_attribute("class"),
                f"{days.text_content()!r} / {days.get_attribute('class')!r}")
        far = expiry_cell(page, "bravo").text_content()
        r.check("further away shows the date", any(ch.isdigit() for ch in far) and "in " not in far, far)
        r.check("a session cookie still says Session", expiry_cell(page, "zulu").text_content() == "Session")
        title = days.get_attribute("title")
        r.check("the tooltip gives the full date and how soon",
                title.startswith("Expires ") and title.endswith("(in 3 days)"), repr(title))

        # --- 1.9: Kept cookies first, as a tie-break ---
        # Back to the default sort, by domain: all four share table.test, so
        # a Kept one goes to the top of them.
        sort_by(page, "domain")
        if aria_sort(page, "domain") != "ascending":
            sort_by(page, "domain")
        keep_button(row_for(page, "zulu")).click()
        page.wait_for_timeout(700)
        r.check("a Kept cookie comes first among cookies of the same site",
                order(page) == ["zulu", "alpha", "bravo", "mike"], str(order(page)))
        sort_by(page, "name")
        r.check("it's only a tie-break: sorting by name still sorts by name",
                order(page) == ["alpha", "bravo", "mike", "zulu"], str(order(page)))
        sort_by(page, "domain")
        if aria_sort(page, "domain") != "descending":
            sort_by(page, "domain")
        r.check("Kept stays first whichever way round the sort is",
                order(page)[0] == "zulu", str(order(page)))

        r.check("no console errors throughout", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
