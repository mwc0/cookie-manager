"""
The popup's screens: only one shows at a time, and each shows for the right
reason.

The main reason for these tests: without host access, chrome.cookies returns
an empty list instead of an error. So "no access" and "no cookies" look the
same unless the code tells them apart on purpose.
"""

import sys

from playwright.sync_api import sync_playwright

from helpers import (
    EXTENSION,
    Results,
    extension_id,
    launch,
    open_popup,
    popup_url,
    stub_active_tab,
    visible_state,
)

SITE = "https://states.test/"


def main():
    r = Results("Popup states")

    with sync_playwright() as p:
        # The real src/, not the pre-granted copy. The first two checks are
        # the only tests of the permission code, so they need a profile with
        # no access granted. Nothing here really opens Chrome's prompt.
        context = launch(p, "states", extension=EXTENSION)
        ext_id = extension_id(context)

        # --- before any permission has been granted ---
        gate = context.new_page()
        stub_active_tab(gate, SITE)
        gate.goto(popup_url(ext_id))
        gate.wait_for_timeout(600)
        r.check("gate shown before permission is granted", visible_state(gate) == "state-gate",
                f"state={visible_state(gate)}")

        # --- the Deny branch ---
        # Pretends the user clicked Deny on Chrome's prompt, which Playwright
        # can't reach. Only the true/false answer is faked.
        deny = context.new_page()
        stub_active_tab(deny, SITE)
        deny.add_init_script("""
            (() => { chrome.permissions.request = (o, cb) =>
                cb ? cb(false) : Promise.resolve(false); })();
        """)
        deny.goto(popup_url(ext_id))
        deny.wait_for_timeout(600)
        deny.locator("#grant-button").click()
        deny.wait_for_timeout(500)

        message = deny.locator("#gate-message").text_content()
        hidden = deny.evaluate("() => document.getElementById('gate-message').hidden")
        r.check("a denial says so, and stays on the gate",
                not hidden and visible_state(deny) == "state-gate" and "declined" in message.lower(),
                repr(message.strip()))
        r.check("a denial leaves a working retry", deny.locator("#grant-button").is_enabled())
        deny.close()
        gate.close()
        context.close()

        # --- everything past the gate ---
        # A second browser with the pre-granted copy, so the screens that need
        # access can be reached without the prompt.
        context = launch(p, "states-granted")
        ext_id = extension_id(context)

        # --- a restricted page ---
        blocked = context.new_page()
        stub_active_tab(blocked, "chrome://version/")
        blocked.goto(popup_url(ext_id))
        blocked.wait_for_timeout(900)
        blocked_message = blocked.locator("#blocked-message").text_content()
        r.check("a chrome:// page shows the blocked screen, not an empty table",
                visible_state(blocked) == "state-blocked" and "chrome:" in blocked_message,
                repr(blocked_message.strip()))
        blocked.close()

        # --- a page with no cookies ---
        # This one must not be mistaken for missing access.
        empty, errors = open_popup(context, ext_id, "https://nothing-here.test/")
        empty_visible = empty.evaluate("() => !document.getElementById('empty-message').hidden")
        rows = empty.evaluate("() => document.getElementById('cookie-rows').children.length")
        r.check("a site with no cookies says so on the main screen",
                visible_state(empty) == "state-main" and empty_visible and rows == 0,
                f"state={visible_state(empty)}, empty message shown={empty_visible}, rows={rows}")
        r.check("no console errors across any of these states", not errors, str(errors[:3]))
        empty.close()

        # --- the table has to fit ---
        # When the table was wider than the popup, the row buttons were cut
        # off, and tabbing to one scrolled the table sideways with no
        # scrollbar to scroll back. Playwright scrolls things into view before
        # clicking, so the click tests still passed. Only a screenshot showed
        # it, so this measures the layout directly.
        #
        # The cookie has an expiry date on purpose. This once passed with a
        # session cookie, but a date ("30 Oct 2027" is wider than "Session")
        # pushed the table 44px too wide.
        wide, _ = open_popup(context, ext_id, "https://wide.test/")
        wide.evaluate("""async () => {
            await chrome.cookies.set({url:'https://wide.test/', name:'a_realistically_long_name',
                value:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.a-long-token-value',
                secure:true, httpOnly:true, sameSite:'no_restriction',
                expirationDate: Math.floor(Date.now() / 1000) + 300 * 86400});
        }""")
        wide.reload()
        wide.wait_for_timeout(1200)

        layout = wide.evaluate("""() => {
            const wrap = document.getElementById('table-wrap');
            const table = document.getElementById('cookie-table');
            const buttons = Array.from(document.querySelectorAll('#cookie-rows button.row-button'));
            const wrapBox = wrap.getBoundingClientRect();
            return {
                overflow: Math.round(table.getBoundingClientRect().width - wrap.clientWidth),
                canScroll: getComputedStyle(wrap).overflowX === 'auto',
                buttons: buttons.length,
                buttonsInside: buttons.filter(b => {
                    const box = b.getBoundingClientRect();
                    return box.left >= wrapBox.left - 1 && box.right <= wrapBox.right + 1;
                }).length,
            };
        }""")
        r.check("the table fits the popup width",
                layout["overflow"] <= 1, f"overflows by {layout['overflow']}px")
        r.check("every row button is reachable without scrolling",
                layout["buttons"] > 0 and layout["buttonsInside"] == layout["buttons"],
                f"{layout['buttonsInside']}/{layout['buttons']} inside the visible area")
        r.check("and the table can scroll if it ever does overflow", layout["canScroll"])
        wide.close()

        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
