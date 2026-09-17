/**
 * ScolaPro — Suite de Tests d'Intégrité Financière & Transactions ACID
 * Vérifie le respect absolu de l'invariant financier SYSCOHADA :
 * Conservation des soldes, non-destruction de fonds (Faille 3),
 * transactions atomiques, séparation des tâches et plafonnement des paiements.
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

/**
 * Calcule l'intégrale des soldes de caisse d'un établissement.
 */
function getTotalCashDeskBalance(schoolId) {
  const row = db.db.prepare('SELECT COALESCE(SUM(balance), 0) as total FROM cash_desks WHERE school_id = ?').get(schoolId);
  return Number(row.total);
}

test('FIN-01 : Invariant Financier — Paiement élève crédite la caisse de façon strictement égale au débit élève (ACID)', async () => {
  const schoolId = 1;
  const user = db.getUserById(2); // Admin Sainte-Marie

  // Créer un élève de test
  const mat = 'STU-FIN-01';
  db.db.prepare(`
    INSERT OR REPLACE INTO students (id, school_id, matricule, nom_prenom, niveau, classe, fee_due, fee_paid)
    VALUES (701, ?, ?, 'Eleve Test Paiement', '6EME', '6EME 1', 200000, 0)
  `).run(schoolId, mat);

  const deskBefore = db.db.prepare("SELECT balance FROM cash_desks WHERE school_id = ? AND type = 'PRINCIPALE'").get(schoolId);
  const deskBalBefore = Number(deskBefore.balance);
  const totalDesksBefore = getTotalCashDeskBalance(schoolId);

  const paymentAmount = 50000;
  const result = db.recordPayment(user, {
    studentId: 701,
    amount: paymentAmount,
    paymentMethod: 'ESPECES',
    cashDesk: 'PRINCIPALE'
  });

  assert.ok(result.receipt);
  assert.ok(result.receipt.ref.startsWith('QUIT-'), 'La quittance doit avoir une référence serveur QUIT-');
  assert.strictEqual(result.student.feePaid, paymentAmount);

  // Vérifier la mise à jour de la caisse
  const deskAfter = db.db.prepare("SELECT balance FROM cash_desks WHERE school_id = ? AND type = 'PRINCIPALE'").get(schoolId);
  const deskBalAfter = Number(deskAfter.balance);
  assert.strictEqual(deskBalAfter, deskBalBefore + paymentAmount, 'Le solde de caisse doit augmenter exactement du montant versé');

  // Invariant de conservation globale
  const totalDesksAfter = getTotalCashDeskBalance(schoolId);
  assert.strictEqual(totalDesksAfter, totalDesksBefore + paymentAmount);

  // Nettoyer l'élève et son paiement
  db.db.prepare('DELETE FROM payments WHERE student_id = 701').run();
  db.db.prepare("UPDATE cash_desks SET balance = ? WHERE school_id = ? AND type = 'PRINCIPALE'").run(deskBalBefore, schoolId);
  db.db.prepare('DELETE FROM students WHERE id = 701').run();
});

