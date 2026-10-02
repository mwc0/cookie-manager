// Undo for the last delete.
//
// To put cookies back, their values have to be kept somewhere, and values are
// often login tokens. So they're kept in chrome.storage.session, which lives
// in memory only: it's never written to disk, and Chrome empties it when the
// browser closes. On top of that, only the most recent delete is kept, and
// it's dropped after 10 minutes. store/PRIVACY.md says all of this, so change
// it there too if any of it changes here.
//
// The popup closes whenever you click outside it, which is why this isn't
// just a variable in popup.js: Undo has to survive that.

import { writeCookie } from "./cookies.js";

const MAX_AGE_SECONDS = 10 * 60;

// Normal windows and incognito each get their own entry. Otherwise an
// incognito window could offer to restore cookies deleted in a normal window,
// or the other way round.
function storageKey() {
  return chrome.extension.inIncognitoContext ? "lastDelete-incognito" : "lastDelete-normal";
}

function messageOf(error) {
  return error && error.message ? error.message : String(error);
}

// Remembers `cookies` as the last delete, replacing any earlier one.
// Returns { error }. A failure only means Undo won't be offered.
export async function saveLastDelete(cookies, now = Date.now() / 1000) {
  if (cookies.length === 0) {
    return { error: null };
  }
  try {
    await chrome.storage.session.set({ [storageKey()]: { at: now, cookies } });
    return { error: null };
  } catch (error) {
    return { error: "Undo isn't available for this delete: " + messageOf(error) };
  }
}

// The last delete as { at, cookies }, or null if there isn't one or it's
// more than 10 minutes old. An old one is removed while we're here.
export async function loadLastDelete(now = Date.now() / 1000) {
  try {
    const stored = await chrome.storage.session.get(storageKey());
    const last = stored ? stored[storageKey()] : null;
    if (!last || !Array.isArray(last.cookies) || typeof last.at !== "number") {
      return null;
    }
    if (now - last.at > MAX_AGE_SECONDS) {
      await clearLastDelete();
      return null;
    }
    return last;
  } catch (error) {
    console.warn("Couldn't read the last delete:", error);
    return null;
  }
}

export async function clearLastDelete() {
  try {
    await chrome.storage.session.remove(storageKey());
  } catch (error) {
    console.warn("Couldn't clear the last delete:", error);
  }
}

// A cookie as Chrome reported it, turned into what writeCookie() takes.
function valuesOf(cookie) {
  const session = typeof cookie.expirationDate !== "number";
  return {
    name: cookie.name,
    value: cookie.value,
    domain: String(cookie.domain || "").replace(/^\./, ""),
    path: cookie.path || "/",
    sameSite: cookie.sameSite || "unspecified",
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    hostOnly: Boolean(cookie.hostOnly),
    session,
    expirationDate: session ? null : cookie.expirationDate,
    storeId: cookie.storeId,
    partitionKey: cookie.partitionKey,
  };
}

// Writes the cookies back. Each goes through writeCookie(), so every write
// trap it handles applies here too. If the site has set a cookie again since
// the delete, the deleted one replaces it: Undo means "put back what I had".
// Returns { restored, expired, failures }, where failures are sentences.
export async function restoreCookies(cookies, now = Date.now() / 1000) {
  let restored = 0;
  let expired = 0;
  const failures = [];

  // One at a time, so the result for each cookie is known.
  for (const cookie of cookies) {
    if (typeof cookie.expirationDate === "number" && cookie.expirationDate <= now) {
      expired += 1;
      continue;
    }
    const { ok, error } = await writeCookie(null, valuesOf(cookie));
    if (ok) {
      restored += 1;
    } else {
      failures.push(cookie.name + " (" + String(cookie.domain || "").replace(/^\./, "") + "): " + error);
    }
  }

  return { restored, expired, failures };
}

// "just now", "1 minute ago", "4 minutes ago"
export function describeAge(seconds) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) {
    return "just now";
  }
  return minutes === 1 ? "1 minute ago" : minutes + " minutes ago";
}
