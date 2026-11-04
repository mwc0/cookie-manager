// Text in the user's language. Every sentence cookieZ shows is in
// src/_locales/<language>/messages.json, under a key. Chrome picks the
// language from the browser's own and falls back to en_GB, the default
// in manifest.json. There is no setting for it in cookieZ.
//
// The popup page's fixed text is filled in by popup/translate-page.js. This
// file is for text made in JavaScript.

// t("deletedOne", name) returns the message with $1 replaced by name, $2 by
// the next value, and so on. A missing key is a bug, so it's logged (the
// tests fail on any console error) and the key itself is shown, never a
// blank.
export function t(key, ...values) {
  const text = chrome.i18n.getMessage(key, values.map(String));
  if (!text) {
    console.error("cookieZ: no message for " + key);
    return key;
  }
  return text;
}

// For a sentence with a number in it. Languages count differently ("1
// cookie", "2 cookies"; Japanese has one form; others have more), so each
// form is its own message: key_one, key_other, and key_few or key_many
// where a language needs them. Intl.PluralRules says which form a number
// takes. $1 is the number, formatted for the language; $2 onwards are
// any other values. A form a language doesn't define falls back to
// key_other.
const PLURAL = new Intl.PluralRules(chrome.i18n.getUILanguage());
const COUNT = new Intl.NumberFormat(chrome.i18n.getUILanguage());

export function tn(key, count, ...values) {
  const form = key + "_" + PLURAL.select(count);
  const all = [COUNT.format(count), ...values].map(String);
  return chrome.i18n.getMessage(form, all) || t(key + "_other", ...all);
}
