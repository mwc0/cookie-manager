"""
The 1.3 interface: clicking a row to edit it, the keyboard, the decoded
value, Help, the "Sure?" step, the badges, and target sizes.

Esc is tested in a tab, where the page always gets the key. Whether the
toolbar popup gets it too is checked by hand (see the private notes).
"""

import sys

from playwright.sync_api import sync_playwright

from helpers import (
    Results,
    delete_button,
    extension_id,
    keep_button,
    launch,
    open_popup,
    row_for,
    visible_state,
)

SITE = "https://www.ui.test/"

SEED = """async () => {
    const set = (d) => chrome.cookies.set(d);
    await set({url: 'https://www.ui.test/', name: 'plain', value: 'simple'});
    await set({url: 'https://www.ui.test/', name: 'wide', value: 'w', domain: 'ui.test'});
    await set({url: 'https://www.ui.test/', name: 'laxed', value: 'l', sameSite: 'lax'});
    await set({url: 'https://www.ui.test/', name: 'prefs',
               value: '%7B%22theme%22%3A%22dark%22%2C%22lang%22%3A%22en-GB%22%7D'});
    await set({url: 'https://www.ui.test/', name: 'token',
               value: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'});
}"""

# Every visible button and tick-box target on the screen showing, with its
# size. Text-link buttons and the sort headings are part of a line of text,
# which WCAG exempts.
TARGETS = """() => [...document.querySelectorAll(
        '.state:not([hidden]) button, .state:not([hidden]) .pick-target, .theme label')]
    .filter(e => e.offsetParent !== null && !e.closest('th button.sort')
                 && !e.classList.contains('value-toggle') && !e.classList.contains('link-button'))
    .map(e => { const r = e.getBoundingClientRect();
                return {name: e.id || e.textContent.trim() || e.className, w: r.width, h: r.height}; })"""


def state(page):
    return visible_state(page)


def flags(page, name):
    return [b.strip() for b in row_for(page, name).locator("td.flags .badge").all_text_contents()]


