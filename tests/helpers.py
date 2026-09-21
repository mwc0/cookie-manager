"""
Shared setup for the browser tests.

Everything awkward about driving an extension from Playwright lives here, so
the test files themselves stay readable.

Two things are worth understanding before changing any of this:

1. Playwright cannot click the extension's toolbar icon, so it cannot open a
   real browser-action popup. The tests open `popup/popup.html` as an ordinary
   tab instead. That has a side effect: the popup page then IS the active tab,
   so the extension would see a chrome-extension:// URL and correctly show its
   blocked screen. `stub_active_tab()` works around it by faking
   chrome.tabs.query, which is the only thing being faked -- all cookie
   reads and writes go to the real Chrome cookie store.

2. Chrome's own UI (the permission prompt, the "Allow in incognito" toggle) is
   browser chrome, not page content, and cannot be driven at all. Those parts
   are checked by hand -- see README.md.
"""

import json
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
EXTENSION = REPO / "src"

# Throwaway browser profiles. Gitignored; removed before each run so every
# test starts from a clean cookie store and an ungranted permission state.
PROFILES = REPO / "tests" / ".profiles"


def launch(playwright, name, extra_args=()):
    """Start Chromium with the extension loaded, on a fresh profile."""
    profile = PROFILES / name
    shutil.rmtree(profile, ignore_errors=True)
    profile.mkdir(parents=True, exist_ok=True)

    return playwright.chromium.launch_persistent_context(
        str(profile),
        # Not headless: extensions and their pages are more reliably available
        # in a real browser window, and these tests are cheap enough to run
        # visibly.
        headless=False,
        args=[
            f"--disable-extensions-except={EXTENSION}",
            f"--load-extension={EXTENSION}",
            "--no-first-run",
            *extra_args,
        ],
    )


def extension_id(context):
    """Read the unpacked extension's generated ID off chrome://extensions."""
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
    Make the popup believe `url` is the active tab.

    Must be called before the page is navigated. See the note at the top of
    this file for why this is necessary.
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
    Grant the optional host permission.

    Calls the API directly, because the real prompt is native browser UI that
    Playwright cannot click. This means the tests cover everything that
    happens AFTER a grant, and nothing about the prompt itself.
    """
    return page.evaluate(
        "() => new Promise(resolve => "
        "chrome.permissions.request({origins: ['*://*/*']}, resolve))"
    )


def open_popup(context, ext_id, site_url, grant=True):
    """
    The usual starting point: a popup showing `site_url`, permission granted.
    Returns (page, console_errors) -- the list fills as errors are logged.
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
    """Which of the popup's screens is currently showing."""
    return page.evaluate(
        "() => { for (const el of document.querySelectorAll('.state')) "
        "if (!el.hidden) return el.id; return null; }"
    )


def cookies_for(page, host):
    """Read the real cookie store directly, to check what the UI actually did."""
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
    The table row for a named cookie.

    Buttons are found by their OWN class, never by text and never by a
    :not() chain. Two reasons, both learned the hard way: cookie VALUES are
    shown in the same row, so a value like "v2-edited" matches a
    has_text="Edit" filter; and a :not(.danger) selector silently started
    matching the Keep button the moment a third action was added to the row.
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
        """Record something observed, with no pass/fail judgement."""
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
