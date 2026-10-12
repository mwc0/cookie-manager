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
// What's saved is site names and the rule for each. Never cookies, never
// values. store/PRIVACY.md says so, so change it there too if this changes.
//
// All of this needs the optional "contentSettings" permission, which is
// asked for on the rules screen. See permissions.js.

import { baseHostOf } from "./cookies.js";

const STORAGE_KEY = "siteRules";

// The three choices for a site. "Every other site" is ALLOW or BLOCK.
export const ALLOW = "allow";
export const OWN_ONLY = "own-only";
export const BLOCK = "block";

const SITE_CHOICES = [ALLOW, OWN_ONLY, BLOCK];
const ALL_URLS = "<all_urls>";

// A made-up address, for asking Chrome what it would do with a cookie from
// "some other company". Nothing is ever sent to it.
const PROBE = "https://cookiez-probe.invalid/";

function emptyRules() {
  return { everywhere: ALLOW, sites: {} };
}

function describe(error) {
  return error && error.message ? error.message : String(error);
}

// Whatever was in storage, as { everywhere, sites } with nothing unexpected
// in it. Anything this file didn't write is dropped.
function tidy(stored) {
  const rules = emptyRules();
  if (!stored || typeof stored !== "object") {
    return rules;
  }
  if (stored.everywhere === BLOCK) {
    rules.everywhere = BLOCK;
  }
  if (stored.sites && typeof stored.sites === "object") {
    for (const [site, rule] of Object.entries(stored.sites)) {
      if (site && SITE_CHOICES.includes(rule)) {
        rules.sites[site] = rule;
      }
    }
  }
  return rules;
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
  return rules.everywhere === BLOCK || Object.keys(rules.sites).length > 0;
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

// Turns the saved rules into the rules Chrome understands.
//
// Chrome's cookie rules have two patterns: who the cookie is from (primary),
// and which site's pages it's being used on (secondary). The more specific
// rule wins, and that is what makes "own-only" work: a general "block
// everyone on this site's pages" and a narrower "but allow the site itself".
//
// This is checked against a real browser in tests/test_rules.py.
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

  return out;
}

// False until the permission has been given. Chrome only adds
// chrome.contentSettings to the page once it has.
export function rulesAvailable() {
  return Boolean(chrome.contentSettings && chrome.contentSettings.cookies);
}

// Makes Chrome's copy match `rules`. Returns an error message, or null.
export async function applyRules(rules) {
  if (!rulesAvailable()) {
    return "Chrome hasn't given cookieZ permission to set rules.";
  }
  try {
    await chrome.contentSettings.cookies.clear({});
    for (const rule of chromeRulesFor(rules)) {
      await chrome.contentSettings.cookies.set(rule);
    }
    return null;
  } catch (error) {
    return "Chrome wouldn't accept the rules: " + describe(error);
  }
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
    checks.push([url, url, rule === BLOCK ? "block" : "allow"]);
    checks.push([PROBE, url, rule === ALLOW ? "allow" : "block"]);
  }
  if (rules.everywhere === BLOCK) {
    checks.push([PROBE, PROBE, "block"]);
  }

  try {
    for (const [primaryUrl, secondaryUrl, expected] of checks) {
      const answer = await chrome.contentSettings.cookies.get({ primaryUrl, secondaryUrl });
      if (!answer || answer.setting !== expected) {
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
// removes the site's own rule, since it no longer needs one.
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
    if (choice === rules.everywhere) {
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

// The rule for every site without one of its own: ALLOW or BLOCK.
export async function setEverywhere(choice) {
  return await changeRules((rules) => {
    rules.everywhere = choice === BLOCK ? BLOCK : ALLOW;
  });
}

// Turns everything off: no site rules, and cookies allowed everywhere.
export async function clearRules() {
  return await changeRules((rules) => {
    rules.everywhere = ALLOW;
    rules.sites = {};
  });
}
