// Password-protected exports. Locks an export with a password, and opens it
// again, using only the browser's own Web Crypto. Nothing is sent anywhere,
// and the password is never saved: it's used once and forgotten.
//
// How it works, for anyone checking:
//   - PBKDF2 with SHA-256 and 600,000 rounds turns the password and a random
//     16-byte salt into a 256-bit key. The rounds are what make guessing
//     passwords slow, which is also why locking takes a moment.
//   - AES-GCM encrypts the export with that key and a random 12-byte IV.
//     GCM also notices any change to the locked data, so a wrong password
//     and an altered file both fail to open, rather than giving nonsense.
//
// A locked file is JSON, so its owner can tell what it is:
//   {
//     "kind": "cookieZ encrypted export",
//     "version": 1,
//     "kdf": "PBKDF2-SHA-256",
//     "iterations": 600000,
//     "salt": "<base64>",
//     "iv": "<base64>",
//     "data": "<base64>"
//   }
// "data" is the export's text (JSON, cookies.txt and so on), encrypted.

export const LOCKED_KIND = "cookieZ encrypted export";
const VERSION = 1;
const KDF = "PBKDF2-SHA-256";
const ITERATIONS = 600000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

// A damaged or doctored file could ask for billions of rounds and freeze
// the popup, so anything above this is treated as damaged.
const MOST_ITERATIONS = 10000000;

// Whether `text` is a locked export. It only looks for the label, so a
// file that's been cut short is still recognised, and readLockedFile() can
// say it's damaged rather than "this isn't JSON".
export function isLockedExport(text) {
  const trimmed = String(text || "").trim();
  return trimmed.startsWith("{") && trimmed.includes('"' + LOCKED_KIND + '"');
}

// Locks `text` with `password`. Returns the locked file as a string.
export async function lockText(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, ITERATIONS);
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(text)
  );

  const file = {
    kind: LOCKED_KIND,
    version: VERSION,
    kdf: KDF,
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(data)),
  };
  return JSON.stringify(file, null, 2);
}

// Reads a locked file without opening it, to check it's whole. Returns
// { file } with the salt, IV and data as bytes, or { error } with a
// sentence saying what's wrong.
export function readLockedFile(text) {
  const damaged = {
    error:
      "This password-protected file is damaged, so it can't be opened. " +
      "If you still have the cookies, export them again.",
  };

  let parsed;
  try {
    parsed = JSON.parse(String(text || "").trim());
  } catch (error) {
    return damaged;
  }
  if (!parsed || typeof parsed !== "object" || parsed.kind !== LOCKED_KIND) {
    return damaged;
  }
  if (typeof parsed.version === "number" && parsed.version > VERSION) {
    return {
      error: "This file was made by a newer version of cookieZ. Update cookieZ to open it.",
    };
  }
  if (parsed.version !== VERSION || parsed.kdf !== KDF) {
    return damaged;
  }
  if (
    !Number.isInteger(parsed.iterations) ||
    parsed.iterations < 1 ||
    parsed.iterations > MOST_ITERATIONS
  ) {
    return damaged;
  }

  const salt = fromBase64(parsed.salt);
  const iv = fromBase64(parsed.iv);
  const data = fromBase64(parsed.data);
  // GCM adds a 16-byte check to the data, so anything shorter is broken.
  if (!salt || !iv || !data || salt.length !== SALT_BYTES || iv.length !== IV_BYTES || data.length < 16) {
    return damaged;
  }
  return { file: { iterations: parsed.iterations, salt, iv, data } };
}

// Opens a locked file. Returns { ok: true, text } or { ok: false, error }.
// Never throws.
export async function unlockText(text, password) {
  const { file, error } = readLockedFile(text);
  if (error) {
    return { ok: false, error };
  }

  let key;
  try {
    key = await deriveKey(password, file.salt, file.iterations);
  } catch (problem) {
    return { ok: false, error: "The file couldn't be opened: " + describe(problem) };
  }

  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: file.iv }, key, file.data);
    return { ok: true, text: new TextDecoder().decode(plain) };
  } catch (problem) {
    // AES-GCM can't tell a wrong password from a file that's been changed:
    // both fail its check in the same way. A wrong password is far more
    // likely, so that comes first.
    return {
      ok: false,
      error:
        "That password doesn't open this file. Check it and try again. " +
        "If you're sure it's right, the file has been changed or damaged since it was saved.",
    };
  }
}

// The password and salt, stretched into an AES key by PBKDF2.
async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Bytes as base64 text, and back. fromBase64 returns null for text that
// isn't base64.
function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(text) {
  if (typeof text !== "string") {
    return null;
  }
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (error) {
    return null;
  }
}

function describe(error) {
  return error && error.message ? error.message : String(error);
}
