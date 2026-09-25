// Everything that talks to chrome.cookies goes through this file, so the
// awkward parts of that API are handled in one place.

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

// The cookies a delete scope would remove. The popup deletes exactly this
// list, so the number it shows and the number it deletes are always the same.
export async function getCookiesForScope(scope, page) {
  if (scope === "all") {
    return await getAllCookies();
  }

  if (scope === "domain") {
    const [pageCookies, domainCookies] = await Promise.all([
      getCookiesForPage(page),
      getCookiesForDomain(baseHostOf(page.hostname)),
    ]);
    return dedupe([...pageCookies, ...domainCookies]);
  }

  return await getCookiesForPage(page);
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
// clearer message.
export function validateCookieValues(values) {
  const errors = [];
  const name = String(values.name || "");
  const value = String(values.value || "");

  if (name.trim() === "") {
    errors.push("A cookie needs a name.");
  } else if (/[\s;=,]/.test(name)) {
    errors.push("A cookie name can't contain spaces, semicolons, commas or equals signs.");
  }

  if (/[;,]/.test(value)) {
    errors.push("A cookie value can't contain semicolons or commas.");
  }

  if (String(values.domain || "").trim() === "") {
    errors.push("A cookie needs a domain.");
  }

  if (!String(values.path || "").startsWith("/")) {
    errors.push("The path has to start with a slash.");
  }

  // TRAP: Chrome rejects SameSite=None unless the cookie is also Secure.
  if (values.sameSite === "no_restriction" && !values.secure) {
    errors.push("SameSite “None” only works on a Secure cookie. Tick Secure, or choose a different SameSite.");
  }

  if (!values.session && typeof values.expirationDate !== "number") {
    errors.push("Set an expiry date, or tick “Session cookie”.");
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
// the user instead of claiming everything worked.
export async function removeCookies(cookies) {
  const outcomes = await Promise.all(
    cookies.map(async (cookie) => ({ cookie, ok: await removeCookie(cookie) }))
  );

  const failed = outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.cookie);
  return {
    removed: outcomes.length - failed.length,
    failed,
  };
}
