"""
Using the table from the keyboard.

Arrow keys move between rows, and a row with focus takes Enter (edit),
Space (tick), K (keep) and Delete (delete, after "Sure?"). Focus has to land
somewhere sensible after every action: back on the row after the editor or
"Sure?", on the next row after a delete, and on the same cookie after the
site changes something and the table is drawn again.
"""

import sys

from playwright.sync_api import sync_playwright

from helpers import (
    Results,
    extension_id,
    launch,
    open_popup,
    row_for,
    visible_state,
)

SITE = "https://keys.test/"

SEED = """async () => {
    for (const name of ['k1', 'k2', 'k3', 'k4']) {
        await chrome.cookies.set({url: 'https://keys.test/', name, value: 'v-' + name});
    }
}"""

# The name of the cookie whose row has focus, or what has focus instead.
FOCUSED = """() => {
    const active = document.activeElement;
    const row = active.closest('#cookie-rows tr');
    if (!row) return active.id ? '#' + active.id : active.tagName;
    const name = row.querySelector('td.name').textContent;
    return active === row ? name : name + ' > ' + (active.className || active.tagName);
}"""


def focused(page):
    return page.evaluate(FOCUSED)


def press(page, key, wait=250):
    page.keyboard.press(key)
    page.wait_for_timeout(wait)


def names_in_store(page):
    return sorted(page.evaluate(
        "async () => (await chrome.cookies.getAll({domain: 'keys.test'})).map(c => c.name)"))


def main():
    r = Results("Keyboard")

    with sync_playwright() as p:
        context = launch(p, "keyboard")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)
        page.evaluate(SEED)
        page.reload()
        page.wait_for_timeout(1200)

        tab_stops = page.evaluate(
            "() => [...document.querySelectorAll('#cookie-rows tr')].filter(r => r.tabIndex === 0).length")
        r.check("only one row is in the tab order", tab_stops == 1, str(tab_stops))

        # --- moving about ---
        press(page, "/")
        press(page, "ArrowDown")
        r.check("Down from the search box goes to the first cookie", focused(page) == "k1", focused(page))
        press(page, "ArrowDown")
        r.check("Down moves to the next", focused(page) == "k2", focused(page))
        press(page, "End")
        r.check("End goes to the last", focused(page) == "k4", focused(page))
        press(page, "Home")
        r.check("Home goes to the first", focused(page) == "k1", focused(page))
        press(page, "ArrowUp")
        r.check("Up from the first goes back to the search box", focused(page) == "#search-input", focused(page))

        ring = None
        press(page, "ArrowDown")
        press(page, "ArrowDown")
        ring = page.evaluate("""() => { const s = getComputedStyle(document.activeElement);
            return [s.outlineStyle, s.outlineWidth]; }""")
        r.check("a focused row shows a focus ring", ring == ["solid", "2px"], str(ring))

        tab_stops = page.evaluate(
            "() => [...document.querySelectorAll('#cookie-rows tr')].filter(r => r.tabIndex === 0).map(r => r.querySelector('td.name').textContent)")
        r.check("the row last used is the one in the tab order", tab_stops == ["k2"], str(tab_stops))

        # --- Space ticks, K keeps ---
        press(page, " ")
        r.check("Space ticks the cookie",
                row_for(page, "k2").locator("td.pick input").is_checked()
                and page.locator("#scope-picked-row").is_visible())
        r.check("and focus stays on the row", focused(page) == "k2", focused(page))
        press(page, " ")
        r.check("Space again unticks it", not row_for(page, "k2").locator("td.pick input").is_checked())

        press(page, "k", wait=700)
        r.check("K keeps the cookie",
                "kept-row" in (row_for(page, "k2").get_attribute("class") or ""))
        r.check("and focus stays on its row after the table is redrawn", focused(page) == "k2", focused(page))

        # A kept cookie isn't deleted from the keyboard either.
        press(page, "Delete", wait=500)
        r.check("Delete on a kept cookie says why it can't",
                "k2 is being kept" in page.locator("#main-message").text_content()
                and "k2" in names_in_store(page),
                page.locator("#main-message").text_content())
        press(page, "k", wait=700)
        r.check("K again stops keeping it",
                "kept-row" not in (row_for(page, "k2").get_attribute("class") or ""))

        # --- Enter edits, Esc comes back to the row ---
        press(page, "Enter", wait=400)
        r.check("Enter opens the cookie in the editor",
                visible_state(page) == "state-edit"
                and page.locator("#field-name").input_value() == "k2",
                visible_state(page))
        press(page, "Escape", wait=400)
        r.check("Esc goes back, with focus on the same row",
                visible_state(page) == "state-main" and focused(page) == "k2", focused(page))

        # --- Delete asks first, Esc backs out ---
        press(page, "Delete")
        r.check("Delete asks Sure?, with focus on it",
                focused(page) == "k2 > row-button danger armed", focused(page))
        press(page, "Escape")
        r.check("Esc backs out of Sure?, back to the row",
                focused(page) == "k2"
                and row_for(page, "k2").locator("button.row-button.danger").get_attribute("class").count("armed") == 0,
                focused(page))
        r.check("and the popup stays on the table", visible_state(page) == "state-main")

        press(page, "Delete")
        press(page, "Enter", wait=1200)
        r.check("Delete then Enter deletes it", "k2" not in names_in_store(page), str(names_in_store(page)))
        r.check("and focus moves on to the next cookie", focused(page) == "k3", focused(page))

        # --- focus survives the site changing something ---
        page.evaluate("() => chrome.cookies.set({url: 'https://keys.test/', name: 'k0', value: 'new'})")
        page.wait_for_timeout(1600)
        r.check("a live redraw keeps focus on the same cookie",
                row_for(page, "k0").count() == 1 and focused(page) == "k3", focused(page))

        # Deleting the last cookie leaves focus somewhere useful.
        press(page, "End")
        press(page, "Delete")
        press(page, "Enter", wait=1200)
        r.check("deleting the last row moves focus to the row before it",
                focused(page) == "k3", focused(page))

        r.check("no console errors throughout", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
