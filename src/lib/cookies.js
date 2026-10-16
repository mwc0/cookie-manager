// Everything that talks to chrome.cookies goes through this file, so the
// awkward parts of that API are handled in one place.

import { cookieBytes, expiresSoon, LARGE_COOKIE_BYTES } from "./format.js";
import { knownCookie } from "./known.js";

// Chrome won't store a cookie whose name and value together are bigger than
// this many bytes.
export const MAX_COOKIE_BYTES = 4096;

// chrome.cookies.set and remove need a URL, not a cookie. The scheme comes
// from the Secure flag, and a leading dot on the domain has to be removed.
export function buildCookieUrl(cookie) {
  const scheme = cookie.secure ? "https://" : "http://";
  const host = String(cookie.domain || "").replace(/^\./, "");
  const path = cookie.path || "/";
  return scheme + host + path;
}

// A key that identifies one cookie, used to remove duplicates when the same
// cookie comes back from more than one query.
export function cookieKey(cookie) {
  const partition = cookie.partitionKey
    ? JSON.stringify(cookie.partitionKey)
    : "";
  return [cookie.storeId, cookie.domain, cookie.path, cookie.name, partition].join("\n");
}

function dedupe(cookies) {
  const seen = new Map();
  for (const cookie of cookies) {
    seen.set(cookieKey(cookie), cookie);
  }
  return Array.from(seen.values());
}

// A plain getAll() skips partitioned (CHIPS) cookies, so "delete everything"
// would leave them behind. We run a second query with partitionKey: {}, which
// means "any partition", and merge the two. The tests confirm both behaviours
// in real Chrome. The try/catch is there in case a future Chrome rejects the
// argument: we'd still return the plain results.
async function queryCookies(query) {
  const results = await chrome.cookies.getAll(query);

  let partitioned = [];
  try {
    partitioned = await chrome.cookies.getAll({ ...query, partitionKey: {} });
  } catch (error) {
    partitioned = [];
  }

  return dedupe([...results, ...partitioned]);
}

// The cookies for the site in the current tab. This needs two queries,
// because each one misses something on its own:
//
//   - A URL query only returns cookies whose path matches, so a cookie for
//     /admin wouldn't show up on /home.
//   - A domain query returns every path and subdomain, but not parent
//     domains, so ".example.com" is missing on "www.example.com".
//
// Together they cover both. The one gap left is a parent-domain cookie on a
// path other than "/". That's rare, and "All sites" still catches it.
export async function getCookiesForPage(page) {
  const [byUrl, byDomain] = await Promise.all([
    queryCookies({ url: page.origin + "/" }),
    queryCookies({ domain: page.hostname }),
  ]);
  return dedupe([...byUrl, ...byDomain]);
}

// Cookies for a domain and its subdomains. Parent domains aren't included,
// which is why the "domain" scope below adds the page's own cookies too.
export async function getCookiesForDomain(domain) {
  return await queryCookies({ domain });
}

export async function getAllCookies() {
  return await queryCookies({});
}

// Removes a leading "www." so that on www.example.com, "this domain and its
// subdomains" also covers blog.example.com. A proper version would need the
// Public Suffix List, which is a dependency we don't want. The popup always
// lists the exact domains before deleting, so nobody has to trust this rule.
export function baseHostOf(hostname) {
  return hostname.replace(/^www\./, "");
}

// Partitioned cookies that other companies keep for this site. A frame from
// widget.example on news.example can set a partitioned (CHIPS) cookie that
// is only ever used on news.example. Its domain is widget.example, so none
// of the queries above find it.
//
// Checked in Chromium (tests/test_known.py): a query with only
// partitionKey: { topLevelSite } returns every cookie in that site's
// partition, whatever its domain, and no unpartitioned cookies. Chrome
// works out the site from the address itself: the port is dropped, and
// "https://www.news.example" finds the cookies kept for news.example. So
// the page's own address can be passed as it is.
export async function getEmbeddedCookies(page) {
  try {
    return await chrome.cookies.getAll({ partitionKey: { topLevelSite: page.origin } });
  } catch (error) {
    // A Chrome that doesn't take this query still shows the site's own.
    console.warn("Couldn't read the cookies kept for this site by others:", error);
    return [];
  }
}

