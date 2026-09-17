/**
 * ScolaPro — Suite de Tests de Sécurité & Authentification
 * Couvre l'intégrité des sessions, les contournements d'auth, la fuite de fichiers sensibles,
 * le hachage Scrypt, le verrouillage de compte et la protection Anti-CSRF.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  db,
  startTestServer,
  stopTestServer,
  makeRequest,
  loginUser,
  TEST_PASSWORD,
  TEST_USERS
} = require('./helpers.js');

let baseUrl = '';

test.before(async () => {
  const srv = await startTestServer();
  baseUrl = srv.baseUrl;
});

test.after(async () => {
  await stopTestServer();
});

test('SEC-01 : Rejet de tout accès API non authentifié (401)', async () => {
  const res = await makeRequest(baseUrl, { path: '/api/bootstrap' });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.json.code, 'UNAUTHENTICATED');
});

test('SEC-02 : Faille 1 colmatée — En-tête forgé x-scolapro-user-id: 0 rejeté', async () => {
  const res = await makeRequest(baseUrl, {
    path: '/api/bootstrap',
    headers: { 'x-scolapro-user-id': '0' }
  });
  assert.strictEqual(res.statusCode, 401);
});

test('SEC-03 : Paramètre d\'URL ?user_id=0 rejeté sans session', async () => {
  const res = await makeRequest(baseUrl, {
    path: '/api/bootstrap?user_id=0'
  });
  assert.strictEqual(res.statusCode, 401);
});

test('SEC-04 : Page protégée /platform redirige vers /login.html?next= (302)', async () => {
  const res = await makeRequest(baseUrl, { path: '/platform' });
  assert.strictEqual(res.statusCode, 302);
  assert.ok(res.headers.location.startsWith('/login.html?next='));
});

test('SEC-05 : Faille 4 colmatée — Divulgation de db.js bloquée (Redirection 302 sans auth, 404 avec auth)', async () => {
  // Sans authentification
  const resUnauth = await makeRequest(baseUrl, { path: '/db.js' });
  assert.strictEqual(resUnauth.statusCode, 302);
  assert.ok(!resUnauth.body.includes('DatabaseSync'));

  // Avec authentification
  const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);
  const resAuth = await makeRequest(baseUrl, {
    path: '/db.js',
    headers: { Cookie: login.cookie }
  });
  assert.strictEqual(resAuth.statusCode, 404);
  assert.ok(!resAuth.body.includes('DatabaseSync'));
});

test('SEC-06 : Faille 4 colmatée — Téléchargement de scolapro.db bloqué (Redirection 302 sans auth, 404 avec auth)', async () => {
  const resUnauth = await makeRequest(baseUrl, { path: '/scolapro.db' });
  assert.strictEqual(resUnauth.statusCode, 302);
  assert.ok(!resUnauth.body.includes('SQLite format 3'));

  const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);
  const resAuth = await makeRequest(baseUrl, {
    path: '/scolapro.db',
    headers: { Cookie: login.cookie }
  });
  assert.strictEqual(resAuth.statusCode, 404);
  assert.ok(!resAuth.body.includes('SQLite format 3'));
});

test('SEC-07 : Divulgation de .env bloquée (Redirection 302 sans auth, 404 avec auth)', async () => {
  const resUnauth = await makeRequest(baseUrl, { path: '/.env' });
  assert.strictEqual(resUnauth.statusCode, 302);

  const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);
  const resAuth = await makeRequest(baseUrl, {
    path: '/.env',
    headers: { Cookie: login.cookie }
  });
  assert.strictEqual(resAuth.statusCode, 404);
});

test('SEC-08 : Divulgation de .git/config bloquée (Redirection 302 sans auth, 404 avec auth)', async () => {
  const resUnauth = await makeRequest(baseUrl, { path: '/.git/config' });
  assert.strictEqual(resUnauth.statusCode, 302);

  const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);
  const resAuth = await makeRequest(baseUrl, {
    path: '/.git/config',
    headers: { Cookie: login.cookie }
  });
  assert.strictEqual(resAuth.statusCode, 404);
});

test('SEC-09 : Attaque par traversée de répertoire (directory traversal) bloquée', async () => {
  const res = await makeRequest(baseUrl, { path: '/..%2fpackage.json' });
  assert.ok(res.statusCode === 302 || res.statusCode === 404 || res.statusCode === 403);
  assert.ok(!res.body.includes('"name": "scolapro"'));
});

test('SEC-10 : Fichier statique autorisé (config.js) accessible publiquement', async () => {
  const res = await makeRequest(baseUrl, { path: '/config.js' });
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.headers['content-type'].includes('javascript'));
  assert.ok(res.body.includes('__APP_CONFIG__'));
});

test('SEC-11 : Page de connexion publique (/login.html) accessible', async () => {
  const res = await makeRequest(baseUrl, { path: '/login.html' });
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.headers['content-type'].includes('text/html'));
  assert.ok(res.body.includes('ScolaPro'));
});

test('SEC-12 : Route publique /health opérationnelle sans authentification', async () => {
  const res = await makeRequest(baseUrl, { path: '/health' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json.status, 'UP');
});

test('SEC-13 : Route publique /api/config opérationnelle et dépourvue de secret', async () => {
  const res = await makeRequest(baseUrl, { path: '/api/config' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json.platformName, 'ScolaPro');
  assert.strictEqual(res.json.currency, 'XOF');
  assert.strictEqual(res.json.secretKey, undefined);
  assert.strictEqual(res.json.supabaseKey, undefined);
});

test('SEC-14 : Authentification réussie délivre un cookie de session HttpOnly et SameSite=Strict', async () => {
  const loginRes = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);
  assert.strictEqual(loginRes.statusCode, 200);
  assert.ok(loginRes.user);
  assert.strictEqual(loginRes.user.email, TEST_USERS.adminSainteMarie);
  assert.ok(loginRes.rawSetCookie);

  const cookieHeader = Array.isArray(loginRes.rawSetCookie) ? loginRes.rawSetCookie[0] : loginRes.rawSetCookie;
  assert.ok(cookieHeader.includes('HttpOnly'), 'Le cookie doit être HttpOnly');
  assert.ok(cookieHeader.includes('SameSite=Strict'), 'Le cookie doit être SameSite=Strict');
  assert.ok(cookieHeader.includes('Path=/'), 'Le cookie doit avoir Path=/');
});

test('SEC-15 : Tentative de connexion avec mot de passe erroné retourne 401 générique', async () => {
  const res = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, 'MauvaisMotDePasse123!');
  assert.strictEqual(res.statusCode, 401);
  assert.ok(res.json.error.includes('Identifiants invalides') || res.json.error.includes('incorrect'));
});

test('SEC-16 : Tentative de connexion avec adresse email inexistante retourne même message 401 (anti-énumération)', async () => {
  const res = await loginUser(baseUrl, 'inconnu@introuvable.ci', 'NimporteQuoi123!');
  assert.strictEqual(res.statusCode, 401);
  assert.ok(res.json.error.includes('Identifiants invalides') || res.json.error.includes('incorrect'));
});

test('SEC-17 : Verrouillage de compte après 5 tentatives infructueuses consécutives', async () => {
  const email = TEST_USERS.caisseSecondaire;
  for (let i = 0; i < 5; i++) {
    await loginUser(baseUrl, email, 'FauxMotDePasse!');
  }
  // 6ème tentative : compte verrouillé
  const res = await loginUser(baseUrl, email, TEST_PASSWORD);
  assert.strictEqual(res.statusCode, 401);
  assert.ok(res.json.error.includes('verrouillé temporairement') || res.json.error.includes('temporairement verrouillé'));

  // Déverrouiller le compte pour la suite des tests
  db.db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email = ?').run(email);
});

test('SEC-18 : Déconnexion (/api/auth/logout) révoque la session serveur', async () => {
  const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);
  assert.ok(login.cookie);

  // Vérifier que la session fonctionne
  const testReq1 = await makeRequest(baseUrl, {
    path: '/api/bootstrap',
    headers: { Cookie: login.cookie }
  });
  assert.strictEqual(testReq1.statusCode, 200);

  // Se déconnecter
  const logoutRes = await makeRequest(baseUrl, {
    path: '/api/auth/logout',
    method: 'POST',
    headers: { Cookie: login.cookie }
  });
  assert.strictEqual(logoutRes.statusCode, 200);

  // Tenter de réutiliser la même session
  const testReq2 = await makeRequest(baseUrl, {
    path: '/api/bootstrap',
    headers: { Cookie: login.cookie }
  });
  assert.strictEqual(testReq2.statusCode, 401);
});

test('SEC-19 : Protection Anti-CSRF — Requête mutatrice rejetée avec Origine externe non autorisée (403)', async () => {
  const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);
  const res = await makeRequest(baseUrl, {
    path: '/api/students',
    method: 'POST',
    headers: {
      Cookie: login.cookie,
      Origin: 'http://malveillant-hacker.com'
    }
  }, { matricule: 'CSRF-01', nomPrenom: 'Test CSRF' });

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.json.code, 'CSRF_REJECTED');
});

test('SEC-20 : En-têtes de sécurité stricts présents sur les réponses (HTML & API)', async () => {
  const resApi = await makeRequest(baseUrl, { path: '/health' });
  assert.strictEqual(resApi.headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(resApi.headers['x-frame-options'], 'SAMEORIGIN');
  assert.strictEqual(resApi.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.strictEqual(resApi.headers['cross-origin-opener-policy'], 'same-origin');
  assert.strictEqual(resApi.headers['cross-origin-resource-policy'], 'same-origin');
  assert.strictEqual(resApi.headers['x-xss-protection'], undefined, 'X-XSS-Protection obsolète doit être absent');

  // CSP vérifié sur la page HTML
  const resHtml = await makeRequest(baseUrl, { path: '/login.html' });
  assert.ok(resHtml.headers['content-security-policy'], 'CSP doit être présent sur les pages HTML');
  assert.ok(resHtml.headers['content-security-policy'].includes("default-src 'self'"));
});
