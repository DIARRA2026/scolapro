/**
 * =====================================================================
 * ScolaPro — Noyau Serveur HTTP & Passerelle de Sécurité (server.js)
 * Architecture : Node.js natif (http, fs, path, crypto, node:sqlite)
 * Zéro dépendance d'exécution externe (Pas d'express, pas de helmet)
 * Conforme : OWASP Top 10, APDP, ISO 27001 & SYSCOHADA
 * =====================================================================
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const db = require('./db.js');
const auth = require('./lib/auth.js');
const { AccessError, ROLES, assertRank } = require('./lib/rbac.js');
const {
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
  sanitizeText
} = require('./lib/http-security.js');

// ---------------------------------------------------------------------
// CONFIGURATION D'ENVIRONNEMENT
// ---------------------------------------------------------------------


// ---------------------------------------------------------------------
// SYNCHRONISATION SUPABASE CLOUD (Multi-Tenant BaaS)
// ---------------------------------------------------------------------

async function syncToSupabase(table, record) {
  const rawUrl = process.env.SUPABASE_URL || '';
  let rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  rawKey = rawKey.replace(/^["']|["']$/g, '').trim();
  if (!rawKey || rawKey.startsWith('your-') || rawKey.length < 50) {
    rawKey = (process.env.SUPABASE_ANON_KEY || '').replace(/^["']|["']$/g, '').trim();
  }
  const sbUrl = rawUrl.replace(/^["']|["']$/g, '').trim();
  const sbKey = rawKey;
  if (!sbUrl || !sbKey || sbUrl.includes('your-project') || sbKey.startsWith('your-')) return;

  try {
    const endpoint = `${sbUrl.replace(/\/$/, '')}/rest/v1/${table}`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal,resolution=merge-duplicates'
      },
      body: JSON.stringify(record)
    });
    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => '');
      console.warn(`[Supabase Sync] Note table ${table} (${resp.status}):`, errTxt);
    }
  } catch (err) {
    console.warn(`[Supabase Sync] Échec synchro table ${table}:`, err.message);
  }
}

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!process.env[key] || process.env[key].startsWith('"')) {
              process.env[key] = val;
            }
          }
        }
      });
      console.log(`[Config] Fichier d'environnement .env chargé avec succès.`);
    } catch (e) {
      console.warn(`[Config] Avertissement : Impossible de lire ${envPath} :`, e.message);
    }
  }
}

loadEnvFile();

const PORT = parseInt(process.env.PORT || '3005', 10);
const PUBLIC_DIR = __dirname;
const isProduction = process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

// Limiteurs de débit en mémoire
const globalLimiter = new RateLimiter(60000);
const writeLimiter = new RateLimiter(60000);
const loginLimiter = new RateLimiter(60000);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// ---------------------------------------------------------------------
// GESTION DES RÉPONSES & ERREURS CENTRALISÉES
// ---------------------------------------------------------------------

function sendJson(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...securityHeaders(false, isProduction),
    ...headers
  });
  res.end(JSON.stringify(data));
}

function sendError(res, err, defaultStatus = 500) {
  const status = (err && typeof err.status === 'number') ? err.status : defaultStatus;
  const isClientError = status >= 400 && status < 500;

  if (!isClientError) {
    console.error('[Erreur Serveur 5xx] :', err);
  }

  const clientMessage = isClientError ? (err.message || 'Requête invalide.') : 'Erreur interne du serveur.';
  const code = (err && err.code) || (isClientError ? 'CLIENT_ERROR' : 'INTERNAL_ERROR');

  sendJson(res, status, {
    success: false,
    error: clientMessage,
    code
  });
}

/**
 * Authentifie une requête en lisant exclusivement le cookie de session serveur.
 * Toute tentative de fournir une identité via header, paramètre d'URL ou cookie non signé est ignorée.
 * @param {http.IncomingMessage} req
 * @returns {object|null}
 */
