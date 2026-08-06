// Verschluesselungs-Wrapper (Web Crypto API): PBKDF2-Schluesselableitung + AES-GCM.
// Die Passphrase selbst wird nirgends gespeichert, nur der abgeleitete CryptoKey
// haelt db.js waehrend der Sitzung im Speicher (siehe dortige Sperr-Logik).

const PBKDF2_ITERATIONS = 250000;

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function generateSaltB64() {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return toBase64(salt);
}

export async function deriveKey(passphrase, saltB64) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(saltB64), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

/** Wirft bei falscher Passphrase/falschem Schluessel (AES-GCM Auth-Tag schlaegt fehl). */
export async function decryptJson(key, ivB64, ciphertextB64) {
  const dec = new TextDecoder();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(ivB64) }, key, fromBase64(ciphertextB64));
  return JSON.parse(dec.decode(plain));
}
