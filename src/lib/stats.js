// The lifetime count of cookies cleared by cookieZ, shown on the Block
// cookies screen.
//
// It counts what cookieZ itself deletes, and nothing else. Chrome doesn't
// tell extensions when it blocks a cookie, so a "cookies blocked" number
// would be a guess; this one is exact. Undo takes cookies back off the
// count. It is one number in chrome.storage.local, never sent anywhere.

export const CLEARED_KEY = "clearedCount";

function asCount(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

// Never throws. If storage fails, the count shows as 0.
export async function loadCleared() {
  try {
    const stored = await chrome.storage.local.get(CLEARED_KEY);
    return asCount(stored ? stored[CLEARED_KEY] : undefined);
  } catch (error) {
    return 0;
  }
}

// Changes are made one after another, so two deletes finishing at the same
// moment can't both read the old number and lose one of them.
let queue = Promise.resolve();

// Adds `change` (negative for Undo) and returns the new total. If saving
// fails the count is simply a little out; nothing else depends on it, so
// the error is ignored rather than shown.
export function changeCleared(change) {
  queue = queue.then(async () => {
    if (!Number.isInteger(change) || change === 0) {
      return loadCleared();
    }
    const total = Math.max(0, (await loadCleared()) + change);
    try {
      await chrome.storage.local.set({ [CLEARED_KEY]: total });
    } catch (error) {
    }
    return total;
  });
  return queue;
}
