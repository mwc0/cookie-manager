"""
Creating, editing and deleting a single cookie.

Each TRAP check is a way chrome.cookies.set can go wrong without an error: a
cookie that becomes domain-wide, permanent, or duplicated. So these checks
read Chrome's cookie store afterwards instead of trusting what the popup
says.
"""

import json
import sys

from playwright.sync_api import sync_playwright

from helpers import (
    Results,
    cookies_for,
    delete_button,
    edit_button,
    extension_id,
    launch,
    open_popup,
    row_for,
    visible_state,
)

SITE = "https://editor.test/"
HOST = "editor.test"


def named(cookies, name):
    return [c for c in cookies if c["name"] == name]


def save(page):
    page.locator("#edit-save").click()
    page.wait_for_timeout(900)


def main():
    r = Results("Create / edit / delete-one")

    with sync_playwright() as p:
        context = launch(p, "editor")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)

        # --- creating ---
        page.locator("#add-button").click()
        page.wait_for_timeout(300)
        r.check("the editor opens", visible_state(page) == "state-edit")

        defaults = page.evaluate("""() => ({
            domain: document.getElementById('field-domain').value,
            path: document.getElementById('field-path').value,
            hostOnly: document.getElementById('field-hostonly').checked,
            session: document.getElementById('field-session').checked,
            expiryDisabled: document.getElementById('field-expiry').disabled,
        })""")
        # A new cookie is host-only and a session cookie by default, the
        # narrowest options, so adding one can't leave something domain-wide
        # or permanent behind by accident.
        r.check("a new cookie defaults to host-only and session",
                defaults["domain"] == HOST and defaults["hostOnly"] and defaults["session"]
                and defaults["expiryDisabled"],
                json.dumps(defaults))

        page.fill("#field-name", "hostonly_c")
        page.fill("#field-value", "v1")
        save(page)

        created = named(cookies_for(page, HOST), "hostonly_c")
        r.check("TRAP: a created host-only cookie stays host-only",
                len(created) == 1 and created[0]["hostOnly"] and created[0]["domain"] == HOST,
                json.dumps(created))
        r.check("TRAP: a created session cookie stays a session cookie",
                len(created) == 1 and created[0]["session"] and created[0]["exp"] is None)
        r.check("the save is reported on the main screen",
                "Created" in page.locator("#main-message").text_content(),
                repr(page.locator("#main-message").text_content().strip()))

        # --- editing a value only ---
        edit_button(row_for(page, "hostonly_c")).click()
        page.wait_for_timeout(400)

        # Check the editor is actually open, not just that the fields hold the
        # right values. The values are still there from the last save, so that
        # check alone passes even if the click did nothing. That's how a
        # broken Edit button was once missed.
        prefilled = page.evaluate("""() => ({
            name: document.getElementById('field-name').value,
            hostOnly: document.getElementById('field-hostonly').checked,
            session: document.getElementById('field-session').checked,
        })""")
        r.check("clicking Edit actually opens the editor",
                visible_state(page) == "state-edit" and page.locator("#field-value").is_visible(),
                f"state={visible_state(page)}")
        r.check("the form is prefilled from the cookie",
                prefilled["name"] == "hostonly_c" and prefilled["hostOnly"] and prefilled["session"],
                json.dumps(prefilled))

        page.fill("#field-value", "v2-edited")
        save(page)
        edited = named(cookies_for(page, HOST), "hostonly_c")
        r.check("TRAP: editing the value keeps it host-only",
                len(edited) == 1 and edited[0]["value"] == "v2-edited" and edited[0]["hostOnly"],
                json.dumps(edited))
        r.check("TRAP: an unchanged identity overwrites rather than duplicating",
                len(edited) == 1, f"{len(edited)} copies")

        # --- SameSite=None without Secure ---
        # Chrome's error names the cookie but not the rule it broke, so the
        # popup has to catch this before saving, or the user is stuck.
        page.locator("#add-button").click()
        page.wait_for_timeout(300)
        page.fill("#field-name", "ss_none")
        page.fill("#field-value", "x")
        page.select_option("#field-samesite", "no_restriction")
        page.uncheck("#field-secure")
        page.locator("#edit-save").click()
        page.wait_for_timeout(600)

        shown = page.evaluate(
            "() => Array.from(document.querySelectorAll('#edit-errors li')).map(li => li.textContent)"
        )
        r.check("TRAP: SameSite=None without Secure is refused, readably",
                visible_state(page) == "state-edit" and any("Secure" in e for e in shown),
                str(shown))
        r.check("nothing is written when validation fails",
                len(named(cookies_for(page, HOST), "ss_none")) == 0)

        page.check("#field-secure")
        save(page)
        fixed = named(cookies_for(page, HOST), "ss_none")
        r.check("it saves once Secure is ticked",
                len(fixed) == 1 and fixed[0]["secure"] and fixed[0]["sameSite"] == "no_restriction",
                json.dumps(fixed))

        # --- session to dated ---
        edit_button(row_for(page, "ss_none")).click()
        page.wait_for_timeout(400)
        page.uncheck("#field-session")
        enabled = page.evaluate("() => !document.getElementById('field-expiry').disabled")
        page.fill("#field-expiry", "2027-01-01T12:00")
        save(page)
        dated = named(cookies_for(page, HOST), "ss_none")
        r.check("the expiry field enables when 'session' is unticked", enabled)
        r.check("TRAP: session -> dated is deliberate and works",
                len(dated) == 1 and not dated[0]["session"] and dated[0]["exp"],
                json.dumps(dated))

        # --- renaming: the identity change that must not duplicate ---
        edit_button(row_for(page, "ss_none")).click()
        page.wait_for_timeout(400)
        page.fill("#field-name", "ss_renamed")
        save(page)
        after = cookies_for(page, HOST)
        r.check("TRAP: renaming removes the original", len(named(after, "ss_none")) == 0)
        r.check("TRAP: renaming leaves exactly one cookie", len(named(after, "ss_renamed")) == 1,
                json.dumps(named(after, "ss_renamed")))

        # --- changing the path: same trap, different field ---
        edit_button(row_for(page, "ss_renamed")).click()
        page.wait_for_timeout(400)
        page.fill("#field-path", "/admin")
        save(page)
        moved = named(cookies_for(page, HOST), "ss_renamed")
        r.check("TRAP: changing the path moves the cookie, not copies it",
                len(moved) == 1 and moved[0]["path"] == "/admin", json.dumps(moved))

        # --- host-only -> domain-wide on purpose ---
        # Chrome also treats these as two different cookies.
        edit_button(row_for(page, "hostonly_c")).click()
        page.wait_for_timeout(400)
        page.uncheck("#field-hostonly")
        save(page)
        widened = named(cookies_for(page, HOST), "hostonly_c")
        r.check("TRAP: widening host-only to domain-wide leaves one cookie, not two",
                len(widened) == 1 and not widened[0]["hostOnly"]
                and widened[0]["domain"] == "." + HOST,
                json.dumps(widened))

        # --- Chrome's silent 400-day expiry cap ---
        page.locator("#add-button").click()
        page.wait_for_timeout(300)
        page.fill("#field-name", "far_future")
        page.fill("#field-value", "x")
        page.uncheck("#field-session")
        page.fill("#field-expiry", "2099-01-01T12:00")
        save(page)
        far_message = page.locator("#main-message").text_content()
        r.check("TRAP: a clamped expiry is reported rather than silently accepted",
                "shortened" in far_message, repr(far_message.strip()))

        page.locator("#add-button").click()
        page.wait_for_timeout(300)
        page.fill("#field-name", "near_future")
        page.fill("#field-value", "y")
        page.uncheck("#field-session")
        page.fill("#field-expiry", "2026-12-25T09:30")
        save(page)
        near_message = page.locator("#main-message").text_content()
        r.check("an expiry inside the cap does NOT claim it was shortened",
                "shortened" not in near_message, repr(near_message.strip()))

        # --- deleting one, with its two-click arm ---
        row = row_for(page, "hostonly_c")
        delete_button(row).click()
        page.wait_for_timeout(250)
        armed_text = delete_button(row).text_content().strip()
        r.check("the first click only arms the delete",
                armed_text == "Sure?" and len(named(cookies_for(page, HOST), "hostonly_c")) == 1,
                f"button reads {armed_text!r}, cookie still present")

        # The armed button must be readable too. A hover rule once made it
        # white text on a pale background, and every text check still passed.
        contrast = delete_button(row).evaluate(
            "b => { const c = getComputedStyle(b); return {color: c.color, background: c.backgroundColor}; }"
        )
        r.check("the armed button is readable (not white-on-white)",
                contrast["color"] != contrast["background"], json.dumps(contrast))

        delete_button(row).click()
        page.wait_for_timeout(900)
        r.check("the second click deletes it",
                len(named(cookies_for(page, HOST), "hostonly_c")) == 0,
                repr(page.locator("#main-message").text_content().strip()))

        r.check("no console errors throughout", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
