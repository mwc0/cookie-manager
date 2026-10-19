"""
Password-protected export (1.9).

An export can be locked with a password (PBKDF2-SHA-256, 600,000 rounds, then
AES-GCM; see src/lib/crypto.js). Import recognises a locked file, asks for
the password, and shows the usual preview.

What matters most:
  - the round trip: lock, clear the site, open with the password, and every
    cookie comes back exactly;
  - a wrong password and a damaged file each get a plain message, and
    nothing is written;
  - the password is never saved: not in chrome.storage.local, not in
    chrome.storage.session, and not left in the box after use.
"""

import base64
import json
import sys

from playwright.sync_api import sync_playwright

from helpers import Results, extension_id, launch, open_popup

SITE = "https://locked.test/"
PASSWORD = "correct horse battery"
FAR = 60 * 60 * 24 * 200

SEED = """async (far) => {
    const exp = Math.floor(Date.now() / 1000) + far;
    await chrome.cookies.set({url: 'https://locked.test/', name: 'sid', value: 's3cret',
                              secure: true, httpOnly: true, sameSite: 'lax', expirationDate: exp});
    await chrome.cookies.set({url: 'https://locked.test/', name: 'theme', value: 'dark'});
}"""

SNAPSHOT = """async () => (await chrome.cookies.getAll({domain: 'locked.test'}))
    .map(c => ({name: c.name, value: c.value, domain: c.domain, path: c.path, hostOnly: c.hostOnly,
                secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, session: c.session,
                exp: c.expirationDate ? Math.round(c.expirationDate) : null}))
    .sort((a, b) => a.name.localeCompare(b.name))"""

CLEAR = """async () => {
    for (const c of await chrome.cookies.getAll({domain: 'locked.test'})) {
        await chrome.cookies.remove({url: 'https://locked.test' + c.path, name: c.name});
    }
}"""

# The clipboard can't be read back in a test, so writes are recorded instead.
CAPTURE_CLIPBOARD = "() => { navigator.clipboard.writeText = async (t) => { window.__copied = t; }; }"

# Records every message the export and import screens show, so a message
# that only shows for a moment ("Encrypting…") can still be checked.
WATCH_MESSAGES = """() => {
    window.__messages = [];
    for (const id of ['export-result', 'import-result']) {
        const node = document.getElementById(id);
        new MutationObserver(() => window.__messages.push(node.textContent))
            .observe(node, {childList: true, characterData: true, subtree: true});
    }
}"""

# Everything cookieZ has saved, as one string, to search for the password.
STORED = """async () => JSON.stringify(await chrome.storage.local.get(null))
    + JSON.stringify(await chrome.storage.session.get(null))"""


def text_of(page, element_id):
    return page.locator("#" + element_id).text_content().strip()


def wait_for_result(page, element_id, words, timeout=15000):
    page.wait_for_function(
        "([id, words]) => document.getElementById(id).textContent.includes(words)",
        arg=[element_id, words], timeout=timeout)


def try_import(page, text, password=None):
    """Pastes `text` and presses Check, with `password` if given."""
    page.locator("#import-button").click()
    page.wait_for_timeout(300)
    page.fill("#import-text", text)
    page.locator("#import-check").click()
    page.wait_for_timeout(400)
    if password is not None:
        page.fill("#import-password", password)
        page.locator("#import-check").click()
        page.wait_for_function(
            "() => !document.getElementById('import-check').disabled", timeout=15000)
        page.wait_for_timeout(600)


def back(page):
    page.locator("#import-back").click()
    page.wait_for_timeout(800)


