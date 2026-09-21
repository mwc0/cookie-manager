# Tests

Browser tests that drive the real extension in a real Chromium, against the
real cookie store. They exist because almost every way this extension can be
wrong is **silent**: a cookie that quietly becomes permanent, a delete that
leaves partitioned cookies behind, a count that doesn't match what was
removed. None of that shows up as an error message, so it has to be checked
deliberately.

## These do not ship

Nothing here is part of the extension. Only `src/` is loaded and zipped, so
the no-dependency rule in `CLAUDE.md` is about `src/`. This directory is
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

`probe_chrome_api.py` is not a test. It asks Chrome how it actually behaves
and prints the answers. Every workaround in `src/lib/cookies.js` exists
because of one of them, so run it if a Chrome update makes something behave
strangely. It's faster than re-deriving the reasons.

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

Both are in the manual checklist in `docs/HANDOFF.md`.

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
