# Privacy Policy: cookieZ

**Last updated: 21 September 2026**

## The short version

cookieZ collects nothing, sends nothing, and makes no network requests
of any kind. There is no server to send anything to.

## What this extension collects

Nothing.

Not your cookies. Not the sites you visit. Not usage statistics, crash
reports, error logs, or which buttons you press. Not an installation
identifier. Not your email address. Nothing is collected, because nothing is
transmitted.

## What this extension sends

Nothing. cookieZ makes no network requests at all.

That includes the things extensions commonly send without mentioning:

- No analytics or telemetry
- No crash or error reporting
- No update or licence checks
- No remotely loaded fonts, stylesheets, scripts or images
- No advertising or affiliate requests
- No "anonymous" or "aggregated" statistics

Everything the extension needs is bundled inside it. It has no server
component, so there is no place for your data to go even in principle.

## What this extension stores on your device

One thing: the list of cookies you have marked as **Kept**, so that the
extension remembers not to delete them.

That list is stored using Chrome's `storage.local` API, which keeps it on your
own computer. It records only enough to recognise a cookie again:

- the cookie's name
- its domain
- its path
- for a partitioned (CHIPS) cookie only, its partition key, which includes
  the top-level site the cookie is partitioned under

It never includes cookie **values**.

That fourth item is worth stating plainly rather than glossing: for
partitioned cookies you have chosen to keep, the stored list will contain the
name of the site they are partitioned under. It is written to your own disk,
it is not synced to any account, not backed up anywhere, not readable by any
website, and never transmitted. But it is a site name, so you should know it
is there.

Nothing is stored for cookies you have not marked as Kept. Uninstalling the
extension removes the list.

## Cookies the extension reads

cookieZ reads your cookies in order to show them to you, which is what
it is for. This happens only while the popup is open, only in response to you
opening it, and the results only ever reach your own screen.

Cookie values are shown in the popup's table. They are never transmitted,
never written to any file, and never stored by the extension.

## Permissions, and why each one exists

**`cookies`**: required to read, create, edit and delete cookies. Without it
the extension cannot do anything at all.

**`storage`**: required to remember which cookies you marked as Kept, so the
setting survives closing the popup.

**Access to websites** (`*://*/*`): Chrome will not release a single cookie
to an extension without permission for the site that cookie belongs to. This
permission is **optional**: it is deliberately kept out of the install prompt
and requested at runtime, the first time you open the popup. You can decline
it, and you can revoke it later from the extension's Details page in
`chrome://extensions`. It is used only to read and change cookies when you
ask.

No other permissions are requested.

## Third parties

There are none. No analytics provider, no error-reporting service, no CDN, no
advertising network, no affiliate partner. No data is sold, shared,
transferred or disclosed to anyone, because no data leaves your device.

## Remote code

The extension runs no remote code. Everything it executes ships inside the
extension package and can be read in full. This is required by Chrome's
Manifest V3 and is also a deliberate design choice. See below.

## Verifying all of this yourself

You do not have to take any of it on trust.

**Watch the network.** Open the extension, use it, and keep Chrome's DevTools
Network tab open throughout. You will see no outbound requests.

**Read the source.** The extension is plain JavaScript, HTML and CSS with no
build step, no bundler, no minification and no dependencies. What is published
is what was written. The full source is at:

https://github.com/mwc0/cookie-manager

**Run the tests.** The repository includes an automated check that scans the
source for anything capable of making a request, and separately captures every
request the browser makes during a full session of using the extension. Both
have to come back empty.

## Children

The extension is not directed at children and collects no personal
information from anyone, of any age.

## Changes to this policy

If this policy ever changes, the updated version will be published at the
repository link above with a new date at the top, and the change will be
described in the extension's release notes. Any change that introduced data
collection would be a fundamental change to what this extension is, and would
be stated plainly rather than buried here.

## Contact

Questions, or something in this policy that does not match what you observe:
open an issue at https://github.com/mwc0/cookie-manager/issues
