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
