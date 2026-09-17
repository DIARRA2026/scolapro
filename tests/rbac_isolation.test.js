/**
 * ScolaPro — Suite de Tests RBAC & Isolation Multi-Tenant Hermétique
 * Couvre les barrières hiérarchiques (N1 Concepteur, N2 Fondation, N3 Établissement),
 * l'anti-escalade de privilèges (Faille 2), l'isolation inter-écoles et fondations (Faille 5),
 * la séparation des fonctions de caisse et l'impersonation souveraine.
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

test('RBAC-01 : Concepteur Souverain (Rang 1) dispose de l\'accès complet aux réglages système', async () => {
  const login = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  assert.strictEqual(login.statusCode, 200);

  const res = await makeRequest(baseUrl, {
    path: '/api/platform/config',
    headers: { Cookie: login.cookie }
  });
  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.json.list);
});

test('RBAC-02 : Faille 2 colmatée — Admin d\'école (Rang 3) ne peut PAS créer un compte Concepteur (403)', async () => {
  const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  const res = await makeRequest(baseUrl, {
    path: '/api/users',
    method: 'POST',
    headers: { Cookie: login.cookie }
  }, {
    nom: 'HACKER',
    prenom: 'AdminEscalation',
    email: 'hacker.concepteur@test.ci',
    role: 'concepteur',
    level: 'PLATFORM',
    permissions: ['*', 'system.superadmin']
  });

  assert.strictEqual(res.statusCode, 403);
  assert.ok(res.json.code === 'ROLE_ASSIGN_FORBIDDEN' || res.json.code === 'INSUFFICIENT_RANK');
});

test('RBAC-03 : Admin d\'école (Rang 3) ne peut PAS s\'auto-attribuer le rôle Fondateur (N2)', async () => {
  const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  const res = await makeRequest(baseUrl, {
    path: '/api/users',
    method: 'POST',
    headers: { Cookie: login.cookie }
  }, {
    nom: 'HACKER',
    prenom: 'FondateurEscalation',
    email: 'hacker.fondateur@test.ci',
    role: 'fondateur',
    level: 'FOUNDATION'
  });

  assert.strictEqual(res.statusCode, 403);
});

test('RBAC-04 : Admin d\'école (Rang 3) ne peut PAS attribuer la permission globale (*) (403)', async () => {
  const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  const res = await makeRequest(baseUrl, {
    path: '/api/users',
    method: 'POST',
    headers: { Cookie: login.cookie }
  }, {
    nom: 'COMPTABLE',
    prenom: 'Test',
    email: 'comptable.test@test.ci',
    role: 'caisse_principale',
    permissions: ['*']
  });

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.json.code, 'SUPERADMIN_ASSIGN_FORBIDDEN');
});

test('RBAC-05 : Faille 5 colmatée — IDOR bloqué : Utilisateur École 1 ne peut pas lire un élève d\'École 2', async () => {
  // Créer temporairement un élève dans l'école 2
  db.db.prepare(`
    INSERT OR REPLACE INTO students (id, school_id, matricule, nom_prenom, niveau, classe, fee_due, fee_paid)
    VALUES (999, 2, 'MAT-SCH2-IDOR', 'Eleve Ecole Deux', '6EME', '6EME 1', 100000, 0)
  `).run();

  try {
    // L'admin de l'école 1 tente d'accéder à l'élève de l'école 2
    const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);
    const res = await makeRequest(baseUrl, {
      path: '/api/students/999',
      headers: { Cookie: login.cookie }
    });

    assert.ok(res.statusCode === 403 || res.statusCode === 404);
    assert.ok(res.json.error.includes('interdit') || res.json.error.includes('introuvable') || res.json.code === 'TENANT_VIOLATION');
  } finally {
    db.db.prepare('DELETE FROM students WHERE id = 999').run();
  }
});

test('RBAC-06 : Faille 5 colmatée — Tentative d\'écriture trans-tenant rejetée avec 403 TENANT_CROSS_WRITE', async () => {
  const login = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  const res = await makeRequest(baseUrl, {
    path: '/api/students',
    method: 'POST',
    headers: { Cookie: login.cookie }
  }, {
    matricule: 'STU-CROSS-01',
    nom: 'Tentative',
    prenom: 'CrossTenant',
    classe: '6EME 1',
    schoolId: 2 // Tentative formelle de cibler l'école 2 depuis l'école 1
  });

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.json.code, 'TENANT_CROSS_WRITE');
});

test('RBAC-07 : Faille 5 colmatée — Fondation 1 ne supervise pas les écoles hors périmètre (403)', async () => {
  const login = await loginUser(baseUrl, TEST_USERS.fondateur, TEST_PASSWORD);

  const res = await makeRequest(baseUrl, {
    path: '/api/students?school_id=999',
    headers: { Cookie: login.cookie }
  });

  assert.strictEqual(res.statusCode, 403);
});

test('RBAC-08 : Faille 1 colmatée — Impersonation de support (/api/auth/switch) STRICTEMENT réservée au Concepteur (403 pour Admin)', async () => {
  const loginAdmin = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  const res = await makeRequest(baseUrl, {
    path: '/api/auth/switch',
    method: 'POST',
    headers: { Cookie: loginAdmin.cookie }
  }, { userId: 0 });

  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.json.code, 'IMPERSONATION_FORBIDDEN');
});

test('RBAC-09 : Concepteur Souverain peut effectuer une impersonation technique autorisée avec journal d\'audit', async () => {
  const loginConcepteur = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);

  const res = await makeRequest(baseUrl, {
    path: '/api/auth/switch',
    method: 'POST',
    headers: { Cookie: loginConcepteur.cookie }
  }, { userId: 2 }); // Basculer vers l'admin Sainte-Marie

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.user.id, 2);

  // Vérifier la présence de l'audit log
  const audit = db.db.prepare('SELECT action, module, target FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT 1').get('SUPPORT_IMPERSONATION_START');
  assert.ok(audit);
  assert.strictEqual(audit.module, 'Supervision Souveraine');
});

test('RBAC-10 : Séparation des fonctions — Caisse Secondaire NE PEUT PAS valider un dépôt inter-caisse (403)', async () => {
  const loginCaisseSec = await loginUser(baseUrl, TEST_USERS.caisseSecondaire, TEST_PASSWORD);

  // Tenter de valider un versement
  const res = await makeRequest(baseUrl, {
    path: '/api/cash/deposits/1/validate',
    method: 'POST',
    headers: { Cookie: loginCaisseSec.cookie }
  });

  assert.strictEqual(res.statusCode, 403);
  assert.ok(res.json.code === 'PERMISSION_DENIED' || res.json.code === 'INSUFFICIENT_PERMISSIONS');
});

test('RBAC-11 : Profil Consultation dispose uniquement de droits de lecture (403 sur création)', async () => {
  const loginConsult = await loginUser(baseUrl, TEST_USERS.consultation, TEST_PASSWORD);

  const res = await makeRequest(baseUrl, {
    path: '/api/students',
    method: 'POST',
    headers: { Cookie: loginConsult.cookie }
  }, {
    matricule: 'STU-CONS-01',
    nom: 'LectureSeule',
    prenom: 'Test'
  });

  assert.strictEqual(res.statusCode, 403);
  assert.ok(res.json.code === 'PERMISSION_DENIED' || res.json.code === 'INSUFFICIENT_PERMISSIONS');
});

test('RBAC-12 : Admin d\'école ne peut pas accéder aux réglages de Fondation (403)', async () => {
  const loginAdmin = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  const res = await makeRequest(baseUrl, {
    path: '/api/foundation/settings',
    headers: { Cookie: loginAdmin.cookie }
  });

  assert.strictEqual(res.statusCode, 403);
});

test('RBAC-13 : Interdiction de supprimer une classe contenant des élèves inscrits (400)', async () => {
  const loginAdmin = await loginUser(baseUrl, TEST_USERS.adminSainteMarie, TEST_PASSWORD);

  // Trouver une classe de l'école 1 contenant des élèves
  const cls = db.db.prepare(`
    SELECT c.id, c.name, COUNT(s.id) as st_count
    FROM classes c
    JOIN students s ON s.classe = c.name AND s.school_id = c.school_id
    WHERE c.school_id = 1
    GROUP BY c.id, c.name
    HAVING st_count > 0
    LIMIT 1
  `).get();
  assert.ok(cls, 'Une classe avec des élèves inscrits doit exister');

  const res = await makeRequest(baseUrl, {
    path: '/api/classes/' + cls.id,
    method: 'DELETE',
    headers: { Cookie: loginAdmin.cookie }
  });

  assert.strictEqual(res.statusCode, 400);
  assert.ok(res.json.error.includes('inscrit'));
});

test('RBAC-14 : Mise à jour d\'élève : Le champ fee_paid est strictement protégé contre toute altération directe', async () => {
  const user = db.getUserById(2);
  const st = db.db.prepare('SELECT id, fee_paid FROM students WHERE school_id = 1 LIMIT 1').get();
  const initialFeePaid = st.fee_paid;

  // Tentative de modification directe de fee_paid via updateStudent
  db.updateStudent(user, st.id, { fee_paid: initialFeePaid + 100000 });

  // Vérifier en base que fee_paid n'a pas bougé
  const stAfter = db.db.prepare('SELECT fee_paid FROM students WHERE id = ?').get(st.id);
  assert.strictEqual(stAfter.fee_paid, initialFeePaid, 'Le montant payé ne peut être modifié que par enregistrement d un paiement comptable');
});

test('RBAC-15 : resolveWriteSchoolId ne bascule JAMAIS silencieusement vers l\'école 1 sans école assignée', () => {
  const { resolveWriteSchoolId } = require('../lib/rbac.js');

  const userSansEcole = {
    id: 99,
    role: 'educateur',
    schoolId: null,
    foundationId: null
  };

  assert.throws(() => {
    resolveWriteSchoolId(userSansEcole, null);
  }, /Compte non rattaché à un établissement/);
});
