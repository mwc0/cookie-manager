"""
1.7's additions to the editor and the table:

  - Base64 values and dates shown decoded under the value
  - JSON values edited laid out, and saved on one line again
  - Copy as Set-Cookie
  - Keep, stop keeping, or set an expiry for every ticked cookie at once

and 1.9's: Copy name in the editor, a Partitioned box for a new cookie, and
Duplicate for a partitioned one.

The JSON part is the risky one. The value in the box isn't the value that
gets saved, so the checks are on what Chrome stored, not on the screen: a
laid-out value must never be saved laid out, and broken JSON must never be
saved at all.
"""

import base64
import json
import sys
import time

from playwright.sync_api import sync_playwright

from helpers import Results, cookies_for, extension_id, launch, open_popup, row_for

SITE = "https://editing.test/"
HOST = "editing.test"

PROFILE = base64.b64encode(b'{"user":"demo","plan":"free"}').decode()

SEED = [
    {"url": SITE, "name": "joined_at", "value": "1760534400"},
    {"url": SITE, "name": "profile_b64", "value": PROFILE},
    {"url": SITE, "name": "random_token", "value": "x7Kq9PzR2mLw4VbN8tYcQ3"},
    {"url": SITE, "name": "prefs", "value": '{"a":1,"b":[2,3]}'},
    {"url": SITE, "name": "spaced", "value": '{"a": 1}'},
    {"url": SITE, "name": "one", "value": "1"},
    {"url": SITE, "name": "two", "value": "2"},
]


def open_editor(page, name):
    row_for(page, name).locator("td.name").click()
    page.wait_for_timeout(400)


def back(page):
    page.locator("#edit-cancel").click()
    page.wait_for_timeout(400)


def decoded(page):
    box = page.locator("#value-decoded")
    if not box.is_visible():
        return None
    return page.locator("#value-decoded-label").text_content(), page.locator("#value-decoded-text").text_content()


def stored(page, name):
    return next((c for c in cookies_for(page, HOST) if c["name"] == name), None)


def tick(page, name):
    row_for(page, name).locator("td.pick input").click()
    page.wait_for_timeout(400)


def partitioned(page, host):
    """name -> partition site, for every partitioned cookie on `host`."""
    return page.evaluate("""async (host) => Object.fromEntries(
        (await chrome.cookies.getAll({domain: host, partitionKey: {}}))
            .filter(c => c.partitionKey).map(c => [c.name, c.partitionKey.topLevelSite]))""", host)


def kept_keys(page):
    return page.evaluate("async () => (await chrome.storage.local.get('protectedCookies')).protectedCookies || []")


