# Cookie Manager

A Chrome cookie manager (Manifest V3), built to replace EditThisCookie.

**Status: early. Not ready for use as your only cookie tool.** The current build
lists, creates, edits and deletes cookies. Search and the protect flag are not
implemented yet.

## Install for testing

There is no build step. The extension loads directly as source.

1. Clone or download this repo.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the **`src`** folder — not the repo root.

To test incognito behaviour, open the extension's **Details** page and turn on
**Allow in incognito**, or the popup won't open in a private window.

After editing any file, press the reload icon on the extension's card.

## What it does so far

- Lists the current site's cookies, with domain, path, expiry and flags.
- Deletes cookies at three scopes — this page, this domain and its subdomains,
  or every site in the profile — always showing the exact count and the exact
  domains affected before anything is removed.
- Creates and edits cookies, including the awkward parts other editors get
  wrong: a host-only cookie stays host-only, a session cookie doesn't quietly
  become permanent, and renaming one moves it instead of leaving two behind.
- Deletes a single cookie from its row, on a second click rather than a dialog.
- Tells you when Chrome silently changes what you asked for — it caps cookie
  expiry at about 400 days, so asking for a date beyond that says so instead
  of showing you a date that isn't what was stored.

## Permissions

The extension asks for `cookies` and `storage` at install, and nothing else.
Access to websites is **optional** and requested at runtime, the first time you
open the popup. Chrome will not release a single cookie to an extension without
it.

## What it will never do

No network requests. No telemetry or analytics. No ads, affiliate links or
injected content. No remote code. These are the reason the project exists, not
preferences — see `CLAUDE.md` for the full list and `docs/SPEC.md` for why.

The source is deliberately plain JavaScript with no build step, no bundler and
no dependencies, so you can read exactly what it does before trusting it with
your session cookies.

## Repo layout

```
src/            the extension (this is what you load)
  manifest.json
  popup/        popup UI
  lib/          shared helpers
docs/           spec and implementation notes
tests/          browser tests (not shipped -- see tests/README.md)
store/          listing copy, screenshots, privacy policy
```

`docs/NOTES.md` records the assumptions in the code that have not yet been
verified against a real browser.

`docs/HANDOFF.md` is the working state: what is built, what isn't, what to test
next and in what order. Start there when picking the project up again.
