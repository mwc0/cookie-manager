"""
The Light and Dark buttons.

With nothing saved, the popup follows the system theme. Picking the other
theme saves it and keeps it, even when the system changes. Picking the
system's own theme again removes the saved choice, so the popup goes back to
following the system.

The browser starts with a dark system theme. emulate_media() stands in for
the person changing their system setting.
"""

import sys

from playwright.sync_api import sync_playwright

from helpers import Results, extension_id, launch, open_popup

SITE = "https://theme.test/"

STATE = """async () => ({
    showing: document.documentElement.dataset.theme,
    checked: (document.querySelector('input[name="theme"]:checked') || {}).value || null,
    saved: (await chrome.storage.local.get('theme')).theme || null,
    copy: localStorage.getItem('theme'),
})"""


def state(page):
    return page.evaluate(STATE)


def pick(page, theme):
    page.locator(f'label[for="theme-{theme}"]').click()
    page.wait_for_timeout(400)


def main():
    r = Results("Light / dark theme")

    with sync_playwright() as p:
        context = launch(p, "theme", color_scheme="dark")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)

        r.check("there are two theme buttons, Light and Dark",
                page.evaluate("() => [...document.querySelectorAll('input[name=\"theme\"]')].map(i => i.value)")
                == ["light", "dark"])

        s = state(page)
        r.check("with nothing saved, it follows the system (dark)",
                s == {"showing": "dark", "checked": "dark", "saved": None, "copy": None}, str(s))

        pick(page, "light")
        s = state(page)
        r.check("picking the other theme switches to it and saves it",
                s == {"showing": "light", "checked": "light", "saved": "light", "copy": "light"}, str(s))

        page.reload()
        page.wait_for_timeout(1000)
        s = state(page)
        r.check("the picked theme is still there after reopening",
                s["showing"] == "light" and s["checked"] == "light", str(s))

        pick(page, "dark")
        s = state(page)
        r.check("picking the system's own theme removes the saved choice",
                s == {"showing": "dark", "checked": "dark", "saved": None, "copy": None}, str(s))

        page.emulate_media(color_scheme="light")
        page.wait_for_timeout(400)
        s = state(page)
        r.check("while following the system, it changes when the system does",
                s["showing"] == "light" and s["checked"] == "light", str(s))

        pick(page, "dark")
        page.emulate_media(color_scheme="dark")
        page.wait_for_timeout(300)
        page.emulate_media(color_scheme="light")
        page.wait_for_timeout(400)
        s = state(page)
        r.check("a picked theme stays when the system changes",
                s == {"showing": "dark", "checked": "dark", "saved": "dark", "copy": "dark"}, str(s))

        # Version 1.0.0 saved "auto" for follow the system.
        page.evaluate("async () => { await chrome.storage.local.set({theme: 'auto'}); localStorage.setItem('theme', 'auto'); }")
        page.reload()
        page.wait_for_timeout(1000)
        s = state(page)
        r.check("an old \"auto\" setting is treated as follow the system, and removed",
                s == {"showing": "light", "checked": "light", "saved": None, "copy": None}, str(s))

        r.check("no console errors", not errors, str(errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