def main():
    r = Results("More editing: decoding, JSON, Set-Cookie, ticked cookies")

    with sync_playwright() as p:
        context = launch(p, "more-editing")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)
        page.evaluate("async (seed) => { for (const s of seed) await chrome.cookies.set(s); }", SEED)
        page.reload()
        page.wait_for_timeout(1200)

        # --- decoding ---
        open_editor(page, "joined_at")
        shown = decoded(page)
        r.check("a timestamp is shown as a date", shown and shown[0] == "As a date" and "2025" in shown[1], str(shown))
        back(page)

        open_editor(page, "profile_b64")
        shown = decoded(page)
        r.check("Base64 is decoded, and JSON inside it laid out",
                shown and shown[0] == "Decoded from Base64" and '"user": "demo"' in shown[1], str(shown))
        r.check("the value itself is left as it is", page.locator("#field-value").input_value() == PROFILE)
        back(page)

        open_editor(page, "random_token")
        r.check("TRAP: a random token isn't 'decoded' into nonsense", decoded(page) is None, str(decoded(page)))
        back(page)

        # --- JSON ---
        open_editor(page, "prefs")
        text = page.locator("#field-value").input_value()
        r.check("compact JSON opens laid out, with 'Edit as JSON' ticked",
                page.locator("#field-json").is_checked() and '\n  "a": 1' in text, repr(text))
        r.check("no decoded box under it: the box above already shows it laid out", decoded(page) is None)
        page.fill("#field-value", text.replace('"a": 1', '"a": 5'))
        page.locator("#edit-save").click()
        page.wait_for_timeout(900)
        r.check("TRAP: it's saved on one line again, with the change",
                (stored(page, "prefs") or {}).get("value") == '{"a":5,"b":[2,3]}',
                repr((stored(page, "prefs") or {}).get("value")))

        open_editor(page, "prefs")
        page.fill("#field-value", '{"a": 5, "b": [2, 3]')
        page.locator("#edit-save").click()
        page.wait_for_timeout(600)
        errors_shown = page.locator("#edit-errors").text_content()
        r.check("TRAP: broken JSON isn't saved, and the editor says why",
                "isn't valid JSON" in errors_shown and (stored(page, "prefs") or {}).get("value") == '{"a":5,"b":[2,3]}',
                errors_shown.strip()[:120])
        page.fill("#field-value", '{"a": 5, "b": [2, 3]}')
        page.locator("#field-json").uncheck()
        page.wait_for_timeout(300)
        r.check("unticking puts the value back on one line",
                page.locator("#field-value").input_value() == '{"a":5,"b":[2,3]}',
                page.locator("#field-value").input_value())
        back(page)

        open_editor(page, "spaced")
        r.check("JSON with spaces is offered as JSON but not laid out unasked",
                page.locator("#value-json-row").is_visible() and not page.locator("#field-json").is_checked()
                and page.locator("#field-value").input_value() == '{"a": 1}')
        page.locator("#edit-save").click()
        page.wait_for_timeout(800)
        r.check("saving it unchanged keeps it exactly as it was",
                (stored(page, "spaced") or {}).get("value") == '{"a": 1}', repr((stored(page, "spaced") or {}).get("value")))

        open_editor(page, "one")
        r.check("a plain value isn't offered as JSON", not page.locator("#value-json-row").is_visible())

        # --- Copy as Set-Cookie ---
        line = page.evaluate("""async () => {
            const m = await import(chrome.runtime.getURL('lib/transfer.js'));
            return {
                hostOnly: m.toSetCookie({ name: 'sid', value: 'abc', domain: 'example.com', hostOnly: true, path: '/',
                    secure: true, httpOnly: true, sameSite: 'lax', expirationDate: 1893456000 }),
                wide: m.toSetCookie({ name: 'w', value: '1', domain: '.example.com', hostOnly: false, path: '/app',
                    sameSite: 'no_restriction', secure: true, partitionKey: { topLevelSite: 'https://example.org' } }),
            };
        }""")
        r.check("Set-Cookie: a host-only cookie has no Domain, and dates are in the header format",
                line["hostOnly"] == "sid=abc; Path=/; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax",
                line["hostOnly"])
        r.check("Set-Cookie: a domain-wide, partitioned cookie keeps both",
                line["wide"] == "w=1; Domain=example.com; Path=/app; Secure; SameSite=None; Partitioned", line["wide"])
        round_trip = page.evaluate("""async (text) => {
            const m = await import(chrome.runtime.getURL('lib/transfer.js'));
            const parsed = m.parseImport(text, { pageUrl: 'https://example.com/' });
            return parsed.format === 'set-cookie' && parsed.problems.length === 0
                ? parsed.entries.map(e => [e.name, e.value, e.path])
                : JSON.stringify(parsed).slice(0, 200);
        }""", line["hostOnly"])
        r.check("and cookieZ's own import reads the line back", round_trip == [["sid", "abc", "/"]], str(round_trip))
        context.grant_permissions(["clipboard-read", "clipboard-write"])
        page.locator("#edit-setcookie").click()
        page.wait_for_timeout(300)
        r.check("the button copies, from the editor", page.locator("#edit-setcookie").text_content() == "Copied")
        back(page)

        # --- ticked cookies ---
        r.check("no bar while nothing is ticked", not page.locator("#picked-bar").is_visible())
        tick(page, "one")
        tick(page, "two")
        r.check("ticking shows the bar with a count",
                page.locator("#picked-bar").is_visible()
                and page.locator("#picked-count").text_content() == "2 cookies ticked:",
                page.locator("#picked-count").text_content())

        page.locator("#picked-keep").click()
        page.wait_for_timeout(600)
        keys = kept_keys(page)
        r.check("Keep keeps both", HOST + "\n/\none\n" in keys and HOST + "\n/\ntwo\n" in keys, str(keys))
        page.locator("#picked-unkeep").click()
        page.wait_for_timeout(600)
        r.check("Stop keeping lets both go", kept_keys(page) == [], str(kept_keys(page)))

        page.locator('[data-picked-expire="86400"]').click()
        page.wait_for_timeout(1200)
        now = time.time()
        expiries = [(stored(page, n) or {}).get("exp") for n in ("one", "two")]
        r.check("TRAP: '1 day' sets both to expire a day from now, and nothing else changes",
                all(e and abs(e - (now + 86400)) < 180 for e in expiries)
                and (stored(page, "one") or {}).get("value") == "1",
                str(expiries))
        message = page.locator("#main-message").text_content()
        r.check("it says so, with Undo", message.startswith("2 cookies now expire in 1 day.")
                and page.locator("#main-message .undo-button").is_visible(), message)
        page.locator("#main-message .undo-button").click()
        page.wait_for_timeout(1000)
        r.check("Undo makes them session cookies again",
                all((stored(page, n) or {}).get("session") for n in ("one", "two")),
                str([stored(page, n) for n in ("one", "two")]))

        page.locator("#picked-clear").click()
        page.wait_for_timeout(400)
        r.check("'Untick all' clears the ticks and the bar goes",
                not page.locator("#picked-bar").is_visible(), str(page.locator("#picked-count").text_content()))

        # --- 1.9: Copy name, in the editor ---
        page.evaluate("() => { navigator.clipboard.writeText = async (t) => { window.__copied = t; }; }")
        open_editor(page, "joined_at")
        page.locator("#name-copy").click()
        page.wait_for_timeout(300)
        r.check("the editor's Copy beside the name copies the name",
                page.evaluate("() => window.__copied") == "joined_at"
                and page.locator("#name-copy").text_content() == "Copied")
        r.check("an existing cookie has no Partitioned box: its partition can't change",
                not page.locator("#partitioned-row").is_visible())
        back(page)

        # --- 1.9: a new partitioned cookie ---
        page.locator("#add-button").click()
        page.wait_for_timeout(400)
        r.check("a new cookie offers a Partitioned box, unticked, naming the site",
                page.locator("#partitioned-row").is_visible() and not page.locator("#field-partitioned").is_checked()
                and page.locator("#partitioned-site").text_content() == HOST,
                page.locator("#partitioned-row").text_content().strip())
        page.fill("#field-name", "chips_new")
        page.fill("#field-value", "p1")
        page.locator("#field-partitioned").check()
        r.check("ticking it ticks Secure, which Chrome needs", page.locator("#field-secure").is_checked())
        page.locator("#edit-save").click()
        page.wait_for_timeout(900)
        made = partitioned(page, HOST)
        r.check("saving makes a partitioned cookie for this site",
                made.get("chips_new") == "https://editing.test", json.dumps(made))

        # On a www page, Chrome refuses https://www.editing.test as a
        # partition, so the site has to be found.
        www_page, www_errors = open_popup(context, ext_id, "https://www.editing.test/")
        www_page.locator("#add-button").click()
        www_page.wait_for_timeout(400)
        www_page.fill("#field-name", "chips_www")
        www_page.fill("#field-value", "w1")
        www_page.locator("#field-partitioned").check()
        www_page.locator("#edit-save").click()
        www_page.wait_for_timeout(900)
        made = partitioned(www_page, "www.editing.test")
        r.check("on a www page it goes in the site's partition, not the host's",
                made.get("chips_www") == "https://editing.test" and www_page.locator("#edit-errors").is_hidden(),
                json.dumps(made) + " / " + (www_page.locator("#edit-errors").text_content() or ""))
        r.check("no errors on the www page", not www_errors, str(www_errors))
        www_page.close()

        # --- 1.9: Duplicate works for a partitioned cookie ---
        page.reload()
        page.wait_for_timeout(1200)
        open_editor(page, "chips_new")
        r.check("Duplicate is offered for a partitioned cookie", page.locator("#edit-duplicate").is_visible())
        page.locator("#edit-duplicate").click()
        page.wait_for_timeout(300)
        r.check("the copy is ticked Partitioned",
                page.locator("#partitioned-row").is_visible() and page.locator("#field-partitioned").is_checked()
                and page.locator("#field-name").input_value() == "chips_new_copy")
        page.locator("#edit-save").click()
        page.wait_for_timeout(900)
        made = partitioned(page, HOST)
        r.check("saving the copy puts it in the same partition, and leaves the original",
                made.get("chips_new_copy") == "https://editing.test" and "chips_new" in made, json.dumps(made))

        r.check("no errors were logged", not errors, str(errors))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
