// Undo for the last change: a delete, an import, a Save in the editor, or a
// new cookie.
//
// To undo a change, the cookies it affected have to be kept somewhere, and
// values are often login tokens. So they're kept in chrome.storage.session,
// which lives in memory only: it's never written to disk, and Chrome empties
// it when the browser closes. On top of that, only the most recent change is
// kept, and it's dropped after 10 minutes. store/PRIVACY.md says all of this,
// so change it there too if any of it changes here.
//
// The popup closes whenever you click outside it, which is why this isn't
// just a variable in popup.js: Undo has to survive that.
//
// A change is { kind, restore, remove }:
//   kind     "delete", "import", "edit" or "create", for the wording
//   restore  cookies as they were before, which Undo writes back
//   remove   cookies the change added, which Undo takes away
// A delete only has `restore`. A new cookie only has `remove`. An import
// has both: the cookies it replaced, and the ones it added.

import { writeCookie, removeCookie } from "./cookies.js";

const MAX_AGE_SECONDS = 10 * 60;

// Normal windows and incognito each get their own entry. Otherwise an
// incognito window could offer to undo a change made in a normal window, or
// the other way round.
function storageKey() {
  return chrome.extension.inIncognitoContext ? "lastChange-incognito" : "lastChange-normal";
}

function messageOf(error) {
  return error && error.message ? error.message : String(error);
}

// Remembers `change` as the last change, replacing any earlier one.
// Returns { error }. A failure only means Undo won't be offered.
export async function saveLastChange(change, now = Date.now() / 1000) {
  const restore = change.restore || [];
  const remove = change.remove || [];
  if (restore.length === 0 && remove.length === 0) {
    return { error: null };
  }
  try {
    await chrome.storage.session.set({
      [storageKey()]: { at: now, kind: change.kind, restore, remove },
    });
    return { error: null };
  } catch (error) {
    return { error: "Undo isn't available for this change: " + messageOf(error) };
  }
}

// The last change as { at, kind, restore, remove }, or null if there isn't
// one or it's more than 10 minutes old. An old one is removed while we're
// here.
export async function loadLastChange(now = Date.now() / 1000) {
  try {
    const stored = await chrome.storage.session.get(storageKey());
    const last = stored ? stored[storageKey()] : null;
    if (
      !last ||
      typeof last.at !== "number" ||
      typeof last.kind !== "string" ||
      !Array.isArray(last.restore) ||
      !Array.isArray(last.remove)
    ) {
      return null;
    }
    if (now - last.at > MAX_AGE_SECONDS) {
      await clearLastChange();
      return null;
    }
    return last;
  } catch (error) {
    console.warn("Couldn't read the last change:", error);
    return null;
  }
}

export async function clearLastChange() {
  try {
    await chrome.storage.session.remove(storageKey());
  } catch (error) {
    console.warn("Couldn't clear the last change:", error);
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

function describe(cookie) {
  return cookie.name + " (" + String(cookie.domain || "").replace(/^\./, "") + ")";
}

// Writes the cookies back. Each goes through writeCookie(), so every write
// trap it handles applies here too. If the site has set a cookie again since
// the change, the old one replaces it: Undo means "put back what I had".
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
      failures.push(describe(cookie) + ": " + error);
    }
  }

  return { restored, expired, failures };
}

// Undoes a change: takes away what it added, then puts back what it
// replaced or deleted. `isKept(cookie)` says whether a cookie is marked
// Kept. A kept cookie is never removed, by Undo or anything else here.
// Returns { removed, kept, restored, expired, failures }.
export async function undoChange(change, isKept, now = Date.now() / 1000) {
  let removed = 0;
  let kept = 0;
  const failures = [];

  for (const cookie of change.remove) {
    if (isKept(cookie)) {
      kept += 1;
      continue;
    }
    if (await removeCookie(cookie)) {
      removed += 1;
    } else {
      failures.push(describe(cookie) + ": couldn't be removed.");
    }
  }

  const back = await restoreCookies(change.restore, now);
  return {
    removed,
    kept,
    restored: back.restored,
    expired: back.expired,
    failures: [...failures, ...back.failures],
  };
}

// "just now", "1 minute ago", "4 minutes ago"
export function describeAge(seconds) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) {
    return "just now";
  }
  return minutes === 1 ? "1 minute ago" : minutes + " minutes ago";
}
