const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const db = require('../db.js');

test('RCPT-01 : Conversion des montants FCFA en toutes lettres françaises conformes', () => {
  assert.strictEqual(db.numberToFrenchWordsFCFA(0), 'Zéro Franc CFA');
  assert.strictEqual(db.numberToFrenchWordsFCFA(1), 'Un Franc CFA');
  assert.strictEqual(db.numberToFrenchWordsFCFA(80), 'Quatre-vingts Francs CFA');
  assert.strictEqual(db.numberToFrenchWordsFCFA(80000), 'Quatre-vingt mille Francs CFA');
  assert.strictEqual(db.numberToFrenchWordsFCFA(81), 'Quatre-vingt-un Francs CFA');
  assert.strictEqual(db.numberToFrenchWordsFCFA(100), 'Cent Francs CFA');
  assert.strictEqual(db.numberToFrenchWordsFCFA(200), 'Deux cents Francs CFA');
  assert.strictEqual(db.numberToFrenchWordsFCFA(205), 'Deux cent cinq Francs CFA');
  assert.strictEqual(db.numberToFrenchWordsFCFA(1000), 'Mille Francs CFA');
  assert.strictEqual(db.numberToFrenchWordsFCFA(1500), 'Mille cinq cents Francs CFA');
  assert.strictEqual(db.numberToFrenchWordsFCFA(150000), 'Cent cinquante mille Francs CFA');
  assert.strictEqual(db.numberToFrenchWordsFCFA(200000), 'Deux cent mille Francs CFA');
  assert.strictEqual(db.numberToFrenchWordsFCFA(1500000), 'Un million cinq cent mille Francs CFA');
  assert.strictEqual(db.numberToFrenchWordsFCFA(25000000), 'Vingt-cinq millions de Francs CFA');
});

test('RCPT-02 : Calcul et format de l\'année scolaire académique', () => {
  // Mois de septembre 2026 -> 2026-2027
  const sepDate = new Date(2026, 8, 15); // mois 8 = septembre (0-indexed)
  assert.strictEqual(db.getCurrentAcademicYear(sepDate), '2026-2027');

  // Mois de janvier 2027 -> 2026-2027
  const janDate = new Date(2027, 0, 15); // mois 0 = janvier
  assert.strictEqual(db.getCurrentAcademicYear(janDate), '2026-2027');

  // Mois d'août 2027 -> 2027-2028 (bascule)
  const augDate = new Date(2027, 7, 5); // mois 7 = août (0-indexed, month 8)
  assert.strictEqual(db.getCurrentAcademicYear(augDate), '2027-2028');
});

test('RCPT-03 : Génération séquentielle atomique et étanchéité multi-tenant par année scolaire', () => {
  const schoolIdA = 1;
  const schoolIdB = 2;
  const testYear1 = '2030-2031';
  const testYear2 = '2031-2032';

  // Nettoyage préventif
  db.db.prepare('DELETE FROM receipt_sequences WHERE school_year IN (?, ?)').run(testYear1, testYear2);

  // S'assurer que l'école 2 existe pour le test multi-tenant
  let createdSchoolB = false;
  const existingSchoolB = db.db.prepare('SELECT id FROM schools WHERE id = ?').get(schoolIdB);
  if (!existingSchoolB) {
    db.db.prepare(`
      INSERT INTO schools (id, code, name, currency, academic_year)
      VALUES (2, 'CSA', 'Collège Sainte-Anne', 'XOF', '2026-2027')
    `).run();
    createdSchoolB = true;
  }

  try {
    // Séquence École A - Année 1
    const r1 = db.getNextReceiptNumber(schoolIdA, testYear1, 'M6');
    assert.strictEqual(r1.sequenceNumber, 1);
    assert.strictEqual(r1.receiptNumber, 'M6-2030-2031-000001');

    const r2 = db.getNextReceiptNumber(schoolIdA, testYear1, 'M6');
    assert.strictEqual(r2.sequenceNumber, 2);
    assert.strictEqual(r2.receiptNumber, 'M6-2030-2031-000002');

    // École B - Même année : doit débuter à 1 (isolation multi-tenant)
    const rb1 = db.getNextReceiptNumber(schoolIdB, testYear1, 'CSA');
    assert.strictEqual(rb1.sequenceNumber, 1);
    assert.strictEqual(rb1.receiptNumber, 'CSA-2030-2031-000001');

    // École A - Nouvelle année scolaire : remise à zéro
    const rNewYear = db.getNextReceiptNumber(schoolIdA, testYear2, 'M6');
    assert.strictEqual(rNewYear.sequenceNumber, 1);
    assert.strictEqual(rNewYear.receiptNumber, 'M6-2031-2032-000001');
  } finally {
    // Nettoyage de test
    db.db.prepare('DELETE FROM receipt_sequences WHERE school_year IN (?, ?)').run(testYear1, testYear2);
    if (createdSchoolB) {
      db.db.prepare('DELETE FROM schools WHERE id = 2').run();
    }
  }
});

