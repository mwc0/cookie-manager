"""
Shared setup for the browser tests, so the test files stay short.

Two things to know before changing anything here:

1. Playwright can't click the extension's toolbar icon, so it can't open the
   real popup. The tests open popup/popup.html in a normal tab instead. But
   then the active tab is the popup itself, and the extension would show its
   blocked-page screen. stub_active_tab() fixes that by faking
   chrome.tabs.query. Nothing else is faked: cookies are read from and
   written to Chrome's real cookie store.

2. Playwright can't click Chrome's own UI at all, like the permission prompt
   or the "Allow in Incognito" switch. Those are checked by hand. See
   README.md.
"""

import atexit
import json
import os
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
EXTENSION = REPO / "src"

# Throwaway browser profiles (gitignored). Deleted before each run, so every
# test starts with no cookies and no permission granted.
PROFILES = REPO / "tests" / ".profiles"

# Throwaway copy of the extension, made by pregranted_extension() (gitignored).
#
# Each process gets its own folder, named after its process ID. run_all.py
# runs each test file as a separate process, and the last test's Chrome can
# keep the folder open for a moment after it finishes. On Windows, deleting a
# folder that's in use fails. This hasn't actually happened. It's a
# precaution.
PREGRANTED = REPO / "tests" / f".pregranted-{os.getpid()}"

# Only built once per process. Rebuilding it while Chrome is running would
# cause the same problem.
_pregranted_ready = False


def pregranted_extension():
    """
    A copy of src/ with host access in the manifest from the start.

    Playwright can't click Chrome's permission prompt, so every call to
    chrome.permissions.request() would wait for someone to click Allow. A
    required host permission is granted when the extension loads, with no
    prompt, so the tests can run on their own.

    src/manifest.json isn't changed, so the real extension still asks when
    it's first used. Because of this, most tests skip the permission code.
    test_states.py loads the real src/ to test that part.
    """
    global _pregranted_ready
    if _pregranted_ready:
        return PREGRANTED

    # Clear out copies left by earlier runs. If Chrome still has one open,
    # it's skipped.
    for stale in PREGRANTED.parent.glob(".pregranted-*"):
        if stale != PREGRANTED:
            shutil.rmtree(stale, ignore_errors=True)

    shutil.rmtree(PREGRANTED, ignore_errors=True)
    shutil.copytree(EXTENSION, PREGRANTED)

    path = PREGRANTED / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    # It has to be host_permissions, not permissions. Chrome ignores a host
    # pattern under permissions without any error, which looks exactly like
    # the extension having no access.
    optional = manifest.pop("optional_host_permissions", [])
    manifest["host_permissions"] = list(optional)
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    # The copy must match the real manifest apart from the host permission.
    # If anything else differs, the tests aren't testing what ships, so stop.
    original = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))
    differing = {
        key
        for key in set(original) | set(manifest)
        if original.get(key) != manifest.get(key)
    }
    if differing != {"host_permissions", "optional_host_permissions"}:
        raise AssertionError(
            "the pre-granted copy differs from src/manifest.json in unexpected "
            f"ways: {sorted(differing)}"
        )

    _pregranted_ready = True
    atexit.register(shutil.rmtree, PREGRANTED, ignore_errors=True)
    return PREGRANTED


def launch(playwright, name, extra_args=(), extension=None, **context_options):
    """
    Starts Chromium on a fresh profile, with the extension loaded.

    Loads the pre-granted copy unless told otherwise, so no permission prompt
    appears. Pass extension=EXTENSION to load the real src/ with no
    permission granted. Only test_states.py does this.

    Any other keyword arguments, like device_scale_factor=2, are passed
    straight to Playwright's launch_persistent_context.
    """
    source = Path(extension) if extension else pregranted_extension()

    profile = PROFILES / name
    shutil.rmtree(profile, ignore_errors=True)
    profile.mkdir(parents=True, exist_ok=True)

    return playwright.chromium.launch_persistent_context(
        str(profile),
        # Not headless. Extensions work more reliably in a real window, and
        # the tests are quick anyway.
        headless=False,
        args=[
            f"--disable-extensions-except={source}",
            f"--load-extension={source}",
            "--no-first-run",
            *extra_args,
        ],
        **context_options,
    )