test('FIN-02 : Faille 3 colmatée — Versement inter-caisse École 2 (Collège Sainte-Anne) crédite S2_PRINCIPALE et non PRINCIPALE', async () => {
  const schoolId = 2; // Collège Sainte-Anne
  const adminSchool2 = { id: 22, role: 'admin', schoolId: 2, rank: 3, prenom: 'Admin', nom: 'SainteAnne' };
  const caisseSecSchool2 = { id: 23, role: 'caisse_secondaire', schoolId: 2, rank: 3, prenom: 'Caisse', nom: 'SecondaireS2' };

  // 1. S'assurer qu'une caisse secondaire existe pour l'école 2 avec un solde suffisant
  let secDesk = db.db.prepare("SELECT id, balance FROM cash_desks WHERE school_id = ? AND type != 'PRINCIPALE' LIMIT 1").get(schoolId);
  if (!secDesk) {
    secDesk = db.createCashDesk(adminSchool2, {
      code: 'S2_ANNEXE',
      name: 'Caisse Annexe Sainte-Anne',
      schoolId: 2
    });
  }
  const secInitBal = 100000;
  db.db.prepare('UPDATE cash_desks SET balance = ? WHERE id = ?').run(secInitBal, secDesk.id);

  // 2. Noter le solde de la caisse principale de l'école 2 et de l'école 1
  const s2MainBefore = db.db.prepare("SELECT id, balance FROM cash_desks WHERE school_id = ? AND type = 'PRINCIPALE'").get(schoolId);
  const s1MainBefore = db.db.prepare("SELECT id, balance FROM cash_desks WHERE school_id = 1 AND type = 'PRINCIPALE'").get();

  const transferAmount = 40000;
  const depRef = 'DEP-TEST-SCH2-' + Date.now();

  // 3. Initier le dépôt
  const deposit = db.createCashDeposit(caisseSecSchool2, {
    ref: depRef,
    amount: transferAmount,
    sourceId: secDesk.id
  });
  assert.strictEqual(deposit.status, 'PENDING');
  assert.strictEqual(deposit.schoolId, 2);

  // 4. Valider le versement par l'administrateur de l'école 2
  const totalDesksBefore = getTotalCashDeskBalance(schoolId);
  const validated = db.validateCashDeposit(adminSchool2, deposit.id);
  assert.strictEqual(validated.deposit.status, 'VALIDATED');

  // 5. VÉRIFICATIONS STRICTES DE SÉCURITÉ FINANCIÈRE :
  // a) La caisse principale de l'école 2 doit avoir reçu les fonds
  const s2MainAfter = db.db.prepare("SELECT id, balance FROM cash_desks WHERE school_id = ? AND type = 'PRINCIPALE'").get(schoolId);
  assert.strictEqual(Number(s2MainAfter.balance), Number(s2MainBefore.balance) + transferAmount);

  // b) La caisse secondaire de l'école 2 doit être débitée
  const secDeskAfter = db.db.prepare('SELECT balance FROM cash_desks WHERE id = ?').get(secDesk.id);
  assert.strictEqual(Number(secDeskAfter.balance), secInitBal - transferAmount);

  // c) La caisse principale de l'école 1 NE DOIT STRICTEMENT PAS AVOIR CHANGÉ
  const s1MainAfter = db.db.prepare("SELECT balance FROM cash_desks WHERE school_id = 1 AND type = 'PRINCIPALE'").get();
  assert.strictEqual(Number(s1MainAfter.balance), Number(s1MainBefore.balance), 'L école 1 ne doit recevoir AUCUN fonds appartenant à l école 2');

  // d) Conservation stricte de la somme des caisses de l'école 2 (Transfert interne = somme constante)
  const totalDesksAfter = getTotalCashDeskBalance(schoolId);
  assert.strictEqual(totalDesksAfter, totalDesksBefore, 'Invariant financier : la somme des caisses doit rester strictement constante lors d un transfert');

  // Nettoyage
  db.db.prepare('DELETE FROM cash_deposits WHERE id = ?').run(deposit.id);
  db.db.prepare("UPDATE cash_desks SET balance = ? WHERE id = ?").run(Number(s2MainBefore.balance), s2MainAfter.id);
  db.db.prepare('DELETE FROM cash_desks WHERE id = ?').run(secDesk.id);
});

test('FIN-03 : Faille 3 colmatée — École 3 (sans caisse d\'origine) dispose d\'une caisse principale automatique et valide les dépôts', async () => {
  const schoolId = 3; // École Primaire Les Lauriers
  const adminSchool3 = { id: 31, role: 'admin', schoolId: 3, rank: 3, prenom: 'Admin', nom: 'Lauriers' };
  const caisseSecSchool3 = { id: 32, role: 'caisse_secondaire', schoolId: 3, rank: 3, prenom: 'Caisse', nom: 'Lauriers' };

  // Créer une caisse secondaire pour l'école 3
  const secDesk = db.createCashDesk(adminSchool3, {
    code: 'S3_SECONDAIRE',
    name: 'Caisse Annexe Lauriers',
    schoolId: 3
  });
  db.db.prepare('UPDATE cash_desks SET balance = 50000 WHERE id = ?').run(secDesk.id);

  const mainDeskBefore = db.db.prepare("SELECT balance FROM cash_desks WHERE school_id = ? AND type = 'PRINCIPALE'").get(schoolId);
  assert.ok(mainDeskBefore, 'L école 3 doit obligatoirement avoir une caisse principale');

  // Effectuer un versement
  const dep = db.createCashDeposit(caisseSecSchool3, {
    ref: 'DEP-S3-' + Date.now(),
    amount: 25000,
    sourceId: secDesk.id
  });

  const res = db.validateCashDeposit(adminSchool3, dep.id);
  assert.strictEqual(res.deposit.status, 'VALIDATED');

  const mainDeskAfter = db.db.prepare("SELECT balance FROM cash_desks WHERE school_id = ? AND type = 'PRINCIPALE'").get(schoolId);
  assert.strictEqual(Number(mainDeskAfter.balance), Number(mainDeskBefore.balance) + 25000);

  // Nettoyage
  db.db.prepare('DELETE FROM cash_deposits WHERE id = ?').run(dep.id);
  db.db.prepare('DELETE FROM cash_desks WHERE id = ?').run(secDesk.id);
  db.db.prepare("UPDATE cash_desks SET balance = ? WHERE school_id = ? AND type = 'PRINCIPALE'").run(Number(mainDeskBefore.balance), schoolId);
});

