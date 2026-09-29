// Export and import: turns cookies into text and back. Nothing here touches
// Chrome or the page, so every part can be tested on its own. popup.js does
// the reading and writing.
//
// Three export formats:
//   - JSON, with the same field names EditThisCookie and Cookie-Editor use,
//     so files move between the three.
//   - Netscape cookies.txt, used by curl, wget, yt-dlp and many other tools.
//     It has no room for SameSite or partitions, so those are lost.
//   - A Cookie header ("name=value; name2=value2"), names and values only.
//
// Import reads JSON and cookies.txt. A Cookie header can't be imported: it
// doesn't say which site the cookies belong to.

import { validateCookieValues } from "./cookies.js";

// --- export ------------------------------------------------------------------

export function toJson(cookies) {
  const list = cookies.map((cookie) => {
    const out = {
      domain: cookie.domain,
      hostOnly: Boolean(cookie.hostOnly),
      httpOnly: Boolean(cookie.httpOnly),
      name: cookie.name,
      path: cookie.path,
      sameSite: cookie.sameSite || "unspecified",
      secure: Boolean(cookie.secure),
      session: typeof cookie.expirationDate !== "number",
      storeId: cookie.storeId,
      value: cookie.value,
    };
    if (typeof cookie.expirationDate === "number") {
      out.expirationDate = cookie.expirationDate;
    }
    if (cookie.partitionKey && cookie.partitionKey.topLevelSite) {
      out.partitionKey = { topLevelSite: cookie.partitionKey.topLevelSite };
    }
    return out;
  });
  return JSON.stringify(list, null, 2);
}

export function toNetscape(cookies) {
  const lines = [
    "# Netscape HTTP Cookie File",
    "# Exported by cookieZ. These are login cookies: keep this file private.",
    "",
  ];
  for (const cookie of cookies) {
    const expiry =
      typeof cookie.expirationDate === "number" ? Math.floor(cookie.expirationDate) : 0;
    lines.push(
      [
        // Tools that read cookies.txt mark HttpOnly cookies this way.
        (cookie.httpOnly ? "#HttpOnly_" : "") + cookie.domain,
        cookie.hostOnly ? "FALSE" : "TRUE",
        cookie.path || "/",
        cookie.secure ? "TRUE" : "FALSE",
        String(expiry),
        cookie.name,
        cookie.value,
      ].join("\t")
    );
  }
  return lines.join("\n") + "\n";
}

export function toHeader(cookies) {
  return cookies.map((cookie) => cookie.name + "=" + cookie.value).join("; ");
}

// --- import: reading the text ------------------------------------------------

// Returns { format, entries, problems }. Each entry is in the same shape as
// the editor form, ready for validateCookieValues() and writeCookie(). Each
// problem is a sentence saying what couldn't be read and where.
export function parseImport(text) {
  const trimmed = String(text || "").trim();
  if (trimmed === "") {
    return { format: null, entries: [], problems: ["There's nothing to import. Paste some cookies first."] };
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseJson(trimmed);
  }

  if (!trimmed.includes("\t") && /^[^=\s;]+=/.test(trimmed)) {
    return {
      format: null,
      entries: [],
      problems: [
        "This looks like a Cookie header. It doesn't say which site the cookies are for, " +
          "so it can't be imported. Use a JSON export or a cookies.txt file instead.",
      ],
    };
  }

  return parseNetscape(trimmed);
}

function parseJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return {
      format: "json",
      entries: [],
      problems: ["This looks like JSON, but it couldn't be read: " + error.message],
    };
  }

  // Most tools export a plain list. Some wrap it as { "cookies": [...] }.
  const list = Array.isArray(data) ? data : data && Array.isArray(data.cookies) ? data.cookies : null;
  if (!list) {
    return {
      format: "json",
      entries: [],
      problems: ["This JSON isn't a list of cookies."],
    };
  }

  const entries = [];
  const problems = [];
  list.forEach((item, index) => {
    const entry = fromJsonItem(item);
    if (typeof entry === "string") {
      problems.push("Cookie " + (index + 1) + ": " + entry);
    } else {
      entries.push(entry);
    }
  });
  return { format: "json", entries, problems };
}

