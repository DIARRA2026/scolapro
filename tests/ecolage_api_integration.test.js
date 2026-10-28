'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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

test('API-ECO-01: GET /api/school/ecolage retourne la configuration complète de l établissement', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  assert.ok(session.cookie, "Connexion concepteur requise");

  const res = await makeRequest(baseUrl, {
    path: '/api/school/ecolage?school_id=1',
    method: 'GET',
    headers: { Cookie: session.cookie }
  });

  assert.equal(res.statusCode, 200, 'Statut HTTP 200 attendu');
  assert.equal(res.json.success, true);
  assert.ok(Array.isArray(res.json.costsByLevel), 'costsByLevel doit être un tableau');
  assert.ok(res.json.costsByLevel.length > 0, 'Au moins un niveau doit être configuré');
  assert.ok(Array.isArray(res.json.feeInstallments), 'feeInstallments doit être un tableau');
  assert.ok(Array.isArray(res.json.feeTypes), 'feeTypes doit être un tableau');
  assert.ok(Array.isArray(res.json.discountCases), 'discountCases doit être un tableau');
});

test('API-ECO-02: POST /api/school/ecolage persiste les modifications en base SQLite', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  assert.ok(session.cookie, "Connexion concepteur requise");

  // Modifier les frais de 6EME pour le test
  const payload = {
    schoolId: 1,
    costsByLevel: [
      { level: '6EME', cycle: 'Collège', baseAff: 48000, baseNaff: 125000, exam: 0 },
      { level: '3EME', cycle: 'Collège', baseAff: 48000, baseNaff: 125000, exam: 10000 }
    ]
  };

  const res = await makeRequest(baseUrl, {
    path: '/api/school/ecolage',
    method: 'POST',
    headers: { Cookie: session.cookie }
  }, payload);

  assert.equal(res.statusCode, 200, 'Statut HTTP 200 attendu sur POST');
  assert.equal(res.json.success, true);

  // Relire la configuration pour vérifier la persistance en base
  const verifyRes = await makeRequest(baseUrl, {
    path: '/api/school/ecolage?school_id=1',
    method: 'GET',
    headers: { Cookie: session.cookie }
  });
  const sixieme = verifyRes.json.costsByLevel.find(c => c.level === '6EME');
  assert.ok(sixieme, '6EME doit être présent');
  assert.equal(sixieme.baseAff, 48000, 'baseAff doit être persisté à 48000');
  assert.equal(sixieme.baseNaff, 125000, 'baseNaff doit être persisté à 125000');
});
