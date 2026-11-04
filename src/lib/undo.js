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

import { describeError, bareDomain } from "./format.js";
import { t, tn } from "./i18n.js";
import { writeCookie, removeCookies } from "./cookies.js";

const MAX_AGE_SECONDS = 10 * 60;

// Normal windows and incognito each get their own entry. Otherwise an
// incognito window could offer to undo a change made in a normal window, or
// the other way round.
function storageKey() {
  return chrome.extension.inIncognitoContext ? "lastChange-incognito" : "lastChange-normal";
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
    return { error: t("rules_undoUnavailable", describeError(error)) };
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
// Also used by popup.js to change one detail of many cookies at once.
export function valuesOf(cookie) {
  const session = typeof cookie.expirationDate !== "number";
  return {
    name: cookie.name,
    value: cookie.value,
    domain: bareDomain(cookie.domain),
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
  return t("rules_undoCookie", cookie.name, bareDomain(cookie.domain));
}

// Writes the cookies back. Each goes through writeCookie(), so every write
// trap it handles applies here too. If the site has set a cookie again since
// the change, the old one replaces it: Undo means "put back what I had".
// Returns { restored, expired, failures }, where failures are sentences.
export async function restoreCookies(cookies, now = Date.now() / 1000) {
  let expired = 0;
  const toWrite = [];
  for (const cookie of cookies) {
    if (typeof cookie.expirationDate === "number" && cookie.expirationDate <= now) {
      expired += 1;
    } else {
      toWrite.push(cookie);
    }
  }

  // All at once, as removeCookies() deletes them: one at a time took about
  // 10 seconds for 3,000 cookies. Each cookie still gets its own result,
  // and the failures stay in the order the cookies came in.
  const outcomes = await Promise.all(
    toWrite.map(async (cookie) => ({ cookie, ...(await writeCookie(null, valuesOf(cookie))) }))
  );

  const failures = outcomes
    .filter((outcome) => !outcome.ok)
    .map((outcome) => t("rules_undoRestoreFailed", describe(outcome.cookie), outcome.error));
  return { restored: outcomes.length - failures.length, expired, failures };
}

// Undoes a change: takes away what it added, then puts back what it
// replaced or deleted. `isKept(cookie)` says whether a cookie is marked
// Kept. A kept cookie is never removed, by Undo or anything else here.
// Returns { removed, kept, restored, expired, failures }.
export async function undoChange(change, isKept, now = Date.now() / 1000) {
  const toRemove = change.remove.filter((cookie) => !isKept(cookie));
  const kept = change.remove.length - toRemove.length;
  const { removed, failed } = await removeCookies(toRemove);
  const failures = failed.map((cookie) => t("rules_undoRemoveFailed", describe(cookie)));

  // Only once every removal has finished: an import can replace a cookie
  // with one of the same name, and putting the old one back mustn't race
  // with taking the new one away.
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
    return t("rules_ageJustNow");
  }
  return tn("rules_ageMinutes", minutes);
}
