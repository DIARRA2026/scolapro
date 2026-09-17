/**
 * =====================================================================
 * ScolaPro — Noyau Cryptographique & Authentification (lib/auth.js)
 * Module pur : aucune dépendance externe, aucun accès base de données.
 * Conforme : Node >= 22.5.0 (node:crypto)
 * =====================================================================
 */

'use strict';

const crypto = require('node:crypto');

// Paramètres de référence Scrypt (OWASP / ANSSI)
const SCRYPT_CONFIG = {
  N: 32768, // Coût mémoire et CPU (2^15)
  r: 8,     // Taille de bloc
  p: 1,     // Parallélisme
  keylen: 64, // Longueur de la clé dérivée en octets
  maxmem: 64 * 1024 * 1024 // 64 Mo
};

const SALT_BYTE_LENGTH = 16;

/**
 * Valide la politique de robustesse des mots de passe.
 * Règles : Au moins 12 caractères, 1 majuscule, 1 minuscule, 1 chiffre.
 * @param {string} password
 * @returns {{ valid: boolean, message?: string }}
 */
function validatePasswordPolicy(password) {
  if (typeof password !== 'string') {
    return { valid: false, message: 'Le mot de passe doit être une chaîne de caractères.' };
  }
  if (password.length < 12) {
    return { valid: false, message: 'Le mot de passe doit comporter au moins 12 caractères.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Le mot de passe doit comporter au moins une lettre majuscule.' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Le mot de passe doit comporter au moins une lettre minuscule.' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Le mot de passe doit comporter au moins un chiffre.' };
  }
  return { valid: true };
}

/**
 * Hache un mot de passe avec l'algorithme Scrypt.
 * Format stocké : scrypt$N$r$p$saltB64$hashB64
 * @param {string} password
 * @returns {Promise<string>}
 */
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    if (typeof password !== 'string' || password.length === 0) {
      return reject(new Error('Mot de passe invalide pour le hachage.'));
    }
    const salt = crypto.randomBytes(SALT_BYTE_LENGTH);
    crypto.scrypt(
      password,
      salt,
      SCRYPT_CONFIG.keylen,
      { N: SCRYPT_CONFIG.N, r: SCRYPT_CONFIG.r, p: SCRYPT_CONFIG.p, maxmem: SCRYPT_CONFIG.maxmem },
      (err, derivedKey) => {
        if (err) return reject(err);
        const saltB64 = salt.toString('base64');
        const hashB64 = derivedKey.toString('base64');
        resolve(`scrypt$${SCRYPT_CONFIG.N}$${SCRYPT_CONFIG.r}$${SCRYPT_CONFIG.p}$${saltB64}$${hashB64}`);
      }
    );
  });
}

/**
 * Vérifie un mot de passe en temps constant. Ne lève jamais d'exception.
 * @param {string} password
 * @param {string} storedHash
 * @returns {Promise<boolean>}
 */
function verifyPassword(password, storedHash) {
  return new Promise((resolve) => {
    if (typeof password !== 'string' || typeof storedHash !== 'string') {
      return resolve(false);
    }
    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
      return resolve(false);
    }
    const N = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);
    const saltB64 = parts[4];
    const hashB64 = parts[5];

    if (isNaN(N) || isNaN(r) || isNaN(p) || !saltB64 || !hashB64) {
      return resolve(false);
    }

    try {
      const salt = Buffer.from(saltB64, 'base64');
      const expectedKey = Buffer.from(hashB64, 'base64');
      if (expectedKey.length === 0 || salt.length === 0) {
        return resolve(false);
      }

      crypto.scrypt(
        password,
        salt,
        expectedKey.length,
        { N, r, p, maxmem: SCRYPT_CONFIG.maxmem },
        (err, derivedKey) => {
          if (err) return resolve(false);
          try {
            if (derivedKey.length !== expectedKey.length) return resolve(false);
            const matches = crypto.timingSafeEqual(derivedKey, expectedKey);
            resolve(matches);
          } catch {
            resolve(false);
          }
        }
      );
    } catch {
      resolve(false);
    }
  });
}

/**
 * Détermine si une empreinte stockée nécessite d'être recalculée avec des paramètres durcis.
 * @param {string} storedHash
 * @returns {boolean}
 */
function needsRehash(storedHash) {
  if (typeof storedHash !== 'string') return true;
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  const N = parseInt(parts[1], 10);
  const r = parseInt(parts[2], 10);
  const p = parseInt(parts[3], 10);
  const hashB64 = parts[5];
  try {
    const keylen = Buffer.from(hashB64, 'base64').length;
    return N !== SCRYPT_CONFIG.N || r !== SCRYPT_CONFIG.r || p !== SCRYPT_CONFIG.p || keylen !== SCRYPT_CONFIG.keylen;
  } catch {
    return true;
  }
}

/**
 * Calcule l'empreinte SHA-256 en hexadécimal d'un jeton de session.
 * @param {string} token
 * @returns {string}
 */
function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Génère un jeton de session cryptographique aléatoire de 32 octets (base64url).
 * Retourne le jeton à transmettre au client et son empreinte SHA-256 seule à persister.
 * @returns {{ token: string, tokenHash: string }}
 */
function generateSessionToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(token);
  return { token, tokenHash };
}

/**
 * Génère un mot de passe temporaire robuste de 16 caractères sans ambiguïté visuelle.
 * Exclut I, l, O, 0, 1. Utilise Fisher-Yates avec source cryptographique.
 * Respecte strictement la politique de robustesse des mots de passe.
 * @returns {string}
 */
function generateTemporaryPassword() {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Sans I, O
  const lowercase = 'abcdefghijkmnopqrstuvwxyz'; // Sans l
  const digits = '23456789';                   // Sans 0, 1
  const symbols = '!@#$%&*+-_=';
  const allChars = uppercase + lowercase + digits + symbols;

  const chars = [
    uppercase[crypto.randomInt(0, uppercase.length)],
    lowercase[crypto.randomInt(0, lowercase.length)],
    digits[crypto.randomInt(0, digits.length)],
    symbols[crypto.randomInt(0, symbols.length)]
  ];

  while (chars.length < 16) {
    chars.push(allChars[crypto.randomInt(0, allChars.length)]);
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const temp = chars[i];
    chars[i] = chars[j];
    chars[j] = temp;
  }

  return chars.join('');
}

module.exports = {
  SCRYPT_CONFIG,
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
  needsRehash,
  hashSessionToken,
  generateSessionToken,
  generateTemporaryPassword
};