test('FIN-04 : Solde insuffisant en caisse source bloque la validation du versement et annule la transaction', () => {
  const schoolId = 1;
  const admin = db.getUserById(2);
  const caissier = db.getUserById(7);

  // Trouver une caisse secondaire
  const secDesk = db.db.prepare("SELECT id, balance FROM cash_desks WHERE school_id = 1 AND type != 'PRINCIPALE' LIMIT 1").get();
  assert.ok(secDesk);

  // Fixer un solde modeste
  db.db.prepare('UPDATE cash_desks SET balance = 5000 WHERE id = ?').run(secDesk.id);

  // Créer un dépôt dépassant le solde disponible (10000 > 5000)
  const dep = db.createCashDeposit(caissier, {
    ref: 'DEP-EXCESS-' + Date.now(),
    amount: 10000,
    sourceId: secDesk.id
  });

  // La validation doit être formellement rejetée pour solde insuffisant
  assert.throws(() => {
    db.validateCashDeposit(admin, dep.id);
  }, /Solde insuffisant/);

  // Vérifier que les soldes n'ont pas bougé d'un seul centime
  const secDeskAfter = db.db.prepare('SELECT balance FROM cash_desks WHERE id = ?').get(secDesk.id);
  assert.strictEqual(Number(secDeskAfter.balance), 5000);

  const depAfter = db.db.prepare('SELECT status FROM cash_deposits WHERE id = ?').get(dep.id);
  assert.strictEqual(depAfter.status, 'PENDING');

  // Nettoyage
  db.db.prepare('DELETE FROM cash_deposits WHERE id = ?').run(dep.id);
});

test('FIN-05 : Séparation des tâches — L\'opérateur ayant initié un versement ne peut PAS le valider lui-même (403)', () => {
  const user = db.getUserById(2); // Admin Sainte-Marie

  const secDesk = db.db.prepare("SELECT id FROM cash_desks WHERE school_id = 1 AND type != 'PRINCIPALE' LIMIT 1").get();
  db.db.prepare('UPDATE cash_desks SET balance = 50000 WHERE id = ?').run(secDesk.id);

  const dep = db.createCashDeposit(user, {
    ref: 'DEP-SELF-' + Date.now(),
    amount: 10000,
    sourceId: secDesk.id
  });

  assert.throws(() => {
    db.validateCashDeposit(user, dep.id);
  }, /Séparation des tâches comptables/);

  db.db.prepare('DELETE FROM cash_deposits WHERE id = ?').run(dep.id);
});

test('FIN-06 : Plafonnement anti-surpaiement — Un paiement dépassant le restant dû est rejeté', () => {
  const user = db.getUserById(2);

  // Créer élève avec reste à payer = 30000
  db.db.prepare(`
    INSERT OR REPLACE INTO students (id, school_id, matricule, nom_prenom, niveau, classe, fee_due, fee_paid)
    VALUES (702, 1, 'STU-CAP-01', 'Eleve Cap Fee', '6EME', '6EME 1', 100000, 70000)
  `).run();

  const desk = db.db.prepare("SELECT id, balance FROM cash_desks WHERE school_id = 1 AND type = 'PRINCIPALE'").get();
  const initBal = Number(desk.balance);

  // Tenter de payer 50000 (alors qu'il ne reste que 30000) -> rejeté !
  assert.throws(() => {
    db.recordPayment(user, {
      studentId: 702,
      amount: 50000,
      paymentMethod: 'ESPECES',
      cashDesk: desk.id
    });
  }, /excède le solde restant dû/);

  // Payer exactement le restant dû (30000) -> accepté !
  const result = db.recordPayment(user, {
    studentId: 702,
    amount: 30000,
    paymentMethod: 'ESPECES',
    cashDesk: desk.id
  });

  assert.strictEqual(result.payment.amount, 30000);
  assert.strictEqual(result.student.feePaid, 100000);

  // La caisse doit être créditée de 30000
  const deskAfter = db.db.prepare('SELECT balance FROM cash_desks WHERE id = ?').get(desk.id);
  assert.strictEqual(Number(deskAfter.balance), initBal + 30000);

  // Nettoyage
  db.db.prepare('DELETE FROM payments WHERE student_id = 702').run();
  db.db.prepare('UPDATE cash_desks SET balance = ? WHERE id = ?').run(initBal, desk.id);
  db.db.prepare('DELETE FROM students WHERE id = 702').run();
});

