'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = path.join(__dirname, '..', 'scolapro.db');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = OFF;');
db.exec('BEGIN IMMEDIATE;');

try {
  // 1. Vider les paiements et quittances de test
  db.prepare('DELETE FROM payments').run();
  console.log('✅ Table payments vidée.');

  // 2. Vider les versements/dépôts inter-caisses
  db.prepare('DELETE FROM cash_deposits').run();
  console.log('✅ Table cash_deposits vidée.');

  // 3. Remettre tous les soldes des caisses à 0 XOF
  db.prepare('UPDATE cash_desks SET balance = 0, physical = 0').run();
  console.log('✅ Soldes des caisses remis à 0 XOF.');

  // 4. Remettre à 0 les frais payés et effacer les notes et moyennes des élèves
  db.prepare('UPDATE students SET fee_paid = 0, note_dev = NULL, is_absent = 0, avg = NULL, rank = NULL, mention = NULL').run();
  console.log('✅ Données élèves réinitialisées (fee_paid = 0, notes et moyennes effacées).');

  // 5. Réinitialiser le taux de recouvrement des écoles
  db.prepare('UPDATE schools SET recovery_rate = 0.0').run();
  console.log('✅ Taux de recouvrement des écoles réinitialisé à 0.0%.');

  db.exec('COMMIT;');
  db.exec('PRAGMA foreign_keys = ON;');
  console.log('🎉 Assainissement des données terminé avec succès !');
} catch (err) {
  db.exec('ROLLBACK;');
  console.error('❌ Erreur lors de l\'assainissement :', err);
  process.exit(1);
}
