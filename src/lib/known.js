// Known cookie names, from the Open Cookie Database (src/lists/known-cookies.js).
//
// A cookie called _ga is almost always Google Analytics. But any site can
// give its own cookie any name, so a match is only ever a guess from the
// name, and the popup says so. That's also why the very common names are
// left out below: "id" or "session" says nothing about who made a cookie.
//
// The list is about 370 KB, which took about a quarter of a second to load
// in a test, so it isn't loaded with the popup. loadKnownCookies() loads it
// once the table is showing, and until then knownCookie() finds nothing.

// Too common to mean anything. Compared in lower case. Each of these is in
// the database under one company, but plenty of sites use them for their
// own cookies.
const TOO_COMMON = new Set([
  "id", "sid", "ssid", "uid", "uuid", "uids", "auid", "user", "userid", "user_id",
  "session", "sess", "sessionid", "session_id", "token", "csrf", "_csrf", "xsrf-token",
  "lang", "language", "locale", "userlang", "country", "currency", "region", "timezone",
  "consent", "cookieconsent", "gdpr", "optout", "opout", "theme", "mode", "settings",
  "test", "login", "store", "store_notice", "version", "hash", "sync", "usersync",
  "visitor", "visitor_id", "callback", "frontend", "europe", "audience", "audit",
  "presence", "viewer", "recs", "inst", "disco", "wires", "pluto", "lantern", "khaos",
  "cart", "device_id", "adid", "unique_id", "remember_me", "isfirstsession", ".auth",
  // Prefixes that would match far too much: "data-" matches data-anything.
  "data-", "partner-", "welcome-", "sharing_", "recs-", "put_", "_sid",
]);

// Whether a name from the database is distinctive enough to go on. Short
// names are skipped unless they start with "_", which is a fair sign of a
// script's naming (_ga, _gid). Two characters is too short even then.
function distinctive(name, isPrefix) {
  if (TOO_COMMON.has(name.toLowerCase())) {
    return false;
  }
  if (name.length < 3) {
    return false;
  }
  if (name.length < 4 && !name.startsWith("_")) {
    return false;
  }
  // A short prefix matches too many names: "_ut" would match "_utm_source".
  if (isPrefix && name.length < 4) {
    return false;
  }
  return true;
}

// Exact names: name -> the entries for it (one per company). Prefixes: the
// same, longest first, so the longest prefix that fits wins.
let exact = null;
let prefixes = null;
let loading = null;

// Builds the lookup from the list. Done once.
function build(list) {
  const byName = new Map();
  const byPrefix = new Map();
  for (const entry of list) {
    if (!entry || typeof entry.name !== "string" || !distinctive(entry.name, entry.prefix)) {
      continue;
    }
    const map = entry.prefix ? byPrefix : byName;
    if (!map.has(entry.name)) {
      map.set(entry.name, []);
    }
    map.get(entry.name).push(entry);
  }
  exact = byName;
  prefixes = [...byPrefix.entries()]
    .map(([prefix, entries]) => ({ prefix, entries }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
}

// Loads the list, once. Resolves to true when it's ready, or false if it
// couldn't be loaded, in which case nothing is marked as known.
export function loadKnownCookies() {
  if (!loading) {
    loading = import("../lists/known-cookies.js")
      .then((module) => {
        build(module.KNOWN_COOKIES || []);
        return true;
      })
      .catch((error) => {
        console.warn("Couldn't load the list of known cookie names:", error);
        return false;
      });
  }
  return loading;
}

// What the database says about a cookie name, or null. An exact match
// first, then the longest prefix (_ga_ for _ga_ABC123). Cookie names are
// case-sensitive, so the match is too. Returns
//   { name, prefix, by, kind, what }
// where `name` is the database's name, `by` is every company it's listed
// under, and `kind` and `what` come from the first of them.
export function knownCookie(name) {
  if (!exact || typeof name !== "string") {
    return null;
  }

  let found = exact.get(name) || null;
  let prefix = false;
  if (!found) {
    const match = prefixes.find((entry) => name.startsWith(entry.prefix));
    found = match ? match.entries : null;
    prefix = Boolean(match);
  }
  if (!found) {
    return null;
  }

  const by = [];
  for (const entry of found) {
    if (!by.includes(entry.by)) {
      by.push(entry.by);
    }
  }
  return {
    name: found[0].name,
    prefix,
    by,
    kind: found[0].kind,
    what: found[0].what,
  };
}

// "Google Analytics", or "Didomi and 1 other" when a name is listed under
// more than one company.
export function describeKnownBy(known) {
  const others = known.by.length - 1;
  if (others === 0) {
    return known.by[0];
  }
  return known.by[0] + " and " + others + (others === 1 ? " other" : " others");
}

// The database's word for what a cookie is for, in a sentence.
const KINDS = {
  Functional: "functional",
  Analytics: "analytics",
  Marketing: "marketing",
  Security: "security",
  Necessary: "necessary",
  Personalization: "personalisation",
};

// "Known name: Google Analytics, analytics. ID used to identify users."
// Some entries have no description yet ("Pending"), so that part is left
// out for them.
export function describeKnown(known) {
  const kind = KINDS[known.kind] || String(known.kind || "").toLowerCase();
  let sentence = "Known name: " + known.by[0] + (kind ? ", " + kind : "") + ".";

  const what = String(known.what || "").trim();
  if (what !== "" && what !== "Pending") {
    sentence += " " + what + (/[.!?…]$/.test(what) ? "" : ".");
  }
  if (known.by.length > 1) {
    sentence += " Also listed under " + joinNames(known.by.slice(1)) + ".";
  }
  return sentence;
}

// "A", "A and B", "A, B and C"
function joinNames(names) {
  if (names.length <= 1) {
    return names.join("");
  }
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}
