'use strict';
/**
 * =====================================================================
 * ScolaPro — Tests : Affichage N° Quittance + Fiche Détaillée Élève
 * =====================================================================
 * Fonctionnalités testées :
 *   SDM-01 : getPayments() enrichi — receiptNumber exposé dans chaque paiement
 *   SDM-02 : getStudentByIdScoped() enrichi — schoolName, schoolCode, payments[]
 *   SDM-03 : API GET /api/students/:id — RBAC HTTP (403 isolation multi-tenant)
 *   SDM-04 : DOM index.html — Modal #modal-student-detail et ses IDs
 *   SDM-05 : DOM index.html — Fonctions JS déclarées (ERP-02)
 *   SDM-06 : DOM index.html — receiptNumber affiché + noms cliquables dans caisses
 *   SDM-07 : ERP-01 — Chaque id appelé en JS est déclaré dans le HTML
 * =====================================================================
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
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

let baseUrl = '';
let adminCookie = '';
let school2Cookie = '';

// Utilisateurs admin de l'école 1 et 2 (fixtures existantes)
const SCHOOL1_ADMIN_EMAIL = TEST_USERS.adminSainteMarie;      // school_id=1
const SCHOOL2_ADMIN_EMAIL = TEST_USERS.chefFinancier;          // school_id=1 aussi
// École 2 — on utilisera l'admin fixture du collège Sainte-Anne
// Pour isoler, on crée un admin school_id=2 à la main
let school2AdminUser;

// Élève et paiement de référence (fixture)
const FIXTURE_STUDENT_ID = 1; // Kouamé Jean — école 1, 150000 total, 50000 payé

before(async () => {
  const srv = await startTestServer();
  baseUrl = srv.baseUrl;

  // Session admin école 1
  const r1 = await loginUser(baseUrl, SCHOOL1_ADMIN_EMAIL);
  adminCookie = r1.cookie;

  // Créer un utilisateur admin pour l'école 2 (isolation)
  const adminUser = db.db.prepare("SELECT * FROM users WHERE role = 'admin' AND school_id = 1").get();
  // S'assurer qu'il y a un utilisateur pour school_id=2
  db.db.prepare(`
    INSERT OR REPLACE INTO users (id, school_id, foundation_id, nom, prenom, email, phone, role, role_label, scope_type, scope_label, level, is_active)
    VALUES (999, 2, 1, 'TEST', 'Isolation', 'isolation.test@sdm2.ci', '+225 07 00 99 99', 'admin', 'Admin Test SDM2', 'SCHOOL', 'Collège Sainte-Anne', 'N3', 1)
  `).run();
  await db.setUserPassword(999, TEST_PASSWORD, { id: 0, role: 'concepteur', rank: 1 });
  db.db.prepare('UPDATE users SET must_change_password = 0 WHERE id = 999').run();

  const r2 = await loginUser(baseUrl, 'isolation.test@sdm2.ci');
  school2Cookie = r2.cookie;

  // S'assurer qu'un paiement avec quittance existe pour l'élève fixture #1
  const existingPayment = db.db.prepare(`
    SELECT p.id FROM payments p WHERE p.student_id = 1 LIMIT 1
  `).get();
  if (!existingPayment) {
    // Créer un paiement via l'API pour générer une quittance
    await makeRequest(baseUrl, {
      path: '/api/payments',
      method: 'POST',
      headers: { Cookie: adminCookie }
    }, { studentId: 1, amount: 50000, paymentMethod: 'ESPECES', cashDesk: 'PRINCIPALE' });
  }
});

after(async () => {
  await stopTestServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// SDM-01 : getPayments() enrichi — receiptNumber exposé
// ─────────────────────────────────────────────────────────────────────────────
describe('SDM-01: getPayments() — receiptNumber enrichi', () => {
  test('SDM-01-A: L\'objet paiement formatté expose bien receiptNumber', () => {
    // Chercher l'admin de l'école 1 par email fixture (stable)
    const rawUser = db.db.prepare("SELECT id FROM users WHERE email = ?").get(TEST_USERS.adminSainteMarie);
    if (!rawUser) return;
    const adminUser = db.getUserById(rawUser.id);
    if (!adminUser || !adminUser.schoolId) return;

    // S'assurer qu'il y a au moins un paiement dans la DB de test
    const payCount = db.db.prepare('SELECT COUNT(*) AS n FROM payments WHERE school_id = ?').get(adminUser.schoolId);
    if (!payCount || payCount.n === 0) {
      db.db.prepare(`
        INSERT OR IGNORE INTO payments (school_id, student_id, amount, payment_method, cash_desk, cashier_id, cashier_name, ref)
        VALUES (?, 1, 25000, 'ESPECES', 'PRINCIPALE', ?, 'Test Caissier', 'TEST-REF-SDM01')
      `).run(adminUser.schoolId, rawUser.id);
    }

    const payments = db.getPayments(adminUser, adminUser.schoolId);
    assert.ok(Array.isArray(payments), 'getPayments doit retourner un tableau');
    assert.ok(payments.length > 0, 'Au moins un paiement attendu pour l\'école 1');

    for (const p of payments) {
      assert.ok('receiptNumber' in p, `Paiement #${p.id} : propriété receiptNumber manquante`);
      assert.ok('receiptId' in p, `Paiement #${p.id} : propriété receiptId manquante`);
    }
  });

  test('SDM-01-B: Les paiements avec quittance ont un receiptNumber non-null', () => {
    const rawUser = db.db.prepare("SELECT id FROM users WHERE email = ?").get(TEST_USERS.adminSainteMarie);
    if (!rawUser) return;
    const adminUser = db.getUserById(rawUser.id);
    if (!adminUser || !adminUser.schoolId) return;

    const payments = db.getPayments(adminUser, adminUser.schoolId);
    const withReceipt = payments.filter(p => p.receiptId !== null && p.receiptId !== undefined);
    if (withReceipt.length === 0) return;

    for (const p of withReceipt) {
      assert.ok(
        p.receiptNumber && !String(p.receiptNumber).startsWith('QUIT-'),
        `Paiement #${p.id} : receiptNumber "${p.receiptNumber}" devrait être le N° séquentiel officiel`
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SDM-02 : getStudentByIdScoped() enrichi
// ─────────────────────────────────────────────────────────────────────────────
describe('SDM-02: getStudentByIdScoped() — enrichi avec school + payments', () => {
  test('SDM-02-A: Retourne schoolName et schoolCode non vides', () => {
    const rawUser = db.db.prepare("SELECT id FROM users WHERE email = ?").get(TEST_USERS.adminSainteMarie);
    if (!rawUser) return;
    const adminUser = db.getUserById(rawUser.id);
    if (!adminUser || !adminUser.schoolId) return;

    const st = db.getStudentByIdScoped(adminUser, FIXTURE_STUDENT_ID);
    assert.ok(st, 'Élève #1 doit être trouvé');
    assert.equal(typeof st.schoolName, 'string', 'schoolName doit être une chaîne');
    assert.ok(st.schoolName.length > 0, 'schoolName doit être non vide');
    assert.equal(typeof st.schoolCode, 'string', 'schoolCode doit être une chaîne');
    assert.ok(st.schoolCode.length > 0, 'schoolCode doit être non vide');
  });

  test('SDM-02-B: Retourne un tableau payments[] avec les propriétés attendues', () => {
    const rawUser = db.db.prepare("SELECT id FROM users WHERE email = ?").get(TEST_USERS.adminSainteMarie);
    if (!rawUser) return;
    const adminUser = db.getUserById(rawUser.id);
    if (!adminUser || !adminUser.schoolId) return;

    const st = db.getStudentByIdScoped(adminUser, FIXTURE_STUDENT_ID);
    assert.ok(Array.isArray(st.payments), 'payments doit être un Array');
    if (st.payments.length > 0) {
      const p = st.payments[0];
      assert.ok('receiptNumber' in p, 'Chaque paiement doit avoir receiptNumber');
      assert.ok('amount' in p, 'Chaque paiement doit avoir amount');
      assert.ok('createdAt' in p, 'Chaque paiement doit avoir createdAt');
      assert.ok('ref' in p, 'Chaque paiement doit avoir ref');
    }
  });

  test('SDM-02-C: Isolation multi-tenant — admin école 2 ne peut PAS voir élève école 1', () => {
    const sch2Raw = db.db.prepare('SELECT id FROM users WHERE id = 999').get();
    if (!sch2Raw) return;
    const sch2User = db.getUserById(sch2Raw.id);
    if (!sch2User) return;

    assert.throws(
      () => db.getStudentByIdScoped(sch2User, FIXTURE_STUDENT_ID),
      /accès|access|permission|forbidden|perimetre/i,
      'Doit lever une AccessError pour un utilisateur d\'une autre école'
    );
  });

  test('SDM-02-D: L\'élève retourné ne contient aucun champ sensible', () => {
    const rawUser = db.db.prepare("SELECT id FROM users WHERE email = ?").get(TEST_USERS.adminSainteMarie);
    if (!rawUser) return;
    const adminUser = db.getUserById(rawUser.id);
    if (!adminUser || !adminUser.schoolId) return;

    const st = db.getStudentByIdScoped(adminUser, FIXTURE_STUDENT_ID);
    const raw = JSON.stringify(st).toLowerCase();
    assert.ok(!raw.includes('password'), 'Aucun champ password dans getStudentByIdScoped');
    assert.ok(!raw.includes('token_hash'), 'Aucun token_hash dans getStudentByIdScoped');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SDM-03 : API HTTP GET /api/students/:id — RBAC
// ─────────────────────────────────────────────────────────────────────────────
describe('SDM-03: API GET /api/students/:id — RBAC & données enrichies', () => {
  test('SDM-03-A: Admin école 1 reçoit 200 + schoolName + payments[]', async () => {
    const r = await makeRequest(baseUrl, {
      path: `/api/students/${FIXTURE_STUDENT_ID}`,
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(r.statusCode, 200, `HTTP 200 attendu (reçu ${r.statusCode})`);
    assert.ok(r.json, 'Réponse JSON attendue');
    assert.ok(r.json.nomPrenom, 'nomPrenom exposé');
    assert.ok(typeof r.json.schoolName === 'string', 'schoolName exposé dans la réponse API');
    assert.ok(Array.isArray(r.json.payments), 'payments[] exposé dans la réponse API');
    if (r.json.payments.length > 0) {
      assert.ok('receiptNumber' in r.json.payments[0], 'receiptNumber dans payments[0]');
    }
  });

  test('SDM-03-B: Admin école 2 ne peut pas voir un élève de l\'école 1 (403)', async () => {
    const r = await makeRequest(baseUrl, {
      path: `/api/students/${FIXTURE_STUDENT_ID}`,
      method: 'GET',
      headers: { Cookie: school2Cookie }
    });
    assert.ok(
      [403, 404].includes(r.statusCode),
      `Doit retourner 403 ou 404 pour une école étrangère (reçu: ${r.statusCode})`
    );
  });

  test('SDM-03-C: Visiteur non authentifié reçoit 401 ou redirection', async () => {
    const r = await makeRequest(baseUrl, {
      path: `/api/students/${FIXTURE_STUDENT_ID}`,
      method: 'GET'
    });
    assert.ok(
      [401, 302].includes(r.statusCode),
      `Doit retourner 401 sans cookie (reçu: ${r.statusCode})`
    );
  });

  test('SDM-03-D: Aucune donnée sensible dans la réponse API', async () => {
    const r = await makeRequest(baseUrl, {
      path: `/api/students/${FIXTURE_STUDENT_ID}`,
      method: 'GET',
      headers: { Cookie: adminCookie }
    });
    assert.equal(r.statusCode, 200);
    const raw = r.body.toLowerCase();
    assert.ok(!raw.includes('"password"'), 'Aucun champ password dans la réponse');
    assert.ok(!raw.includes('token_hash'), 'Aucun token_hash dans la réponse');
    assert.ok(!raw.includes('"secret"'), 'Aucun champ secret dans la réponse');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SDM-04 : DOM index.html — Modal #modal-student-detail
// ─────────────────────────────────────────────────────────────────────────────
describe('SDM-04: DOM index.html — Modal #modal-student-detail et ses IDs', () => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  let html;

  before(() => { html = fs.readFileSync(htmlPath, 'utf8'); });

  const requiredIds = [
    'modal-student-detail',
    'sdm-header',
    'sdm-initials',
    'sdm-name',
    'sdm-statut-badge',
    'sdm-matricule',
    'sdm-dob',
    'sdm-sexe',
    'sdm-tuteur',
    'sdm-phone',
    'sdm-email',
    'sdm-school',
    'sdm-year',
    'sdm-niveau',
    'sdm-classe',
    'sdm-red',
    'sdm-cashdesk',
    'sdm-fee-due',
    'sdm-fee-paid',
    'sdm-fee-balance',
    'sdm-balance-box',
    'sdm-pay-btn',
    'sdm-receipts-list'
  ];

  for (const id of requiredIds) {
    test(`SDM-04: L'id "${id}" est déclaré dans le DOM`, () => {
      assert.ok(html.includes(`id="${id}"`), `L'id "${id}" doit être présent dans index.html`);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SDM-05 : DOM index.html — Fonctions JS déclarées (ERP-02)
// ─────────────────────────────────────────────────────────────────────────────
describe('SDM-05: DOM index.html — Fonctions JS déclarées', () => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  let html;

  before(() => { html = fs.readFileSync(htmlPath, 'utf8'); });

  const requiredFns = [
    'function openStudentDetailModal',
    'function closeStudentDetailModal',
    'function payForCurrentStudent',
    'function printReceiptById'
  ];

  for (const fn of requiredFns) {
    test(`SDM-05: "${fn}" est définie dans index.html`, () => {
      assert.ok(html.includes(fn), `"${fn}" doit être déclarée dans index.html`);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SDM-06 : DOM — receiptNumber affiché + noms cliquables
// ─────────────────────────────────────────────────────────────────────────────
describe('SDM-06: DOM index.html — receiptNumber et noms cliquables dans les caisses', () => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  let html;

  before(() => { html = fs.readFileSync(htmlPath, 'utf8'); });

  test('SDM-06-A: renderMainCashDesk affiche p.receiptNumber', () => {
    const start = html.indexOf('function renderMainCashDesk');
    const end = html.indexOf('function renderPendingDeposits', start);
    const body = start !== -1 && end !== -1 ? html.slice(start, end) : '';
    assert.ok(body.includes('receiptNumber'), 'renderMainCashDesk doit afficher p.receiptNumber');
  });

  test('SDM-06-B: renderSecondaryCashDesk affiche p.receiptNumber', () => {
    const start = html.indexOf('function renderSecondaryCashDesk');
    const end = html.indexOf('function resetSecondaryDepositForm', start);
    const body = start !== -1 && end !== -1 ? html.slice(start, end) : '';
    assert.ok(body.includes('receiptNumber'), 'renderSecondaryCashDesk doit afficher p.receiptNumber');
  });

  test('SDM-06-C: renderConsultJournal (vue consolidée) affiche p.receiptNumber', () => {
    const start = html.indexOf('function renderConsultJournal');
    const end = html.indexOf('function renderImpayesTable', start);
    const body = start !== -1 && end !== -1 ? html.slice(start, end) : '';
    assert.ok(body.includes('receiptNumber'), 'renderConsultJournal (vue consolidée) doit afficher p.receiptNumber');
  });

  test('SDM-06-D: renderMainCashDesk rend le nom de l\'élève cliquable via openStudentDetailModal', () => {
    const start = html.indexOf('function renderMainCashDesk');
    const end = html.indexOf('function renderPendingDeposits', start);
    const body = start !== -1 && end !== -1 ? html.slice(start, end) : '';
    assert.ok(body.includes('openStudentDetailModal'), 'renderMainCashDesk doit appeler openStudentDetailModal');
  });

  test('SDM-06-E: renderSecondaryCashDesk rend le nom de l\'élève cliquable', () => {
    const start = html.indexOf('function renderSecondaryCashDesk');
    const end = html.indexOf('function resetSecondaryDepositForm', start);
    const body = start !== -1 && end !== -1 ? html.slice(start, end) : '';
    assert.ok(body.includes('openStudentDetailModal'), 'renderSecondaryCashDesk doit appeler openStudentDetailModal');
  });

  test('SDM-06-F: renderConsultJournal rend le nom de l\'élève cliquable', () => {
    const start = html.indexOf('function renderConsultJournal');
    const end = html.indexOf('function renderImpayesTable', start);
    const body = start !== -1 && end !== -1 ? html.slice(start, end) : '';
    assert.ok(body.includes('openStudentDetailModal'), 'renderConsultJournal doit appeler openStudentDetailModal');
  });

  test('SDM-06-G: renderStudentsTable rend le nom de l\'élève cliquable', () => {
    const start = html.indexOf('function renderStudentsTable');
    const end = html.indexOf('function updateKPIs', start);
    const body = start !== -1 && end !== -1 ? html.slice(start, end) : '';
    assert.ok(body.includes('openStudentDetailModal'), 'renderStudentsTable doit appeler openStudentDetailModal');
  });

  test('SDM-06-H: renderFinanceTable rend le nom de l\'élève cliquable', () => {
    const start = html.indexOf('function renderFinanceTable');
    const end = html.indexOf('function numberToFrenchWords', start);
    const body = start !== -1 && end !== -1 ? html.slice(start, end) : '';
    assert.ok(body.includes('openStudentDetailModal'), 'renderFinanceTable doit appeler openStudentDetailModal');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SDM-07 : ERP-01 — Chaque id appelé en JS est déclaré dans le HTML
// ─────────────────────────────────────────────────────────────────────────────
describe('SDM-07: ERP-01 — IDs utilisés en JS déclarés dans le DOM', () => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  let html;

  before(() => { html = fs.readFileSync(htmlPath, 'utf8'); });

  const idsUsedByJs = [
    'modal-student-detail',
    'sdm-name', 'sdm-matricule', 'sdm-statut-badge', 'sdm-initials',
    'sdm-dob', 'sdm-sexe', 'sdm-tuteur', 'sdm-phone', 'sdm-email',
    'sdm-school', 'sdm-year', 'sdm-niveau', 'sdm-classe', 'sdm-red', 'sdm-cashdesk',
    'sdm-fee-due', 'sdm-fee-paid', 'sdm-fee-balance', 'sdm-balance-box',
    'sdm-pay-btn', 'sdm-receipts-list'
  ];

  for (const id of idsUsedByJs) {
    test(`ERP-01: getElementById('${id}') → id="${id}" présent dans le HTML`, () => {
      assert.ok(
        html.includes(`id="${id}"`),
        `L'id "${id}" utilisé par JS doit être déclaré dans le HTML`
      );
    });
  }
});
