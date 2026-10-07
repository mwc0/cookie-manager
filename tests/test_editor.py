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

        # --- name prefixes Chrome enforces, and the size limit (1.5) ---
        # Chrome refuses each of these with the same vague error, so the
        # editor has to say which rule was broken before it tries.
        def errors_shown():
            return page.locator("#edit-errors").text_content() if page.locator("#edit-errors").is_visible() else ""

        page.locator("#add-button").click()
        page.wait_for_timeout(300)
        r.check("a new cookie has no Duplicate button",
                not page.locator("#edit-duplicate").is_visible())
        page.fill("#field-name", "__Secure-token")
        page.fill("#field-value", "x")
        page.uncheck("#field-secure")
        save(page)
        r.check("TRAP: __Secure- without Secure is explained, not sent to Chrome",
                "__Secure-" in errors_shown() and "Tick Secure" in errors_shown()
                and len(named(cookies_for(page, HOST), "__Secure-token")) == 0,
                repr(errors_shown()))

        page.fill("#field-name", "__Host-id")
        page.check("#field-secure")
        page.uncheck("#field-hostonly")
        page.fill("#field-path", "/account")
        save(page)
        host_error = errors_shown()
        r.check("TRAP: __Host- says exactly what is missing",
                "__Host-" in host_error and "host-only" in host_error and "on the path /" in host_error
                and "isn't Secure" not in host_error,
                repr(host_error))

        page.check("#field-hostonly")
        page.fill("#field-path", "/")
        save(page)
        host_cookie = named(cookies_for(page, HOST), "__Host-id")
        r.check("a __Host- cookie that keeps the rules is saved",
                len(host_cookie) == 1 and host_cookie[0]["secure"] and host_cookie[0]["hostOnly"]
                and host_cookie[0]["path"] == "/",
                json.dumps(host_cookie))

        page.locator("#add-button").click()
        page.wait_for_timeout(300)
        page.fill("#field-name", "big")
        page.fill("#field-value", "a" * 100)
        r.check("a small cookie shows no size note",
                not page.locator("#value-size").is_visible())
        page.fill("#field-value", "a" * 3600)
        near = page.locator("#value-size").text_content()
        r.check("close to the limit, the editor shows the size",
                page.locator("#value-size").is_visible() and "3,603 of 4,096" in near, repr(near))
        page.fill("#field-value", "a" * 4200)
        save(page)
        r.check("TRAP: a cookie over 4,096 bytes is stopped with the reason",
                "4,096 bytes" in errors_shown() and "4,203" in errors_shown()
                and len(named(cookies_for(page, HOST), "big")) == 0,
                repr(errors_shown()))
        r.check("and the size note has turned red",
                "error" in (page.locator("#value-size").get_attribute("class") or ""))

        # --- expiry shortcuts ---
        page.fill("#field-name", "one_day")
        page.fill("#field-value", "x")
        page.locator('[data-expire-in="86400"]').click()
        shortcut = page.evaluate("""() => ({
            session: document.getElementById('field-session').checked,
            disabled: document.getElementById('field-expiry').disabled,
            value: document.getElementById('field-expiry').value,
        })""")
        save(page)
        one_day = named(cookies_for(page, HOST), "one_day")
        hours_ahead = (one_day[0]["exp"] - page.evaluate("Date.now() / 1000")) / 3600 if one_day and one_day[0]["exp"] else None
        r.check("the 1 day shortcut unticks Session and sets tomorrow's date",
                not shortcut["session"] and not shortcut["disabled"] and shortcut["value"] != ""
                and hours_ahead is not None and 23.9 < hours_ahead < 24.1,
                f"{json.dumps(shortcut)}, saved {hours_ahead} hours ahead")

        # --- duplicate ---
        edit_button(row_for(page, "one_day")).click()
        page.wait_for_timeout(300)
        r.check("an existing cookie has a Duplicate button",
                page.locator("#edit-duplicate").is_visible())
        page.locator("#edit-duplicate").click()
        page.wait_for_timeout(200)
        duplicate = page.evaluate("""() => ({
            title: document.getElementById('edit-title').textContent,
            name: document.getElementById('field-name').value,
            button: !document.getElementById('edit-duplicate').hidden,
        })""")
        save(page)
        both = [len(named(cookies_for(page, HOST), n)) for n in ("one_day", "one_day_copy")]
        r.check("Duplicate makes a second cookie and leaves the first alone",
                duplicate == {"title": "New cookie", "name": "one_day_copy", "button": False} and both == [1, 1],
                f"{json.dumps(duplicate)}, counts {both}")
        r.check("and it can be undone like any new cookie",
                page.locator("#main-message .undo-button").is_visible(),
                repr(page.locator("#main-message").text_content().strip()))

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
