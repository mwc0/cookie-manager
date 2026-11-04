// Puts the popup's fixed text into the user's language. Not a module and
// placed just before popup.js, so it runs while the page is still loading
// and nobody sees the English first.
//
// In popup.html an element says which message it takes:
//   data-i18n="key"             its text
//   data-i18n-html="key"        its contents, for messages with <strong>,
//                               <code> or <kbd> in them. Only messages from
//                               our own _locales files ever go in here.
//   data-i18n-title, data-i18n-aria-label, data-i18n-placeholder
//                               that attribute
// See src/lib/i18n.js for text made in JavaScript.

(() => {
  const get = (key) => {
    const text = chrome.i18n.getMessage(key);
    if (!text) console.error("cookieZ: no message for " + key);
    return text || key;
  };

  document.documentElement.lang = chrome.i18n.getUILanguage();

  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = get(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll("[data-i18n-html]")) {
    element.innerHTML = get(element.dataset.i18nHtml);
  }
  for (const attribute of ["title", "aria-label", "placeholder"]) {
    const name = "data-i18n-" + attribute;
    for (const element of document.querySelectorAll("[" + name + "]")) {
      element.setAttribute(attribute, get(element.getAttribute(name)));
    }
  }
})();
