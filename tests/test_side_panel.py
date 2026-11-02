"""
The side panel: the button that opens it, the panel following the active
tab, and the narrow layout.

Chrome's real sidePanel.open() can't be driven here: in the test browser,
opening the side panel closes the whole browser. So the button is tested
with chrome.sidePanel replaced by a stand-in that records what it was asked
to do. Whether the real panel opens from the toolbar popup is checked by
hand. See README.md.

The panel itself is popup.html?panel=1 loaded in an ordinary tab of the same
window. Bringing another tab to the front fires chrome.tabs.onActivated
exactly as switching tabs does, so the page follows it as it would in the
panel.
"""

import sys

from playwright.sync_api import sync_playwright

from helpers import (
    Results,
    extension_id,
    keep_button,
    launch,
    open_popup,
    popup_url,
    row_for,
    stub_active_tab,
    visible_state,
)

SITE = "https://panel.test/"
ONE = "https://one.panel.test/"
TWO = "https://two.panel.test/"
THREE = "https://three.panel.test/"

SEED = """async () => {
    const set = (url, name, value) => chrome.cookies.set({url, name, value});
    await set('https://panel.test/', 'session_id', 'a-long-session-value-0123456789abcdef0123456789');
    await set('https://panel.test/', 'a_cookie_with_a_really_long_name_that_goes_on', 'x');
    await set('https://panel.test/', 'prefs', '%7B%22theme%22%3A%22dark%22%7D');
    await set('https://one.panel.test/', 'from_one', '1');
    await set('https://two.panel.test/', 'from_two', '2');
    await set('https://three.panel.test/', 'from_three', '3');
}"""

# Stands in for chrome.sidePanel and window.close(), and records each call.
RECORD_PANEL = """
(() => {
    window.__calls = [];
    chrome.sidePanel.setOptions = (options) => {
        window.__calls.push(['setOptions', options]);
        return Promise.resolve();
    };
    chrome.sidePanel.open = (options) => {
        window.__calls.push(['open', options]);
        if (window.__openFails) {
            return Promise.reject(new Error(window.__openFails));
        }
        return Promise.resolve();
    };
    window.close = () => window.__calls.push(['close']);
})();
"""

OVERFLOW = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth"


def text_of(page, element_id):
    return (page.locator("#" + element_id).text_content() or "").strip()


def wait_for_site(page, host, timeout=4000):
    """Waits until the page shows `host`. Returns whether it did."""
    try:
        page.wait_for_function(
            "(host) => document.getElementById('site-name').textContent === host "
            "&& !document.getElementById('state-main').hidden",
            arg=host, timeout=timeout)
        return True
    except Exception:
        return False


def serve(page):
    page.route("https://*.panel.test/**", lambda route: route.fulfill(
        status=200, content_type="text/html", body="<!doctype html><title>site</title>"))


