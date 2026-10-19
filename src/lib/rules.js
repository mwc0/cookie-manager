// Site rules: which sites may set cookies.
//
// cookieZ doesn't block anything itself. It only runs while it's open, and
// blocking has to work all the time. So it hands Chrome a rule for each site,
// through chrome.contentSettings, and Chrome does the blocking.
//
// Two things about that API shape this file:
//
//   1. Chrome can't list the rules an extension has set. So the list saved
//      here is the truth, and Chrome's copy is made from it.
//   2. Chrome can't remove one rule, only all of them. So every change clears
//      Chrome's copy and sets every rule again. See applyRules().
//
// "Block other companies' cookies" on every site can't be written as one of
// those rules: a rule says "cookies from X, on pages of Y", and no pattern
// means "from a different site than the page". So that one choice uses
// Chrome's own switch for third-party cookies instead
// (chrome.privacy.websites.thirdPartyCookiesAllowed). A site's own rule still
// wins over it, which is what keeps the allowed list working.
//
// Known trackers' cookies can be blocked on every site too, from a list
// inside cookieZ (src/lists/trackers.js). That's one rule per tracker, and
// more for sites set to allow all cookies. See chromeRulesFor().
//
// What's saved is site names, the rule for each, and three settings. Never
// cookies, never values. store/PRIVACY.md says so, so change it there too
// if this changes.
//
// Site rules need the optional "contentSettings" permission, and the
// every-site choice also needs "privacy". Both are asked for on the rules
// screen. See permissions.js.

import { baseHostOf } from "./cookies.js";
import { TRACKER_DOMAINS } from "../lists/trackers.js";

const STORAGE_KEY = "siteRules";

// The choices for a site. "Every other site" can be ALLOW, OWN_ONLY or BLOCK.
export const ALLOW = "allow";
export const SESSION = "session";
export const OWN_ONLY = "own-only";
export const BLOCK = "block";

const SITE_CHOICES = [ALLOW, SESSION, OWN_ONLY, BLOCK];
const EVERYWHERE_CHOICES = [ALLOW, OWN_ONLY, BLOCK];
const ALL_URLS = "<all_urls>";

// A made-up address, for asking Chrome what it would do with a cookie from
// "some other company". Nothing is ever sent to it.
const PROBE = "https://cookiez-probe.invalid/";

function emptyRules() {
  return { everywhere: ALLOW, sites: {}, deleteOnBlock: false, trackers: false };
}

function describe(error) {
  return error && error.message ? error.message : String(error);
}

// Whatever was in storage (or in a backup file), with nothing unexpected in
// it. Anything this file didn't write is dropped.
function tidy(stored) {
  const rules = emptyRules();
  if (!stored || typeof stored !== "object") {
    return rules;
  }
  if (EVERYWHERE_CHOICES.includes(stored.everywhere)) {
    rules.everywhere = stored.everywhere;
  }
  if (stored.sites && typeof stored.sites === "object") {
    for (const [site, rule] of Object.entries(stored.sites)) {
      if (isSiteName(site) && SITE_CHOICES.includes(rule)) {
        rules.sites[site] = rule;
      }
    }
  }
  rules.deleteOnBlock = stored.deleteOnBlock === true;
  rules.trackers = stored.trackers === true;
  return rules;
}

// A host name or IP address, and nothing that could become part of a
// pattern Chrome would read differently.
function isSiteName(site) {
  return typeof site === "string" && /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)$/i.test(site) && !site.startsWith(".");
}

// The saved rules. If storage can't be read, this returns no rules plus an
// error, and the popup must show it.
export async function loadRules() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return { rules: tidy(stored && stored[STORAGE_KEY]), error: null };
  } catch (error) {
    return { rules: emptyRules(), error: "Couldn't read your site rules: " + describe(error) };
  }
}

// Returns an error message, or null.
async function saveRules(rules) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: rules });
    return null;
  } catch (error) {
    return "Couldn't save your site rules: " + describe(error);
  }
}

// True if a rule for `site` also covers `host`: the site itself, or one of
// its subdomains.
function covers(site, host) {
  return host === site || host.endsWith("." + site);
}

// The site a page's rule belongs to. That's the page's own site, unless a
// rule already exists for a site above it: a rule for example.com covers
// shop.example.com, so on shop.example.com that's the rule to show and change.
export function siteFor(rules, hostname) {
  const host = baseHostOf(hostname);
  let found = null;
  for (const site of Object.keys(rules.sites)) {
    if (covers(site, host) && (found === null || site.length > found.length)) {
      found = site;
    }
  }
  return found || host;
}