def extension_id(context):
    """Reads the extension's ID from chrome://extensions."""
    page = context.new_page()
    page.goto("chrome://extensions")
    page.wait_for_timeout(800)
    ext_id = page.locator("extensions-item").first.get_attribute("id")
    page.close()

    if not ext_id:
        raise RuntimeError("Could not read the extension ID from chrome://extensions")
    return ext_id


def popup_url(ext_id):
    return f"chrome-extension://{ext_id}/popup/popup.html"


def stub_active_tab(page, url):
    """
    Makes the popup think `url` is the active tab.

    Call it before the page is loaded. The note at the top of this file
    explains why it's needed.
    """
    page.add_init_script(
        """
        (() => {
            const fakeTab = { id: 1, url: %s, title: 'test tab', active: true };
            chrome.tabs.query = (options, callback) => {
                if (options && options.active) {
                    if (callback) { callback([fakeTab]); return; }
                    return Promise.resolve([fakeTab]);
                }
                return Promise.resolve([]);
            };
        })();
        """
        % json.dumps(url)
    )


def grant_host_permission(page):
    """
    Asks for host access.

    With the pre-granted copy (the default) access is already there, so this
    returns straight away. With the real src/ it opens Chrome's permission
    prompt, which Playwright can't click, so only use it then if someone is
    there to click Allow.
    """
    return page.evaluate(
        "() => new Promise(resolve => "
        "chrome.permissions.request({origins: ['*://*/*']}, resolve))"
    )


def open_popup(context, ext_id, site_url, grant=True):
    """
    Opens the popup for `site_url`, with access granted.
    Returns (page, console_errors). The list fills up as errors are logged.
    """
    page = context.new_page()
    console_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )

    stub_active_tab(page, site_url)
    page.goto(popup_url(ext_id))
    page.wait_for_timeout(400)

    if grant:
        grant_host_permission(page)
        page.reload()
        page.wait_for_timeout(1000)

    return page, console_errors


def visible_state(page):
    """Which of the popup's screens is showing."""
    return page.evaluate(
        "() => { for (const el of document.querySelectorAll('.state')) "
        "if (!el.hidden) return el.id; return null; }"
    )


def cookies_for(page, host):
    """Reads Chrome's cookie store directly, to check what the popup really did."""
    return page.evaluate(
        """async (host) => (await chrome.cookies.getAll({domain: host})).map(c => ({
            name: c.name, value: c.value, domain: c.domain, path: c.path,
            hostOnly: c.hostOnly, secure: c.secure, httpOnly: c.httpOnly,
            sameSite: c.sameSite, session: c.session, exp: c.expirationDate || null
        }))""",
        host,
    )


def row_for(page, cookie_name):
    """
    The table row for the named cookie.

    Buttons are found by their own class, not by their text or a :not()
    selector. Cookie values are in the same row, so a value like "v2-edited"
    would match a search for "Edit". And a :not(.danger) selector started
    matching the Keep button as soon as it was added to the row.
    """
    return page.locator("tr", has=page.locator("td.name", has_text=cookie_name))


def edit_button(row):
    return row.locator("button.row-button.edit").first


def delete_button(row):
    return row.locator("button.row-button.danger").first


def keep_button(row):
    return row.locator("button.row-button.keep").first


class Results:
    """Collects PASS/FAIL lines and reports a total."""

    def __init__(self, title):
        self.title = title
        self.entries = []
        print(f"\n=== {title} ===")

    def check(self, name, ok, detail=""):
        self.entries.append((name, bool(ok), detail))
        print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f": {detail}" if detail else ""))
        return ok

    def note(self, name, detail):
        """Logs something without passing or failing it."""
        self.entries.append((name, True, detail))
        print(f"[note] {name}: {detail}")

    @property
    def failures(self):
        return [name for name, ok, _ in self.entries if not ok]

    def summarise(self):
        failed = self.failures
        total = len(self.entries)
        print(f"\n{total - len(failed)}/{total} passed" + (f". Failed: {failed}" if failed else "."))
        return len(failed) == 0
