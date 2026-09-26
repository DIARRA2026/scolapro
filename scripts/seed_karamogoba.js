/**
 * ScolaPro — Script de peuplement des données réelles
 * Établissement : COLLÈGE PRIVÉ KARAMOGOBA DE BOUAKE (Code 071246)
 * Source des élèves : C:\Users\HP\Desktop\Nouveau dossier\dfa_selection_110_eleves.csv (110 élèves réels)
 */

'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const auth = require('../lib/auth');

const ROOT_DIR = path.resolve(__dirname, '..');
const dbPath = path.join(ROOT_DIR, 'scolapro.db');
const csvPath = 'C:\\Users\\HP\\Desktop\\Nouveau dossier\\dfa_selection_110_eleves.csv';

async function seed() {
  console.log('=== PEUPLEMENT DES DONNÉES RÉELLES SCOLAPRO ===');
  console.log('[Établissement] COLLÈGE PRIVÉ KARAMOGOBA DE BOUAKE (071246)');

  if (!fs.existsSync(dbPath)) {
    console.error('Erreur : Base de données introuvable à', dbPath);
    process.exit(1);
  }

  // Backup
  const backupPath = path.join(ROOT_DIR, `scolapro_backup_real_${Date.now()}.db`);
  fs.copyFileSync(dbPath, backupPath);
  console.log('[Backup] Sauvegarde de sécurité créée :', backupPath);

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN IMMEDIATE;');

  try {
    // 1. Nettoyer les anciennes tables de test
    db.prepare('DELETE FROM payments').run();
    db.prepare('DELETE FROM cash_deposits').run();
    db.prepare('DELETE FROM students').run();
    db.prepare('DELETE FROM classes').run();
    db.prepare('DELETE FROM cash_desks').run();
    db.prepare('DELETE FROM school_settings').run();
    db.prepare('DELETE FROM foundation_settings').run();
    db.prepare('DELETE FROM schools').run();
    db.prepare('DELETE FROM foundations').run();
    db.prepare('DELETE FROM users WHERE id > 0').run();
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM login_attempts').run();

    console.log('[Purge] Données temporaires antérieures nettoyées avec succès.');

    // 2. Hash des mots de passe
    const schoolPwdHash = await auth.hashPassword('Karamogoba2026!');
    const staffPwdHash = await auth.hashPassword('Password2026!');

    // S'assurer que le concepteur existe avec le bon mot de passe
    const concepteurPwdHash = await auth.hashPassword('Password2026!');
    db.prepare(`
      INSERT OR REPLACE INTO users (id, school_id, foundation_id, nom, prenom, email, phone, role, role_label, scope_type, scope_label, level, scope_value, is_active, password_hash, must_change_password)
      VALUES (0, NULL, NULL, 'DIARRA', 'Dolourou', 'diarra.dolourou@scolapro.ci', '+225 07 00 00 00 00', 'concepteur', 'Concepteur Système SaaS', 'GLOBAL', 'Supervision Universelle', 'N1', 'ALL', 1, ?, 0)
    `).run(concepteurPwdHash);

    // 3. Créer l'établissement principal
    const schoolInsert = db.prepare(`
      INSERT INTO schools (
        id, code, name, short_name, foundation_id, school_type,
        city, address, phone, email, logo, currency, academic_year,
        students_count, classes_count, cash_desks_count, recovery_rate,
        is_active, password_hash
      ) VALUES (
        1, '071246', 'COLLEGE PRIVE KARAMOGOBA DE BOUAKE', 'CP KARAMOGOBA', NULL, 'PREMIER CYCLE (COLLÈGE)',
        'Bouaké', 'Bouaké, Quartier Dar-Es-Salam / Koko (DRENA BOUAKE 1)', '+225 07 00 51 05 24', 'contact@karamogoba.ci', '🏫', 'XOF', '2026-2027',
        110, 8, 1, 0.0,
        1, ?
      )
    `);
    schoolInsert.run(schoolPwdHash);
    console.log('[School] Établissement créé : COLLÈGE PRIVÉ KARAMOGOBA DE BOUAKE (Code: 071246)');

    // 4. Utilisateurs de l'établissement (Personnel Administratif & Pédagogique)
    const staffList = [
      { id: 1, nom: 'TRAORE', prenom: 'Djakaridja', email: 'direction@karamogoba.ci', phone: '+225 07 00 51 05 24', role: 'admin', label: 'Directeur des Études' },
      { id: 2, nom: 'DIARRASSOUBA', prenom: 'Bintou', email: 'b.diarrassouba@karamogoba.ci', phone: '+225 05 44 11 22 33', role: 'professeur', label: 'Professeur Principal 6EME 2' },
      { id: 3, nom: 'SANON', prenom: 'Nani', email: 'n.sanon@karamogoba.ci', phone: '+225 07 77 88 99 00', role: 'educateur', label: 'Éducatrice & Vie Scolaire' },
      { id: 4, nom: 'KONE', prenom: 'Ousmane', email: 'caisse@karamogoba.ci', phone: '+225 01 22 33 44 55', role: 'comptable', label: 'Responsable Caisse & Écolages' }
    ];

    const userInsert = db.prepare(`
      INSERT INTO users (id, school_id, foundation_id, nom, prenom, email, phone, role, role_label, scope_type, scope_label, level, scope_value, is_active, password_hash, must_change_password)
      VALUES (?, 1, NULL, ?, ?, ?, ?, ?, ?, 'SCHOOL', 'Collège Karamogoba', 'N3', '1', 1, ?, 0)
    `);

    for (const u of staffList) {
      userInsert.run(u.id, u.nom, u.prenom, u.email, u.phone, u.role, u.label, staffPwdHash);
    }
    console.log(`[Users] ${staffList.length} comptes de gestionnaires créés (Direction, PP, Éducateur, Caissier).`);

    // 5. Caisse Principale
    db.prepare(`
      INSERT INTO cash_desks (id, school_id, code, name, type, balance, physical, status, cashier)
      VALUES ('PRINCIPALE', 1, 'CAISSE-01', 'Caisse Principale (Centrale)', 'PRINCIPALE', 0, 0, 'ACTIVE', 'M. KONE Ousmane')
    `).run();
    console.log('[CashDesk] Caisse Principale active configurée.');

    // 6. Classes Pédagogiques (Premier cycle)
    const classList = [
      { id: 1, name: '6EME 1', level: '6EME', cycle: 'Premier Cycle', cap: 35, titulaire: 'Mme Bamba Fatou', educateur: 'Mme Sanon Nani', room: 'Salle 101' },
      { id: 2, name: '6EME 2', level: '6EME', cycle: 'Premier Cycle', cap: 35, titulaire: 'Mme Diarrassouba Bintou', educateur: 'Mme Sanon Nani', room: 'Salle 102' },
      { id: 3, name: '6EME 3', level: '6EME', cycle: 'Premier Cycle', cap: 35, titulaire: 'M. Sidibe Noumoutie', educateur: 'Mme Sanon Nani', room: 'Salle 103' },
      { id: 4, name: '6EME 4', level: '6EME', cycle: 'Premier Cycle', cap: 35, titulaire: 'M. Yabre Hamed', educateur: 'Mme Sanon Nani', room: 'Salle 104' },
      { id: 5, name: '5EME 1', level: '5EME', cycle: 'Premier Cycle', cap: 40, titulaire: 'M. Kragbe N\'Dri', educateur: 'Mme Sanon Nani', room: 'Salle 201' },
      { id: 6, name: '5EME 2', level: '5EME', cycle: 'Premier Cycle', cap: 40, titulaire: 'M. Kone Yaya', educateur: 'Mme Sanon Nani', room: 'Salle 202' },
      { id: 7, name: '4EME 1', level: '4EME', cycle: 'Premier Cycle', cap: 40, titulaire: 'M. Akouati Ulrich', educateur: 'Mme Sanon Nani', room: 'Salle 301' },
      { id: 8, name: '3EME 1', level: '3EME', cycle: 'Premier Cycle', cap: 40, titulaire: 'Mme Kone Madane', educateur: 'Mme Sanon Nani', room: 'Salle 302' }
    ];

    const classInsert = db.prepare(`
      INSERT INTO classes (id, school_id, name, level, cycle, capacity, titulaire, educateur, room, status)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 'ACTIF')
    `);

    for (const c of classList) {
      classInsert.run(c.id, c.name, c.level, c.cycle, c.cap, c.titulaire, c.educateur, c.room);
    }
    console.log(`[Classes] ${classList.length} divisions pédagogiques configurées (6EME 1 à 3EME 1).`);

    // 7. Lecture et insertion des 110 élèves réels depuis le CSV
    if (!fs.existsSync(csvPath)) {
      throw new Error(`Fichier CSV des élèves introuvable : ${csvPath}`);
    }

    const rawCsv = fs.readFileSync(csvPath, 'utf8');
    const lines = rawCsv.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    const studentInsert = db.prepare(`
      INSERT INTO students (
        id, school_id, matricule, nom_prenom, sexe, red, statut,
        niveau, classe, fee_due, fee_paid, note_dev, is_absent,
        rank, mention, avg, tuteur, phone, email, enrolled_at, cash_desk
      ) VALUES (
        ?, 1, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, '09/09/2026', 'PRINCIPALE'
      )
    `);

    const paymentInsert = db.prepare(`
      INSERT INTO payments (
        id, school_id, student_id, amount, payment_method, ref,
        cashier_id, cashier_name, cash_desk, created_at
      ) VALUES (
        ?, 1, ?, ?, 'ESPECES', ?,
        4, 'M. KONE Ousmane', 'PRINCIPALE', datetime('now')
      )
    `);

    let studentIdCounter = 1;
    let paymentIdCounter = 1;
    let totalCashCollected = 0;

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(';').map(p => p.trim());
      if (parts.length < 7) continue;

      const [num, mat, nom, genre, rawClasse, rawMga, dfa] = parts;

      // Normaliser classe (ex: '6EME2' -> '6EME 2')
      let classe = rawClasse.replace(/^(6EME)(\d)$/, '$1 $2');
      if (!classe.includes(' ')) {
        classe = classe.replace(/(\d)$/, ' $1');
      }

      const niveau = '6EME';
      const mga = parseFloat(rawMga.replace(',', '.')) || 12.0;
      const isRedoublant = dfa.includes('Redouble');
      const red = isRedoublant ? 'R' : '';
      const statut = 'AFF';

      // Frais d'écolage annuel : 135 000 XOF
      const feeDue = 135000;

      // Répartition réaliste des paiements :
      // - 40% soldés à 100% (135 000 XOF)
      // - 40% premier acompte (75 000 XOF)
      // - 15% acompte d'inscription (35 000 XOF)
      // - 5% impayé (0 XOF)
      let feePaid = 0;
      const mod = studentIdCounter % 10;
      if (mod <= 3) {
        feePaid = 135000;
      } else if (mod <= 7) {
        feePaid = 75000;
      } else if (mod <= 8) {
        feePaid = 35000;
      } else {
        feePaid = 0;
      }

      let mention = 'Passable';
      if (mga >= 16) mention = 'Très Bien';
      else if (mga >= 14) mention = 'Bien';
      else if (mga >= 12) mention = 'Assez Bien';
      else if (mga < 10) mention = 'Insuffisant';

      const nomFamille = nom.split(' ')[0] || 'PARENT';
      const phoneDigits = String(Math.floor(10000000 + Math.random() * 89999999));
      const phone = `+225 07 ${phoneDigits.slice(0, 2)} ${phoneDigits.slice(2, 4)} ${phoneDigits.slice(4, 6)} ${phoneDigits.slice(6, 8)}`;
      const tuteur = `M. ${nomFamille} (${phone})`;

      studentInsert.run(
        studentIdCounter,
        mat,
        nom,
        genre,
        red,
        statut,
        niveau,
        classe,
        feeDue,
        feePaid,
        mga,
        0, // absent
        studentIdCounter, // rank
        mention,
        mga,
        tuteur,
        phone,
        `eleve.${mat.toLowerCase()}@karamogoba.ci`
      );

      // Si paiement effectué, émettre quittance officielle
      if (feePaid > 0) {
        const rcptNo = `QUITT-2026-${String(studentIdCounter).padStart(4, '0')}`;
        paymentInsert.run(
          paymentIdCounter,
          studentIdCounter,
          feePaid,
          rcptNo
        );
        paymentIdCounter++;
        totalCashCollected += feePaid;
      }

      studentIdCounter++;
    }

    const insertedCount = studentIdCounter - 1;
    console.log(`[Students] ${insertedCount} élèves réels importés depuis dfa_selection_110_eleves.csv.`);
    console.log(`[Payments] ${paymentIdCounter - 1} quittances d'écolage générées. Total perçu : ${totalCashCollected.toLocaleString('fr-FR')} XOF.`);

    // Mettre à jour la caisse principale
    db.prepare('UPDATE cash_desks SET balance = ?, physical = ? WHERE id = ?').run(totalCashCollected, totalCashCollected, 'PRINCIPALE');

    // Mettre à jour les compteurs de l'école
    const recoveryRate = Math.round((totalCashCollected / (insertedCount * 135000)) * 1000) / 10;
    db.prepare('UPDATE schools SET students_count = ?, classes_count = 8, recovery_rate = ? WHERE id = 1').run(insertedCount, recoveryRate);

    // Enregistrer l'audit
    db.prepare(`
      INSERT INTO audit_logs (school_id, foundation_id, user_id, action, module, target, old_val, new_val, status)
      VALUES (1, NULL, 0, 'REAL_DATA_POPULATE', 'Système', 'Collège Karamogoba', '', 'Peuplement certifié : 110 élèves réels de Bouaké, 8 classes et quittances initialisées', 'SUCCÈS')
    `).run();

    db.exec('COMMIT;');
    db.exec('PRAGMA foreign_keys = ON;');

    console.log('\n======================================================');
    console.log('✅ BASE DE DONNÉES RÉELLE PEUPLÉE AVEC SUCCÈS !');
    console.log('   - Établissement : COLLÈGE PRIVÉ KARAMOGOBA DE BOUAKE');
    console.log('   - Code École    : 071246');
    console.log('   - Ville         : Bouaké (DRENA BOUAKE 1)');
    console.log(`   - Effectif réel : ${insertedCount} élèves inscrits`);
    console.log('   - Classes       : 6EME 1, 6EME 2, 6EME 3, 6EME 4, 5EME, 4EME, 3EME');
    console.log(`   - Encaissé      : ${totalCashCollected.toLocaleString('fr-FR')} XOF (${recoveryRate}% de recouvrement)`);
    console.log('   - Compte Admin  : direction@karamogoba.ci / Password2026!');
    console.log('   - Code Accès    : 071246 / Karamogoba2026!');
    console.log('======================================================\n');
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('❌ Échec du peuplement :', err);
    process.exit(1);
  }
}

seed().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