// The rule a page gets: its site's own rule, or the one for every other site.
export function ruleFor(rules, hostname) {
  return rules.sites[siteFor(rules, hostname)] || rules.everywhere;
}

export function hasAnyRule(rules) {
  return rules.everywhere !== ALLOW || rules.trackers || Object.keys(rules.sites).length > 0;
}

// True if `site` is one of the listed trackers, or a subdomain of one.
function isTrackerSite(site) {
  return TRACKER_DOMAINS.some((tracker) => covers(tracker, site));
}

// Whether a blocked tracker keeps its cookies on its own site. See
// chromeRulesFor().
function allowedOnOwnSite(rules, tracker) {
  return rules.everywhere !== BLOCK && !Object.keys(rules.sites).some((site) => covers(site, tracker));
}

// Every site with a rule of its own, sorted by name.
export function listRules(rules) {
  return Object.keys(rules.sites)
    .sort((a, b) => a.localeCompare(b))
    .map((site) => ({ site, rule: rules.sites[site] }));
}

// The pattern Chrome wants for a site and its subdomains. An IP address has
// no subdomains, and Chrome refuses the "*." form for one.
export function patternFor(site) {
  const isAddress = /^\d{1,3}(\.\d{1,3}){3}$/.test(site) || site.startsWith("[");
  return isAddress ? "*://" + site + "/*" : "*://*." + site + "/*";
}

// Turns the saved rules into the content-setting rules Chrome understands.
// "Block other companies' cookies" on every site isn't one of these; see
// the note at the top and applyRules().
//
// Chrome's cookie rules have two patterns: who the cookie is from (primary),
// and which site's pages it's being used on (secondary). The more specific
// rule wins, and that is what makes "own-only" work: a general "block
// everyone on this site's pages" and a narrower "but allow the site itself".
//
// Known trackers are blocked with "cookies from the tracker, on any site's
// pages". That rule names who the cookie is from, so Chrome counts it as
// more specific than a site's "anyone's cookies on my pages: allow", and
// the site's rule loses. "Allow all cookies" has to mean all, so each
// allowed site also gets "cookies from the tracker, on this site's pages:
// allow", for every tracker. Only allowed sites need these: every other
// choice blocks other companies' cookies anyway, or is happy for Chrome to
// block these ones.
//
// The tracker block also stops a tracker's cookies on its own site, which
// would break signing in to its own dashboard. So each tracker also gets
// "cookies from the tracker, on its own pages: allow", which is more
// specific again. Not when the tracker's site has a rule of the user's
// own (theirs decides), and not when every other site blocks all cookies
// (that would let the tracker's site through the allowed list).
//
// This is checked against a real browser in tests/test_rules.py and
// tests/test_trackers.py.
export function chromeRulesFor(rules) {
  const out = [];

  if (rules.everywhere === BLOCK) {
    out.push({ primaryPattern: ALL_URLS, setting: "block" });
  }

  for (const { site, rule } of listRules(rules)) {
    const pattern = patternFor(site);

    if (rule === ALLOW) {
      // Anyone's cookies, on this site's pages.
      out.push({ primaryPattern: ALL_URLS, secondaryPattern: pattern, setting: "allow" });
    } else if (rule === SESSION) {
      // Anyone's cookies on this site's pages, but Chrome deletes them all
      // when it closes.
      out.push({ primaryPattern: ALL_URLS, secondaryPattern: pattern, setting: "session_only" });
    } else if (rule === OWN_ONLY) {
      // Nobody's cookies on this site's pages, except the site's own.
      out.push({ primaryPattern: ALL_URLS, secondaryPattern: pattern, setting: "block" });
      out.push({ primaryPattern: pattern, secondaryPattern: pattern, setting: "allow" });
    } else {
      // Nobody's cookies on this site's pages, and none from this site
      // anywhere else either.
      out.push({ primaryPattern: ALL_URLS, secondaryPattern: pattern, setting: "block" });
      out.push({ primaryPattern: pattern, setting: "block" });
    }
  }

  if (rules.trackers) {
    for (const tracker of TRACKER_DOMAINS) {
      out.push({ primaryPattern: patternFor(tracker), secondaryPattern: ALL_URLS, setting: "block" });
      if (allowedOnOwnSite(rules, tracker)) {
        out.push({ primaryPattern: patternFor(tracker), secondaryPattern: patternFor(tracker), setting: "allow" });
      }
    }
    for (const { site, rule } of listRules(rules)) {
      if (rule === ALLOW) {
        for (const tracker of TRACKER_DOMAINS) {
          out.push({ primaryPattern: patternFor(tracker), secondaryPattern: patternFor(site), setting: "allow" });
        }
      }
    }
  }

  return out;
}

