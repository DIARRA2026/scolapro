/**
 * =====================================================================
 * ScolaPro — Couche de Sécurité HTTP & Protection Web (lib/http-security.js)
 * Module pur : en-têtes de sécurité, liste blanche statique, anti-CSRF,
 * parsing sécurisé de cookies & rate limiting.
 * =====================================================================
 */

'use strict';

const path = require('node:path');

/**
 * Génère les en-têtes de sécurité HTTP durcis (OWASP / ANSSI).
 * Note : X-XSS-Protection est volontairement retiré car déprécié et vulnérable.
 * @param {boolean} isHtml
 * @param {boolean} isProduction
 * @returns {Record<string, string>}
 */
function securityHeaders(isHtml = false, isProduction = false) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'X-Permitted-Cross-Domain-Policies': 'none'
  };

  if (isProduction) {
    headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
  }

  if (isHtml) {
    // CONCESSION TECHNIQUE DOCUMENTÉE :
    // 'unsafe-inline' est conservé dans script-src tant que index.html embarque
    // ses ~16 000 lignes de JavaScript applicatif inline. Dès l'extraction vers des
    // modules compilés avec hachages (SHA-256) ou nonces, 'unsafe-inline' devra être supprimé.
    headers['Content-Security-Policy'] = [
      "default-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://cdn.tailwindcss.com"
    ].join('; ');
  }

  return headers;
}

/**
 * Valide l'origine d'une requête HTTP modificatrice (Anti-CSRF sans jeton).
 * Analyse Origin, Referer et Sec-Fetch-Site.
 * @param {import('http').IncomingMessage} req
 * @param {string[]} allowedOrigins
 * @returns {boolean}
 */
function checkRequestOrigin(req, allowedOrigins = []) {
  const method = req.method ? req.method.toUpperCase() : 'GET';
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return true;
  }

  // Vérification de métadonnées de navigation (Sec-Fetch-Site)
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') {
    return false;
  }

  const host = req.headers.host;
  const origin = req.headers.origin;

  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) return true;
      if (allowedOrigins.includes(origin)) return true;
      return false;
    } catch {
      return false;
    }
  }

  const referer = req.headers.referer;
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host === host) return true;
      if (allowedOrigins.includes(refererUrl.origin)) return true;
      return false;
    } catch {
      return false;
    }
  }

  // Si ni Origin ni Referer n'est transmis sur une requête mutatrice HTTP/1.1
  return false;
}

/**
 * Limitation de débit (RateLimiter) par fenêtre glissante en mémoire.
 * LIMITE ARCHITECTURALE CONNUE : En cas de passage à l'échelle horizontale (multi-instances),
 * ce limiteur local ne partage pas l'état entre serveurs sans Redis ou affinité de session.
 */
class RateLimiter {
  /**
   * @param {number} sweepIntervalMs
   */
  constructor(sweepIntervalMs = 60000) {
    this.hits = new Map();
    this.timer = setInterval(() => this.sweep(), sweepIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  /**
   * Enregistre et vérifie une tentative pour une clé donnée.
   * @param {string} key
   * @param {number} maxRequests
   * @param {number} windowMs
   * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
   */
  consume(key, maxRequests, windowMs) {
    const now = Date.now();
    let record = this.hits.get(key);

    if (!record || now > record.resetAt) {
      record = { count: 1, resetAt: now + windowMs };
      this.hits.set(key, record);
      return { allowed: true, remaining: maxRequests - 1, resetMs: windowMs };
    }

    record.count++;
    const allowed = record.count <= maxRequests;
    const remaining = Math.max(0, maxRequests - record.count);
    const resetMs = Math.max(0, record.resetAt - now);

    return { allowed, remaining, resetMs };
  }

  /**
   * Purge les clés expirées de la mémoire.
   */
  sweep() {
    const now = Date.now();
    for (const [key, record] of this.hits.entries()) {
      if (now > record.resetAt) {
        this.hits.delete(key);
      }
    }
  }

  /**
   * Arrête le timer d'arrière-plan.
   */
  destroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

/**
 * Fichiers et extensions statiques autorisés sur liste blanche stricte.
 */
const ALLOWED_STATIC_FILES = new Set([
  '/',
  '/index.html',
  '/login.html',
  '/inscription.html',
  '/config.js',
  '/favicon.ico',
  '/robots.txt'
]);

const ALLOWED_STATIC_EXTENSIONS = new Set([
  '.html',
  '.js',
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.ico',
  '.woff',
  '.woff2'
]);

/**
 * Fichiers et dossiers strictement confidentiels (rejet absolu).
 */
const FORBIDDEN_FILENAMES = new Set([
  'server.js',
  'db.js',
  'schema.sql',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'scolapro.db',
  'README.md',
  'PRODUCTION_GUIDE.md',
  'SECURITY.md',
  'vercel.json'
]);

/**
 * Valide si un chemin d'URL correspond à une ressource statique publique autorisée.
 * @param {string} reqPath
 * @returns {boolean}
 */
function isStaticAllowed(reqPath) {
  if (typeof reqPath !== 'string') return false;
  const normalized = path.posix.normalize(reqPath);

  if (ALLOWED_STATIC_FILES.has(normalized)) return true;

  const baseName = path.posix.basename(normalized);
  if (baseName.startsWith('.') || FORBIDDEN_FILENAMES.has(baseName)) {
    return false;
  }
  if (normalized.includes('/tests/') || normalized.includes('/lib/') || normalized.includes('/scripts/')) {
    return false;
  }

  const ext = path.posix.extname(normalized).toLowerCase();
  return ALLOWED_STATIC_EXTENSIONS.has(ext);
}

/**
 * Résout le chemin absolu d'un fichier statique avec protection étanche anti-traversée.
 * Utilise 'baseDir + path.sep' pour interdire les accès aux répertoires frères.
 * @param {string} reqPath
 * @param {string} baseDir
 * @returns {string|null} Chemin absolu ou null en cas de violation
 */
function resolveStaticPath(reqPath, baseDir) {
  if (!isStaticAllowed(reqPath)) return null;

  let cleanPath = reqPath;
  if (cleanPath === '/' || cleanPath === '') {
    cleanPath = '/index.html';
  }

  const absoluteBase = path.resolve(baseDir);
  const resolved = path.resolve(absoluteBase, '.' + cleanPath);

  // Vérification stricte avec séparateur système (évite la faille base-backup)
  const safePrefix = absoluteBase.endsWith(path.sep) ? absoluteBase : absoluteBase + path.sep;
  if (resolved !== absoluteBase && !resolved.startsWith(safePrefix)) {
    return null;
  }

  const fileName = path.basename(resolved);
  if (fileName.startsWith('.') || FORBIDDEN_FILENAMES.has(fileName)) {
    return null;
  }

  return resolved;
}

/**
 * Analyse les cookies HTTP entrants sur un objet exempt de prototype (Object.create(null))
 * pour immuniser l'application contre toute pollution de prototype via __proto__.
 * @param {import('http').IncomingMessage} req
 * @returns {Record<string, string>}
 */
function parseCookies(req) {
  const list = Object.create(null);
  const rc = req.headers.cookie;
  if (!rc) return list;

  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      const key = parts.shift().trim();
      const val = parts.join('=').trim();
      if (key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
        try {
          list[key] = decodeURIComponent(val);
        } catch {
          list[key] = val;
        }
      }
    }
  });

