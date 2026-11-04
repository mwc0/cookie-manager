"""
The popup in every language it ships in.

First, without a browser, the message files: each language has every
message English has, with the same $1, $2... in it, nothing empty, and every
key the code and popup.html ask for exists.

Then, for each language, the popup is opened in a browser started in that
language (--lang), and each screen is visited at the popup's width and at
the side panel's narrowest. On each: no console errors (a missing message
logs one), the page doesn't scroll sideways, and no button, heading or label
has text cut off. Longer German and French words are what this is for.
"""

import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from helpers import EXTENSION, Results, extension_id, launch, open_popup, popup_url

LOCALES = EXTENSION / "_locales"
LANGUAGES = ["en_GB", "de", "es", "fr", "ja", "pt_BR"]
SITE = "https://i18n.test/"
PLURAL = re.compile(r"_(zero|one|two|few|many|other)$")
VALUES = re.compile(r"\$(\d)")


def load(language):
    path = LOCALES / language / "messages.json"
    return {key: entry["message"] for key, entry in json.loads(path.read_text(encoding="utf-8")).items()}


def base(key):
    return PLURAL.sub("", key)


def check_files(r):
    english = load("en_GB")
    groups = {base(key) for key in english}
    for language in LANGUAGES[1:]:
        messages = load(language)
        r.check(f"{language}: every message English has, and no others",
                {base(key) for key in messages} == groups
                and all(key in messages for key in english if not key.endswith("_one")
                        and not key.endswith("_few") and not key.endswith("_many")),
                str(sorted(groups ^ {base(key) for key in messages})[:10]))
        wrong = []
        for key, text in messages.items():
            source = english.get(key) or english.get(base(key) + "_other", "")
            want = set(VALUES.findall(source))
            have = set(VALUES.findall(text))
            # A one form may say the number in words, so its $1 is optional.
            if key.endswith("_one"):
                have.add("1"), want.add("1")
            if want != have or not text.strip():
                wrong.append(key)
        r.check(f"{language}: each message has the same $1, $2... as English, and none is empty",
                not wrong, str(wrong[:10]))
        same = [key for key in english if messages.get(key) == english[key] and len(english[key]) > 12]
        r.check(f"{language}: under a tenth of the longer messages are left in English",
                len(same) < len(english) / 10, f"{len(same)} of {len(english)}: {same[:5]}")

    html = (EXTENSION / "popup" / "popup.html").read_text(encoding="utf-8")
    asked = set(re.findall(r'data-i18n(?:-html|-title|-aria-label|-placeholder)?="(\w+)"', html))
    code = "".join(path.read_text(encoding="utf-8") for path in EXTENSION.rglob("*.js"))
    code = re.sub(r"^\s*//.*$", "", code, flags=re.M)  # examples in comments aren't real keys
    asked |= set(re.findall(r'\bt\(\s*"(\w+)"', code))
    asked |= {key + "_other" for key in re.findall(r'\btn\(\s*"(\w+)"', code)}
    missing = sorted(key for key in asked if key not in english)
    r.check("every key popup.html and the code ask for is in en_GB", not missing, str(missing[:10]))
    r.check("and English has a one form for every number message",
            all(key[:-6] + "_one" in english for key in english if key.endswith("_other")))


SEED = """async () => {
    const set = (name, value) => chrome.cookies.set({url: 'https://i18n.test/', name, value});
    await set('session_id', 'a-long-session-value-0123456789abcdef');
    await set('_ga', 'GA1.2.3.4');
    await set('prefs', '%7B%22theme%22%3A%22dark%22%7D');
}"""

# Buttons, headings and labels whose text is wider than their box.
CLIPPED = """() => [...document.querySelectorAll(
        'button, h1, h2, h3, th, label, summary, .badge, .chip, [role="menuitem"]')]
    .filter(e => e.offsetParent && e.textContent.trim()
        && !e.closest('.visually-hidden')
        && getComputedStyle(e).textOverflow !== 'ellipsis'
        && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 4)
        && getComputedStyle(e).overflow !== 'visible')
    .map(e => (e.id || e.className || e.tagName) + ': ' + e.textContent.trim().slice(0, 40))"""

SIDEWAYS = "() => document.documentElement.scrollWidth > window.innerWidth + 1"

# Each screen, and the button that opens it.
SCREENS = [
    ("main", None),
    ("More menu", "#more-button"),
    ("Help", "#help-button"),
    ("Block cookies", "#rules-open"),
    ("Export", "#export-button"),
    ("Import", "#import-button"),
    ("Add cookie", "#add-button"),
    ("Site report", "#report-open"),
    ("Changes", "#changes-open"),
]


def open_screen(page, button):
    if not button:
        return True
    target = page.locator(button)
    if not target.is_visible():
        page.locator("#more-button").click()
        page.wait_for_timeout(200)
    if not target.is_visible():
        return False
    target.click()
    page.wait_for_timeout(500)
    return True


def check_language(r, p, language):
    context = launch(p, "i18n-" + language, extra_args=(f"--lang={language.replace('_', '-')}",))
    ext_id = extension_id(context)
    page, errors = open_popup(context, ext_id, SITE)
    page.evaluate(SEED)
    page.reload()
    page.wait_for_timeout(1000)

    r.check(f"{language}: the popup is in that language",
            page.evaluate("() => chrome.i18n.getUILanguage()").lower().startswith(language[:2].lower()),
            page.evaluate("() => chrome.i18n.getUILanguage()"))

    # 360px is the side panel at its narrowest, which has its own layout.
    for width, address in ((780, popup_url(ext_id)), (360, popup_url(ext_id) + "?panel=1")):
        page.set_viewport_size({"width": width, "height": 600})
        page.goto(address)
        page.wait_for_timeout(1000)
        problems, skipped = [], []
        for name, button in SCREENS:
            if not open_screen(page, button):
                skipped.append(name)
                continue
            if page.evaluate(SIDEWAYS):
                problems.append(f"{name}: scrolls sideways")
            problems += [f"{name}: {item}" for item in page.evaluate(CLIPPED)]
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
        r.check(f"{language} at {width}px: nothing scrolls sideways or is cut off",
                not problems, "; ".join(problems[:8]) + (f" (skipped {skipped})" if skipped else ""))

    r.check(f"{language}: no console errors, so no message is missing", not errors, str(errors[:5]))
    context.close()


def main():
    r = Results("Languages")
    check_files(r)
    with sync_playwright() as p:
        for language in LANGUAGES:
            check_language(r, p, language)
    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