// False until the permission has been given. Chrome only adds
// chrome.contentSettings to the page once it has.
export function rulesAvailable() {
  return Boolean(chrome.contentSettings && chrome.contentSettings.cookies);
}

// The same for Chrome's third-party cookie switch.
export function everywhereAvailable() {
  return Boolean(chrome.privacy && chrome.privacy.websites && chrome.privacy.websites.thirdPartyCookiesAllowed);
}

function thirdPartySetting() {
  return chrome.privacy.websites.thirdPartyCookiesAllowed;
}

// Who is in charge of Chrome's third-party cookie switch, and what it's set
// to: { allowed, ours, canChange }, or null without the permission.
// `ours` is true when cookieZ set it. `canChange` is false when another
// extension or the computer's administrator controls it.
export async function thirdPartyStatus() {
  if (!everywhereAvailable()) {
    return null;
  }
  try {
    const details = await thirdPartySetting().get({});
    return {
      allowed: details.value !== false,
      ours: details.levelOfControl === "controlled_by_this_extension",
      canChange:
        details.levelOfControl === "controlled_by_this_extension" ||
        details.levelOfControl === "controllable_by_this_extension",
    };
  } catch (error) {
    console.warn("Couldn't read Chrome's third-party cookie setting:", error);
    return null;
  }
}

// Makes Chrome match `rules`. Returns an error message, or null.
export async function applyRules(rules) {
  if (!rulesAvailable()) {
    return "Chrome hasn't given cookieZ permission to set rules.";
  }
  try {
    // Chrome's own third-party switch: set for "block other companies'
    // cookies" on every site, and handed back to the user otherwise.
    if (rules.everywhere === OWN_ONLY) {
      if (!everywhereAvailable()) {
        return "Chrome hasn't given cookieZ permission to block other companies' cookies on every site.";
      }
      await thirdPartySetting().set({ value: false });
    } else if (everywhereAvailable()) {
      await thirdPartySetting().clear({});
    }

    // Every rule at once, not one after another: with the trackers there
    // can be hundreds, and Chrome takes them in about a third of the time
    // this way. allSettled waits for all of them to finish, so a refused
    // rule can't still be arriving while the old rules are put back.
    await chrome.contentSettings.cookies.clear({});
    const results = await Promise.allSettled(
      chromeRulesFor(rules).map((rule) => chrome.contentSettings.cookies.set(rule))
    );
    const refused = results.find((result) => result.status === "rejected");
    if (refused) {
      return "Chrome wouldn't accept the rules: " + describe(refused.reason);
    }
    return null;
  } catch (error) {
    return "Chrome wouldn't accept the rules: " + describe(error);
  }
}

// What Chrome should answer for a cookie from `site`, and for one from
// another company, on `site`'s pages.
function expectedFor(rule) {
  if (rule === ALLOW) {
    return { own: "allow", other: "allow" };
  }
  if (rule === SESSION) {
    return { own: "session_only", other: "session_only" };
  }
  if (rule === OWN_ONLY) {
    return { own: "allow", other: "block" };
  }
  return { own: "block", other: "block" };
}

// Asks Chrome what it would do, and compares that with the saved rules.
// Returns true if they agree, false if not, and null if Chrome couldn't be
// asked. The popup uses this when it opens, to put the rules back if Chrome
// has lost them.
export async function rulesInForce(rules) {
  if (!rulesAvailable()) {
    return null;
  }

  // Each check is [who the cookie is from, the page it's on, what to expect].
  const checks = [];
  for (const { site, rule } of listRules(rules)) {
    const url = "https://" + site + "/";
    const expected = expectedFor(rule);
    // A tracker's own site set to clear on close: the tracker block is the
    // more specific rule, so Chrome blocks the tracker's cookies there.
    const own = rules.trackers && rule === SESSION && isTrackerSite(site) ? "block" : expected.own;
    checks.push([url, url, own]);
    checks.push([PROBE, url, expected.other]);
  }
  if (rules.everywhere === BLOCK) {
    checks.push([PROBE, PROBE, "block"]);
  }
  // One tracker is enough to tell whether Chrome still has the list, since
  // the rules are all set together and lost together.
  if (rules.trackers && TRACKER_DOMAINS.length > 0) {
    const tracker = "https://" + TRACKER_DOMAINS[0] + "/";
    checks.push([tracker, PROBE, "block"]);
    if (allowedOnOwnSite(rules, TRACKER_DOMAINS[0])) {
      checks.push([tracker, tracker, "allow"]);
    }
    const allowed = listRules(rules).find((entry) => entry.rule === ALLOW);
    if (allowed) {
      checks.push([tracker, "https://" + allowed.site + "/", "allow"]);
    }
  }

  try {
    // Asked all at once, since this runs each time the popup opens and the
    // answers don't depend on each other.
    const answers = await Promise.all(
      checks.map(([primaryUrl, secondaryUrl]) => chrome.contentSettings.cookies.get({ primaryUrl, secondaryUrl }))
    );
    for (let i = 0; i < checks.length; i++) {
      const expected = checks[i][2];
      if (!answers[i] || answers[i].setting !== expected) {
        return false;
      }
    }
    if (rules.everywhere === OWN_ONLY) {
      const status = await thirdPartyStatus();
      if (!status || status.allowed || !status.ours) {
        return false;
      }
    }
    return true;
  } catch (error) {
    console.warn("Couldn't check the site rules:", error);
    return null;
  }
}

