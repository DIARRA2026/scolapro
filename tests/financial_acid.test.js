const test = require('node:test');
const assert = require('node:assert');
const db = require('../db.js');

test('Financial ACID : Enregistrement d\'un paiement met à jour élève et solde de caisse de façon atomique', () => {
  const user = db.getUserById(2); // Proviseur Lycée Sainte-Marie

  // Créer un élève de test éphémère
  const testMatricule = `TEST-${Date.now().toString().slice(-6)}K`;
  const student = db.createStudent(user, {
    matricule: testMatricule,
    nomPrenom: 'TEST-ELEVE Automatisé',
    classe: '6EME 1',
    niveau: '6EME',
    feeDue: 150000,
    feePaid: 0,
    cashDesk: 'PRINCIPALE'
  });

  assert.ok(student.id, 'L élève de test doit être créé avec un identifiant valide');

  const cashDesksBefore = db.getCashDesks(user);
  const mainDeskBefore = cashDesksBefore.find(d => d.id === 'PRINCIPALE') || cashDesksBefore[0];
  const initialBalance = mainDeskBefore.balance;

  const testAmount = 50000;
  const paymentRef = `TEST-QUIT-${Date.now().toString().slice(-6)}`;

  // Enregistrer le paiement
  const result = db.recordPayment(user, {
    studentId: student.id,
    amount: testAmount,
    paymentMethod: 'ESPECES',
    ref: paymentRef,
    cashDesk: mainDeskBefore.id
  });

  assert.ok(result);
  assert.strictEqual(result.student.feePaid, testAmount);

  // Vérifier la mise à jour du solde de caisse
  const mainDeskAfter = result.cashDesks.find(d => d.id === mainDeskBefore.id);
  assert.strictEqual(mainDeskAfter.balance, initialBalance + testAmount);

  // Règle financière stricte : L'élève ayant cotisé ne peut plus être supprimé directement
  assert.throws(() => {
    db.deleteStudent(user, student.id);
  }, /Sécurité financière/);

  // Nettoyage complet du test
  db.db.exec('BEGIN TRANSACTION');
  db.db.prepare('DELETE FROM payments WHERE ref = ?').run(paymentRef);
  db.db.prepare('UPDATE cash_desks SET balance = ? WHERE id = ?').run(initialBalance, mainDeskBefore.id);
  db.db.prepare('DELETE FROM students WHERE id = ?').run(student.id);
  db.db.prepare('DELETE FROM audit_logs WHERE target LIKE ?').run(`%${student.id}%`);
  db.db.exec('COMMIT');
});

test('Financial ACID : Versement inter-caisse PENDING puis VALIDATED avec transfert de solde', () => {
  const user = db.getUserById(2); // Proviseur Lycée Sainte-Marie
  const transferAmount = 10000;
  const depositRef = `TEST-DEP-${Date.now().toString().slice(-6)}`;

  // 1. Initialiser le dépôt
  const deposit = db.createCashDeposit(user, {
    ref: depositRef,
    amount: transferAmount,
    source: 'Caisse Secondaire n°2',
    sourceId: 'CAISSE_2'
  });

  assert.strictEqual(deposit.status, 'PENDING');
  assert.strictEqual(deposit.amount, transferAmount);

  // Solde avant validation
  const desksBefore = db.getCashDesks(user);
  const mainBefore = desksBefore.find(d => d.id === 'PRINCIPALE');
  const secBefore = desksBefore.find(d => d.id === 'CAISSE_2');

  const mainInitBal = mainBefore ? mainBefore.balance : 0;
  const secInitBal = secBefore ? secBefore.balance : 0;

  // 2. Valider le dépôt
  const result = db.validateCashDeposit(user, deposit.id);
  assert.strictEqual(result.deposit.status, 'VALIDATED');

  // Solde après validation
  const desksAfter = db.getCashDesks(user);
  const mainAfter = desksAfter.find(d => d.id === 'PRINCIPALE');
  const secAfter = desksAfter.find(d => d.id === 'CAISSE_2');

  if (mainBefore && secBefore) {
    assert.strictEqual(mainAfter.balance, mainInitBal + transferAmount);
    assert.strictEqual(secAfter.balance, secInitBal - transferAmount);
  }

  // Nettoyage du versement de test
  db.db.exec('BEGIN TRANSACTION');
  if (mainBefore && secBefore) {
    db.db.prepare('UPDATE cash_desks SET balance = ? WHERE id = ?').run(mainInitBal, 'PRINCIPALE');
    db.db.prepare('UPDATE cash_desks SET balance = ? WHERE id = ?').run(secInitBal, 'CAISSE_2');
  }
  db.db.prepare('DELETE FROM cash_deposits WHERE id = ?').run(deposit.id);
  db.db.prepare('DELETE FROM audit_logs WHERE target LIKE ?').run(`%Dépôt #${deposit.id}%`);
  db.db.exec('COMMIT');
});
