// The protect flag.
//
// v1 is a UI GUARD, not active protection: a protected cookie is excluded from
// anything this extension deletes, and the popup says so. It does not stop a
// website, or another extension, from changing or removing the cookie itself.
// Doing that needs a service worker listening to cookies.onChanged and writing
// the old value back, which is deliberately deferred -- see docs/SPEC.md.
//
// Calling it "protected" while only guarding our own delete button would be
// overclaiming, so the UI says "kept" wherever it reports what a delete did.

const STORAGE_KEY = "protectedCookies";

// Identity of a cookie for protection purposes.
//
// Deliberately WITHOUT storeId, unlike cookieKey() in cookies.js. A storeId
// distinguishes the normal cookie store from the incognito one, so including
// it would mean a cookie protected in a normal window is unprotected in an
// incognito one -- which is the opposite of what someone ticking "protect"
// expects. The trade-off is that protecting a cookie protects its incognito
// namesake too, which is the safer direction to be wrong in.
export function protectionKeyOf(cookie) {
  return [
    String(cookie.domain || "").replace(/^\./, ""),
    cookie.path || "/",
    cookie.name,
    cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : "",
  ].join("\n");
}

// Every protected cookie, as a Set of keys.
//
// A storage failure returns an empty set rather than throwing: the cost is
// that a protected cookie is briefly treated as unprotected, so the caller is
// told about the failure and the UI has to surface it. Silently swallowing it
// would let a delete remove something the user believed was safe.
export async function loadProtected() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const keys = stored && Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    return { keys: new Set(keys), error: null };
  } catch (error) {
    return {
      keys: new Set(),
      error:
        "Couldn't read the protected list, so nothing is being treated as " +
        "protected right now: " + (error && error.message ? error.message : String(error)),
    };
  }
}

// Turn protection on or off for one cookie. Returns { keys, error }.
export async function setProtected(cookie, shouldProtect) {
  const { keys, error } = await loadProtected();
  if (error) {
    return { keys, error };
  }

  const key = protectionKeyOf(cookie);
  if (shouldProtect) {
    keys.add(key);
  } else {
    keys.delete(key);
  }

  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: Array.from(keys) });
    return { keys, error: null };
  } catch (storageError) {
    return {
      keys,
      error:
        "Couldn't save the protected list: " +
        (storageError && storageError.message ? storageError.message : String(storageError)),
    };
  }
}

export function isProtected(protectedKeys, cookie) {
  return protectedKeys.has(protectionKeyOf(cookie));
}

// Split a list into what a delete may touch and what it must leave alone.
export function partitionByProtection(protectedKeys, cookies) {
  const deletable = [];
  const kept = [];

  for (const cookie of cookies) {
    if (isProtected(protectedKeys, cookie)) {
      kept.push(cookie);
    } else {
      deletable.push(cookie);
    }
  }

  return { deletable, kept };
}

// Forget protection for cookies that no longer exist.
//
// Without this the stored list grows forever, and worse: a key can be
// reused. Delete a cookie, and a site later sets one with the same name on
// the same domain and path -- a stale entry would silently protect the new
// one. Called with every cookie currently on the page, so only keys for THIS
// page's domains are considered; keys for other sites are left alone.
export async function pruneProtected(protectedKeys, cookiesOnPage, pageDomains) {
  const live = new Set(cookiesOnPage.map(protectionKeyOf));
  const stale = [];

  for (const key of protectedKeys) {
    const domain = key.split("\n")[0];
    if (pageDomains.has(domain) && !live.has(key)) {
      stale.push(key);
    }
  }

  if (stale.length === 0) {
    return { keys: protectedKeys, error: null };
  }

  const remaining = new Set(protectedKeys);
  for (const key of stale) {
    remaining.delete(key);
  }

  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: Array.from(remaining) });
    return { keys: remaining, error: null };
  } catch (error) {
    // Not worth bothering the user about: the list is merely untidy, and
    // nothing is protected that shouldn't be.
    console.warn("Couldn't prune the protected list:", error);
    return { keys: protectedKeys, error: null };
  }
}
