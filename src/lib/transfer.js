// Export and import: turns cookies into text and back. Nothing here touches
// Chrome or the page, so every part can be tested on its own. popup.js does
// the reading and writing.
//
// Five export formats:
//   - JSON, with the same field names EditThisCookie and Cookie-Editor use,
//     so files move between the three.
//   - Netscape cookies.txt, used by curl, wget, yt-dlp and many other tools.
//     It has no room for SameSite or partitions, so those are lost.
//   - Playwright's storageState file, which testers use to start a test
//     already logged in.
//   - A Cookie header ("name=value; name2=value2"), names and values only.
//   - A curl command that sends that header.
//
// Import reads JSON (Playwright's included), cookies.txt, Set-Cookie lines,
// a Cookie header and a curl command. The last two only carry names and
// values, so matchSentCookies() fills in the rest from the cookies the site
// already has.

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

// Playwright's storageState: { cookies, origins }. Only cookies are filled
// in, since an extension can't read a site's localStorage without running
// code on the page. Playwright marks a domain-wide cookie with a leading dot,
// uses -1 for a session cookie, and only knows Strict, Lax and None.
export function toPlaywright(cookies) {
  const list = cookies.map((cookie) => {
    const host = String(cookie.domain || "").replace(/^\./, "");
    const out = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.hostOnly ? host : "." + host,
      path: cookie.path || "/",
      expires: typeof cookie.expirationDate === "number" ? cookie.expirationDate : -1,
      httpOnly: Boolean(cookie.httpOnly),
      secure: Boolean(cookie.secure),
      sameSite: PLAYWRIGHT_SAME_SITE[cookie.sameSite] || "Lax",
    };
    // Playwright writes the partition as just the top-level site.
    if (cookie.partitionKey && cookie.partitionKey.topLevelSite) {
      out.partitionKey = cookie.partitionKey.topLevelSite;
    }
    return out;
  });
  return JSON.stringify({ cookies: list, origins: [] }, null, 2);
}

// Chrome treats an unset SameSite as Lax, so that's what Playwright gets.
const PLAYWRIGHT_SAME_SITE = {
  strict: "Strict",
  lax: "Lax",
  no_restriction: "None",
};