def check_button(r, context, ext_id):
    page, errors = open_popup(context, ext_id, SITE)
    page.locator("#more-button").click()
    r.check("the popup has an Open in side panel button", page.locator("#panel-button").is_visible())
    page.keyboard.press("Escape")

    tab_view = context.new_page()
    stub_active_tab(tab_view, SITE)
    tab_view.goto(popup_url(ext_id) + "?tab=1")
    tab_view.wait_for_timeout(1000)
    r.check("not in a tab", not tab_view.locator("#panel-button").is_visible())
    tab_view.close()

    panel = context.new_page()
    stub_active_tab(panel, SITE)
    panel.goto(popup_url(ext_id) + "?panel=1")
    panel.wait_for_timeout(1000)
    r.check("and not in the side panel, where Open in a tab is hidden too",
            visible_state(panel) == "state-main"
            and not panel.locator("#panel-button").is_visible()
            and not panel.locator("#tab-button").is_visible(),
            visible_state(panel))
    r.check("the side panel page is marked for the narrow layout",
            panel.evaluate("document.body.classList.contains('in-panel')"))
    panel.close()
    page.close()

    # The click, with chrome.sidePanel recorded.
    page = context.new_page()
    page.add_init_script(RECORD_PANEL)
    stub_active_tab(page, SITE)
    page.goto(popup_url(ext_id))
    page.wait_for_timeout(1200)
    window_id = page.evaluate("async () => (await chrome.windows.getCurrent()).id")
    page.locator("#more-button").click()
    page.locator("#panel-button").click()
    page.wait_for_timeout(400)
    calls = page.evaluate("window.__calls")
    r.check("clicking it sets the panel's page, opens it in this window, then closes the popup",
            calls == [["setOptions", {"path": "popup/popup.html?panel=1", "enabled": True}],
                      ["open", {"windowId": window_id}],
                      ["close"]],
            str(calls))

    page.evaluate("""() => { window.__calls = [];
        window.__openFails = 'sidePanel.open() may only be called in response to a user gesture.'; }""")
    page.locator("#more-button").click()
    page.locator("#panel-button").click()
    page.wait_for_timeout(400)
    message = text_of(page, "main-message")
    r.check("if Chrome says the click came too late, the message says to click again",
            message == "Chrome only opens the side panel straight from a click. Please click the button again."
            and ["close"] not in page.evaluate("window.__calls"),
            message)

    page.evaluate("() => { window.__calls = []; window.__openFails = 'No active side panel for windowId: 7'; }")
    page.locator("#more-button").click()
    page.locator("#panel-button").click()
    page.wait_for_timeout(400)
    message = text_of(page, "main-message")
    r.check("any other failure is shown in plain words",
            message == "Couldn't open the side panel: No active side panel for windowId: 7", message)
    page.close()

    # Declined. Chrome doesn't ask for this permission, but if it ever says no:
    page = context.new_page()
    page.add_init_script(RECORD_PANEL)
    page.add_init_script("chrome.permissions.request = () => Promise.resolve(false);")
    stub_active_tab(page, SITE)
    page.goto(popup_url(ext_id))
    page.wait_for_timeout(1200)
    page.locator("#more-button").click()
    page.locator("#panel-button").click()
    page.wait_for_timeout(400)
    message = text_of(page, "main-message")
    r.check("if the permission is refused, the popup says so and opens nothing",
            message == "Chrome didn't allow the side panel, so cookieZ can't open there."
            and page.evaluate("window.__calls") == [],
            message)
    page.close()
    r.check("no console errors in the popup", not errors, str(errors))