// Every change goes through here: save, then tell Chrome. If Chrome refuses,
// both copies are put back as they were, so what's saved and what Chrome is
// doing never disagree. Returns { rules, error }.
async function changeRules(change) {
  const { rules: before, error } = await loadRules();
  if (error) {
    return { rules: before, error };
  }

  const after = tidy(JSON.parse(JSON.stringify(before)));
  change(after);

  const saveError = await saveRules(after);
  if (saveError) {
    return { rules: before, error: saveError };
  }

  const applyError = await applyRules(after);
  if (applyError) {
    await saveRules(before);
    await applyRules(before);
    return { rules: before, error: applyError };
  }

  return { rules: after, error: null };
}

// Sets the rule for a site. Choosing the same thing as "every other site"
// removes the site's own rule, since it no longer needs one. The exception
// is "Allow all cookies" while trackers are blocked: that rule is what lets
// the trackers through on this site.
//
// Rules for its subdomains are removed too. Otherwise a rule for
// example.com and another for shop.example.com could pull against each
// other, and what Chrome did would be hard to explain.
export async function setSiteRule(site, choice) {
  return await changeRules((rules) => {
    for (const other of Object.keys(rules.sites)) {
      if (other !== site && covers(site, other)) {
        delete rules.sites[other];
      }
    }
    if (choice === rules.everywhere && !(choice === ALLOW && rules.trackers)) {
      delete rules.sites[site];
    } else {
      rules.sites[site] = choice;
    }
  });
}

export async function removeSiteRule(site) {
  return await changeRules((rules) => {
    delete rules.sites[site];
  });
}

// The rule for every site without one of its own.
export async function setEverywhere(choice) {
  return await changeRules((rules) => {
    rules.everywhere = EVERYWHERE_CHOICES.includes(choice) ? choice : ALLOW;
  });
}

// Whether blocking a site also deletes the cookies it already has, without
// asking each time.
export async function setDeleteOnBlock(on) {
  return await changeRules((rules) => {
    rules.deleteOnBlock = on === true;
  });
}

// Whether known trackers' cookies are blocked on every site.
export async function setTrackers(on) {
  return await changeRules((rules) => {
    rules.trackers = on === true;
  });
}

// Turns everything off: no site rules, no trackers blocked, and cookies
// allowed everywhere. "Always delete" is a preference rather than a rule,
// so it stays.
export async function clearRules() {
  return await changeRules((rules) => {
    rules.everywhere = ALLOW;
    rules.sites = {};
    rules.trackers = false;
  });
}

// --- backing up the rules ---------------------------------------------------
//
// A small JSON file the user saves themselves, and can load on another
// computer. It holds exactly what's saved here: site names and rules, and
// the two settings. Copies saved before 1.8 have no "trackers", so they
// load with it off.

const BACKUP_KIND = "cookieZ site rules";

export function rulesToBackup(rules) {
  return JSON.stringify(
    {
      kind: BACKUP_KIND,
      version: 1,
      everywhere: rules.everywhere,
      deleteOnBlock: rules.deleteOnBlock,
      trackers: rules.trackers,
      sites: rules.sites,
    },
    null,
    2
  );
}

// Reads a backup file's text. Returns { rules, error }.
export function rulesFromBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { rules: null, error: "That file isn't a cookieZ rules backup: it isn't JSON." };
  }
  if (!data || data.kind !== BACKUP_KIND) {
    return { rules: null, error: "That file isn't a cookieZ rules backup." };
  }
  return { rules: tidy(data), error: null };
}

// Replaces every rule with the ones from a backup.
export async function replaceRules(incoming) {
  return await changeRules((rules) => {
    rules.everywhere = incoming.everywhere;
    rules.sites = { ...incoming.sites };
    rules.deleteOnBlock = incoming.deleteOnBlock;
    rules.trackers = incoming.trackers;
  });
}
