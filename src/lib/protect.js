// The "Keep" flag (called "protected" in the code). A kept cookie is skipped
// by every delete in this extension. It doesn't stop the website, or another
// extension, from changing or deleting it. That would need a background
// script, which v1 doesn't have. It's why the popup says "kept" and never
// "protected": it would be promising more than it does.

const STORAGE_KEY = "protectedCookies";

// How a kept cookie is remembered. Unlike cookieKey() in cookies.js, this
// leaves out storeId, so keeping a cookie in a normal window also keeps the
// matching cookie in incognito. That's what people expect, and if it's ever
// wrong, it errs towards not deleting.
export function protectionKeyOf(cookie) {
  return [
    String(cookie.domain || "").replace(/^\./, ""),
    cookie.path || "/",
    cookie.name,
    cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : "",
  ].join("\n");
}

// Every kept cookie, as a Set of keys. If storage can't be read, this returns
// an empty set plus an error. The popup must show that error, otherwise a
// delete could remove a cookie the user thinks is kept.
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

// Keep or un-keep one cookie. Returns { keys, error }.
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

// Splits a list into cookies a delete may remove and ones it must leave.
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

// Forgets kept cookies that no longer exist. Otherwise the list grows
// forever, and if a site later sets a new cookie with the same name, the old
// entry would keep it without the user asking. Only this page's domains are
// checked. Entries for other sites are left alone.
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
    // Not worth telling the user. The list is just untidy.
    console.warn("Couldn't prune the protected list:", error);
    return { keys: protectedKeys, error: null };
  }
}

// --- the whole list, for the "Kept cookies" screen ------------------------
//
// These only read and change the saved list. They never ask Chrome for any
// site's cookies, so the screen can show every kept cookie on every site
// without looking at anything it hasn't already been told to keep.

// Turns a saved key back into its parts. The opposite of protectionKeyOf().
export function parseProtectionKey(key) {
  const [domain, path, name, partition] = String(key).split("\n");
  let partitionKey = null;
  if (partition) {
    try {
      partitionKey = JSON.parse(partition);
    } catch (error) {
      // Not something this file wrote. Show the entry without it.
      partitionKey = null;
    }
  }
  return { key, domain: domain || "", path: path || "/", name: name || "", partitionKey };
}

// Every kept cookie, sorted by site and then name. Returns { entries, error }.
export async function listProtected() {
  const { keys, error } = await loadProtected();
  const entries = Array.from(keys)
    .map(parseProtectionKey)
    .sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));
  return { entries, error };
}

// Stops keeping the cookies with these saved keys. Returns { keys, error },
// like setProtected().
export async function unprotectKeys(keysToRemove) {
  const { keys, error } = await loadProtected();
  if (error) {
    return { keys, error };
  }

  for (const key of keysToRemove) {
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