function authenticate(req) {
  const cookies = parseCookies(req);
  const token = cookies['__Host-scolapro_session'] || cookies['scolapro_session'];
  if (!token) return null;
  return db.getSessionUser(token);
}

/**
 * Rendu sécurisé de la page d'interdiction HTTP 403.
 * Échappe TOUTES les interpolations contextuellement.
 */
function render403Page(title, message, user, requiredLevel) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safePrenom = escapeHtml(user.prenom);
  const safeNom = escapeHtml(user.nom);
  const safeId = escapeHtml(user.id);
  const safeRoleLabel = escapeHtml(user.roleLabel);
  const safeRequiredLevel = escapeHtml(requiredLevel);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>403 - Accès Refusé | ScolaPro Isolation</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #0f0406; color: #f1f5f9; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .card { max-width: 34rem; width: 100%; background: #1b0609; border: 2px solid rgba(239, 68, 68, 0.4); border-radius: 1.5rem; padding: 2rem; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8); }
    .icon { width: 5rem; height: 5rem; margin: 0 auto 1.5rem; border-radius: 1rem; background: rgba(127, 29, 29, 0.8); border: 1px solid rgba(239, 68, 68, 0.5); display: flex; align-items: center; justify-content: center; font-size: 2.5rem; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.4); font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; font-weight: 900; color: #fff; margin-bottom: 0.5rem; }
    p { font-size: 0.875rem; color: #fecdd3; line-height: 1.5; margin-bottom: 1.5rem; }
    .details { background: rgba(0,0,0,0.4); border: 1px solid rgba(153, 27, 27, 0.5); border-radius: 1rem; padding: 1rem; text-align: left; font-size: 0.75rem; margin-bottom: 1.5rem; }
    .row { display: flex; justify-content: space-between; align-items: center; padding-bottom: 0.5rem; margin-bottom: 0.5rem; border-bottom: 1px solid rgba(153, 27, 27, 0.3); }
    .row:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .label { color: #fda4af; font-weight: 700; text-transform: uppercase; font-size: 0.65rem; }
    .val { color: #facc15; font-weight: 700; }
    .btn { display: inline-block; padding: 0.75rem 1.5rem; border-radius: 0.75rem; background: #dc2626; color: #fff; text-decoration: none; font-weight: 700; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🛡️</div>
    <div class="badge">HTTP 403 FORBIDDEN &bull; ISOLATION MULTI-TENANT</div>
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    <div class="details">
      <div class="row">
        <span class="label">Identité Active</span>
        <span class="val">${safePrenom} ${safeNom} (ID: ${safeId})</span>
      </div>
      <div class="row">
        <span class="label">Rôle & Périmètre</span>
        <span style="color:#fff; font-weight:600;">${safeRoleLabel}</span>
      </div>
      <div class="row">
        <span class="label">Niveau Requis</span>
        <span style="background:rgba(153,27,27,0.6); padding:0.1rem 0.4rem; border-radius:0.25rem; color:#fecdd3; font-family:monospace;">${safeRequiredLevel}</span>
      </div>
      <div class="row">
        <span class="label">Politique</span>
        <span style="color:#fb7185; font-style:italic;">Confinement hermétique N1 &rarr; N2 &rarr; N3</span>
      </div>
    </div>
    <a href="/school" class="btn">&larr; Retourner à mon Espace École</a>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------
// ROUTEUR HTTP CENTRAL
// ---------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let reqPath = parsedUrl.pathname || '/';
  const queryParams = Object.fromEntries(parsedUrl.searchParams.entries());
  const method = req.method ? req.method.toUpperCase() : 'GET';
  const clientIp = req.socket.remoteAddress || '127.0.0.1';

  // 1. Limitation de débit globale (600 req / min par IP)
  const isTest = process.env.NODE_ENV === 'test';
  const globalCheck = globalLimiter.consume(clientIp, isTest ? 5000 : 600, 60000);
  if (!globalCheck.allowed) {
    return sendError(res, new Error("Trop de requêtes. Veuillez ralentir vos appels."), 429);
  }

  // 2. Routes publiques directes (Sans authentification requise)
  if (reqPath === '/health' || reqPath === '/api/health') {
    return sendJson(res, 200, {
      status: 'UP',
      name: 'ScolaPro',
      version: '2.5.0',
      database: { status: 'connected' },
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  }

  if (reqPath === '/api/config') {
    // Configuration publique exposée sans aucune clé secrète
    return sendJson(res, 200, {
      platformName: 'ScolaPro',
      academicYear: '2026-2027',
      currency: 'XOF',
      environment: isProduction ? 'production' : 'development'
    });
  }

  // 3. Authentification : Connexion publique (/api/auth/login)
  if (reqPath === '/api/auth/login' && method === 'POST') {
    // Rate limit sur la connexion : 10 tentatives / 15 minutes par IP (étendu en test)
    const loginCheck = loginLimiter.consume(clientIp, isTest ? 1000 : 10, 15 * 60 * 1000);
    if (!loginCheck.allowed) {
      return sendError(res, new Error("Trop de tentatives de connexion échouées. Veuillez patienter 15 minutes."), 429);
    }

    try {
      const body = await readJsonBody(req);
      const identifier = body.identifier || body.email || body.code || body.schoolCode;
      const user = await db.verifyCredentials(identifier, body.password, {
        ip: clientIp,
        userAgent: req.headers['user-agent']
      });

      const session = db.createSession(user.id, {
        ip: clientIp,
        userAgent: req.headers['user-agent']
      });

      const sessionCookie = formatSessionCookie(session.token, isProduction);
      return sendJson(res, 200, {
        success: true,
        user: session.user,
        mustChangePassword: session.user.mustChangePassword
      }, {
        'Set-Cookie': sessionCookie
      });
    } catch (err) {
      return sendError(res, err, 401);
    }
  }

  // 4. Déconnexion (/api/auth/logout)
  if (reqPath === '/api/auth/logout') {
    const cookies = parseCookies(req);
    const token = cookies['__Host-scolapro_session'] || cookies['scolapro_session'];
    if (token) {
      db.revokeSession(token);
    }
    const clearCookie = formatClearSessionCookie(isProduction);

    if (method === 'GET') {
      res.writeHead(302, {
        'Location': '/login.html',
        'Set-Cookie': clearCookie,
        ...securityHeaders(false, isProduction)
      });
      return res.end();
    }

    return sendJson(res, 200, { success: true }, { 'Set-Cookie': clearCookie });
  }

  // 4b. État de session courant (/api/auth/me)
  if (reqPath === '/api/auth/me' && method === 'GET') {
    const me = authenticate(req);
    if (!me) {
      return sendJson(res, 200, { authenticated: false });
    }
    return sendJson(res, 200, {
      authenticated: true,
      user: {
        id: me.id,
        nom: me.nom,
        prenom: me.prenom,
        email: me.email,
        phone: me.phone,
        role: me.role,
        roleLabel: me.roleLabel,
        level: me.level,
        scopeType: me.scopeType,
        scopeLabel: me.scopeLabel,
        schoolId: me.schoolId,
        foundationId: me.foundationId,
        rank: me.rank
      }
    });
  }

  // 5. Page de connexion (/login.html)
  if (reqPath === '/login.html') {
    const currentUser = authenticate(req);
    if (currentUser && !currentUser.mustChangePassword) {
      // Déjà connecté : redirection vers l'accueil ou ?next=
      const nextParam = queryParams.next;
      let target = '/';
      if (typeof nextParam === 'string' && /^\/[A-Za-z0-9/_.-]*$/.test(nextParam) && !nextParam.startsWith('//')) {
        target = nextParam;
      }
      res.writeHead(302, { 'Location': target, ...securityHeaders(false, isProduction) });
      return res.end();
    }

    const loginFilePath = path.join(PUBLIC_DIR, 'login.html');
    if (fs.existsSync(loginFilePath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        ...securityHeaders(true, isProduction)
      });
      return fs.createReadStream(loginFilePath).pipe(res);
    }
  }

  // 6. Portail des inscriptions en ligne (Public)
  if (reqPath === '/inscription.html' || reqPath === '/inscription') {
    const inscPath = path.join(PUBLIC_DIR, 'inscription.html');
    if (fs.existsSync(inscPath)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        ...securityHeaders(true, isProduction)
      });
      return fs.createReadStream(inscPath).pipe(res);
    }
  }

  // 7. Fichiers statiques autorisés sur liste blanche stricte
  if (isStaticAllowed(reqPath) && reqPath !== '/index.html' && reqPath !== '/') {
    const resolved = resolveStaticPath(reqPath, PUBLIC_DIR);
    if (resolved && fs.existsSync(resolved)) {
      const ext = path.extname(resolved).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        ...securityHeaders(ext === '.html', isProduction)
      });
      return fs.createReadStream(resolved).pipe(res);
    }
  }

  // -------------------------------------------------------------------
  // VÉRIFICATION D'AUTHENTIFICATION OBLIGATOIRE POUR TOUT LE RESTE
  // -------------------------------------------------------------------
  const user = authenticate(req);
  if (!user) {
    if (reqPath.startsWith('/api/')) {
      return sendError(res, new AccessError("Session non authentifiée ou expirée. Veuillez vous connecter.", 401, 'UNAUTHENTICATED'), 401);
    }
    // Redirection vers la page de connexion pour les pages web
    const safeNext = encodeURIComponent(reqPath);
    res.writeHead(302, {
      'Location': `/login.html?next=${safeNext}`,
      ...securityHeaders(false, isProduction)
    });
    return res.end();
  }

  // Si l'utilisateur doit obligatoirement changer son mot de passe
  if (user.mustChangePassword && reqPath !== '/api/auth/password' && reqPath !== '/api/auth/logout') {
    if (reqPath.startsWith('/api/')) {
      return sendError(res, new AccessError("Changement de mot de passe obligatoire requis avant toute opération.", 403, 'PASSWORD_CHANGE_REQUIRED'), 403);
    }
    res.writeHead(302, {
      'Location': '/login.html',
      ...securityHeaders(false, isProduction)
    });
    return res.end();
  }

  // 8. Protection Anti-CSRF sur toutes les requêtes mutatrices
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const writeCheck = writeLimiter.consume(clientIp, isTest ? 1000 : 120, 60000);
    if (!writeCheck.allowed) {
      return sendError(res, new Error("Trop d'opérations d'écriture. Veuillez ralentir."), 429);
    }

    if (!checkRequestOrigin(req, CORS_ALLOWED_ORIGINS)) {
      db.logSecurityViolation(user, 'CSRF_REJECTED', reqPath, `Origine: ${req.headers.origin || req.headers.referer || 'inconnue'}`);
      return sendError(res, new AccessError("Origine de la requête non autorisée (protection anti-CSRF).", 403, 'CSRF_REJECTED'), 403);
    }
  }

  // -------------------------------------------------------------------
  // API REST SÉCURISÉE & CONTRÔLÉE
  // -------------------------------------------------------------------

  try {
    // Changement de mot de passe personnel
    if (reqPath === '/api/auth/password' && method === 'POST') {
      const body = await readJsonBody(req);
      await db.setUserPassword(user.id, body.newPassword, user);
      const newSession = db.createSession(user.id, { ip: clientIp, userAgent: req.headers['user-agent'] });
      return sendJson(res, 200, { success: true }, {
        'Set-Cookie': formatSessionCookie(newSession.token, isProduction)
      });
    }

    // Impersonation de support technique : Concepteur Souverain (Rang 1) UNIQUEMENT
    if (reqPath === '/api/auth/switch' && method === 'POST') {
      if (user.role !== 'concepteur') {
        db.logSecurityViolation(user, 'IMPERSONATION_ATTEMPT', 'POST /api/auth/switch', 'Tentative d\'usurpation par un utilisateur non-concepteur');
        throw new AccessError("L'impersonation de support est réservée exclusivement au Concepteur Souverain.", 403, 'IMPERSONATION_FORBIDDEN');
      }

      const body = await readJsonBody(req);
      const targetUserId = parseInt(body.userId, 10);
      const targetUser = db.getUserById(targetUserId);
      if (!targetUser) throw new Error("Utilisateur cible d'impersonation introuvable.");

      const newSession = db.createSession(targetUser.id, {
        ip: clientIp,
        userAgent: req.headers['user-agent'],
        impersonatedBy: user.id
      });

      db.addAuditLog(user, {
        action: 'SUPPORT_IMPERSONATION_START',
        module: 'Supervision Souveraine',
        target: `Session #${targetUser.id} (${targetUser.prenom} ${targetUser.nom})`,
        oldVal: `Concepteur #${user.id}`,
        newVal: `Impersoné en #${targetUser.id} (${targetUser.role})`,
        schoolId: targetUser.schoolId,
        foundationId: targetUser.foundationId
      });

      return sendJson(res, 200, {
        success: true,
        user: targetUser
      }, {
        'Set-Cookie': formatSessionCookie(newSession.token, isProduction)
      });
    }

    // Données de bootstrap
    if (reqPath === '/api/bootstrap' && method === 'GET') {
      return sendJson(res, 200, db.getBootstrapData(user));
    }

    // Élèves
    if (reqPath === '/api/students') {
      if (method === 'GET') {
        return sendJson(res, 200, db.getStudents(user, queryParams.school_id));
      }
      if (method === 'POST') {
        const body = await readJsonBody(req);
        return sendJson(res, 201, db.createStudent(user, body));
      }
    }

    const studentMatch = reqPath.match(/^\/api\/students\/(\d+)$/);
    if (studentMatch) {
      const stId = studentMatch[1];
      if (method === 'GET') {
        const st = db.getStudentByIdScoped(user, stId);
        if (!st) return sendError(res, new Error("Élève introuvable."), 404);
        return sendJson(res, 200, st);
      }
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, db.updateStudent(user, stId, body));
      }
      if (method === 'DELETE') {
        return sendJson(res, 200, db.deleteStudent(user, stId));
      }
    }

    // Classes
    if (reqPath === '/api/classes') {
      if (method === 'GET') {
        return sendJson(res, 200, db.getClasses(user));
      }
      if (method === 'POST') {
        const body = await readJsonBody(req);
        return sendJson(res, 201, db.createClass(user, body));
      }
    }

    const classMatch = reqPath.match(/^\/api\/classes\/(\d+)$/);
    if (classMatch) {
      const cId = classMatch[1];
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, db.updateClass(user, cId, body));
      }
      if (method === 'DELETE') {
        return sendJson(res, 200, db.deleteClass(user, cId));
      }
    }

    // Caisses
    if (reqPath === '/api/cash/desks') {
      if (method === 'GET') {
        return sendJson(res, 200, db.getCashDesks(user));
      }
      if (method === 'POST') {
        const body = await readJsonBody(req);
        return sendJson(res, 201, db.createCashDesk(user, body));
      }
    }

    const deskMatch = reqPath.match(/^\/api\/cash\/desks\/([a-zA-Z0-9_-]+)$/);
    if (deskMatch) {
      const dId = deskMatch[1];
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, db.updateCashDesk(user, dId, body));
      }
      if (method === 'DELETE') {
        return sendJson(res, 200, db.deleteCashDesk(user, dId));
      }
    }

    // Versements inter-caisses
    if (reqPath === '/api/cash/deposits' || reqPath === '/api/cash-deposits') {
      if (method === 'GET') {
        return sendJson(res, 200, db.getCashDeposits(user));
      }
      if (method === 'POST') {
        const body = await readJsonBody(req);
        return sendJson(res, 201, db.createCashDeposit(user, body));
      }
    }

    const depositValMatch = reqPath.match(/^\/api\/(?:cash\/deposits|cash-deposits)\/(\d+)\/validate$/);
    if (depositValMatch && method === 'POST') {
      return sendJson(res, 200, db.validateCashDeposit(user, depositValMatch[1]));
    }

    const depositRejMatch = reqPath.match(/^\/api\/(?:cash\/deposits|cash-deposits)\/(\d+)\/reject$/);
    if (depositRejMatch && method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, db.rejectCashDeposit(user, depositRejMatch[1], body.reason));
    }

    // Paiements & quittances
    if (reqPath === '/api/payments') {
      if (method === 'GET') {
        return sendJson(res, 200, db.getPayments(user, queryParams.school_id));
      }
      if (method === 'POST') {
        const body = await readJsonBody(req);
        return sendJson(res, 201, db.recordPayment(user, body));
      }
    }

    // Utilisateurs
    if (reqPath === '/api/users') {
      if (method === 'GET') {
        return sendJson(res, 200, db.getUsers(user));
      }
      if (method === 'POST') {
        const body = await readJsonBody(req);
        return sendJson(res, 201, db.createUser(user, body));
      }
    }

    const userMatch = reqPath.match(/^\/api\/users\/(\d+)$/);
    if (userMatch) {
      const uId = userMatch[1];
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, db.updateUser(user, uId, body));
      }
      if (method === 'DELETE') {
        return sendJson(res, 200, db.deleteUser(user, uId));
      }
    }

    // Établissements & Fondations
    if (reqPath === '/api/schools') {
      if (method === 'GET') {
        const fId = queryParams.foundation_id || queryParams.foundationId || null;
        return sendJson(res, 200, db.getSchools(user, fId));
      }
      if (method === 'POST') {
        const body = await readJsonBody(req);
        const created = db.createSchool(user, body);
        syncToSupabase('schools', {
          code: created.code,
          name: created.name,
          short_name: created.shortName || created.short_name || created.name,
          school_type: created.schoolType || created.school_type || 'COLLÈGE & LYCÉE',
          country_code: 'CI',
          city: created.city || 'Abidjan',
          address: created.address || 'Abidjan',
          phone: created.phone || '+225 27 00 00 00',
          email: created.email || `${created.code.toLowerCase()}@scolapro.ci`,
          currency: 'XOF',
          is_active: true
        }).catch(() => {});
        return sendJson(res, 201, { success: true, school: created, id: created.id, ...created });
      }
    }
    const schoolMatch = reqPath.match(/^\/api\/schools\/(\d+)$/);
    if (schoolMatch) {
      const sId = schoolMatch[1];
      if (method === 'GET') {
        const s = db.lookupSchool(sId);
        if (!s) return sendError(res, new Error("Établissement introuvable."), 404);
        return sendJson(res, 200, { success: true, school: s, ...s });
      }
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readJsonBody(req);
        const updated = db.updateSchool(user, sId, body);
        syncToSupabase('schools', {
          code: updated.code,
          name: updated.name,
          short_name: updated.shortName || updated.short_name || updated.name,
          school_type: updated.schoolType || updated.school_type || 'COLLÈGE & LYCÉE',
          country_code: 'CI',
          city: updated.city || 'Abidjan',
          address: updated.address || 'Abidjan',
          phone: updated.phone || '+225 27 00 00 00',
          email: updated.email || `${updated.code.toLowerCase()}@scolapro.ci`,
          currency: 'XOF',
          is_active: true
        }).catch(() => {});
        return sendJson(res, 200, { success: true, school: updated, ...updated });
      }
      if (method === 'DELETE') {
        return sendJson(res, 200, db.deleteSchool(user, sId));
      }
    }

    if (reqPath === '/api/foundations') {
      if (method === 'GET') {
        return sendJson(res, 200, db.getFoundations(user));
      }
      if (method === 'POST') {
        const body = await readJsonBody(req);
        const created = db.createFoundation(user, body);
        syncToSupabase('foundations', {
          code: created.code,
          name: created.name,
          sigle: created.sigle || (created.code ? created.code.toUpperCase() : 'FND'),
          country_code: 'CI',
          city: created.city || 'Abidjan',
          address: created.hq || created.address || 'Abidjan',
          president_name: created.president || 'Direction Générale',
          phone: created.phone || '+225 27 00 00 00',
          email: created.email || 'contact@fondation.ci',
          description: created.description || '',
          is_active: true
        }).catch(() => {});
        return sendJson(res, 201, { success: true, foundation: created, id: created.id, ...created });
      }
    }
    const foundMatch = reqPath.match(/^\/api\/foundations\/(\d+)$/);
    if (foundMatch) {
      const fId = foundMatch[1];
      if (method === 'GET') {
        const f = db.getFoundations(user).find(x => x.id === parseInt(fId, 10));
        if (!f) return sendError(res, new Error("Fondation introuvable."), 404);
        return sendJson(res, 200, { success: true, foundation: f, ...f });
      }
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readJsonBody(req);
        const updated = db.updateFoundation(user, fId, body);
        syncToSupabase('foundations', {
          code: updated.code,
          name: updated.name,
          sigle: updated.sigle || (updated.code ? updated.code.toUpperCase() : 'FND'),
          country_code: 'CI',
          city: updated.city || 'Abidjan',
          address: updated.hq || updated.address || 'Abidjan',
          president_name: updated.president || 'Direction Générale',
          phone: updated.phone || '+225 27 00 00 00',
          email: updated.email || 'contact@fondation.ci',
          description: updated.description || '',
          is_active: true
        }).catch(() => {});
        return sendJson(res, 200, { success: true, foundation: updated, ...updated });
      }
      if (method === 'DELETE') {
        return sendJson(res, 200, db.deleteFoundation(user, fId));
      }
    }

    // Journaux d'audit
    if (reqPath === '/api/audit-logs') {
      if (method === 'GET') {
        return sendJson(res, 200, db.getAuditLogs(user));
      }
      if (method === 'POST') {
        const body = await readJsonBody(req);
        db.addAuditLog(user, {
          action: sanitizeText(body.action, 50),
          module: sanitizeText(body.module, 50),
          target: sanitizeText(body.target, 100),
          oldVal: sanitizeText(body.oldVal, 255),
          newVal: sanitizeText(body.newVal, 255)
        });
        return sendJson(res, 200, { success: true });
      }
    }

    // Paramètres Plateforme (Niveau 1 Concepteur)
    if (reqPath === '/api/platform/config') {
      if (method === 'GET') {
        return sendJson(res, 200, { success: true, list: db.getSystemSettings(user) });
      }
      if (method === 'POST') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, { success: true, list: db.updateSystemSettings(user, body) });
      }
    }

    // Paramètres Fondation (Niveau 2)
    if (reqPath === '/api/foundation/settings') {
      if (method === 'GET') {
        return sendJson(res, 200, { success: true, list: db.getFoundationSettings(user, user.foundationId) });
      }
      if (method === 'POST') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, { success: true, list: db.updateFoundationSettings(user, user.foundationId, body) });
      }
    }

    // Paramètres Établissement (Niveau 3)
    if (reqPath === '/api/school/settings') {
      if (method === 'GET') {
        return sendJson(res, 200, { success: true, list: db.getSchoolSettings(user, user.schoolId) });
      }
      if (method === 'POST') {
        const body = await readJsonBody(req);
        return sendJson(res, 200, { success: true, list: db.updateSchoolSettings(user, user.schoolId, body) });
      }
    }

    // Consolidation Fondation (Niveau 2)
    const foundConsolidatedMatch = reqPath.match(/^\/api\/foundation\/(?:(\d+)\/)?consolidated$/);
    if ((foundConsolidatedMatch || reqPath === '/api/foundation/consolidated') && method === 'GET') {
      const fId = (foundConsolidatedMatch && foundConsolidatedMatch[1]) || queryParams.foundationId || queryParams.foundation_id || user.foundationId;
      if (!fId) {
        return sendJson(res, 200, {
          success: true,
          consolidated: { totalSchools: 0, totalStudents: 0, totalClasses: 0, totalCashConsolidated: 0, averageRecoveryRate: '0.0' },
          schools: [],
          stats: { schoolsCount: 0, totalStudents: 0, totalDue: 0, totalPaid: 0, globalRecoveryRate: 0.0, totalCashBalance: 0 }
        });
      }
      return sendJson(res, 200, db.getFoundationConsolidatedData(user, fId));
    }

    // Purge de production sécurisée (Exige PURGE_CONFIRM_TOKEN)
    if (reqPath === '/api/sanitize' && method === 'POST') {
      assertRank(user, 1);
      const body = await readJsonBody(req);
      return sendJson(res, 200, db.sanitizeProductionDatabase(body.confirmToken));
    }

    // -----------------------------------------------------------------
    // PAGES WEB APPLICATIVES (HTML) AVEC GARDE RBAC
    // -----------------------------------------------------------------

    // Portail Concepteur (Niveau 1)
    if (reqPath === '/platform' || reqPath.startsWith('/platform/')) {
      if (user.role !== 'concepteur') {
        db.logSecurityViolation(user, 'PORTAL_ACCESS_DENIED', '/platform', 'Tentative d\'accès non autorisé au portail souverain');
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', ...securityHeaders(true, isProduction) });
        return res.end(render403Page(
          "Accès Restreint : Portail Souverain",
          "Cet espace est réservé exclusivement au Concepteur Système & Super Administrateur (INNOVA GROUP).",
          user,
          "Niveau 1 — PLATFORM"
        ));
      }
    }

    // Portail Fondation (Niveau 2)
    if (reqPath === '/foundation' || reqPath.startsWith('/foundation/')) {
      if (user.role !== 'concepteur' && user.role !== 'fondateur') {
        db.logSecurityViolation(user, 'PORTAL_ACCESS_DENIED', '/foundation', 'Tentative d\'accès non autorisé au portail fondation');
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', ...securityHeaders(true, isProduction) });
        return res.end(render403Page(
          "Accès Restreint : Portail Fondation",
          "Cet espace est réservé exclusivement à la Présidence du Conseil de Fondation.",
          user,
          "Niveau 2 — FOUNDATION"
        ));
      }
    }

    // Tout point d'accès API non intercepté retourne un 404 JSON strict (jamais le HTML SPA)
    if (reqPath.startsWith('/api/')) {
      return sendError(res, new Error("Point d'accès API introuvable."), 404);
    }

    // Page SPA Principale (index.html) uniquement pour les routes de navigation sans extension ni segments cachés
    const hasExt = path.extname(reqPath).length > 0;
    const isHidden = reqPath.split('/').some(segment => segment.startsWith('.'));
    if (!hasExt && !isHidden) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          ...securityHeaders(true, isProduction)
        });
        return fs.createReadStream(indexPath).pipe(res);
      }
    }

    return sendError(res, new Error("Ressource non trouvée."), 404);

  } catch (err) {
    return sendError(res, err, err instanceof AccessError ? err.status : 400);
  }
});

function startServer(port = PORT) {
  return new Promise((resolve) => {
    const srv = server.listen(port, () => {
      console.log(`[ScolaPro] Serveur sécurisé en écoute sur le port ${port} (${isProduction ? 'PRODUCTION' : 'DÉVELOPPEMENT'}).`);
      resolve(srv);
    });
  });
}

if (require.main === module) {
  startServer().catch(console.error);
}

module.exports = {
  server,
  startServer,
  authenticate,
  render403Page
};