def main():
    r = Results("Password-protected export")

    with sync_playwright() as p:
        context = launch(p, "encrypted-export")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)
        page.evaluate(SEED, FAR)
        page.reload()
        page.wait_for_timeout(1200)
        page.evaluate(CAPTURE_CLIPBOARD)
        page.evaluate(WATCH_MESSAGES)
        original = page.evaluate(SNAPSHOT)
        r.check("seeded two cookies", len(original) == 2, json.dumps(original))

        # --- locking ---
        page.locator('input[name="scope"][value="page"]').check()
        page.wait_for_timeout(800)
        page.locator("#export-button").click()
        page.wait_for_timeout(300)
        plain = page.locator("#export-output").input_value()
        page.fill("#export-password", PASSWORD)
        page.locator("#export-copy").click()
        wait_for_result(page, "export-result", "Locked with your password")
        page.wait_for_timeout(300)
        messages = page.evaluate("() => window.__messages")
        r.check("'Encrypting…' shows while the key is made", "Encrypting…" in messages, str(messages))

        locked = page.evaluate("() => window.__copied") or ""
        try:
            file = json.loads(locked)
        except ValueError:
            file = {}
        r.check("Copy gives the locked file, with its header",
                file.get("kind") == "cookieZ encrypted export" and file.get("version") == 1
                and file.get("kdf") == "PBKDF2-SHA-256" and file.get("iterations") == 600000,
                locked[:160])
        try:
            sizes = [len(base64.b64decode(file.get(k, ""))) for k in ("salt", "iv", "data")]
        except ValueError:
            sizes = []
        r.check("a 16-byte salt, a 12-byte IV, and data", sizes[:2] == [16, 12] and sizes[2] > 16, str(sizes))
        r.check("nothing readable is left in the locked file",
                "s3cret" not in locked and "theme" not in locked and PASSWORD not in locked)
        r.check("the box shows what was copied", page.locator("#export-output").input_value() == locked)
        r.check("the password box is emptied after use",
                page.locator("#export-password").input_value() == "")

        # A second lock of the same text uses a new salt and IV.
        page.fill("#export-password", PASSWORD)
        r.check("typing a password puts the readable text back in the box",
                page.locator("#export-output").input_value() == plain)
        with page.expect_download() as info:
            page.locator("#export-download").click()
        download = info.value
        saved = open(download.path(), encoding="utf-8").read()
        second = json.loads(saved)
        r.check("Download saves a locked file, named as one",
                second.get("kind") == "cookieZ encrypted export"
                and download.suggested_filename.endswith("-locked.json"),
                download.suggested_filename)
        r.check("each lock uses a new salt and IV",
                second.get("salt") != file.get("salt") and second.get("iv") != file.get("iv"))
        r.check("and the result says the password isn't saved",
                "isn't saved anywhere" in text_of(page, "export-result"), text_of(page, "export-result"))

        page.locator('input[name="format"][value="selenium"]').check()
        page.wait_for_timeout(200)
        r.check("Selenium code can't have a password, and says why",
                page.locator("#export-password").is_disabled()
                and "can't have a password" in text_of(page, "export-password-note"),
                text_of(page, "export-password-note"))
        page.locator('input[name="format"][value="json"]').check()
        page.locator("#export-back").click()
        page.wait_for_timeout(300)

        r.check("the password isn't in storage after exporting", PASSWORD not in page.evaluate(STORED))

        # --- a damaged file ---
        page.evaluate(CLEAR)
        cut_short = locked[: len(locked) // 2]
        try_import(page, cut_short)
        result = text_of(page, "import-result")
        r.check("a file cut short is called damaged, without asking for the password",
                "damaged" in result and not page.locator("#import-password-row").is_visible()
                and not page.locator("#import-preview").is_visible(),
                result)
        back(page)

        bad_salt = json.dumps({**file, "salt": "not base64!"})
        try_import(page, bad_salt)
        result = text_of(page, "import-result")
        r.check("a broken salt is called damaged too", "damaged" in result, result)
        back(page)

        # --- a wrong password ---
        try_import(page, locked)
        r.check("a locked file asks for its password",
                page.locator("#import-password-row").is_visible()
                and "password" in text_of(page, "import-result"),
                text_of(page, "import-result"))
        page.fill("#import-password", "wrong password")
        page.locator("#import-check").click()
        page.wait_for_function("() => !document.getElementById('import-check').disabled", timeout=15000)
        page.wait_for_timeout(400)
        result = text_of(page, "import-result")
        r.check("a wrong password gets a plain message, and nothing to import",
                "doesn't open this file" in result and not page.locator("#import-preview").is_visible(),
                result)
        r.check("the wrong password is emptied from the box",
                page.locator("#import-password").input_value() == "")
        r.check("nothing was written", page.evaluate(SNAPSHOT) == [])

        # Changed data with the right password fails in the same way: GCM
        # notices the change.
        data = bytearray(base64.b64decode(file["data"]))
        data[0] ^= 1
        tampered = json.dumps({**file, "data": base64.b64encode(bytes(data)).decode()})
        back(page)
        try_import(page, tampered, PASSWORD)
        result = text_of(page, "import-result")
        r.check("a file changed after locking doesn't open, even with the right password",
                "doesn't open this file" in result and "changed or damaged" in result, result)
        back(page)

        # --- the round trip ---
        try_import(page, locked, PASSWORD)
        summary = text_of(page, "import-summary")
        r.check("the right password shows the usual preview",
                summary.startswith("Will add 2 cookies") and not page.locator("#import-password-row").is_visible(),
                summary)
        warning = page.locator("#import-warning")
        r.check("the preview says to only import your own cookies",
                warning.is_visible() and " ".join(warning.text_content().split()) ==
                "Only import cookies you made yourself. Cookies from someone else can sign you in to "
                "their account, or be used to trick you.",
                warning.text_content().strip())
        r.check("the password is emptied once used", page.locator("#import-password").input_value() == "")
        page.locator("#import-confirm").click()
        page.wait_for_timeout(1500)
        after = page.evaluate(SNAPSHOT)
        r.check("round trip: every cookie comes back exactly", after == original,
                json.dumps([a for a in after if a not in original]))
        r.check("the password isn't in storage after importing", PASSWORD not in page.evaluate(STORED))
        back(page)

        r.check("no console errors throughout", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
