"""
The popup's screens: that exactly one shows at a time, and that each one is
reached for the right reason.

The point of these is the gap the gate screen exists to close -- without host
permission chrome.cookies returns an empty list rather than an error, so
"no permission" and "no cookies" look identical unless the code distinguishes
them deliberately.
"""

import sys

from playwright.sync_api import sync_playwright

from helpers import (
    Results,
    extension_id,
    grant_host_permission,
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
        context = launch(p, "states")
        ext_id = extension_id(context)

        # --- before any permission has been granted ---
        gate = context.new_page()
        stub_active_tab(gate, SITE)
        gate.goto(popup_url(ext_id))
        gate.wait_for_timeout(600)
        r.check("gate shown before permission is granted", visible_state(gate) == "state-gate",
                f"state={visible_state(gate)}")

        # --- the Deny branch ---
        # Stands in for the user clicking Deny on Chrome's native prompt, which
        # Playwright cannot reach. Only the boolean the code reads is faked.
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

        # --- a restricted page ---
        blocked = context.new_page()
        stub_active_tab(blocked, "chrome://version/")
        blocked.goto(popup_url(ext_id))
        blocked.wait_for_timeout(400)
        grant_host_permission(blocked)
        blocked.reload()
        blocked.wait_for_timeout(900)
        blocked_message = blocked.locator("#blocked-message").text_content()
        r.check("a chrome:// page shows the blocked screen, not an empty table",
                visible_state(blocked) == "state-blocked" and "chrome:" in blocked_message,
                repr(blocked_message.strip()))
        blocked.close()

        # --- a page with no cookies ---
        # The one that must NOT be mistaken for a permission failure.
        empty, errors = open_popup(context, ext_id, "https://nothing-here.test/")
        empty_visible = empty.evaluate("() => !document.getElementById('empty-message').hidden")
        rows = empty.evaluate("() => document.getElementById('cookie-rows').children.length")
        r.check("a site with no cookies says so on the main screen",
                visible_state(empty) == "state-main" and empty_visible and rows == 0,
                f"state={visible_state(empty)}, empty message shown={empty_visible}, rows={rows}")
        r.check("no console errors across any of these states", not errors, str(errors[:3]))
        empty.close()

        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
