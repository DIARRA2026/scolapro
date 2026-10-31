/**
 * Tests de non-régression et de conformité pour :
 * 1. L'affichage garanti des numéros de quittance (Opérations consolidées, Caisse secondaire, Journal de caisse)
 * 2. La persistance et non-disparition des données lors de la déconnexion/reconnexion (Bootstrap & Offline Sync)
 * 3. L'actualisation automatique et temps-réel du tableau de bord lors d'un versement
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { db } = require('./helpers');

describe('SUITE : Persistance des données, Quittances et Synchronisation Tableau de Bord', () => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  let htmlContent;

  before(() => {
    htmlContent = fs.readFileSync(htmlPath, 'utf8');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. VÉRIFICATION BACKEND : DB & FORMAT PAYMENT & BOOTSTRAP
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Backend SQLite/DB : Enregistrement de paiement et Quittances', () => {
    test('DB-01: formatPayment enrichit receiptNumber et receiptId', () => {
      const mockRow = {
        id: 9999,
        school_id: 1,
        student_id: 10,
        nom_prenom: 'Kouassi Yao',
        amount: 25000,
        payment_method: 'ESPECES',
        ref: 'REF-TEST-01',
        receipt_id: 'RCPT-9999',
        receipt_number: 'M6-2026-2027-009999',
        cash_desk: 'PRINCIPALE',
        cashier_id: 1,
        cashier_name: 'Caissier Principal',
        created_at: '2026-10-05 10:00:00'
      };
      const formatted = db.formatPayment(mockRow);
      assert.ok(formatted, 'formatPayment doit renvoyer un objet');
      assert.equal(formatted.receiptNumber, 'M6-2026-2027-009999');
      assert.equal(formatted.receiptId, 'RCPT-9999');
      assert.equal(formatted.cashDesk, 'PRINCIPALE');
      assert.equal(formatted.amount, 25000);
    });

    test('DB-02: recordPayment renvoie payment avec receiptNumber et cashDesks à jour', () => {
      const adminUser = { id: 1, role: 'admin', schoolId: 1, rank: 3, prenom: 'Admin', nom: 'Principal' };
      const testMatricule = '26SYNC999Z';
      db.db.prepare('DELETE FROM students WHERE matricule = ?').run(testMatricule);

      const insertStudent = db.db.prepare(`
        INSERT INTO students (school_id, matricule, nom_prenom, niveau, classe, statut, fee_due, fee_paid)
        VALUES (1, ?, 'Élève Test Synchronisation', 'Collège', '3ÈME 1', 'AFF', 100000, 0)
      `).run(testMatricule);
      const studentId = Number(insertStudent.lastInsertRowid);

      try {
        const payRes = db.recordPayment(adminUser, {
          studentId: studentId,
          amount: 25000,
          paymentMethod: 'ESPECES',
          ref: `TST-${Date.now()}`
        });

        assert.ok(payRes.payment, 'recordPayment doit retourner un objet payment');
        assert.ok(payRes.payment.receiptNumber, 'payment.receiptNumber doit être présent');
        assert.ok(payRes.payment.receiptId, 'payment.receiptId doit être présent');
        assert.ok(payRes.receipt, 'recordPayment doit retourner les données receipt');
        assert.equal(payRes.receipt.receiptNumber, payRes.payment.receiptNumber);
        assert.ok(Array.isArray(payRes.cashDesks), 'recordPayment doit retourner la liste des cashDesks');
      } finally {
        db.db.prepare('DELETE FROM payments WHERE student_id = ?').run(studentId);
        db.db.prepare('DELETE FROM receipts WHERE student_id = ?').run(studentId);
        db.db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
      }
    });

    test('DB-03: getBootstrapData inclut payments, cashDesks et cashDeposits', () => {
      const adminUser = { id: 1, role: 'admin', schoolId: 1, rank: 3, prenom: 'Admin', nom: 'Principal' };
      const bootData = db.getBootstrapData(adminUser);
      assert.ok(bootData, 'getBootstrapData doit renvoyer des données');
      assert.ok(Array.isArray(bootData.payments), 'bootData.payments doit être un tableau');
      assert.ok(Array.isArray(bootData.cashDesks), 'bootData.cashDesks doit être un tableau');
      assert.ok(Array.isArray(bootData.cashDeposits), 'bootData.cashDeposits doit être un tableau');
      assert.ok(Array.isArray(bootData.students), 'bootData.students doit être un tableau');
      assert.ok(Array.isArray(bootData.schools), 'bootData.schools doit être un tableau');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. VÉRIFICATION CLIENT : PERSISTANCE ET RÉHYDRATATION APRÈS RECONNEXION
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Client index.html : Persistance et réhydratation après déconnexion/reconnexion', () => {
    test('CLIENT-01: rehydrateAppData est déclarée et gère payments, cashDesks et localStorage', () => {
      assert.ok(htmlContent.includes('function rehydrateAppData('), 'rehydrateAppData doit être déclarée');
      
      const start = htmlContent.indexOf('function rehydrateAppData(');
      const end = htmlContent.indexOf('function ensureDemoSession()', start);
      const body = htmlContent.slice(start, end);

      assert.ok(body.includes('appState.payments = data.payments'), 'rehydrateAppData doit hydrater payments');
      assert.ok(body.includes('appState.cashDesks = data.cashDesks'), 'rehydrateAppData doit hydrater cashDesks');
      assert.ok(body.includes('appState.students = data.students'), 'rehydrateAppData doit hydrater students');
      assert.ok(body.includes("localStorage.setItem('scolapro_payments'"), 'rehydrateAppData doit sauvegarder payments dans localStorage');
      assert.ok(body.includes("localStorage.setItem('scolapro_cashdesks'"), 'rehydrateAppData doit sauvegarder cashDesks dans localStorage');
      assert.ok(body.includes('renderDashboardByRole()'), 'rehydrateAppData doit réactualiser le tableau de bord');
      assert.ok(body.includes('renderMainCashDesk()'), 'rehydrateAppData doit réactualiser la caisse principale');
    });

    test('CLIENT-02: handleSecureLoginSubmit appelle rehydrateAppData pour réhydrater après connexion', () => {
      const start = htmlContent.indexOf('async function handleSecureLoginSubmit(');
      const end = htmlContent.indexOf('function closeSecureLoginModal()', start > 0 ? start - 500 : 0);
      assert.ok(start > 0, 'handleSecureLoginSubmit doit exister');
      
      const body = htmlContent.slice(start, start + 3000);
      assert.ok(body.includes('rehydrateAppData(bootData)'), 'handleSecureLoginSubmit doit appeler rehydrateAppData avec bootData');
    });

    test('CLIENT-03: ensureDemoSession appelle rehydrateAppData pour réhydrater les données', () => {
      const start = htmlContent.indexOf('async function ensureDemoSession(');
      assert.ok(start > 0, 'ensureDemoSession doit exister');
      const body = htmlContent.slice(start, start + 1500);
      assert.ok(body.includes('rehydrateAppData(bData)'), 'ensureDemoSession doit appeler rehydrateAppData');
    });

    test('CLIENT-04: window DOMContentLoaded réhydrate avec /api/bootstrap et rehydrateAppData', () => {
      const start = htmlContent.indexOf("window.addEventListener('DOMContentLoaded'");
      assert.ok(start > 0, 'DOMContentLoaded doit exister');
      const body = htmlContent.slice(start, start + 2500);
      assert.ok(body.includes('rehydrateAppData(data)'), 'DOMContentLoaded doit appeler rehydrateAppData');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. VÉRIFICATION CLIENT : AFFICHAGE DES NUMÉROS DE QUITTANCE DANS LES LISTES
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Client index.html : Affichage des numéros de quittance dans les tableaux', () => {
    test('RCPT-TBL-01: renderMainCashDesk affiche p.receiptNumber dans le tableau des opérations', () => {
      const start = htmlContent.indexOf('function renderMainCashDesk()');
      const end = htmlContent.indexOf('function renderPendingDeposits()', start);
      const body = htmlContent.slice(start, end);

      assert.ok(body.includes('receiptNumber'), 'renderMainCashDesk doit inclure receiptNumber');
      assert.ok(body.includes('p.receiptNumber || p.receipt_number || p.ref'), 'renderMainCashDesk doit prioriser p.receiptNumber');
    });

    test('RCPT-TBL-02: renderSecondaryCashDesk affiche p.receiptNumber dans la liste de caisse secondaire', () => {
      const start = htmlContent.indexOf('function renderSecondaryCashDesk()');
      const end = htmlContent.indexOf('function resetSecondaryDepositForm()', start);
      const body = htmlContent.slice(start, end);

      assert.ok(body.includes('receiptNumber'), 'renderSecondaryCashDesk doit inclure receiptNumber');
      assert.ok(body.includes('p.receiptNumber || p.receipt_number || p.ref'), 'renderSecondaryCashDesk doit prioriser p.receiptNumber');
    });

    test('RCPT-TBL-03: renderConsultJournal affiche p.receiptNumber dans le journal consolidé', () => {
      const start = htmlContent.indexOf('function renderConsultJournal()');
      const end = htmlContent.indexOf('function renderImpayesTable()', start);
      const body = htmlContent.slice(start, end);

      assert.ok(body.includes('receiptNumber'), 'renderConsultJournal doit inclure receiptNumber');
      assert.ok(body.includes('p.receiptNumber || p.receipt_number || p.ref'), 'renderConsultJournal doit prioriser p.receiptNumber');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. VÉRIFICATION CLIENT : ACTUALISATION AUTOMATIQUE DU TABLEAU DE BORD
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Client index.html : Actualisation automatique lors d\'un versement', () => {
    test('SYNC-01: applyPaymentSuccess met à jour le solde de la caisse et déclenche renderDashboardByRole', () => {
      assert.ok(htmlContent.includes('function applyPaymentSuccess('), 'applyPaymentSuccess doit être définie');
      const start = htmlContent.indexOf('function applyPaymentSuccess(');
      const end = htmlContent.indexOf('async function refreshPaymentsFromServer()', start);
      const body = htmlContent.slice(start, end);

      assert.ok(body.includes('renderDashboardByRole()'), 'applyPaymentSuccess doit appeler renderDashboardByRole');
      assert.ok(body.includes('updateKPIs()'), 'applyPaymentSuccess doit appeler updateKPIs');
      assert.ok(body.includes('renderMainCashDesk()'), 'applyPaymentSuccess doit appeler renderMainCashDesk');
      assert.ok(body.includes('renderSecondaryCashDesk()'), 'applyPaymentSuccess doit appeler renderSecondaryCashDesk');
      assert.ok(body.includes('renderConsultJournal()'), 'applyPaymentSuccess doit appeler renderConsultJournal');
      assert.ok(body.includes('renderConsultStats()'), 'applyPaymentSuccess doit appeler renderConsultStats');
      assert.ok(body.includes('appState.payments.unshift'), 'applyPaymentSuccess doit insérer le nouveau paiement en tête de liste');
      assert.ok(body.includes('receiptNumber: officialReceiptNo'), 'applyPaymentSuccess doit assigner le numéro officiel de quittance');
    });

    test('SYNC-02: quickCollect appelle applyPaymentSuccess', () => {
      const start = htmlContent.indexOf('async function quickCollect(');
      const end = htmlContent.indexOf('function resetPaymentForm()', start);
      const body = htmlContent.slice(start, end);

      assert.ok(body.includes('applyPaymentSuccess('), 'quickCollect doit appeler applyPaymentSuccess');
    });

    test('SYNC-03: confirmPayment appelle applyPaymentSuccess', () => {
      const start = htmlContent.indexOf('async function confirmPayment()');
      const end = htmlContent.indexOf('function printReceipt(', start);
      const body = htmlContent.slice(start, end);

      assert.ok(body.includes('applyPaymentSuccess('), 'confirmPayment doit appeler applyPaymentSuccess');
    });

    test('SYNC-04: setConsultSubTab déclenche le rafraîchissement des paiements et stats', () => {
      const start = htmlContent.indexOf('function setConsultSubTab(');
      const end = htmlContent.indexOf('function renderConsultStats()', start);
      const body = htmlContent.slice(start, end);

      assert.ok(body.includes('refreshPaymentsFromServer()'), 'setConsultSubTab doit appeler refreshPaymentsFromServer');
      assert.ok(body.includes('renderConsultStats()'), 'setConsultSubTab doit appeler renderConsultStats');
    });
  });
});
