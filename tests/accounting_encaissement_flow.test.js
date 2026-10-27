/**
 * Tests de validation complète pour le flux d'encaissement :
 * 1. Le comptable fait le paiement
 * 2. Le paiement est enregistré en base et s'affiche dans la liste des paiements
 * 3. Le montant payé est ajouté au montant global payé et s'affiche sur le tableau de bord de l'école et de la fondation
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../db');
const { hasPermission, getRolePermissions } = require('../lib/rbac');

describe('SUITE : Logique Métier Encaissement, Listes et Tableaux de Bord (École & Fondation)', () => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  let htmlContent;

  before(() => {
    htmlContent = fs.readFileSync(htmlPath, 'utf8');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. RÔLE COMPTABLE & PERMISSIONS D'ENCAISSEMENT
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Rôle Comptable & Habilitations RBAC', () => {
    test('RBAC-01: Le rôle comptable dispose de la permission payments.create', () => {
      const comptableUser = { id: 42, role: 'comptable', rank: 3, schoolId: 1 };
      assert.equal(hasPermission(comptableUser, 'payments.create'), true, 'Le comptable doit pouvoir encaisser (payments.create)');
      assert.equal(hasPermission(comptableUser, 'payments.view'), true, 'Le comptable doit pouvoir consulter les paiements (payments.view)');
      assert.equal(hasPermission(comptableUser, 'cash.view'), true, 'Le comptable doit pouvoir voir les caisses (cash.view)');
    });

    test('RBAC-02: Le rôle comptable a les permissions de gestion financière d\'établissement', () => {
      const perms = getRolePermissions('comptable');
      assert.ok(perms.includes('payments.create'));
      assert.ok(perms.includes('payments.view'));
      assert.ok(perms.includes('cash.view'));
      assert.ok(perms.includes('cash.deposit.create'));
      assert.ok(perms.includes('cash.deposit.validate'));
      assert.ok(perms.includes('ecolage.view'));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. ENCAISSEMENT PAR LE COMPTABLE & PERSISTANCE EN BASE DE DONNÉES
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Enregistrement en Base & Liste des Paiements', () => {
    const testMatricule = '26COMPTA01Z';
    let studentId;
    let schoolId = 1;
    let deskId = 'S1_PRINCIPALE';

    before(() => {
      // Nettoyage et initialisation d'un élève test
      db.db.prepare('DELETE FROM students WHERE matricule = ?').run(testMatricule);

      // S'assurer qu'une caisse active existe pour schoolId = 1
      const existingDesk = db.db.prepare(`SELECT id FROM cash_desks WHERE school_id = ? AND type = 'PRINCIPALE'` ).get(schoolId);
      if (existingDesk) {
        deskId = existingDesk.id;
      } else {
        db.db.prepare(`
          INSERT OR IGNORE INTO cash_desks (id, school_id, name, type, balance, status)
          VALUES ('S1_PRINCIPALE', 1, 'Caisse Principale', 'PRINCIPALE', 0, 'ACTIVE')
        `).run();
      }

      const insert = db.db.prepare(`
        INSERT INTO students (school_id, matricule, nom_prenom, niveau, classe, statut, fee_due, fee_paid)
        VALUES (1, ?, 'Koffi Paul (Test Comptable)', 'Lycée', '1ÈRE A', 'AFF', 150000, 0)
      `).run(testMatricule);
      studentId = Number(insert.lastInsertRowid);
    });

    test('ENC-01: Le comptable effectue un versement (recordPayment)', () => {
      const comptableUser = {
        id: 77,
        role: 'comptable',
        schoolId: 1,
        rank: 3,
        prenom: 'Économe',
        nom: 'Comptable',
        scopeType: 'SCHOOL',
        scopeValue: [1]
      };

      const paymentAmount = 45000;
      const result = db.recordPayment(comptableUser, {
        studentId: studentId,
        amount: paymentAmount,
        paymentMethod: 'ESPECES',
        cashDesk: deskId
      });

      assert.ok(result, 'recordPayment doit retourner un résultat');
      assert.ok(result.payment, 'Le paiement doit être retourné');
      assert.equal(result.payment.amount, paymentAmount);
      assert.ok(result.receipt, 'Une quittance officielle doit être générée');
      assert.ok(result.receipt.receiptNumber, 'Le numéro de quittance séquentiel doit être présent');
      assert.equal(result.student.feePaid, paymentAmount);

      // Vérification en base SQLite directe
      const stRow = db.db.prepare('SELECT fee_paid, fee_due FROM students WHERE id = ?').get(studentId);
      assert.equal(stRow.fee_paid, paymentAmount, 'fee_paid en base doit valoir exactement 45000');

      const payRow = db.db.prepare('SELECT * FROM payments WHERE id = ?').get(result.payment.id);
      assert.ok(payRow, 'La transaction doit être persistée dans la table payments');
      assert.equal(payRow.amount, paymentAmount);
      assert.equal(payRow.cashier_id, 77);

      const rcptRow = db.db.prepare('SELECT * FROM receipts WHERE payment_id = ?').get(result.payment.id);
      assert.ok(rcptRow, 'La quittance doit être enregistrée dans la table receipts');
      assert.equal(rcptRow.amount, paymentAmount);
      assert.equal(rcptRow.student_id, studentId);
    });

    test('ENC-02: Le paiement apparaît dans la liste des paiements (getPayments)', () => {
      const comptableUser = {
        id: 77,
        role: 'comptable',
        schoolId: 1,
        rank: 3,
        prenom: 'Économe',
        nom: 'Comptable',
        scopeType: 'SCHOOL',
        scopeValue: [1]
      };

      const payments = db.getPayments(comptableUser, 1);
      assert.ok(Array.isArray(payments), 'getPayments doit retourner une liste');
      assert.ok(payments.length > 0, 'La liste des paiements ne doit pas être vide');

      const matchingPayment = payments.find(p => p.studentId === studentId);
      assert.ok(matchingPayment, 'Le paiement de l\'élève doit figurer dans la liste des paiements');
      assert.equal(matchingPayment.amount, 45000);
      assert.ok(matchingPayment.receiptNumber, 'Le paiement dans la liste doit comporter son numéro officiel de quittance');
    });

    test('ENC-03: Un second versement s\'additionne au montant payé et génère une nouvelle quittance', () => {
      const comptableUser = {
        id: 77,
        role: 'comptable',
        schoolId: 1,
        rank: 3,
        prenom: 'Économe',
        nom: 'Comptable',
        scopeType: 'SCHOOL',
        scopeValue: [1]
      };

      const secondAmount = 30000;
      const result2 = db.recordPayment(comptableUser, {
        studentId: studentId,
        amount: secondAmount,
        paymentMethod: 'MOBILE_MONEY',
        cashDesk: deskId
      });

      assert.equal(result2.student.feePaid, 75000, '45000 + 30000 = 75000 payé');
      const stRow = db.db.prepare('SELECT fee_paid FROM students WHERE id = ?').get(studentId);
      assert.equal(stRow.fee_paid, 75000);

      const payments = db.getPayments(comptableUser, 1);
      const studentPayments = payments.filter(p => p.studentId === studentId);
      assert.equal(studentPayments.length, 2, 'L\'élève doit maintenant avoir 2 paiements distincts dans la liste');
    });

    test('ENC-04: Rejet strict si le versement dépasse le solde restant', () => {
      const comptableUser = {
        id: 77,
        role: 'comptable',
        schoolId: 1,
        rank: 3,
        prenom: 'Économe',
        nom: 'Comptable',
        scopeType: 'SCHOOL',
        scopeValue: [1]
      };

      // fee_due = 150000, fee_paid = 75000 => reste 75000
      assert.throws(() => {
        db.recordPayment(comptableUser, {
          studentId: studentId,
          amount: 80000, // Excède le solde de 5000
          paymentMethod: 'ESPECES',
          cashDesk: deskId
        });
      }, /excède le solde restant dû/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. TABLEAUX DE BORD ÉCOLE & FONDATION
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Mise à Jour du Montant Global Payé sur les Tableaux de Bord (École & Fondation)', () => {
    test('DASH-01: getLiveSchoolMetrics et formatSchool calculent fidèlement totalPaid pour l\'école', () => {
      const metricsMap = db.getLiveSchoolMetrics([1]);
      const metrics = metricsMap.get(1);
      assert.ok(metrics, 'Les métriques temps réel de l\'école #1 doivent exister');
      assert.ok(metrics.totalPaid > 0, 'Le montant global payé de l\'école doit être supérieur à zéro');
      assert.ok(metrics.totalDue > 0, 'Le total dû doit être calculé');
      assert.ok(metrics.recoveryRate >= 0, 'Le taux de recouvrement doit être calculé');

      const rawSchool = db.db.prepare('SELECT * FROM schools WHERE id = 1').get();
      const formatted = db.formatSchool(rawSchool, metrics);
      assert.ok(formatted, 'formatSchool doit renvoyer un objet');
      assert.equal(formatted.totalPaid, metrics.totalPaid, 'L\'établissement formaté doit contenir totalPaid');
      assert.equal(formatted.totalDue, metrics.totalDue, 'L\'établissement formaté doit contenir totalDue');
      assert.equal(formatted.totalCash, metrics.totalCash, 'L\'établissement formaté doit contenir totalCash');
    });

    test('DASH-02: getFoundationConsolidatedData inclut totalPaid consolidé pour la fondation', () => {
      const adminUser = { id: 1, role: 'concepteur', rank: 1 };
      const foundRow = db.db.prepare('SELECT id FROM foundations LIMIT 1').get();
      if (!foundRow) return; // Si aucune fondation en base, passer

      const consolidatedData = db.getFoundationConsolidatedData(adminUser, foundRow.id);
      assert.ok(consolidatedData.success, 'L\'appel consolidé doit réussir');
      assert.ok(consolidatedData.stats, 'stats doit être présent');
      assert.ok(consolidatedData.consolidated, 'consolidated doit être présent');
      assert.ok(consolidatedData.consolidated.totalPaid !== undefined, 'consolidated.totalPaid doit être présent');
      assert.ok(consolidatedData.consolidated.totalDue !== undefined, 'consolidated.totalDue doit être présent');
      assert.equal(consolidatedData.consolidated.totalPaid, consolidatedData.stats.totalPaid);
    });

    test('DASH-03: formatFoundation inclut totalPaid et totalDue', () => {
      const rawFound = db.db.prepare('SELECT * FROM foundations LIMIT 1').get();
      if (!rawFound) return;

      const schools = db.getSchools({ id: 1, role: 'concepteur', rank: 1 }, rawFound.id);
      const formatted = db.formatFoundation(rawFound, schools);
      assert.ok(formatted, 'formatFoundation doit renvoyer la fondation enrichie');
      assert.ok(formatted.totalPaid !== undefined, 'La fondation formatée doit exposer totalPaid');
      assert.ok(formatted.totalDue !== undefined, 'La fondation formatée doit exposer totalDue');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. CONFORMITÉ FRONTEND (index.html)
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Interface Utilisateur & Éléments DOM (index.html)', () => {
    test('UI-01: La vue fondation contient la carte Montant Global Payé (kpi-found-paid-total)', () => {
      assert.ok(htmlContent.includes('id="kpi-found-paid-total"'), 'Le KPI Montant Global Payé doit exister dans la vue fondation');
      assert.ok(htmlContent.includes('Montant Global Payé'), 'Le libellé Montant Global Payé doit être présent');
      assert.ok(htmlContent.includes('grid-cols-5'), 'La grille KPI fondation doit comporter 5 colonnes');
    });

    test('UI-02: Le tableau comparatif fondation contient la colonne Montant Global Payé', () => {
      assert.ok(htmlContent.includes('<th class="py-3 px-3.5 text-right">Montant Global Payé</th>'), 'L\'en-tête de colonne Montant Global Payé doit être dans le comparatif fondation');
    });

    test('UI-03: renderFoundationDashboard alimente kpi-found-paid-total en local et via API', () => {
      assert.ok(htmlContent.includes("document.getElementById('kpi-found-paid-total')"), 'renderFoundationDashboard doit mettre à jour kpi-found-paid-total');
      assert.ok(htmlContent.includes('totalTuitionPaid'), 'totalTuitionPaid doit être calculé dans renderFoundationDashboard');
    });

    test('UI-04: renderDashboardByRole propose un tableau de bord complet pour le profil comptable', () => {
      assert.ok(htmlContent.includes("user.role === 'comptable'"), 'renderDashboardByRole doit avoir une branche dédiée user.role === comptable');
      assert.ok(htmlContent.includes('Espace Comptabilité &amp; Encaissements'), 'Le titre comptable doit être présent');
      assert.ok(htmlContent.includes('openPaymentModal()'), 'Un bouton d\'encaissement rapide doit être accessible');
      assert.ok(htmlContent.includes('kpi-school-paid-total'), 'Le KPI du montant payé doit être sur le dashboard comptable');
      assert.ok(htmlContent.includes('Derniers Encaissements Enregistrés (Liste des Paiements)'), 'La liste des paiements récents doit être affichée sur le dashboard');
    });

    test('UI-05: renderDashboardByRole inclut le Montant Global Payé pour tous les rôles superviseurs et administratifs', () => {
      assert.ok(htmlContent.includes('Montant Global Payé'), 'Montant Global Payé doit être affiché');
      assert.ok(htmlContent.includes('${schoolTotalPaid.toLocaleString(\'fr-FR\')}'), 'schoolTotalPaid doit être formaté et rendu');
    });

    test('UI-06: applyPaymentSuccess synchronise les totaux d\'école et déclenche le rafraîchissement fondation et école', () => {
      assert.ok(htmlContent.includes('targetSchool.totalPaid = (targetSchool.totalPaid || 0) + amount'), 'applyPaymentSuccess doit incrémenter totalPaid de l\'école');
      assert.ok(htmlContent.includes('renderFoundationDashboard()'), 'applyPaymentSuccess doit appeler renderFoundationDashboard()');
      assert.ok(htmlContent.includes('renderDashboardByRole()'), 'applyPaymentSuccess doit appeler renderDashboardByRole()');
    });
  });
});
