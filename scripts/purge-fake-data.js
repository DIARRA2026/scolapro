/**
 * ScolaPro — Script d'assainissement et purge des données et comptes fictifs
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const dbPath = path.join(__dirname, '..', 'scolapro.db');
const backupPath = path.join(__dirname, '..', `scolapro_backup_${Date.now()}.db`);

fs.copyFileSync(dbPath, backupPath);
console.log('[Backup] Sauvegarde créée :', backupPath);

const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = OFF;');
db.exec('BEGIN IMMEDIATE;');

try {
  // 1. Purge des comptes fictifs (conserve uniquement le souverain ID: 0)
  const usersDeleted = db.prepare('DELETE FROM users WHERE id > 0').run();
  console.log('[Users] Comptes fictifs purgés :', usersDeleted.changes);

  // 2. Purge des élèves
  const studentsDeleted = db.prepare('DELETE FROM students').run();
  console.log('[Students] Élèves supprimés :', studentsDeleted.changes);

  // 3. Purge des paiements
  const paymentsDeleted = db.prepare('DELETE FROM payments').run();
  console.log('[Payments] Paiements supprimés :', paymentsDeleted.changes);

  // 4. Purge des versements inter-caisses
  const depositsDeleted = db.prepare('DELETE FROM cash_deposits').run();
  console.log('[Deposits] Dépôts supprimés :', depositsDeleted.changes);

  // 5. Purge des sessions actives et tentatives de connexion
  db.prepare('DELETE FROM sessions').run();
  db.prepare('DELETE FROM login_attempts').run();

  // 6. Purge intégrale des classes et caisses fictives
  const classesDeleted = db.prepare('DELETE FROM classes').run();
  console.log('[Classes] Classes fictives purgées :', classesDeleted.changes);

  const desksDeleted = db.prepare('DELETE FROM cash_desks').run();
  console.log('[CashDesks] Caisses purgées :', desksDeleted.changes);

  // 7. Purge intégrale des établissements scolaires et fondations fictifs
  db.prepare('DELETE FROM school_settings').run();
  db.prepare('DELETE FROM foundation_settings').run();
  const schoolsDeleted = db.prepare('DELETE FROM schools').run();
  console.log('[Schools] Établissements scolaires purgés :', schoolsDeleted.changes);

  const foundationsDeleted = db.prepare('DELETE FROM foundations').run();
  console.log('[Foundations] Fondations mères purgées :', foundationsDeleted.changes);

  // 8. Purge des journaux de test et insertion du journal initial propre
  db.prepare('DELETE FROM audit_logs').run();
  db.prepare(`
    INSERT INTO audit_logs (school_id, foundation_id, user_id, action, module, target, old_val, new_val, status)
    VALUES (NULL, NULL, 0, 'SYSTEM_INITIALIZE', 'Système', 'Plateforme ScolaPro', '', 'Base assainie pour production — Tous les établissements et comptes fictifs purgés', 'SUCCÈS')
  `).run();

  db.exec('COMMIT;');
  db.exec('PRAGMA foreign_keys = ON;');
  console.log('[Succès] Base scolapro.db assainie avec succès.');
} catch (err) {
  db.exec('ROLLBACK;');
  console.error('[Erreur] Échec de la purge :', err.message);
  process.exit(1);
}