def main():
    r = Results("1.3 interface")

    with sync_playwright() as p:
        context = launch(p, "ui")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)
        page.evaluate(SEED)
        page.reload()
        page.wait_for_function(
            "() => !document.getElementById('scope-summary').textContent.includes('Counting')"
        )

        # --- clicking a row opens it in the editor ---
        row_for(page, "plain").locator("td.domain").click()
        page.wait_for_timeout(300)
        r.check("clicking a row opens that cookie in the editor",
                state(page) == "state-edit" and page.locator("#field-name").input_value() == "plain",
                state(page))

        # --- Esc goes back ---
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        r.check("Esc goes back from the editor", state(page) == "state-main", state(page))

        row_for(page, "plain").locator("td.pick .pick-target").click()
        page.wait_for_timeout(300)
        keep_button(row_for(page, "laxed")).click()
        page.wait_for_timeout(600)
        r.check("ticking a box or clicking Keep doesn't open the editor",
                state(page) == "state-main", state(page))

        page.locator("#export-button").click()
        page.wait_for_timeout(300)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        r.check("Esc goes back from export", state(page) == "state-main", state(page))

        page.locator("#delete-button").click()
        page.wait_for_timeout(300)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        r.check("Esc backs out of 'Delete these cookies?'",
                state(page) == "state-main" and page.locator("#confirm-row").is_hidden()
                and page.locator("#delete-button").is_visible())

        page.locator("#delete-button").click()
        page.wait_for_timeout(300)
        page.locator("#confirm-no").click()
        page.wait_for_timeout(300)
        focused = page.evaluate("() => document.activeElement.id")
        r.check("Cancel puts the focus back on Delete", focused == "delete-button", repr(focused))

        # --- "/" jumps to search ---
        page.locator("body").click(position={"x": 5, "y": 5})
        page.keyboard.press("/")
        focused = page.evaluate("() => document.activeElement.id")
        page.keyboard.type("wi")
        page.wait_for_timeout(300)
        r.check("'/' jumps to the search box, and isn't typed into it",
                focused == "search-input" and page.locator("#search-input").input_value() == "wi",
                f"{focused!r} / {page.locator('#search-input').input_value()!r}")
        # --- "n" adds a cookie, but not while typing ---
        page.keyboard.type("n")
        page.wait_for_timeout(300)
        r.check("'n' in the search box is just typed",
                state(page) == "state-main" and page.locator("#search-input").input_value() == "win",
                page.locator("#search-input").input_value())
        page.fill("#search-input", "")
        page.wait_for_timeout(300)
        page.locator("body").click(position={"x": 5, "y": 5})
        page.keyboard.press("n")
        page.wait_for_timeout(300)
        r.check("'n' anywhere else opens a new cookie",
                state(page) == "state-edit" and page.locator("#edit-title").text_content() == "New cookie"
                and page.locator("#field-name").input_value() == "", state(page))
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # --- plain words ---
        page.locator('input[name="scope"][value="page"]').check()
        page.wait_for_timeout(800)
        summary = page.locator("#scope-summary").text_content().strip()
        # www.ui.test and ui.test really are two sites; the summary says
        # "sites", not "domains", and lists them without leading dots.
        listed = page.evaluate(
            "() => [...document.querySelectorAll('#scope-domains-list li')].map(li => li.textContent)"
        )
        r.check("the summary counts sites, and lists them without leading dots",
                "across 2 sites" in summary and listed == ["ui.test", "www.ui.test"],
                f"{summary!r} / {listed}")
        r.check("a cookie with nothing unusual gets no badges", flags(page, "plain") == [],
                str(flags(page, "plain")))
        r.check("a domain-wide cookie says Subdomains", flags(page, "wide") == ["Subdomains"],
                str(flags(page, "wide")))
        r.check("SameSite is spelled out when set", flags(page, "laxed") == ["SameSite Lax"],
                str(flags(page, "laxed")))

        # --- the "Sure?" step ---
        row = row_for(page, "wide")
        delete_button(row).click()
        page.wait_for_timeout(200)
        r.check("the first Delete click shows 'Sure?' and a cancel button, and hides Keep and Edit",
                delete_button(row).text_content().strip() == "Sure?"
                and row.locator("button.cancel").is_visible()
                and keep_button(row).is_hidden(),
                delete_button(row).text_content())
        row.locator("button.cancel").click()
        page.wait_for_timeout(200)
        r.check("cancel puts the buttons back and deletes nothing",
                delete_button(row).text_content().strip() == "Delete" and keep_button(row).is_visible()
                and row_for(page, "wide").count() == 1)

        # --- the decoded value ---
        row_for(page, "prefs").locator("td.name").click()
        page.wait_for_timeout(300)
        decoded = page.locator("#value-decoded-text").text_content()
        r.check("a URL-encoded JSON value is shown decoded and laid out",
                page.locator("#value-decoded").is_visible() and '"theme": "dark"' in decoded
                and "\n" in decoded, repr(decoded))
        r.check("and the value itself is unchanged",
                page.locator("#field-value").input_value().startswith("%7B%22theme"))
        page.fill("#field-value", "plain words")
        page.wait_for_timeout(200)
        r.check("the decoded panel hides when there's nothing to decode",
                page.locator("#value-decoded").is_hidden())
        page.locator("#edit-cancel").click()
        page.wait_for_timeout(300)

        row_for(page, "token").locator("td.name").click()
        page.wait_for_timeout(300)
        r.check("a JWT isn't decoded (that's for the paid tier)",
                page.locator("#value-decoded").is_hidden())
        page.locator("#edit-cancel").click()
        page.wait_for_timeout(300)

        # --- the focus after Untick all ---
        # The bar the button sits on hides, so the focus has to go somewhere.
        if page.locator("#picked-bar").is_hidden():
            row_for(page, "plain").locator("td.pick .pick-target").click()
            page.wait_for_timeout(200)
        page.locator("#picked-clear").click()
        page.wait_for_timeout(200)
        focused = page.evaluate("() => document.activeElement.id")
        r.check("Untick all leaves the focus on the header tick box", focused == "pick-all", repr(focused))

        # --- status lines are live regions that are always there ---
        # A status line shown by un-hiding it isn't always read out, so they
        # stay on the page and only their text changes. Empty, no room.
        lines = page.evaluate("""() => ['gate-message', 'main-message', 'size-warning',
                'kept-message', 'rules-message'].map(id => {
            const line = document.getElementById(id);
            return [id, line.hidden, line.getAttribute('role'), line.textContent,
                    line.getBoundingClientRect().height];
        })""")
        r.check("the status lines are never hidden, only emptied, and are role=status",
                all(not hidden and role == "status" for _, hidden, role, _, _ in lines), str(lines))
        empty = [line for line in lines if line[3] == "" and line[0] in ("main-message", "size-warning")]
        r.check("an empty one on the main screen takes no room",
                len(empty) == 2 and all(line[4] == 0 for line in empty), str(lines))

        # --- the focus after "Yes, delete" ---
        row_for(page, "token").locator("td.pick .pick-target").click()
        page.wait_for_timeout(500)
        page.locator("#delete-button").click()
        page.wait_for_timeout(300)
        page.locator("#confirm-yes").click()
        page.wait_for_timeout(900)
        focus = page.evaluate("""() => [document.activeElement.className,
            document.activeElement.parentElement.id]""")
        r.check("after 'Yes, delete', the focus is on the new Undo button",
                "undo-button" in focus[0] and focus[1] == "main-message", str(focus))
        message = page.locator("#main-message")
        r.check("and the result is in the same live region, not hidden",
                message.text_content().startswith("Deleted 1 cookie.")
                and not page.evaluate("() => document.getElementById('main-message').hidden"),
                message.text_content())

        # --- Windows high contrast ---
        # Backgrounds are dropped in forced colours, so a pressed filter is
        # filled with the system's selection colour instead (popup.css).
        page.emulate_media(forced_colors="active")
        chip = page.locator("#filters .chip:not([hidden])").first
        chip.click()
        page.wait_for_timeout(200)
        fills = page.evaluate("""() => [
            '#filters .chip[aria-pressed="true"]', '#filters .chip[aria-pressed="false"]:not([hidden])'
        ].map(s => getComputedStyle(document.querySelector(s)).backgroundColor)""")
        r.check("in high contrast, a pressed filter is filled and an unpressed one isn't",
                fills[0] != fills[1], str(fills))
        chip.click()
        page.emulate_media(forced_colors="none")
        page.wait_for_timeout(200)

        # --- Help ---
        page.locator("#help-button").click()
        page.wait_for_timeout(300)
        r.check("Help opens, and has no links to the web",
                state(page) == "state-help" and page.locator("#state-help a").count() == 0
                and "support@cookiez.uk" in page.locator("#state-help").text_content())
        help_targets = page.evaluate(TARGETS)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        r.check("Esc goes back from Help", state(page) == "state-main", state(page))

        # --- target sizes (WCAG 2.2: at least 24 x 24px) ---
        small = [t for t in page.evaluate(TARGETS) + help_targets if t["w"] < 24 or t["h"] < 24]
        r.check("every button and tick box is at least 24 x 24px", not small, str(small))

        r.check("no console errors throughout", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
