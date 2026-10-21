// What more than one of the popup's files reads and changes: the page being
// shown, the Kept list, what the delete panel will delete, and so on. It's
// one object because a file can't change a variable that belongs to another
// file, but it can change a field on an object they share.

export const state = {
  // The site in the current tab, as { origin, hostname }.
  page: null,

  // What has happened to this site's cookies while cookieZ has been open,
  // newest first, for the "What changed" screen: { at, name, domain, what }.
  // Names only, never values. In memory only, so it's gone when cookieZ
  // closes, and it starts again if the tab moves to another site.
  changeLog: [],

  // When a site changes a cookie, Chrome reports the old one being removed
  // and then the new one being set. This remembers the first half, so the
  // second can be listed as "Changed" and not "Added".
  overwritten: new Set(),

  // True while the editor is saving, so its own write isn't taken for the
  // site changing the cookie.
  saving: false,

  // The cookies the chosen scope will delete. The count on screen comes from
  // this same list, so the number shown always matches what gets deleted.
  scopeCookies: [],

  // Every cookie in the chosen scope, kept ones included. This is what Export
  // exports: keeping a cookie stops it being deleted, not copied.
  scopeAll: [],

  // The cookie open in the editor, or null for a new one. Saving needs the
  // original cookie, in case the name or path changed. See writeCookie().
  editing: null,

  // The cookies the user has marked as Kept. See src/lib/protect.js.
  protectedKeys: new Set(),

  // The cookies "Clear site data" will delete, counted when it asks.
  siteDataCookies: [],
};