// Returns an entry, or a sentence saying why the item can't be used.
function fromJsonItem(item) {
  if (!item || typeof item !== "object") {
    return "not a cookie.";
  }
  if (typeof item.name !== "string" || item.name === "") {
    return "it has no name.";
  }
  if (typeof item.domain !== "string" || item.domain === "") {
    return item.name + " has no domain.";
  }

  // EditThisCookie and Cookie-Editor use expirationDate. Puppeteer and
  // Playwright use expires, with -1 for a session cookie.
  let expiry = null;
  if (typeof item.expirationDate === "number") {
    expiry = item.expirationDate;
  } else if (typeof item.expires === "number" && item.expires > 0) {
    expiry = item.expires;
  }
  const session = item.session === true || expiry === null;

  const entry = {
    name: item.name,
    value: item.value == null ? "" : String(item.value),
    domain: item.domain.replace(/^\./, ""),
    path: typeof item.path === "string" && item.path !== "" ? item.path : "/",
    secure: Boolean(item.secure),
    httpOnly: Boolean(item.httpOnly),
    // Without a hostOnly field, a leading dot means domain-wide.
    hostOnly: typeof item.hostOnly === "boolean" ? item.hostOnly : !item.domain.startsWith("."),
    sameSite: normaliseSameSite(item.sameSite),
    session,
    expirationDate: session ? null : expiry,
  };

  if (item.partitionKey && typeof item.partitionKey.topLevelSite === "string") {
    entry.partitionKey = { topLevelSite: item.partitionKey.topLevelSite };
  }
  return entry;
}

// Chrome's names are lax, strict and no_restriction. Other tools write
// "Lax", "None" and so on.
function normaliseSameSite(value) {
  const lower = String(value || "").toLowerCase();
  if (lower === "lax" || lower === "strict") {
    return lower;
  }
  if (lower === "none" || lower === "no_restriction") {
    return "no_restriction";
  }
  return "unspecified";
}

function parseNetscape(text) {
  const entries = [];
  const problems = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    let line = raw.trim() === "" ? "" : raw.replace(/\r$/, "");
    if (line === "") {
      return;
    }

    let httpOnly = false;
    if (line.startsWith("#HttpOnly_")) {
      httpOnly = true;
      line = line.slice("#HttpOnly_".length);
    } else if (line.startsWith("#")) {
      return;
    }

    const fields = line.split("\t");
    if (fields.length < 7) {
      problems.push(
        "Line " + (index + 1) + " isn't in cookies.txt format, which has 7 columns separated by tabs."
      );
      return;
    }

    const [domain, includeSubdomains, path, secure, expires, name, ...rest] = fields;
    const expiry = Number(expires);
    if (!Number.isFinite(expiry)) {
      problems.push("Line " + (index + 1) + ": the expiry isn't a number.");
      return;
    }

    entries.push({
      name,
      // A value can't contain a tab, but join any extra columns back just in case.
      value: rest.join("\t"),
      domain: domain.replace(/^\./, ""),
      path: path || "/",
      secure: secure.toUpperCase() === "TRUE",
      httpOnly,
      hostOnly: includeSubdomains.toUpperCase() !== "TRUE",
      sameSite: "unspecified",
      session: expiry <= 0,
      expirationDate: expiry > 0 ? expiry : null,
    });
  });

  if (entries.length === 0 && problems.length === 0) {
    problems.push("No cookies were found. Paste a JSON export or the contents of a cookies.txt file.");
  }
  return { format: "netscape", entries, problems };
}

// --- import: working out what will happen ------------------------------------

// Two cookies are the same cookie, as far as Chrome is concerned, when these
// all match. Importing one of these overwrites the existing cookie.
function identityOf(cookie) {
  return [
    cookie.name,
    String(cookie.domain || "").replace(/^\./, ""),
    Boolean(cookie.hostOnly),
    cookie.path || "/",
    cookie.partitionKey && cookie.partitionKey.topLevelSite ? cookie.partitionKey.topLevelSite : "",
  ].join("\n");
}

// Works out what an import will do, before anything is written. `existing`
// is every cookie in this browser profile, and `isKept(cookie)` says whether
// one is marked Kept. `now` is in seconds.
//
// Returns {
//   toWrite: [{ entry, replaces, kept }],  what will be written
//   expired, duplicates,                    counts of what's skipped
//   invalid: ["name: reason", ...],         cookies that can't be written
//   domains: [...]                          the sites that will change
// }
export function planImport(entries, existing, isKept, now) {
  const byIdentity = new Map();
  for (const cookie of existing) {
    byIdentity.set(identityOf(cookie), cookie);
  }

  // If the same cookie is in the file twice, the last one wins, as it would
  // if they were written in order.
  const unique = new Map();
  for (const entry of entries) {
    unique.set(identityOf(entry), entry);
  }
  const duplicates = entries.length - unique.size;

  const toWrite = [];
  const invalid = [];
  let expired = 0;

  for (const entry of unique.values()) {
    if (!entry.session && entry.expirationDate <= now) {
      expired += 1;
      continue;
    }

    const errors = validateCookieValues(entry);
    if (errors.length > 0) {
      invalid.push(entry.name + " (" + entry.domain + "): " + errors.join(" "));
      continue;
    }

    const match = byIdentity.get(identityOf(entry));
    toWrite.push({
      entry,
      replaces: Boolean(match),
      kept: Boolean(match && isKept(match)),
    });
  }

  const domains = Array.from(new Set(toWrite.map((item) => item.entry.domain))).sort();
  return { toWrite, expired, duplicates, invalid, domains };
}