  return list;
}

/**
 * Construit l'en-tête Set-Cookie pour une session utilisateur.
 * Utilise le préfixe __Host- en production avec les drapeaux HttpOnly, Secure, SameSite=Strict.
 * @param {string} token
 * @param {boolean} isProduction
 * @param {number} maxAgeSeconds
 * @returns {string}
 */
function formatSessionCookie(token, isProduction = false, maxAgeSeconds = 86400) {
  const cookieName = isProduction ? '__Host-scolapro_session' : 'scolapro_session';
  const parts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`
  ];

  if (isProduction) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Construit l'en-tête de révocation de cookie de session.
 * @param {boolean} isProduction
 * @returns {string}
 */
function formatClearSessionCookie(isProduction = false) {
  const cookieName = isProduction ? '__Host-scolapro_session' : 'scolapro_session';
  const parts = [
    `${cookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0'
  ];

  if (isProduction) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Nettoie un objet JSON de toute tentative de pollution de prototype.
 * @param {any} obj
 * @returns {any}
 */
function sanitizeObject(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);

  const clean = Object.create(null);
  for (const [key, val] of Object.entries(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    clean[key] = sanitizeObject(val);
  }
  return clean;
}

/**
 * Lit et analyse un corps de requête JSON avec plafond strict en octets (512 Kio).
 * Rejette les requêtes dépassant le plafond, les tableaux ou primitives en racine.
 * @param {import('http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<Record<string, any>>}
 */
function readJsonBody(req, maxBytes = 524288) {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks = [];

    req.on('data', chunk => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.removeAllListeners('data');
        req.resume();
        const err = new Error('Charge utile trop volumineuse (limite stricte 512 Kio).');
        err.status = 413;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        return resolve(Object.create(null));
      }
      try {
        const rawBuffer = Buffer.concat(chunks);
        const parsed = JSON.parse(rawBuffer.toString('utf8'));

        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          const err = new Error('Le corps de la requête doit être un objet JSON.');
          err.status = 400;
          return reject(err);
        }

        resolve(sanitizeObject(parsed));
      } catch (e) {
        const err = new Error('Format JSON invalide.');
        err.status = 400;
        reject(err);
      }
    });

    req.on('error', reject);
  });
}

/**
 * Échappement HTML contextuel strict (prévention XSS).
 * @param {any} value
 * @returns {string}
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Nettoie et borne un texte libre en éliminant les caractères non imprimables.
 * @param {any} val
 * @param {number} maxLength
 * @returns {string}
 */
function sanitizeText(val, maxLength = 255) {
  if (val === null || val === undefined) return '';
  const str = String(val).trim().replace(/[\x00-\x1F\x7F]/g, '');
  return str.slice(0, maxLength);
}

module.exports = {
  securityHeaders,
  checkRequestOrigin,
  RateLimiter,
  isStaticAllowed,
  resolveStaticPath,
  parseCookies,
  formatSessionCookie,
  formatClearSessionCookie,
  readJsonBody,
  escapeHtml,
  sanitizeText,
  ALLOWED_STATIC_FILES,
  ALLOWED_STATIC_EXTENSIONS,
  FORBIDDEN_FILENAMES
};
