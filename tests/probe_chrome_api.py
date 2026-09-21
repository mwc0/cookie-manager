"""
Not a test -- a probe. Run it to ask Chrome how it actually behaves.

Every awkward workaround in src/lib/cookies.js exists because of one of the
answers below. If a Chrome update ever changes one, the code built on it goes
subtly wrong in a way no amount of reading the source would reveal, so this
prints the current answers rather than asserting the old ones.

    python probe_chrome_api.py

Expected answers as of 2026-09-21, Chromium 153:
  set() with a non-covering url ......... returns None, but WRITES the cookie
  set() with a covering url ............. returns the cookie
  SameSite=None without Secure .......... throws, without naming the rule
  domain omitted ........................ host-only
  domain supplied (no dot) .............. stored dotted, NOT host-only
  same identity set twice ............... overwrites, one cookie
  expiry far in the future .............. silently capped near 400 days
"""

import json
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright

from helpers import extension_id, launch, open_popup

SITE = "https://probe.test/"

QUESTIONS = """
async () => {
    const report = {};

    // Does set() resolve null when the url doesn't cover the cookie's path?
    const a = await chrome.cookies.set({url:'https://probe.test/', name:'p1', value:'1', path:'/sub'});
    const aBack = await chrome.cookies.getAll({domain:'probe.test', name:'p1'});
    report['set() with a url that does NOT cover the path'] = {
        returned: a, lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : null,
        cookieActuallyExists: aBack.length === 1
    };

    // And when it does cover it?
    const b = await chrome.cookies.set({url:'https://probe.test/sub', name:'p2', value:'2', path:'/sub'});
    report['set() with a url that DOES cover the path'] = {
        returned: b ? 'the cookie object' : b, cookieActuallyExists: true
    };

    // How does Chrome refuse SameSite=None without Secure?
    try {
        await chrome.cookies.set({url:'https://probe.test/', name:'p3', value:'3',
                                  sameSite:'no_restriction', secure:false});
        report['SameSite=None without Secure'] = {threw:false};
    } catch (e) {
        report['SameSite=None without Secure'] = {threw:true, message:String(e)};
    }

    // Omitting vs supplying `domain`.
    const d1 = await chrome.cookies.set({url:'https://probe.test/', name:'p4', value:'4'});
    const d2 = await chrome.cookies.set({url:'https://probe.test/', name:'p5', value:'5', domain:'probe.test'});
    report['domain omitted'] = d1 ? {domain:d1.domain, hostOnly:d1.hostOnly} : null;
    report['domain supplied, no leading dot'] = d2 ? {domain:d2.domain, hostOnly:d2.hostOnly} : null;

    // Setting the same identity twice: overwrite or duplicate?
    await chrome.cookies.set({url:'https://probe.test/', name:'p6', value:'first'});
    await chrome.cookies.set({url:'https://probe.test/', name:'p6', value:'second'});
    const e = await chrome.cookies.getAll({domain:'probe.test', name:'p6'});
    report['same identity set twice'] = {count:e.length, values:e.map(c => c.value)};

    // How far ahead will Chrome let a cookie expire?
    const wanted = Math.floor(new Date('2099-01-01T00:00:00Z').getTime() / 1000);
    const f = await chrome.cookies.set({url:'https://probe.test/', name:'p7', value:'7',
                                        expirationDate: wanted});
    report['expiry requested far in the future'] = {
        requested: wanted, stored: f ? f.expirationDate : null
    };

    return report;
}
"""


def main():
    with sync_playwright() as p:
        context = launch(p, "probe")
        ext_id = extension_id(context)
        page, _ = open_popup(context, ext_id, SITE)

        answers = page.evaluate(QUESTIONS)

        for question, answer in answers.items():
            print(f"\n{question}:")
            print("  " + json.dumps(answer))

        # The expiry answer is only meaningful as a duration.
        expiry = answers.get("expiry requested far in the future", {})
        if expiry.get("stored"):
            stored = datetime.fromtimestamp(expiry["stored"], timezone.utc)
            days = (stored - datetime.now(timezone.utc)).days
            print(f"\n  -> stored expiry is {days} days from now ({stored.date()}),")
            print(f"     against the {datetime.fromtimestamp(expiry['requested'], timezone.utc).date()} that was asked for.")

        context.close()


if __name__ == "__main__":
    main()