// Whether a cookie was set by another site, inside this one, and is kept
// for this site only: partitioned, with a domain that isn't this site's.
export function setByOtherSite(cookie, hostname) {
  if (!cookie.partitionKey) {
    return false;
  }
  const domain = String(cookie.domain || "").replace(/^\./, "");
  const base = baseHostOf(hostname);
  const own = domain === base || domain.endsWith("." + base) || base.endsWith("." + domain);
  return !own;
}

// The site's table: its own cookies, and those other companies keep for it.
export async function getSiteCookies(page) {
  const [own, embedded] = await Promise.all([getCookiesForPage(page), getEmbeddedCookies(page)]);
  return dedupe([...own, ...embedded]);
}

// The cookies a delete scope would remove. The popup deletes exactly this
// list, so the number it shows and the number it deletes are always the same.
//
// With `embedded`, "page" and "domain" also include the cookies other
// companies keep for this site (see getEmbeddedCookies()), as the table
// shows them. The main screen asks for that.
export async function getCookiesForScope(scope, page, { embedded = false } = {}) {
  if (scope === "all") {
    return await getAllCookies();
  }

  const [own, others] = await Promise.all([
    scope === "domain" ? getCookiesForDomainScope(page) : getCookiesForPage(page),
    embedded ? getEmbeddedCookies(page) : [],
  ]);
  return dedupe([...own, ...others]);
}

async function getCookiesForDomainScope(page) {
  const [pageCookies, domainCookies] = await Promise.all([
    getCookiesForPage(page),
    getCookiesForDomain(baseHostOf(page.hostname)),
  ]);
  return dedupe([...pageCookies, ...domainCookies]);
}

// Search box filter. Looks at name, value, domain and path all at once, and
// ignores case, so people can find a cookie by whatever part they remember.
export function filterCookies(cookies, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (needle === "") {
    return cookies;
  }

  return cookies.filter((cookie) => {
    const haystack = [cookie.name, cookie.value, cookie.domain, cookie.path]
      .map((part) => String(part == null ? "" : part).toLowerCase())
      .join("\n");
    return haystack.includes(needle);
  });
}

// The quick filters above the table. Each one is a yes-or-no question
// about a single cookie. "kept" isn't here, because whether a cookie is kept
// isn't part of the cookie: filterByFlags() is told that separately.
//
// The last three are checks for developers, and only state facts. "Not
// Secure" only means something on an HTTPS page, so popup.js only offers
// it there.
export const FILTERS = {
  secure: (cookie) => Boolean(cookie.secure),
  httponly: (cookie) => Boolean(cookie.httpOnly),
  session: (cookie) => typeof cookie.expirationDate !== "number",
  soon: (cookie) => expiresSoon(cookie),
  large: (cookie) => cookieBytes(cookie) >= LARGE_COOKIE_BYTES,
  partitioned: (cookie) => Boolean(cookie.partitionKey),
  known: (cookie) => knownCookie(cookie.name) !== null,
  notsecure: (cookie) => !cookie.secure,
  readable: (cookie) => !cookie.httpOnly,
  samesitenone: (cookie) => cookie.sameSite === "no_restriction",
};

// Whether one cookie passes one filter. `isKept` is a function that says
// whether a cookie is marked as Kept.
export function passesFilter(cookie, name, isKept) {
  if (name === "kept") {
    return Boolean(isKept(cookie));
  }
  return Boolean(FILTERS[name] && FILTERS[name](cookie));
}

// The cookies that pass every filter that's switched on. `active` is a Set
// of filter names. With none switched on, every cookie passes.
export function filterByFlags(cookies, active, isKept) {
  if (active.size === 0) {
    return cookies;
  }
  return cookies.filter((cookie) =>
    [...active].every((name) => passesFilter(cookie, name, isKept))
  );
}

// The sites these cookies belong to, for sentences like "Will delete 4
// cookies from example.com". "example.com" and ".example.com" are one site
// to a reader, so the leading dot is dropped. The table still shows each
// cookie's exact domain.
export function sitesOf(cookies) {
  const sites = new Set();
  for (const cookie of cookies) {
    sites.add(String(cookie.domain || "").replace(/^\./, ""));
  }
  return Array.from(sites).sort();
}

// The count and the list of domains, shown before anything is deleted.
export function summarise(cookies) {
  const domains = new Set();
  for (const cookie of cookies) {
    domains.add(cookie.domain);
  }
  return {
    count: cookies.length,
    domains: Array.from(domains).sort(),
  };
}

