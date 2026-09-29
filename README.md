# cookieZ - Cookie Editor

A Chrome cookie manager (Manifest V3)


## What it does so far

- Lists the current site's cookies, with domain, path, expiry and flags.
- Deletes cookies at three scopes: this page, this domain and its subdomains,
  or every site in the profile, plus a fourth while searching (below). It
  always shows the exact count and the exact domains affected before anything
  is removed.
- Creates and edits cookies, including the awkward parts other editors get
  wrong: a host-only cookie stays host-only, a session cookie doesn't quietly
  become permanent, and renaming one moves it instead of leaving two behind.
- Deletes a single cookie from its row, on a second click rather than a dialog.
- Tells you when Chrome silently changes what you asked for. It caps cookie
  expiry at about 400 days, so asking for a date beyond that says so instead
  of showing you a date that isn't what was stored.
- Searches the current tab's cookies by name, value, domain or path. While a
  search is active you also get a "just the cookies shown" delete scope, so
  filtering and then deleting removes what you can see rather than silently
  reaching past it.
- Lets you mark a cookie as **kept**, which excludes it from every delete this
  extension makes, including "All sites", and says so in the count before
  you delete. It's a guard on this extension's own delete button, not
  protection from the website: nothing here stops a site changing its own
  cookies.

## Permissions

The extension asks for `cookies` and `storage` at install, and nothing else.
Access to websites is **optional** and requested at runtime, the first time you
open the popup. Chrome will not release a single cookie to an extension without
it.

## What it will never do

No network requests. No telemetry or analytics. No ads, affiliate links or
injected content. No remote code.

The source is deliberately plain JavaScript with no build step, no bundler and
no dependencies, so you can read exactly what it does before trusting it with
your session cookies.

## Licence

MIT. See `LICENSE`. You can read it, fork it, and check that what's published
is what's described, which is rather the point.

## Releases

What changed in each version is on the
[releases page](https://github.com/mwc0/cookie-manager/releases), along with
the exact zip that was uploaded to the Chrome Web Store.
