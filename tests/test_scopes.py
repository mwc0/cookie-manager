"""
The page, domain and all-sites delete options.

This is the main feature, so it's not enough that it deletes. It has to
delete exactly what it said it would: the count on screen, the confirm
message, the result message and Chrome's cookie store must all agree.

notexample.test is there on purpose. A check that only looked at whether the
domain ends in "example.test" would delete it too, and it's a different
site.
"""

import json
import sys

from playwright.sync_api import sync_playwright

from helpers import Results, extension_id, launch, open_popup, visible_state

SITE = "https://www.example.test/"

SEED = [
    {"url": "https://www.example.test/", "name": "host_www", "value": "1"},
    {"url": "https://example.test/", "name": "domainwide", "value": "2", "domain": ".example.test"},
    {"url": "https://sub.example.test/", "name": "host_sub", "value": "3"},
    {"url": "https://deep.sub.example.test/", "name": "host_deep", "value": "4"},
    {"url": "https://other.test/", "name": "unrelated", "value": "5"},
    {"url": "https://notexample.test/", "name": "lookalike", "value": "6"},
]


def select_scope(page, scope):
    page.locator(f'input[name="scope"][value="{scope}"]').check()
    page.wait_for_timeout(900)


def listed_domains(page):
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('#scope-domains-list li'))"
        ".map(li => li.textContent)"
    )


def main():
    r = Results("Delete scopes")

    with sync_playwright() as p:
        context = launch(p, "scopes")
        ext_id = extension_id(context)
        page, errors = open_popup(context, ext_id, SITE)

        seeded = page.evaluate(
            """async (seed) => {
                const out = [];
                for (const s of seed) {
                    const c = await chrome.cookies.set(s);
                    out.push([s.name, c ? c.domain : null]);
                }
                return out;
            }""",
            SEED,
        )
        r.check("seeded the test cookies", all(x[1] for x in seeded), json.dumps(seeded))

        page.reload()
        page.wait_for_timeout(1200)
        r.check("main screen reached", visible_state(page) == "state-main")

        # --- this page ---
        # Two cookies: the host-only one, and the domain-wide .example.test
        # one, which this page also gets.
        select_scope(page, "page")
        r.check("'this page' counts the cookies the page actually receives",
                "2 cookies" in page.locator("#scope-summary").text_content(),
                page.locator("#scope-summary").text_content().strip())

        # --- this domain and its subdomains ---
        select_scope(page, "domain")
        domains = listed_domains(page)
        r.check("'this domain' strips the www. from the label",
                page.locator("#scope-target-domain").text_content().strip() == "example.test")
        r.check("'this domain' reaches subdomains, including two levels down",
                "sub.example.test" in domains and "deep.sub.example.test" in domains,
                str(domains))
        r.check("'this domain' does NOT catch a lookalike domain",
                "notexample.test" not in domains and "other.test" not in domains,
                "notexample.test / other.test correctly absent")

        # --- all sites ---
        select_scope(page, "all")
        all_domains = listed_domains(page)
        r.check("'all sites' includes the unrelated domains",
                "notexample.test" in all_domains and "other.test" in all_domains,
                str(all_domains))

        # --- delete at domain scope, and check it did what it said ---
        select_scope(page, "domain")
        claimed = page.locator("#scope-summary").text_content().strip()
        page.locator("#delete-button").click()
        page.wait_for_timeout(300)
        confirmed = page.locator("#confirm-text").text_content().strip()
        page.locator("#confirm-yes").click()
        page.wait_for_timeout(1200)
        reported = page.locator("#delete-result").text_content().strip()

        remaining = page.evaluate(
            "async () => (await chrome.cookies.getAll({})).map(c => c.domain + '|' + c.name)"
        )
        example_left = [c for c in remaining if "example.test" in c and not c.startswith("notexample")]
        survivors = sorted(c for c in remaining if c.startswith(("other.test", "notexample.test")))

        r.check("the claim, the confirm and the result all say 4",
                "4 cookies" in claimed and "4 cookies" in confirmed and "4 cookies" in reported,
                f"{claimed!r} -> {confirmed!r} -> {reported!r}")
        r.check("the target domain is actually empty afterwards", not example_left, str(example_left))
        r.check("the unrelated cookies survived untouched", len(survivors) == 2, str(survivors))
        r.check("no console errors", not errors, str(errors[:3]))

        context.close()

    return r.summarise()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