// --- writing -----------------------------------------------------------
//
// chrome.cookies.set has several traps, marked TRAP below. Each one was
// checked in real Chrome, and tests/test_editor.py covers them.

// Whether two cookies are the same cookie as far as Chrome is concerned.
// This isn't cookieKey() above: a host-only cookie is stored as "example.com"
// and a domain-wide one as ".example.com", and those are different cookies
// even though the host is the same.
function identityOf(parts) {
  return [
    parts.name,
    String(parts.domain || "").replace(/^\./, ""),
    Boolean(parts.hostOnly),
    parts.path || "/",
    parts.storeId || "",
    parts.partitionKey ? JSON.stringify(parts.partitionKey) : "",
  ].join("\n");
}

// Turns the editor form's values into what chrome.cookies.set expects.
export function buildSetDetails(values) {
  const host = String(values.domain || "").replace(/^\./, "");
  const path = values.path || "/";
  const scheme = values.secure ? "https://" : "http://";

  const details = {
    // TRAP: set() reads the cookie back from this URL. If the URL is "/" but
    // the cookie's path is "/admin", set() returns null even though it worked,
    // and there's no error to tell the difference. Using the cookie's own
    // path avoids that.
    url: scheme + host + path,
    name: values.name,
    value: values.value,
    path,
    secure: Boolean(values.secure),
    httpOnly: Boolean(values.httpOnly),
    sameSite: values.sameSite || "unspecified",
  };

  // TRAP: passing any domain at all makes the cookie domain-wide. For a
  // host-only cookie the domain has to be left out completely.
  if (!values.hostOnly) {
    details.domain = host;
  }

  // TRAP: a session cookie has no expiry date. Giving it one turns it into a
  // permanent cookie.
  if (!values.session && typeof values.expirationDate === "number") {
    details.expirationDate = values.expirationDate;
  }

  if (values.storeId) {
    details.storeId = values.storeId;
  }
  if (values.partitionKey) {
    details.partitionKey = values.partitionKey;
  }

  return details;
}

// Checks the form before saving. When Chrome rejects a cookie, its error
// doesn't say which rule was broken, so anything we can catch here gets a
// clearer message. An imported cookie has no form to tick, so `imported`
// swaps the advice for a description of what's wrong with it.
export function validateCookieValues(values, { imported = false } = {}) {
  const errors = [];
  const name = String(values.name || "");
  const value = String(values.value || "");

  if (name.trim() === "") {
    errors.push("A cookie needs a name.");
  } else if (/[\s;=,]/.test(name)) {
    errors.push("A cookie name can't contain spaces, semicolons, commas or equals signs.");
  }

  // A semicolon ends a cookie's value, so it can't be in one. Commas can:
  // Chrome stores them, and sites put JSON in cookies that has them. This
  // refused commas until 1.7, which meant such a cookie couldn't be saved.
  if (/;/.test(value)) {
    errors.push("A cookie value can't contain a semicolon.");
  }

  // TRAP: Chrome refuses a cookie over 4,096 bytes with the same vague error
  // as everything else.
  const bytes = cookieBytes({ name, value });
  if (bytes > MAX_COOKIE_BYTES) {
    errors.push(
      "Chrome won't store a cookie bigger than 4,096 bytes (name and value together). " +
        (imported ? "It is " : "This one is ") + bytes.toLocaleString("en-GB") + "."
    );
  }

  // TRAP: a name starting with __Secure- or __Host- is a promise Chrome
  // holds the cookie to. Break it and Chrome refuses the cookie, again with
  // no reason given. Chrome ignores case when it checks these.
  if (/^__secure-/i.test(name) && !values.secure) {
    errors.push(
      imported
        ? "Its name starts with __Secure- but it isn't Secure, and Chrome won't accept that."
        : "A name starting with __Secure- only works on a Secure cookie. Tick Secure, or change the name."
    );
  }

  if (/^__host-/i.test(name)) {
    const missing = [];
    if (!values.secure) {
      missing.push("Secure");
    }
    if (!values.hostOnly) {
      missing.push("host-only");
    }
    if ((values.path || "/") !== "/") {
      missing.push("on the path /");
    }
    if (missing.length > 0) {
      errors.push(
        (imported
          ? "Its name starts with __Host-, so Chrome only accepts it if it is Secure, host-only and on the path /. It isn't "
          : "A name starting with __Host- only works on a cookie that is Secure, host-only and on the path /. This one isn't ") +
          missing.join(" or ") + "."
      );
    }
  }

  if (String(values.domain || "").trim() === "") {
    errors.push("A cookie needs a domain.");
  }

  if (!String(values.path || "").startsWith("/")) {
    errors.push("The path has to start with a slash.");
  }

  // TRAP: Chrome rejects SameSite=None unless the cookie is also Secure.
  if (values.sameSite === "no_restriction" && !values.secure) {
    errors.push(
      imported
        ? "It has SameSite “None” but isn't Secure, and Chrome won't accept that."
        : "SameSite “None” only works on a Secure cookie. Tick Secure, or choose a different SameSite."
    );
  }

  if (!values.session && typeof values.expirationDate !== "number") {
    errors.push(
      imported
        ? "It has no expiry date and isn't marked as a session cookie."
        : "Set an expiry date, or tick “Session cookie”."
    );
  }

  return errors;
}

