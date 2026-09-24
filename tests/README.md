# Tests

Browser tests that drive the real extension in a real Chromium, against the
real cookie store. They exist because almost every way this extension can be
wrong is **silent**: a cookie that quietly becomes permanent, a delete that
leaves partitioned cookies behind, a count that doesn't match what was
removed. None of that shows up as an error message, so it has to be checked
deliberately.

## These do not ship

Nothing here is part of the extension. Only `src/` is loaded and zipped, so
the project's no-dependency rule is about `src/`. This directory is
allowed a test dependency because it never reaches a user's browser.

## Running them

Needs Python and Playwright, once:

```
pip install playwright
python -m playwright install chromium
```

Then, from this directory:

```
python run_all.py          # everything
python test_editor.py      # or just one file
```

A browser window opens and clicks through the popup. That's expected: the
tests aren't headless, because extension pages are more reliably available in
a real window.

## What's covered

| File | What it pins down |
| --- | --- |
| `test_states.py` | Which screen shows and why. The gate vs "no cookies" distinction, the Deny branch, `chrome://` pages. |
| `test_scopes.py` | All three delete scopes, including that a lookalike domain (`notexample.test`) is *not* swept up with `example.test`. |
| `test_partitioned.py` | That `partitionKey: {}` really means "any partition", so delete-all doesn't leave CHIPS cookies behind. |
| `test_editor.py` | Every write trap: host-only, session, SameSite=None, remove-then-set, and Chrome's silent 400-day expiry cap. |
| `test_no_network.py` | That the extension makes no outbound requests, via both a static scan of `src/` and a live capture of a whole session. |
| `test_devtools_crosscheck.py` | The same claims again, but checked against Chrome's DevTools Protocol rather than the extension API. See below. |

`probe_chrome_api.py` is not a test. It asks Chrome how it actually behaves
and prints the answers. Every workaround in `src/lib/cookies.js` exists
because of one of them, so run it if a Chrome update makes something behave
strangely. It's faster than re-deriving the reasons.

## Why there is a separate DevTools cross-check

Every other file here verifies the extension by asking `chrome.cookies` what
happened. That is the same API the extension uses, so if Chrome's extension
API ever disagreed with how the browser really stores things, those tests
would agree with the bug and still report green.

`test_devtools_crosscheck.py` asks a second, independent source: the Chrome
DevTools Protocol. `Storage.getCookies` and `Network.requestWillBeSent` are
the calls behind DevTools' own Application and Network panels, so it is in
substance the same check as opening DevTools and reading the tables by hand.
It compares what the popup *displays*, field by field, against what Chrome
reports.

It also covers the one case the other CHIPS test cannot. `test_partitioned.py`
sets `partitionKey` directly through `chrome.cookies`, which only proves the
extension can read back what it itself wrote. This one gets a real partitioned
cookie the way the web makes them: a cross-site iframe over real TLS returning
a real `Set-Cookie: ...; Partitioned` header.

That needs a genuine HTTPS origin, so the file starts a local TLS server and
maps two hostnames onto it. It is worth knowing why. The first attempt served
those pages through Playwright's request interception, and Chrome stored the
cookie but **ignored the Partitioned attribute entirely**, because route
fulfilment does not go through the code path that applies partitioning. That
looked exactly like a real finding about Chrome, and was not. Telling those
two apart is the whole reason this file exists.

The certificate is generated at runtime with `openssl`, into the gitignored
profiles directory. If `openssl` is not on the machine, that one check reports
SKIPPED rather than failing.

## What these tests CANNOT cover

Two things need a human, and no amount of scripting gets around them:

1. **The permission prompt.** `chrome.permissions.request()` opens native
   browser UI, not a page, so Playwright can neither click it nor see it. The
   tests call the API directly, which covers everything that happens *after* a
   grant and nothing about the prompt itself.

2. **Incognito.** An extension only runs in incognito once "Allow in
   incognito" is ticked on its Details page, which is also native UI. Writing that
   flag straight into the profile's `Secure Preferences` was tried and does
   not work: the file is HMAC-protected and Chrome reverts it. Don't spend
   time on it again.

Both were checked by hand before 1.0.0, and both need checking by hand again
before any release that touches them.

## Two things worth knowing before editing these

**The popup is opened as an ordinary tab**, because Playwright can't click a
toolbar icon. That makes the popup page itself the active tab, which the
extension would correctly report as a blocked page, so `stub_active_tab()`
fakes `chrome.tabs.query`. It's the only thing faked; every cookie read and
write goes to the real store.

**Find buttons by class, never by text.** Cookie values appear in the same
row, and a value like `v2-edited` matches a `has_text="Edit"` filter. There
are `edit_button()` and `delete_button()` helpers for this. It has already
caused one confusing failure.

## A caveat about how much these prove

They run against the Chromium that Playwright installs, not the Chrome build a
user installs, and the partitioned-cookie test sets its partition key directly
rather than through a real cross-site embed. They're a strong regression net,
not a substitute for occasionally opening the thing in your own browser and
comparing against DevTools → Application → Cookies.
