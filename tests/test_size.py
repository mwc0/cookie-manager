"""
Cookie sizes.

A site that has piled up cookies can push the Cookie header past what its
server accepts, and the symptom is usually "I can't log in". The popup shows
the total, marks cookies close to Chrome's 4 KB limit, and warns above 6 KB.
"""

import sys

from playwright.sync_api import sync_playwright

from helpers import (
    Results,
    extension_id,
    launch,
    open_popup,
    row_for,
)

BIG_SITE = "https://heavy.test/"
SMALL_SITE = "https://light.test/"

# 3,600 + 3,000 + 1 bytes of values, plus names and separators, is 6,622
# bytes, or 6.5 KB.
SEED = """async () => {
    const set = (d) => chrome.cookies.set(d);
    await set({url: 'https://heavy.test/', name: 'big', value: 'x'.repeat(3600)});
    await set({url: 'https://heavy.test/', name: 'medium', value: 'y'.repeat(3000)});
    await set({url: 'https://heavy.test/', name: 'small', value: 'z'});
    await set({url: 'https://light.test/', name: 'tiny', value: '1'});
}"""


def main():
    r = Results("Cookie sizes")

    with sync_playwright() as p:
        context = launch(p, "size")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, BIG_SITE)
        page.evaluate(SEED)
        page.reload()
        page.wait_for_timeout(1200)

        count = page.locator("#cookie-count").text_content().strip()
        r.check("the count line gives the total size", count == "3 cookies · about 6.5 KB", count)

        big_flags = row_for(page, "big").locator(".flags").text_content()
        medium_flags = row_for(page, "medium").locator(".flags").text_content()
        r.check("a cookie near Chrome's 4 KB limit is marked Large", "Large" in big_flags, big_flags)
        r.check("a smaller one isn't", "Large" not in medium_flags, medium_flags)

        name_title = row_for(page, "small").locator(".name").get_attribute("title")
        r.check("a cookie's size is in its name's tooltip", name_title == "small (6 bytes)", repr(name_title))

        warning = page.locator("#size-warning")
        r.check("over 6 KB, the popup warns that it can stop logins",
                warning.is_visible() and "8 KB" in warning.text_content(),
                warning.text_content().strip())
        page.close()

        page, more_errors = open_popup(context, ext_id, SMALL_SITE)
        page.wait_for_timeout(600)
        count = page.locator("#cookie-count").text_content().strip()
        r.check("a small site shows its size too", count == "1 cookie · about 6 bytes", count)
        r.check("and no warning", page.locator("#size-warning").is_hidden())
        page.close()

        page, empty_errors = open_popup(context, ext_id, "https://nothing.test/")
        page.wait_for_timeout(600)
        count = page.locator("#cookie-count").text_content().strip()
        r.check("a site with no cookies shows no size", count == "0 cookies", count)

        all_errors = errors + more_errors + empty_errors
        r.check("no console errors throughout", not all_errors, str(all_errors[:3]))
        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