// Creates a cookie, or updates one when `original` is the cookie being
// edited. Returns { ok, cookie, error } and never throws.
export async function writeCookie(original, values) {
  const details = buildSetDetails(values);

  // TRAP: if the name, domain or path changed, saving creates a second cookie
  // and leaves the old one. So in that case we delete the old one first. If
  // only the value changed, set() overwrites it and no delete is needed.
  if (original) {
    const before = identityOf(original);
    const after = identityOf({
      name: details.name,
      domain: details.domain || details.url.replace(/^https?:\/\//, "").split("/")[0],
      hostOnly: !details.domain,
      path: details.path,
      storeId: details.storeId,
      partitionKey: details.partitionKey,
    });

    if (before !== after) {
      const removed = await removeCookie(original);
      if (!removed) {
        return {
          ok: false,
          error:
            "The original cookie couldn't be removed, so the change was stopped " +
            "rather than risk leaving two copies of it behind.",
        };
      }
    }
  }

  let result;
  try {
    result = await chrome.cookies.set(details);
  } catch (error) {
    return { ok: false, error: describeWriteFailure(error) };
  }

  if (result) {
    return { ok: true, cookie: result, error: null };
  }

  // A null result should mean it failed, but set() has returned null on
  // success before (see the TRAP above), so check whether the cookie is there.
  const landed = await chrome.cookies.getAll({
    url: details.url,
    name: details.name,
  });
  if (landed.length > 0) {
    return { ok: true, cookie: landed[0], error: null };
  }

  return {
    ok: false,
    error: "Chrome didn't accept the cookie, and didn't say why.",
  };
}

// Chrome's error names the cookie but not what was wrong with it, so we add
// the likely reasons.
function describeWriteFailure(error) {
  const message = error && error.message ? error.message : String(error);

  if (message.includes("Failed to parse or set cookie")) {
    return (
      message +
      " This usually means the domain doesn't match the cookie, or the name " +
      "or value contains a character cookies aren't allowed to carry."
    );
  }
  return message;
}

// --- deleting ----------------------------------------------------------

// Deletes one cookie. chrome.cookies.remove returns null when it fails
// instead of throwing, so the result has to be checked.
export async function removeCookie(cookie) {
  const details = {
    url: buildCookieUrl(cookie),
    name: cookie.name,
    storeId: cookie.storeId,
  };
  if (cookie.partitionKey) {
    details.partitionKey = cookie.partitionKey;
  }

  try {
    const result = await chrome.cookies.remove(details);
    return result !== null && result !== undefined;
  } catch (error) {
    console.warn("Failed to remove cookie", cookie.name, error);
    return false;
  }
}

// Deletes many cookies and reports which ones failed, so the popup can tell
// the user instead of claiming everything worked. `removedCookies` is the
// ones that really went, which is what Undo puts back.
export async function removeCookies(cookies) {
  const outcomes = await Promise.all(
    cookies.map(async (cookie) => ({ cookie, ok: await removeCookie(cookie) }))
  );

  const failed = outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.cookie);
  const removedCookies = outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.cookie);
  return {
    removed: removedCookies.length,
    removedCookies,
    failed,
  };
}