test('RCPT-04 : Enregistrement complet d\'un paiement avec quittance officielle et solde restant', () => {
  const schoolId = 1;
  const adminUser = { id: 1, role: 'admin', schoolId: 1, rank: 3, prenom: 'Admin', nom: 'Principal' };

  // Création d'un élève test
  const testMatricule = '26999999Z';
  db.db.prepare('DELETE FROM students WHERE matricule = ?').run(testMatricule);
  
  const insertStudent = db.db.prepare(`
    INSERT INTO students (school_id, matricule, nom_prenom, niveau, classe, statut, fee_due, fee_paid)
    VALUES (?, ?, 'Élève Quittance Test', 'Collège', '3ÈME 1', 'AFF', 150000, 0)
  `).run(schoolId, testMatricule);
  const studentId = Number(insertStudent.lastInsertRowid);

  try {
    // 1er versement de 50 000 FCFA
    const pay1 = db.recordPayment(adminUser, {
      studentId,
      amount: 50000,
      paymentMethod: 'ESPECES'
    });

    assert.ok(pay1.receipt);
    assert.ok(pay1.receipt.ref.startsWith('QUIT-'), 'Rétrocompatibilité du ref QUIT-');
    assert.match(pay1.receipt.receiptNumber, /^[A-Z0-9]+-\d{4}-\d{4}-\d{6}$/, 'Format de quittance officiel valide');
    assert.strictEqual(pay1.receipt.amount, 50000);
    assert.strictEqual(pay1.receipt.amountInWords, 'Cinquante mille Francs CFA');
    assert.strictEqual(pay1.receipt.totalDue, 150000);
    assert.strictEqual(pay1.receipt.totalPaidAfter, 50000);
    assert.strictEqual(pay1.receipt.remainingBalance, 100000);

    // Vérifier la persistance dans la table receipts
    const storedReceipt = db.getReceiptById(pay1.receipt.id, adminUser);
    assert.ok(storedReceipt);
    assert.strictEqual(storedReceipt.receiptNumber, pay1.receipt.receiptNumber);
    assert.strictEqual(storedReceipt.remainingBalance, 100000);
    assert.strictEqual(storedReceipt.amountInWords, 'Cinquante mille Francs CFA');

    // Vérifier getReceiptByPaymentId
    const storedByPayment = db.getReceiptByPaymentId(pay1.payment.id, adminUser);
    assert.ok(storedByPayment);
    assert.strictEqual(storedByPayment.id, pay1.receipt.id);

    // 2e versement soldant le reste dû (100 000 FCFA)
    const pay2 = db.recordPayment(adminUser, {
      studentId,
      amount: 100000,
      paymentMethod: 'WAVE'
    });

    assert.strictEqual(pay2.receipt.remainingBalance, 0);
    assert.strictEqual(pay2.receipt.amountInWords, 'Cent mille Francs CFA');
    assert.strictEqual(pay2.receipt.totalPaidAfter, 150000);
    assert.strictEqual(pay2.receipt.sequenceNumber, pay1.receipt.sequenceNumber + 1);
  } finally {
    // Nettoyage de l'élève et ses paiements
    db.db.prepare('DELETE FROM receipts WHERE student_id = ?').run(studentId);
    db.db.prepare('DELETE FROM payments WHERE student_id = ?').run(studentId);
    db.db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
  }
});

test('RCPT-05 : Structure DOM Dual A5 sur feuille A4 et ligne centrale de découpe dans index.html', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // Conteneur A4 et 2 exemplaires A5
  assert.ok(content.includes('id="modal-payment-receipt"'), 'Modal principal de quittance');
  assert.ok(content.includes('id="printable-receipt"'), 'Conteneur imprimable');
  assert.ok(content.includes('id="receipt-copy-student"'), '1er exemplaire A5 élève');
  assert.ok(content.includes('id="receipt-copy-accounting"'), '2nd exemplaire A5 comptabilité');

  // Mention claire des exemplaires
  assert.ok(content.includes('EXEMPLAIRE ÉLÈVE'), 'Mention Exemplaire Élève');
  assert.ok(content.includes('EXEMPLAIRE COMPTABILITÉ'), 'Mention Exemplaire Comptabilité');

  // Ligne de découpe centrale avec ciseaux
  assert.ok(content.includes('receipt-cut-line'), 'Ligne de découpe');
  assert.ok(content.includes('Découper ici'), 'Texte informatif de découpe');
  assert.ok(content.includes('✂'), 'Symbole ciseaux');

  // Éléments du reçu élève
  assert.ok(content.includes('id="rcpt-number"'), 'Numéro de quittance élève');
  assert.ok(content.includes('id="rcpt-words"'), 'Montant en toutes lettres élève');
  assert.ok(content.includes('id="rcpt-tx-amount"'), 'Montant en chiffres élève');
  assert.ok(content.includes('id="rcpt-fee-balance"'), 'Solde restant dû élève');

  // Éléments du reçu comptabilité
  assert.ok(content.includes('id="rcpt-number-acc"'), 'Numéro de quittance comptabilité');
  assert.ok(content.includes('id="rcpt-words-acc"'), 'Montant en toutes lettres comptabilité');
  assert.ok(content.includes('id="rcpt-tx-amount-acc"'), 'Montant en chiffres comptabilité');
  assert.ok(content.includes('id="rcpt-fee-balance-acc"'), 'Solde restant dû comptabilité');

  // Règles d\'impression CSS format A4
  assert.ok(content.includes('size: A4 portrait'), 'Spécification CSS @page size A4 portrait');
});