def check_following(r, context, ext_id):
    one = context.new_page()
    serve(one)
    one.goto(ONE)
    two = context.new_page()
    serve(two)
    two.goto(TWO)

    panel = context.new_page()
    errors = []
    panel.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    panel.set_viewport_size({"width": 400, "height": 800})
    panel.goto(popup_url(ext_id) + "?panel=1")
    panel.wait_for_timeout(1000)

    windows = panel.evaluate("async () => (await chrome.tabs.query({})).map(t => t.windowId)")
    r.check("the test's tabs are all in one window", len(set(windows)) == 1, str(windows))

    one.bring_to_front()
    r.check("switching to a tab shows that tab's cookies", wait_for_site(panel, "one.panel.test"),
            text_of(panel, "site-name"))
    r.check("with its cookie in the table", row_for(panel, "from_one").count() == 1)

    two.bring_to_front()
    r.check("switching to another tab follows it", wait_for_site(panel, "two.panel.test"),
            text_of(panel, "site-name"))

    two.goto(THREE)
    r.check("the active tab going to a new address is followed too",
            wait_for_site(panel, "three.panel.test"), text_of(panel, "site-name"))
    r.check("with the new site's cookies", row_for(panel, "from_three").count() == 1)

    # The editor is open: a tab switch waits until it's closed. Clicks go
    # through evaluate(), since clicking would bring the panel's own tab to
    # the front.
    panel.evaluate("document.getElementById('add-button').click()")
    panel.wait_for_timeout(200)
    one.bring_to_front()
    panel.wait_for_timeout(1800)
    r.check("no reload while the editor is open",
            visible_state(panel) == "state-edit" and text_of(panel, "site-name") == "three.panel.test",
            f"{visible_state(panel)}, {text_of(panel, 'site-name')}")
    panel.evaluate("document.getElementById('edit-cancel').click()")
    r.check("and it catches up on going back", wait_for_site(panel, "one.panel.test"),
            text_of(panel, "site-name"))

    # "Delete these cookies?" is a question waiting for an answer.
    panel.evaluate("document.getElementById('delete-button').click()")
    panel.wait_for_timeout(200)
    two.bring_to_front()
    panel.wait_for_timeout(1800)
    r.check("no reload while Delete is asking",
            not panel.locator("#confirm-row").is_hidden() and text_of(panel, "site-name") == "one.panel.test",
            text_of(panel, "site-name"))
    panel.evaluate("document.getElementById('confirm-no').click()")
    r.check("and it catches up after Cancel", wait_for_site(panel, "three.panel.test"),
            text_of(panel, "site-name"))

    # A tab in another window is none of the panel's business.
    panel.evaluate("""async () => {
        const w = await chrome.windows.create({url: 'https://two.panel.test/', focused: false});
        window.__otherWindow = w.id;
    }""")
    panel.wait_for_timeout(1800)
    r.check("a tab opened in another window isn't followed",
            text_of(panel, "site-name") == "three.panel.test", text_of(panel, "site-name"))
    panel.evaluate("chrome.windows.remove(window.__otherWindow)")

    # The keyboard works in the panel.
    panel.evaluate("document.body.focus()")
    panel.keyboard.press("/")
    r.check("/ goes to the search box in the panel",
            panel.evaluate("document.activeElement.id") == "search-input")
    panel.evaluate("document.activeElement.blur()")
    panel.keyboard.press("n")
    panel.wait_for_timeout(200)
    r.check("and N opens a new cookie", visible_state(panel) == "state-edit", visible_state(panel))
    panel.keyboard.press("Escape")
    panel.wait_for_timeout(200)
    r.check("and Esc goes back", visible_state(panel) == "state-main", visible_state(panel))

    r.check("no console errors in the panel", not errors, str(errors))
    for page in (one, two, panel):
        page.close()