test('FIN-07 : Rejet des montants invalides (négatifs, nuls, décimaux, non-entiers)', () => {
  const user = db.getUserById(2);

  // Négatif
  assert.throws(() => {
    db.recordPayment(user, { studentId: 1, amount: -1000, cashDesk: 'PRINCIPALE' });
  }, /strictement positif/);

  // Zéro
  assert.throws(() => {
    db.recordPayment(user, { studentId: 1, amount: 0, cashDesk: 'PRINCIPALE' });
  }, /strictement positif/);

  // Décimal
  assert.throws(() => {
    db.recordPayment(user, { studentId: 1, amount: 1500.50, cashDesk: 'PRINCIPALE' });
  }, /entier/);

  // NaN ou chaîne non numérique
  assert.throws(() => {
    db.recordPayment(user, { studentId: 1, amount: 'abc', cashDesk: 'PRINCIPALE' });
  }, /nombre/);
});

test('FIN-08 : Rejet des montants dépassant le plafond de sécurité de 50 000 000 XOF', () => {
  const user = db.getUserById(2);

  assert.throws(() => {
    db.recordPayment(user, { studentId: 1, amount: 60000000, cashDesk: 'PRINCIPALE' });
  }, /dépasse le plafond/);
});

test('FIN-09 : Interdiction formelle de supprimer un élève ayant des paiements enregistrés', () => {
  const user = db.getUserById(2);

  // Créer un élève avec un paiement
  db.db.prepare(`
    INSERT OR REPLACE INTO students (id, school_id, matricule, nom_prenom, niveau, classe, fee_due, fee_paid)
    VALUES (703, 1, 'STU-NODEL-01', 'Eleve Non Supprimable', '6EME', '6EME 1', 100000, 20000)
  `).run();

  db.db.prepare(`
    INSERT INTO payments (id, school_id, student_id, amount, payment_method, ref, cash_desk)
    VALUES (9999, 1, 703, 20000, 'ESPECES', 'QUIT-TEST-NODEL', 'PRINCIPALE')
  `).run();

  assert.throws(() => {
    db.deleteStudent(user, 703);
  }, /règlements financiers|paiements/);

  // Nettoyage
  db.db.prepare('DELETE FROM payments WHERE id = 9999').run();
  db.db.prepare('DELETE FROM students WHERE id = 703').run();
});

test('FIN-10 : Interdiction de paiements trans-tenant (élève d\'une autre école)', () => {
  const userSchool1 = db.getUserById(2); // Admin École 1

  // Créer un élève en école 2
  db.db.prepare(`
    INSERT OR REPLACE INTO students (id, school_id, matricule, nom_prenom, niveau, classe, fee_due, fee_paid)
    VALUES (704, 2, 'STU-CROSS-FIN', 'Eleve Ecole 2', '6EME', '6EME 1', 100000, 0)
  `).run();

  assert.throws(() => {
    db.recordPayment(userSchool1, {
      studentId: 704,
      amount: 10000,
      paymentMethod: 'ESPECES',
      cashDesk: 'PRINCIPALE'
    });
  }, /Accès refusé|confiné|non autorisé|introuvable/);

  db.db.prepare('DELETE FROM students WHERE id = 704').run();
});

