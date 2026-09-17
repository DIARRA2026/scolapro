/**
 * ScolaPro — Tests Automatisés CRUD (Utilisateurs, Caisses, Élèves)
 * Vérifie le comportement des nouvelles routes et fonctions de mise à jour et suppression,
 * ainsi que les barrières de protection métier et financière.
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

test('CRUD-01 : Mise à jour d\'un utilisateur (PUT /api/users/:id)', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  assert.ok(session.cookie, "Connexion concepteur requise");

  // Créer un utilisateur temporaire
  const createRes = await makeRequest(baseUrl, {
    path: '/api/users',
    method: 'POST',
    headers: { cookie: session.cookie }
  }, {
    nom: 'Kouassi',
    prenom: 'Jean-Luc',
    email: 'jl.kouassi@test-scolapro.ci',
    phone: '+225 07 00 11 22 33',
    role: 'educateur',
    schoolId: 1
  });
  assert.equal(createRes.statusCode, 201);
  const newUserId = createRes.json.user.id;

  // Modifier les informations de l'utilisateur
  const updateRes = await makeRequest(baseUrl, {
    path: `/api/users/${newUserId}`,
    method: 'PUT',
    headers: { cookie: session.cookie }
  }, {
    nom: 'Kouassi-Modifie',
    prenom: 'Jean-Luc-Pierre',
    phone: '+225 07 99 88 77 66',
    role: 'educateur'
  });

  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.json.success, true);
  assert.equal(updateRes.json.user.nom, 'Kouassi-Modifie');
  assert.equal(updateRes.json.user.prenom, 'Jean-Luc-Pierre');
  assert.equal(updateRes.json.user.phone, '+225 07 99 88 77 66');
});

test('CRUD-02 : Suppression d\'un utilisateur et protection du compte souverain', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);

  // Tenter de supprimer le compte Concepteur Souverain (id=0) -> DOIT ÉCHOUER (403)
  const delSovereign = await makeRequest(baseUrl, {
    path: '/api/users/0',
    method: 'DELETE',
    headers: { cookie: session.cookie }
  });
  assert.equal(delSovereign.statusCode, 403);

  // Créer et supprimer un utilisateur test
  const createRes = await makeRequest(baseUrl, {
    path: '/api/users',
    method: 'POST',
    headers: { cookie: session.cookie }
  }, {
    nom: 'A_Supprimer',
    prenom: 'Test',
    email: 'a.supprimer@test-scolapro.ci',
    role: 'consultation',
    schoolId: 1
  });
  assert.equal(createRes.statusCode, 201);
  const uId = createRes.json.user.id;

  const delRes = await makeRequest(baseUrl, {
    path: `/api/users/${uId}`,
    method: 'DELETE',
    headers: { cookie: session.cookie }
  });
  assert.equal(delRes.statusCode, 200);
  assert.equal(delRes.json.success, true);

  // Vérifier qu'il n'existe plus en base
  const checkUser = db.getUserById(uId);
  assert.equal(checkUser, null);
});

test('CRUD-03 : Mise à jour d\'une caisse (PUT /api/cash/desks/:id)', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  // Créer une caisse secondaire
  const deskCode = `CS_MOD_${Date.now().toString().slice(-4)}`;
  const createRes = await makeRequest(baseUrl, {
    path: '/api/cash/desks',
    method: 'POST',
    headers: { cookie: session.cookie }
  }, {
    code: deskCode,
    name: 'Caisse Annexe Test',
    type: 'SECONDAIRE',
    cashier: 'Mlle Kouamé',
    schoolId: 1
  });
  assert.equal(createRes.statusCode, 201);
  const deskId = createRes.json.id;

  // Modifier le nom et le caissier
  const updateRes = await makeRequest(baseUrl, {
    path: `/api/cash/desks/${deskId}`,
    method: 'PUT',
    headers: { cookie: session.cookie }
  }, {
    name: 'Caisse Annexe Rénovée',
    cashier: 'Mme Bamba'
  });

  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.json.name, 'Caisse Annexe Rénovée');
  assert.equal(updateRes.json.cashier, 'Mme Bamba');
});

test('CRUD-04 : Suppression d\'une caisse secondaire soldée à 0 (DELETE /api/cash/desks/:id)', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  // Créer une caisse secondaire
  const deskCode = `CS_DEL_${Date.now().toString().slice(-4)}`;
  const createRes = await makeRequest(baseUrl, {
    path: '/api/cash/desks',
    method: 'POST',
    headers: { cookie: session.cookie }
  }, {
    code: deskCode,
    name: 'Caisse Éphémère',
    type: 'SECONDAIRE',
    cashier: 'À assigner',
    schoolId: 1
  });
  assert.equal(createRes.statusCode, 201);
  const deskId = createRes.json.id;

  // Supprimer la caisse
  const delRes = await makeRequest(baseUrl, {
    path: `/api/cash/desks/${deskId}`,
    method: 'DELETE',
    headers: { cookie: session.cookie }
  });
  assert.equal(delRes.statusCode, 200);
  assert.equal(delRes.json.success, true);
  assert.equal(delRes.json.deletedId, deskId);
});

test('CRUD-05 : Interdiction de supprimer une caisse principale', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  // Tenter de supprimer la caisse principale de l'école 1 (S1_PRINCIPALE ou PRINCIPALE)
  const delMain = await makeRequest(baseUrl, {
    path: '/api/cash/desks/S1_PRINCIPALE',
    method: 'DELETE',
    headers: { cookie: session.cookie }
  });
  assert.equal(delMain.statusCode, 400);
});

test('CRUD-06 : Suppression d\'un élève nouvellement créé sans historique de paiement', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  const mat = `ST-TEST-${Date.now().toString().slice(-4)}`;
  const createRes = await makeRequest(baseUrl, {
    path: '/api/students',
    method: 'POST',
    headers: { cookie: session.cookie }
  }, {
    matricule: mat,
    nomPrenom: 'Élève À Supprimer',
    sexe: 'M',
    classe: '6EME A',
    niveau: '6EME',
    feeDue: 120000,
    schoolId: 1
  });
  assert.equal(createRes.statusCode, 201);
  const stId = createRes.json.id;

  // Supprimer l'élève
  const delRes = await makeRequest(baseUrl, {
    path: `/api/students/${stId}`,
    method: 'DELETE',
    headers: { cookie: session.cookie }
  });
  assert.equal(delRes.statusCode, 200);
  assert.equal(delRes.json.success, true);

  // Vérifier qu'il n'existe plus
  const getRes = await makeRequest(baseUrl, {
    path: `/api/students/${stId}`,
    method: 'GET',
    headers: { cookie: session.cookie }
  });
  assert.equal(getRes.statusCode, 404);
});