// A curl command that sends these cookies to `url`. Single quotes keep the
// shell from reading anything in a value, and a quote inside a value is
// written the way bash and zsh expect: '\''
export function toCurl(cookies, url) {
  const quote = (text) => "'" + String(text).replace(/'/g, "'\\''") + "'";
  return "curl -b " + quote(toHeader(cookies)) + " " + quote(url);
}

// --- import: reading the text ------------------------------------------------

// Returns { format, entries, problems }. Each entry is in the same shape as
// the editor form, ready for validateCookieValues() and writeCookie(), with
// one exception: a Cookie header or a curl command only gives names and
// values, so those entries are { name, value, sendTo } and go through
// matchSentCookies() first. Each problem is a sentence saying what couldn't
// be read and where.
//
// `pageUrl` is the address of the page cookieZ is open on. A Cookie header,
// and a Set-Cookie line without a Domain, are for that page.
export function parseImport(text, { pageUrl = null } = {}) {
  const trimmed = String(text || "").trim();
  if (trimmed === "") {
    return { format: null, entries: [], problems: ["There's nothing to import. Paste some cookies first."] };
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseJson(trimmed);
  }
  if (/^curl(\.exe)?\s/i.test(trimmed)) {
    return parseCurl(trimmed);
  }
  if (looksLikeSetCookie(trimmed)) {
    return parseSetCookie(trimmed, pageUrl);
  }
  if (!trimmed.includes("\t") && /^(cookie\s*:\s*)?[^=\s;]+=/i.test(trimmed)) {
    return parseCookieHeader(trimmed, pageUrl);
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

  // Chrome's own shape is { topLevelSite }. Playwright writes the site alone.
  if (item.partitionKey && typeof item.partitionKey.topLevelSite === "string") {
    entry.partitionKey = { topLevelSite: item.partitionKey.topLevelSite };
  } else if (typeof item.partitionKey === "string" && item.partitionKey !== "") {
    entry.partitionKey = { topLevelSite: item.partitionKey };
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

// --- import: Set-Cookie lines ------------------------------------------------

// Words that only appear after the first ";" of a Set-Cookie line. A Cookie
// header ("a=1; b=2") never has them, which is how the two are told apart
// when the lines don't start with "Set-Cookie:".
const SET_COOKIE_ATTRIBUTES = new Set([
  "domain",
  "path",
  "expires",
  "max-age",
  "secure",
  "httponly",
  "samesite",
  "partitioned",
  "priority",
]);

function looksLikeSetCookie(text) {
  if (/^set-cookie\s*:/im.test(text)) {
    return true;
  }
  if (text.includes("\t")) {
    return false;
  }
  const firstLine = text.split(/\r?\n/)[0];
  return firstLine
    .split(";")
    .slice(1)
    .some((part) => SET_COOKIE_ATTRIBUTES.has(part.split("=")[0].trim().toLowerCase()));
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch (error) {
    return null;
  }
}

// One cookie per line. When some lines start with "Set-Cookie:", the rest
// are taken to be other response headers and ignored, so a whole block of
// headers copied from DevTools can be pasted as it is.
function parseSetCookie(text, pageUrl) {
  const host = hostOf(pageUrl);
  const prefixed = /^set-cookie\s*:/im.test(text);
  const now = Date.now() / 1000;
  const entries = [];
  const problems = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    let line = raw.trim();
    if (line === "") {
      return;
    }
    if (prefixed) {
      const prefix = /^set-cookie\s*:\s*/i.exec(line);
      if (!prefix) {
        return;
      }
      line = line.slice(prefix[0].length);
    }

    const entry = fromSetCookie(line, host, now);
    if (typeof entry === "string") {
      problems.push("Line " + (index + 1) + ": " + entry);
    } else {
      entries.push(entry);
    }
  });

  if (entries.length === 0 && problems.length === 0) {
    problems.push("No Set-Cookie lines were found.");
  }
  return { format: "set-cookie", entries, problems };
}

// Reads one Set-Cookie value the way a browser would. Returns an entry, or a
// sentence saying why it can't be used.
function fromSetCookie(line, host, now) {
  const [pair, ...attributes] = line.split(";");
  const equals = pair.indexOf("=");
  const name = equals > 0 ? pair.slice(0, equals).trim() : "";
  if (name === "") {
    return "it doesn't start with a cookie's name and value.";
  }

  const entry = {
    name,
    value: pair.slice(equals + 1).trim(),
    // No Domain means the cookie belongs to the page that set it, and no
    // other host.
    domain: host,
    path: "/",
    secure: false,
    httpOnly: false,
    hostOnly: true,
    sameSite: "unspecified",
    session: true,
    expirationDate: null,
  };
  let expires = null;
  let maxAge = null;
  let partitioned = false;

  for (const attribute of attributes) {
    const split = attribute.indexOf("=");
    const key = (split === -1 ? attribute : attribute.slice(0, split)).trim().toLowerCase();
    const value = split === -1 ? "" : attribute.slice(split + 1).trim();

    if (key === "domain" && value !== "") {
      entry.domain = value.replace(/^\./, "").toLowerCase();
      entry.hostOnly = false;
    } else if (key === "path" && value.startsWith("/")) {
      entry.path = value;
    } else if (key === "expires") {
      // A date that can't be read is ignored, as browsers do.
      const time = Date.parse(value);
      if (!Number.isNaN(time)) {
        expires = time / 1000;
      }
    } else if (key === "max-age" && /^-?\d+$/.test(value)) {
      maxAge = Number(value);
    } else if (key === "secure") {
      entry.secure = true;
    } else if (key === "httponly") {
      entry.httpOnly = true;
    } else if (key === "samesite") {
      entry.sameSite = normaliseSameSite(value);
    } else if (key === "partitioned") {
      partitioned = true;
    }
  }

  if (partitioned) {
    return (
      name +
      " is partitioned, and a Set-Cookie line doesn't say which site it was embedded in. " +
      "Import it from a JSON export instead."
    );
  }
  if (!entry.domain) {
    return name + " has no Domain, and there's no page to put it on.";
  }

  // Max-Age wins over Expires, as it does in browsers. Zero or less means
  // "delete it now", so it counts as already expired and is skipped.
  const expiry = maxAge !== null ? (maxAge <= 0 ? now - 1 : now + maxAge) : expires;
  if (expiry !== null) {
    entry.session = false;
    entry.expirationDate = expiry;
  }
  return entry;
}

// --- import: a Cookie header or a curl command --------------------------------

// "a=1; b=2" as [{ name, value }]. A value runs to the next semicolon and
// can contain "=", which base64 often does. Each line may start with
// "Cookie:".
function readCookiePairs(text) {
  const pairs = [];
  const problems = [];

  for (const line of text.split(/\r?\n/)) {
    for (const part of line.replace(/^\s*cookie\s*:\s*/i, "").split(";")) {
      const piece = part.trim();
      if (piece === "") {
        continue;
      }
      const equals = piece.indexOf("=");
      if (equals <= 0) {
        const shown = piece.length > 40 ? piece.slice(0, 40) + "…" : piece;
        problems.push("“" + shown + "” isn't a name=value pair, so it's skipped.");
        continue;
      }
      pairs.push({ name: piece.slice(0, equals).trim(), value: piece.slice(equals + 1).trim() });
    }
  }
  return { pairs, problems };
}

function parseCookieHeader(text, pageUrl) {
  if (!hostOf(pageUrl)) {
    return {
      format: "header",
      entries: [],
      problems: ["A Cookie header doesn't say which site it's for, and there's no page to put it on."],
    };
  }
  const { pairs, problems } = readCookiePairs(text);
  if (pairs.length === 0 && problems.length === 0) {
    problems.push("No cookies were found in the Cookie header.");
  }
  return { format: "header", entries: pairs.map((pair) => ({ ...pair, sendTo: pageUrl })), problems };
}

// curl options that take a value, so that value isn't mistaken for the
// address. -b and -H are read separately below.
const CURL_OPTIONS_WITH_VALUES = new Set([
  "-A", "--user-agent", "-c", "--cookie-jar", "-d", "--data", "--data-ascii",
  "--data-binary", "--data-raw", "--data-urlencode", "-e", "--referer", "-F",
  "--form", "-m", "--max-time", "--connect-timeout", "-o", "--output", "-u",
  "--user", "-x", "--proxy", "-X", "--request", "-T", "--upload-file", "-w",
  "--write-out", "-r", "--range", "--resolve", "-E", "--cert", "--cacert",
  "--key", "-K", "--config",
]);

// A curl command, such as one from "Copy as cURL (bash)" in DevTools, or
// cookieZ's own curl export. The cookies come from -b / --cookie or a
// "Cookie:" header, and the site from the command's address.
function parseCurl(text) {
  const result = (entries, problems) => ({ format: "curl", entries, problems });

  // The cmd version escapes quotes as ^" and ends lines with ^.
  if (/\^"/.test(text) || /\s\^\r?\n/.test(text)) {
    return result([], [
      "This is the Windows (cmd) version of “Copy as cURL”. Copy the bash version instead, and paste that.",
    ]);
  }

  const words = shellWords(text);
  if (words === null) {
    return result([], ["This curl command couldn't be read, because a quote isn't closed."]);
  }

  let address = null;
  const cookieTexts = [];
  const problems = [];
  const takeCookies = (value) => {
    if (value === undefined) {
      return;
    }
    if (value.includes("=")) {
      cookieTexts.push(value);
    } else {
      problems.push(
        "This curl command reads its cookies from a file (" + value + "), which cookieZ can't open. " +
          "Paste the cookies themselves instead."
      );
    }
  };

  for (let i = 1; i < words.length; i += 1) {
    const word = words[i];
    if (word === "-b" || word === "--cookie") {
      i += 1;
      takeCookies(words[i]);
    } else if (word.startsWith("--cookie=")) {
      takeCookies(word.slice("--cookie=".length));
    } else if (word.startsWith("-b") && !word.startsWith("--")) {
      takeCookies(word.slice(2));
    } else if (word === "-H" || word === "--header") {
      i += 1;
      const header = words[i] || "";
      if (/^cookie\s*:/i.test(header)) {
        cookieTexts.push(header);
      }
    } else if (word === "--url") {
      i += 1;
      address = address || words[i] || null;
    } else if (CURL_OPTIONS_WITH_VALUES.has(word)) {
      i += 1;
    } else if (address === null && /^https?:\/\//i.test(word)) {
      address = word;
    }
  }

  if (!hostOf(address)) {
    return result([], [
      ...problems,
      "This curl command has no web address, so there's no telling which site its cookies are for.",
    ]);
  }
  if (cookieTexts.length === 0) {
    return result([], problems.length > 0 ? problems : ["This curl command doesn't send any cookies."]);
  }

  const { pairs, problems: pairProblems } = readCookiePairs(cookieTexts.join("\n"));
  return result(
    pairs.map((pair) => ({ ...pair, sendTo: address })),
    [...problems, ...pairProblems]
  );
}

// Splits a shell command into words, as bash would. '...' is taken as it
// is. "..." understands \" \\ \$ and \`. $'...' understands \n, \t, \xHH,
// \uHHHH and \', which DevTools uses for values with unusual characters. A
// backslash at the end of a line joins it to the next. Returns null if a
// quote isn't closed.
function shellWords(text) {
  const words = [];
  let word = null;
  const add = (part) => {
    word = (word === null ? "" : word) + part;
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];

    if (char === "\\") {
      const next = text[i + 1];
      if (next === "\n") {
        i += 2;
      } else if (next === "\r" && text[i + 2] === "\n") {
        i += 3;
      } else {
        add(next === undefined ? "" : next);
        i += 2;
      }
    } else if (/\s/.test(char)) {
      if (word !== null) {
        words.push(word);
        word = null;
      }
      i += 1;
    } else if (char === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) {
        return null;
      }
      add(text.slice(i + 1, end));
      i = end + 1;
    } else if (char === "$" && text[i + 1] === "'") {
      const quoted = readDollarQuote(text, i + 2);
      if (!quoted) {
        return null;
      }
      add(quoted.value);
      i = quoted.end;
    } else if (char === '"') {
      let j = i + 1;
      let part = "";
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\" && '"\\$`\n'.includes(text[j + 1])) {
          part += text[j + 1] === "\n" ? "" : text[j + 1];
          j += 2;
        } else {
          part += text[j];
          j += 1;
        }
      }
      if (j >= text.length) {
        return null;
      }
      add(part);
      i = j + 1;
    } else {
      add(char);
      i += 1;
    }
  }

  if (word !== null) {
    words.push(word);
  }
  return words;
}

const DOLLAR_QUOTE_ESCAPES = {
  n: "\n",
  r: "\r",
  t: "\t",
  "\\": "\\",
  "'": "'",
  '"': '"',
  a: "\x07",
  b: "\b",
  e: "\x1b",
  f: "\f",
  v: "\v",
};

// Reads $'...' from just after the opening quote. Returns { value, end }, or
// null if the quote isn't closed.
function readDollarQuote(text, start) {
  let value = "";
  let j = start;
  while (j < text.length) {
    const char = text[j];
    if (char === "'") {
      return { value, end: j + 1 };
    }
    if (char !== "\\") {
      value += char;
      j += 1;
      continue;
    }

    const next = text[j + 1];
    const hex =
      next === "x" ? /^[0-9a-fA-F]{1,2}/.exec(text.slice(j + 2))
      : next === "u" ? /^[0-9a-fA-F]{1,4}/.exec(text.slice(j + 2))
      : next === "U" ? /^[0-9a-fA-F]{1,8}/.exec(text.slice(j + 2))
      : null;
    if (hex) {
      value += String.fromCodePoint(parseInt(hex[0], 16));
      j += 2 + hex[0].length;
    } else if (Object.hasOwn(DOLLAR_QUOTE_ESCAPES, next)) {
      value += DOLLAR_QUOTE_ESCAPES[next];
      j += 2;
    } else {
      value += char;
      j += 1;
    }
  }
  return null;
}

// Whether `cookie` belongs to `host`: the same host for a host-only cookie,
// or the host or a subdomain of it for a domain-wide one. Partitioned
// cookies are left out: which of those are sent depends on the page they're
// embedded in, which a header doesn't say.
function isOnHost(cookie, host) {
  if (cookie.partitionKey) {
    return false;
  }
  const domain = String(cookie.domain || "").replace(/^\./, "");
  return cookie.hostOnly ? host === domain : host === domain || host.endsWith("." + domain);
}

// Would Chrome send `cookie` to `url`? Its path and Secure have to match too.
function isSentTo(cookie, url) {
  const path = cookie.path || "/";
  const pathMatches =
    url.pathname === path ||
    (url.pathname.startsWith(path) && (path.endsWith("/") || url.pathname[path.length] === "/"));

  // Chrome treats localhost as secure, so it gets Secure cookies over http.
  const host = url.hostname;
  const secureMatches =
    !cookie.secure || url.protocol === "https:" || host === "localhost" || host.endsWith(".localhost");

  return isOnHost(cookie, host) && pathMatches && secureMatches;
}

// Turns { name, value, sendTo } entries into full ones. Other entries pass
// through untouched.
//
// A name the site already has keeps that cookie's domain, path, expiry and
// flags, and only its value changes. The header came from a browser that
// had those cookies, so they're the same cookies. Cookies Chrome would send
// to the address come first, longest path first, as Chrome orders them, so
// a name sent twice pairs up in order. After those come the site's other
// cookies with that name, on other paths: a header copied from cookieZ's
// own export includes every path. A new name becomes a host-only session
// cookie on the address's host, Secure on https.
export function matchSentCookies(entries, existing) {
  const byPath = (a, b) => (b.path || "/").length - (a.path || "/").length;
  const queues = new Map();
  const candidatesFor = (sendTo, name) => {
    const key = sendTo + "\n" + name;
    if (!queues.has(key)) {
      const url = new URL(sendTo);
      const named = existing.filter((cookie) => cookie.name === name && isOnHost(cookie, url.hostname));
      const sent = named.filter((cookie) => isSentTo(cookie, url)).sort(byPath);
      const others = named.filter((cookie) => !isSentTo(cookie, url)).sort(byPath);
      queues.set(key, [...sent, ...others]);
    }
    return queues.get(key);
  };

  return entries.map((entry) => {
    if (!entry.sendTo) {
      return entry;
    }

    const match = candidatesFor(entry.sendTo, entry.name).shift();
    if (match) {
      const session = typeof match.expirationDate !== "number";
      return {
        name: match.name,
        value: entry.value,
        domain: String(match.domain || "").replace(/^\./, ""),
        path: match.path || "/",
        secure: Boolean(match.secure),
        httpOnly: Boolean(match.httpOnly),
        hostOnly: Boolean(match.hostOnly),
        sameSite: match.sameSite || "unspecified",
        session,
        expirationDate: session ? null : match.expirationDate,
      };
    }

    const url = new URL(entry.sendTo);
    return {
      name: entry.name,
      value: entry.value,
      domain: url.hostname,
      path: "/",
      secure: url.protocol === "https:",
      httpOnly: false,
      hostOnly: true,
      sameSite: "unspecified",
      session: true,
      expirationDate: null,
    };
  });
}

// --- import: putting cookies on this site instead -----------------------------

// Whether an entry is for the page's site: its host, a parent domain of it,
// or one of its subdomains. When some aren't, the import offers to move them.
export function isForSite(entry, hostname) {
  const domain = entry.sendTo
    ? hostOf(entry.sendTo)
    : String(entry.domain || "").replace(/^\./, "");
  return domain === hostname || hostname.endsWith("." + domain) || domain.endsWith("." + hostname);
}

// "Put them on this site instead", for copying cookies from, say, a staging
// site to localhost. Each cookie moves to the page's host as a host-only
// cookie, with its path and flags unchanged. Ports don't matter: cookies
// ignore them. A partitioned cookie is skipped, because its partition
// belongs to the site it came from. Returns { entries, problems }.
export function moveToSite(entries, pageUrl) {
  const host = hostOf(pageUrl);
  const moved = [];
  const problems = [];
  for (const entry of entries) {
    if (entry.sendTo) {
      moved.push({ ...entry, sendTo: pageUrl });
    } else if (entry.partitionKey) {
      problems.push(entry.name + " (" + entry.domain + ") is partitioned, so it can't be moved to another site.");
    } else {
      moved.push({ ...entry, domain: host, hostOnly: true });
    }
  }
  return { entries: moved, problems };
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
//   toWrite: [{ entry, replaces, match, kept }],  what will be written, and
//                                          the cookie each one replaces
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

    const errors = validateCookieValues(entry, { imported: true });
    if (errors.length > 0) {
      invalid.push(entry.name + " (" + entry.domain + "): " + errors.join(" "));
      continue;
    }

    const match = byIdentity.get(identityOf(entry));
    toWrite.push({
      entry,
      replaces: Boolean(match),
      match: match || null,
      kept: Boolean(match && isKept(match)),
    });
  }

  const domains = Array.from(new Set(toWrite.map((item) => item.entry.domain))).sort();
  return { toWrite, expired, duplicates, invalid, domains };
}