test('FIN-11 : Rapprochement d\'audit — Chaque opération financière crée une trace immuable', () => {
  const user = db.getUserById(2);

  db.db.prepare(`
    INSERT OR REPLACE INTO students (id, school_id, matricule, nom_prenom, niveau, classe, fee_due, fee_paid)
    VALUES (705, 1, 'STU-AUDIT-01', 'Eleve Audit', '6EME', '6EME 1', 100000, 0)
  `).run();

  const desk = db.db.prepare("SELECT id, balance FROM cash_desks WHERE school_id = 1 AND type = 'PRINCIPALE'").get();
  const initBal = Number(desk.balance);

  const res = db.recordPayment(user, {
    studentId: 705,
    amount: 15000,
    paymentMethod: 'ESPECES',
    cashDesk: desk.id
  });

  // Vérifier la présence du log d'audit
  const log = db.db.prepare(`
    SELECT * FROM audit_logs 
    WHERE action = 'PAYMENT_CONFIRM' AND school_id = 1 
    ORDER BY id DESC LIMIT 1
  `).get();

  assert.ok(log);
  assert.ok(log.new_val.includes(res.receipt.ref));
  assert.strictEqual(log.status, 'SUCCÈS');

  // Nettoyage
  db.db.prepare('DELETE FROM payments WHERE student_id = 705').run();
  db.db.prepare('UPDATE cash_desks SET balance = ? WHERE id = ?').run(initBal, desk.id);
  db.db.prepare('DELETE FROM students WHERE id = 705').run();
});

test('FIN-12 : Rejet du versement inter-caisse avec motif lors du rejet formel (REJECT)', () => {
  const admin = db.getUserById(2);
  const caissier = db.getUserById(7);

  const secDesk = db.db.prepare("SELECT id FROM cash_desks WHERE school_id = 1 AND type != 'PRINCIPALE' LIMIT 1").get();
  const dep = db.createCashDeposit(caissier, {
    ref: 'DEP-REJ-' + Date.now(),
    amount: 10000,
    sourceId: secDesk.id
  });

  const rejected = db.rejectCashDeposit(admin, dep.id, 'Erreur de comptage des billets');
  assert.strictEqual(rejected.deposit.status, 'REJECTED');
  assert.ok(rejected.deposit.rejectionReason.includes('Erreur de comptage'));

  db.db.prepare('DELETE FROM cash_deposits WHERE id = ?').run(dep.id);
});

test('FIN-13 : Résolution automatique de la caisse principale si non spécifiée lors d\'un paiement', () => {
  const user = db.getUserById(2);

  db.db.prepare(`
    INSERT OR REPLACE INTO students (id, school_id, matricule, nom_prenom, niveau, classe, fee_due, fee_paid)
    VALUES (706, 1, 'STU-AUTODESK-01', 'Eleve Sans Caisse', '6EME', '6EME 1', 100000, 0)
  `).run();

  const desk = db.db.prepare("SELECT id, code, balance FROM cash_desks WHERE school_id = 1 AND type = 'PRINCIPALE'").get();
  const initBal = Number(desk.balance);

  const res = db.recordPayment(user, {
    studentId: 706,
    amount: 20000,
    paymentMethod: 'ESPECES'
    // cashDesk omis
  });

  assert.ok(res.payment.cash_desk === desk.code || res.payment.cash_desk === desk.id);

  // Nettoyage
  db.db.prepare('DELETE FROM payments WHERE student_id = 706').run();
  db.db.prepare('UPDATE cash_desks SET balance = ? WHERE id = ?').run(initBal, desk.id);
  db.db.prepare('DELETE FROM students WHERE id = 706').run();
});

test('FIN-14 : Impossibilité de créer un versement avec montant négatif ou nul', () => {
  const caissier = db.getUserById(7);
  const secDesk = db.db.prepare("SELECT id FROM cash_desks WHERE school_id = 1 AND type != 'PRINCIPALE' LIMIT 1").get();

  assert.throws(() => {
    db.createCashDeposit(caissier, {
      ref: 'DEP-NEG',
      amount: -5000,
      sourceId: secDesk.id
    });
  }, /strictement positif/);

  assert.throws(() => {
    db.createCashDeposit(caissier, {
      ref: 'DEP-ZERO',
      amount: 0,
      sourceId: secDesk.id
    });
  }, /strictement positif/);
});

test('FIN-15 : Transaction ACID avec rollback garanti en cas d\'erreur simulée', () => {
  const schoolId = 1;
  const initialTotal = getTotalCashDeskBalance(schoolId);

  // Tenter une opération dans withTransaction qui lève une exception
  assert.throws(() => {
    db.withTransaction(() => {
      db.db.prepare('UPDATE cash_desks SET balance = balance + 99999 WHERE school_id = 1').run();
      throw new Error('Erreur simulée dans transaction');
    });
  }, /Erreur simulée/);

  const afterTotal = getTotalCashDeskBalance(schoolId);
  assert.strictEqual(afterTotal, initialTotal, 'La transaction doit avoir été complètement annulée (Rollback)');
});
