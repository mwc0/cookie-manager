// The occasional "a review helps" line, shown after a delete, an import or a
// Save has gone well a few times.
//
// It asks at most twice, ever: after the 5th finished job, and, if the
// answer was "Not now", once more after the 25th. "Leave a review" or "No
// thanks" ends it for good. What's saved is one small entry in
// chrome.storage.local, never sent anywhere:
//
//   reviewAsk: { jobs: <number>, state: "later" | "done" | undefined }

export const REVIEW_KEY = "reviewAsk";

// The store's review page for cookieZ. This is the only real web address
// in cookieZ's code (the bundled lists in src/lists/ name their sources,
// and rules.js tests with a made-up .invalid one that can't exist). It's
// only opened, in a new tab, when someone clicks "Leave a review". cookieZ
// never fetches anything from it. tests/test_no_network.py checks this.
export const STORE_REVIEWS_URL =
  "https://chromewebstore.google.com/detail/ceonoigjmjpfhkiokodcnhneecfhfokb/reviews";

const FIRST_ASK = 5;
const SECOND_ASK = 25;

async function loadAsk() {
  const stored = await chrome.storage.local.get(REVIEW_KEY);
  const saved = stored ? stored[REVIEW_KEY] : undefined;
  return {
    jobs: saved && Number.isInteger(saved.jobs) && saved.jobs > 0 ? saved.jobs : 0,
    state: saved ? saved.state : undefined,
  };
}

// Adds one finished job. Returns "first" or "second" when now is the time
// to ask, otherwise null. Never throws: if storage fails it never asks,
// which isn't worth troubling anyone about.
export async function noteJob() {
  try {
    const ask = await loadAsk();
    if (ask.state === "done") {
      return null; // Finished with: no need to keep counting.
    }
    ask.jobs += 1;
    await chrome.storage.local.set({ [REVIEW_KEY]: ask });
    if (ask.jobs === FIRST_ASK && ask.state === undefined) {
      return "first";
    }
    if (ask.jobs === SECOND_ASK && ask.state === "later") {
      return "second";
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Saves the answer: "later" for Not now, "done" for Leave a review or No
// thanks. If saving fails it may ask again; nothing worse.
export async function recordAnswer(state) {
  try {
    const ask = await loadAsk();
    ask.state = state;
    await chrome.storage.local.set({ [REVIEW_KEY]: ask });
  } catch (error) {
  }
}