def check_narrow(r, context, ext_id):
    page = context.new_page()
    stub_active_tab(page, SITE)
    page.set_viewport_size({"width": 360, "height": 800})
    page.goto(popup_url(ext_id) + "?panel=1")
    page.wait_for_timeout(1200)

    shown = page.evaluate("""() => [...document.querySelectorAll('#cookie-table thead th')]
        .filter(th => getComputedStyle(th).display !== 'none')
        .map(th => th.textContent.trim())""")
    r.check("at 360px the table shows the tick box, Name, Value and the row buttons",
            shown == ["", "Name", "Value", "Actions"], str(shown))
    cells = page.evaluate("""() => [...document.querySelector('#cookie-rows tr').cells]
        .filter(td => getComputedStyle(td).display !== 'none').map(td => td.className)""")
    r.check("and the rows match their headings", cells == ["pick", "mono name", "mono value", "row-actions"],
            str(cells))
    fits = page.evaluate("""() => { const wrap = document.getElementById('table-wrap');
        return wrap.scrollWidth <= wrap.clientWidth; }""")
    r.check("the table fits without scrolling sideways", fits)
    small = page.evaluate("""() => [...document.querySelectorAll('#state-main button, #state-main label[for]')]
        .filter(b => b.offsetParent !== null && !b.closest('.visually-hidden'))
        .filter(b => { const r = b.getBoundingClientRect(); return r.width < 24 || r.height < 24; })
        .filter(b => !b.classList.contains('link-button') && !b.classList.contains('value-toggle')
                     && !b.classList.contains('sort') && !b.closest('.pick-target'))
        .map(b => b.id || b.className || b.textContent.trim())""")
    r.check("buttons are still at least 24px", small == [], str(small))

    if page.locator("#kept-open").is_hidden():
        keep_button(row_for(page, "prefs")).click()
    page.evaluate("chrome.cookies.set({url: 'https://panel.test/', name: 'added_later', value: 'y'})")
    page.wait_for_timeout(1500)

    for scheme in ("light", "dark"):
        page.emulate_media(color_scheme=scheme)
        screens = {"main": page.evaluate(OVERFLOW)}

        def visit(name, open_button, back_button, setup=None):
            page.locator("#" + open_button).click()
            page.wait_for_timeout(400)
            if setup:
                setup()
            screens[name] = page.evaluate(OVERFLOW)
            page.locator("#" + back_button).click()
            page.wait_for_timeout(200)

        def confirm():
            page.locator("#delete-button").click()
            page.wait_for_timeout(200)
            screens["confirm"] = page.evaluate(OVERFLOW)
            page.locator("#confirm-no").click()

        def import_and_compare():
            page.locator("#import-text").fill(
                '[{"domain": "panel.test", "name": "session_id", "value": "other", "hostOnly": true, "session": true, "path": "/"}]')
            page.locator("#import-check").click()
            page.wait_for_timeout(500)
            screens["import"] = page.evaluate(OVERFLOW)
            page.locator("#import-compare").click()
            page.wait_for_timeout(400)
            screens["compare"] = page.evaluate(OVERFLOW)
            page.locator("#compare-back").click()
            page.wait_for_timeout(200)

        visit("edit", "add-button", "edit-cancel")
        visit("export", "export-button", "export-back")
        visit("import", "import-button", "import-back", import_and_compare)
        visit("kept", "kept-open", "kept-back")
        visit("changes", "changes-open", "changes-back")
        visit("rules", "rules-open", "rules-back")
        visit("help", "help-button", "help-back")
        confirm()
        page.locator("#pick-all").check()
        page.wait_for_timeout(300)
        screens["ticked"] = page.evaluate(OVERFLOW)
        page.locator("#pick-all").uncheck()

        overflowing = [name for name, fits in screens.items() if not fits]
        r.check(f"no screen scrolls sideways at 360px ({scheme}): " + ", ".join(screens),
                len(screens) == 11 and overflowing == [], str(overflowing))
    page.close()

    # The toolbar popup is untouched.
    popup = context.new_page()
    stub_active_tab(popup, SITE)
    popup.set_viewport_size({"width": 780, "height": 580})
    popup.goto(popup_url(ext_id))
    popup.wait_for_timeout(1200)
    shown = popup.evaluate("""() => [...document.querySelectorAll('#cookie-table thead th')]
        .filter(th => getComputedStyle(th).display !== 'none')
        .map(th => th.textContent.trim())""")
    r.check("the 780px popup still shows every column but Size",
            shown == ["", "Name", "Value", "Domain", "Path", "Expires", "Flags", "Actions"], str(shown))
    one_row = popup.evaluate("""() => { const bar = document.querySelector('header.bar');
        const kids = [...bar.querySelectorAll('.bar-actions > *')].filter(k => k.offsetParent !== null);
        return new Set(kids.map(k => Math.round(k.getBoundingClientRect().top))).size === 1; }""")
    r.check("and its header buttons are on one line", one_row)
    popup.close()


def main():
    r = Results("Side panel")

    with sync_playwright() as p:
        context = launch(p, "side-panel")
        ext_id = extension_id(context)
        setup = context.new_page()
        setup.goto(popup_url(ext_id))
        setup.evaluate(SEED)
        setup.close()

        check_button(r, context, ext_id)
        check_following(r, context, ext_id)
        check_narrow(r, context, ext_id)
        context.close()

    return 0 if r.summarise() else 1


if __name__ == "__main__":
    sys.exit(main())
