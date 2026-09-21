// Thin wrappers over chrome.cookies.
//
// Everything that touches the cookie API goes through here, so the awkward
// parts of that API are handled in one place instead of being rediscovered
// in the UI code.

// chrome.cookies.set/remove want a URL, not a cookie object. The cookie's
// own fields tell us what that URL has to look like:
//   - the scheme comes from the `secure` flag
//   - a leading dot on the domain ( ".example.com" ) is not part of the host
export function buildCookieUrl(cookie) {
  const scheme = cookie.secure ? "https://" : "http://";
  const host = String(cookie.domain || "").replace(/^\./, "");
  const path = cookie.path || "/";
  return scheme + host + path;
}

// Identity of a cookie, for de-duplicating results that came from more than
// one query. Chrome considers these four fields (plus the partition) to be
// what makes a cookie unique.
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

// Run one cookie query.
//
// Partitioned cookies (CHIPS) are the wrinkle here. A plain getAll() returns
// unpartitioned cookies only, so a "delete everything" built on it alone can
// leave partitioned cookies behind -- which is the exact complaint we exist to
// fix. We therefore also attempt a partitioned query and merge the results.
//
// NOT YET VERIFIED against a real browser: whether `partitionKey: {}` means
// "any partition" in the installed Chrome version. It is wrapped in try/catch
// so that if the argument is rejected we simply fall back to the plain result
// rather than breaking the query. See docs/NOTES.md.
async function queryCookies(query) {
  const results = await chrome.cookies.getAll(query);

  let partitioned = [];
  try {
    partitioned = await chrome.cookies.getAll({ ...query, partitionKey: {} });
  } catch (error) {
    // Older Chrome, or an argument it doesn't accept. Not fatal.
    partitioned = [];
  }

  return dedupe([...results, ...partitioned]);
}

// Cookies belonging to the site in the current tab.
//
// This needs two queries unioned together, because each one alone has a hole:
//
//   - Querying by URL applies cookie PATH matching. On /home, a cookie scoped
//     to /admin would be invisible. We pass the origin so at least the root
//     path matches, and let the domain query cover the rest.
//   - Querying by domain covers every path, and subdomains, but excludes
//     PARENT domains -- a ".example.com" cookie is not returned for
//     "www.example.com", even though the page receives it.
//
// Together they cover both. The one case still missed is a parent-domain
// cookie on a non-root path; that is rare, it errs towards showing too little
// rather than deleting too much, and the "All sites" scope still catches it.
export async function getCookiesForPage(page) {
  const [byUrl, byDomain] = await Promise.all([
    queryCookies({ url: page.origin + "/" }),
    queryCookies({ domain: page.hostname }),
  ]);
  return dedupe([...byUrl, ...byDomain]);
}

// Cookies for a domain and everything below it.
//
// Note this does NOT include parent domains: querying "www.example.com"
// excludes a ".example.com" cookie, even though the page receives it. That's
// why the domain scope unions this with the page's own cookies below.
export async function getCookiesForDomain(domain) {
  return await queryCookies({ domain });
}

// Every cookie in this browser profile.
export async function getAllCookies() {
  return await queryCookies({});
}

// Strip a leading "www." so that "this domain and its subdomains" on
// www.example.com also covers blog.example.com.
//
// Deliberately a simple string rule and not a real public-suffix lookup:
// doing that properly needs the Public Suffix List, which is a dependency and
// a data file we don't want. The cost of the simple rule is that the scope can
// occasionally reach less far than the user expects -- which is why the UI
// always lists the exact domains being affected before deleting anything.
export function baseHostOf(hostname) {
  return hostname.replace(/^www\./, "");
}

// Collect the cookies a delete scope would remove.
// `page` is { origin, hostname }.
//
// The UI deletes exactly the array this returns, so the number it shows and
// the number it deletes cannot drift apart.
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

// Count and list the domains a set of cookies touches, for the scope
// indicator. The UI shows this before deleting so the user sees exactly what
// is about to go.
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
// The awkward parts of chrome.cookies.set, all verified against Chrome rather
// than assumed. See docs/NOTES.md.

// What makes two cookies the same cookie as far as Chrome is concerned.
//
// Deliberately not cookieKey() above: that one dedupes query results and
// compares the stored domain string as-is. Here we need the *effective*
// identity, because a host-only cookie is stored as "example.com" and a
// domain-wide one as ".example.com" — same host, different cookie.
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

// Turn the form's values into the object chrome.cookies.set wants.
//
// `values` is { name, value, domain, path, secure, httpOnly, hostOnly,
// session, expirationDate, sameSite, storeId, partitionKey }.
export function buildSetDetails(values) {
  const host = String(values.domain || "").replace(/^\./, "");
  const path = values.path || "/";
  const scheme = values.secure ? "https://" : "http://";

  const details = {
    // TRAP: set() reads the cookie back using this URL, and a cookie scoped to
    // /admin is not returned for a URL at /. Ask for the root and set() hands
    // back null even though the write SUCCEEDED, with runtime.lastError unset,
    // so there is no way to tell that apart from a genuine failure. Including
    // the cookie's own path here keeps the read-back honest.
    url: scheme + host + path,
    name: values.name,
    value: values.value,
    path,
    secure: Boolean(values.secure),
    httpOnly: Boolean(values.httpOnly),
    sameSite: values.sameSite || "unspecified",
  };

  // TRAP: supplying `domain` at all makes the cookie domain-wide. Chrome
  // stores it as ".host" with hostOnly false even when the dot is left off,
  // so a host-only cookie has to omit the field entirely rather than pass
  // the bare host.
  if (!values.hostOnly) {
    details.domain = host;
  }

  // TRAP: a session cookie has no expirationDate. Writing one back with a date
  // silently converts it into a permanent cookie.
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

// Reasons Chrome would reject the write, checked before we attempt it.
//
// Worth doing up front: when Chrome refuses a cookie it throws
// "Failed to parse or set cookie named X" and never says which rule was
// broken, so anything we don't catch here reaches the user as a dead end.
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

// Create or update a cookie.
//
// `original` is the cookie being edited, or null when creating a new one.
// Returns { ok, cookie, error } — never throws at the caller.
export async function writeCookie(original, values) {
  const details = buildSetDetails(values);

  // TRAP: editing is remove-then-set. Chrome keys a cookie on
  // name + domain + path (+ store + partition), so saving with any of those
  // changed writes a SECOND cookie and leaves the original in place. Setting
  // with an unchanged identity overwrites cleanly (verified), so a plain
  // value edit doesn't need the remove.
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

  // A null result should be a real failure now that the URL covers the path,
  // but that assumption has bitten once already — so check rather than trust
  // it, and only report a failure if the cookie genuinely isn't there.
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

function describeWriteFailure(error) {
  const message = error && error.message ? error.message : String(error);

  // Chrome's own message for a rejected cookie names the cookie but not the
  // rule it broke, so add the possibilities the form can't rule out.
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

// Delete one cookie.
//
// chrome.cookies.remove resolves to null when it fails rather than throwing,
// so the result has to be checked or failures pass silently.
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

// Delete many. Returns what actually happened, so the UI can report honestly
// instead of claiming success.
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
