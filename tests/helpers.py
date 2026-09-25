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

import atexit
import json
import os
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
EXTENSION = REPO / "src"

# Throwaway browser profiles. Gitignored; removed before each run so every
# test starts from a clean cookie store and an ungranted permission state.
PROFILES = REPO / "tests" / ".profiles"

# Throwaway copy of the extension, built by pregranted_extension(). Gitignored.
#
# The PID matters. run_all.py runs each test file as its own process, and a
# finished test's Chrome can still hold this directory open for a moment after
# the process that started it has gone. With a single shared path, the next
# test would delete a directory Chrome was still reading -- which on Windows
# fails rather than being ignored. One directory per process cannot collide.
#
# This is precaution, not a fix for something observed. It has not been seen
# to happen.
PREGRANTED = REPO / "tests" / f".pregranted-{os.getpid()}"

# Built once per process; the second and later calls reuse it. Rebuilding
# under a browser that is already running would reintroduce the same problem.
_pregranted_ready = False


def pregranted_extension():
    """
    A copy of src/ whose manifest asks for host access UP FRONT.

    Chrome's optional-permission prompt is native browser UI that Playwright
    cannot click, so anything calling chrome.permissions.request() blocks until
    a human clicks Allow -- dozens of times across a full run. A REQUIRED host
    permission is granted when the extension loads, with no prompt at all, so
    the tests start from an already-granted state and run unattended.

    src/manifest.json is never touched: the shipped extension still asks at
    runtime. The trade-off is that the optional-permission wiring is no longer
    exercised by most tests. test_states.py deliberately loads the real src/
    and is the one place the gate screen and the Deny branch are covered, so
    that path still has a test behind it.
    """
    global _pregranted_ready
    if _pregranted_ready:
        return PREGRANTED

    # Best-effort tidy of copies left behind by earlier runs whose browser was
    # still holding files at exit. Failing here is not worth stopping for.
    for stale in PREGRANTED.parent.glob(".pregranted-*"):
        if stale != PREGRANTED:
            shutil.rmtree(stale, ignore_errors=True)

    shutil.rmtree(PREGRANTED, ignore_errors=True)
    shutil.copytree(EXTENSION, PREGRANTED)

    path = PREGRANTED / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    # host_permissions, NOT permissions: Manifest V3 keeps host patterns in
    # their own key, and Chrome silently ignores a host pattern listed under
    # permissions. That failure mode looks exactly like the extension having
    # no access at all.
    optional = manifest.pop("optional_host_permissions", [])
    manifest["host_permissions"] = list(optional)
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    # The copy has to stay the extension under test. If anything other than
    # where the host permission sits has changed, the tests are no longer
    # testing what ships, so fail loudly rather than quietly drift.
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
    Start Chromium with the extension loaded, on a fresh profile.

    Loads the pre-granted copy by default, so no native permission prompt ever
    appears and the suite runs without anyone clicking Allow. Pass
    `extension=EXTENSION` to load the real src/ instead and start from a
    genuinely ungranted state -- test_states.py is the one place that wants it.

    Any other keyword (device_scale_factor=2, say) goes straight to
    Playwright's launch_persistent_context.
    """
    source = Path(extension) if extension else pregranted_extension()

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
            f"--disable-extensions-except={source}",
            f"--load-extension={source}",
            "--no-first-run",
            *extra_args,
        ],
        **context_options,
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
    Make sure the host permission is granted.

    Under the default pre-granted extension this is a no-op: the permission is
    already held, so Chrome resolves immediately without showing anything. It
    still matters when the real src/ is loaded, where it WILL raise the native
    prompt that Playwright cannot click -- so only call it then if a human is
    sitting there to click Allow.

    Either way, the tests cover what happens after a grant, never the prompt.
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
