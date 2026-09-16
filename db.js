/**
 * =====================================================================
 * ScolaPro — Moteur de Base de Données Persistante (db.js)
 * Architecture : Node.js native node:sqlite (DatabaseSync)
 * Base de données : scolapro.db (dans le répertoire racine)
 * Alignement : schema.sql (PostgreSQL 14+ compatible)
 * Sécurité : Multi-tenant strict (school_id / foundation_id)
 * =====================================================================
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'scolapro.db');
const db = new DatabaseSync(DB_PATH);

// Optimisation et intégrité relationnelle
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

// ---------------------------------------------------------------------
// CRÉATION DES TABLES RELATIONNELLES
// ---------------------------------------------------------------------
function initSchema() {
  db.exec(`
    -- 1. FONDATIONS & GROUPES SCOLAIRES
    CREATE TABLE IF NOT EXISTS foundations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      sigle TEXT,
      hq TEXT,
      president TEXT,
      phone TEXT,
      email TEXT,
      logo TEXT DEFAULT '🏛️',
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 2. ÉTABLISSEMENTS SCOLAIRES (TENANTS)
    CREATE TABLE IF NOT EXISTS schools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      short_name TEXT,
      foundation_id INTEGER REFERENCES foundations(id) ON DELETE SET NULL,
      school_type TEXT NOT NULL DEFAULT 'COLLÈGE & LYCÉE',
      city TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      logo TEXT DEFAULT '🏛️',
      currency TEXT NOT NULL DEFAULT 'XOF',
      academic_year TEXT NOT NULL DEFAULT '2026-2027',
      students_count INTEGER DEFAULT 0,
      classes_count INTEGER DEFAULT 0,
      cash_desks_count INTEGER DEFAULT 0,
      recovery_rate REAL DEFAULT 0.0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 3. UTILISATEURS RBAC
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
      foundation_id INTEGER REFERENCES foundations(id) ON DELETE CASCADE,
      nom TEXT NOT NULL,
      prenom TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      role TEXT NOT NULL,
      role_label TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_label TEXT NOT NULL,
      level TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 4. CLASSES
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      level TEXT NOT NULL,
      cycle TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 45,
      titulaire TEXT,
      educateur TEXT,
      room TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIF',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 5. ÉLÈVES
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      matricule TEXT NOT NULL UNIQUE,
      nom_prenom TEXT NOT NULL,
      sexe TEXT NOT NULL DEFAULT 'M',
      red TEXT DEFAULT '',
      statut TEXT NOT NULL DEFAULT 'AFF',
      niveau TEXT NOT NULL,
      classe TEXT NOT NULL,
      fee_due INTEGER NOT NULL DEFAULT 120000,
      fee_paid INTEGER NOT NULL DEFAULT 0,
      note_dev REAL DEFAULT 10.0,
      is_absent INTEGER NOT NULL DEFAULT 0,
      rank INTEGER DEFAULT 1,
      mention TEXT DEFAULT 'Passable',
      avg REAL DEFAULT 10.0,
      tuteur TEXT,
      phone TEXT,
      email TEXT,
      enrolled_at TEXT NOT NULL DEFAULT (date('now')),
      cash_desk TEXT DEFAULT 'PRINCIPALE',
      overdue_days INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 6. CAISSES
    CREATE TABLE IF NOT EXISTS cash_desks (
      id TEXT PRIMARY KEY,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'SECONDAIRE',
      balance INTEGER NOT NULL DEFAULT 0,
      physical INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      cashier TEXT NOT NULL DEFAULT 'Non assigné',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 7. VERSEMENTS INTER-CAISSES (BORDEREAUX)
    CREATE TABLE IF NOT EXISTS cash_deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      ref TEXT NOT NULL UNIQUE,
      source_name TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_name TEXT NOT NULL DEFAULT 'Caisse Principale',
      amount INTEGER NOT NULL,
      operator TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'PENDING',
      validated_by TEXT,
      validated_at TEXT,
      rejection_reason TEXT,
      ref_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 8. PAIEMENTS & QUITTANCES ÉCOLAGES
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'ESPECES',
      ref TEXT NOT NULL,
      cashier_id INTEGER,
      cashier_name TEXT,
      cash_desk TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 9. JOURNAUX D'AUDIT & TRAÇABILITÉ (ISO 27001)
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
      foundation_id INTEGER REFERENCES foundations(id) ON DELETE CASCADE,
      user_id INTEGER,
      action TEXT NOT NULL,
      module TEXT NOT NULL,
      target TEXT NOT NULL,
      old_val TEXT,
      new_val TEXT,
      status TEXT NOT NULL DEFAULT 'SUCCÈS',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 10. CONFIGURATIONS SYSTÈME & PARAMÈTRES GLOBAUX SOUVERAINS (Niveau 1)
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 11. PARAMÈTRES DE FONDATION (Niveau 2)
    CREATE TABLE IF NOT EXISTS foundation_settings (
      foundation_id INTEGER NOT NULL REFERENCES foundations(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      description TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (foundation_id, key)
    );

    -- 12. PARAMÈTRES D'ÉTABLISSEMENT (Niveau 3)
    CREATE TABLE IF NOT EXISTS school_settings (
      school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      description TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (school_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_found_settings ON foundation_settings(foundation_id);
    CREATE INDEX IF NOT EXISTS idx_school_settings ON school_settings(school_id);

    -- INDEX DE PERFORMANCES ET CLOISONNEMENT
    CREATE INDEX IF NOT EXISTS idx_schools_found ON schools(foundation_id);
    CREATE INDEX IF NOT EXISTS idx_classes_school ON classes(school_id);
    CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
    CREATE INDEX IF NOT EXISTS idx_desks_school ON cash_desks(school_id);
    CREATE INDEX IF NOT EXISTS idx_deposits_school ON cash_deposits(school_id);
    CREATE INDEX IF NOT EXISTS idx_payments_school ON payments(school_id);
    CREATE INDEX IF NOT EXISTS idx_audit_school ON audit_logs(school_id);
  `);

  // Initialisation des configurations par défaut si absentes
  const countSettings = db.prepare('SELECT COUNT(*) as count FROM system_settings').get();
  if (countSettings.count === 0) {
    const insertSetting = db.prepare(`
      INSERT OR IGNORE INTO system_settings (key, value, description, updated_by)
      VALUES (?, ?, ?, 'Concepteur Système')
    `);
    insertSetting.run('platform_name', 'ScolaPro', 'Nom officiel de la plateforme SaaS');
    insertSetting.run('platform_version', '2.5.0', 'Version du noyau applicatif');
    insertSetting.run('maintenance_mode', 'false', 'Verrouillage de maintenance globale');
    insertSetting.run('allow_tenant_registration', 'true', 'Autorisation de provisionnement de nouveaux établissements');
    insertSetting.run('sms_gateway_provider', 'orange_ci', 'Passerelle SMS transactionnelle');
    insertSetting.run('currency_default', 'XOF', 'Devise financière de référence');
    insertSetting.run('academic_year_active', '2026-2027', 'Année académique courante');
    insertSetting.run('security_session_timeout_minutes', '120', 'Durée de validité des sessions utilisateur');
    insertSetting.run('max_login_attempts', '5', 'Seuil de verrouillage anti-bruteforce');
    insertSetting.run('payment_reminder_threshold_days', '15', 'Seuil d\'alerte des impayés d\'écolage');
    insertSetting.run('enforce_strict_isolation', 'true', 'Cloisonnement multi-tenant hermétique');
  }
}

// ---------------------------------------------------------------------
// ENSEMENCEMENT INITIAL (SEEDING) SI LA BASE EST VIDE
// ---------------------------------------------------------------------
function seedDatabase() {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM foundations');
  const { count } = countStmt.get();
  if (count > 0) return; // Déjà initialisé

  console.log('[Database] Ensemencement initial de la base de données ScolaPro...');

  // 1. Fondations
  const insertFound = db.prepare(`
    INSERT INTO foundations (id, code, name, sigle, hq, president, phone, email, logo, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertFound.run(1, 'fondation-fea', 'Fondation Éducation & Avenir', 'FEA', 'Plateau, Immeuble CCIA, Abidjan', 'Dr. Kouamé A. Patrice', '+225 27 20 22 00', 'contact@fondation-fea.ci', '🏛️', "Réseau d'excellence scolaire promouvant l'éducation moderne, l'égalité des chances et la réussite académique.", '2024-01-15 00:00:00');

  // 2. Écoles
  const insertSchool = db.prepare(`
    INSERT INTO schools (id, code, name, short_name, foundation_id, school_type, city, address, phone, email, logo, currency, academic_year, students_count, classes_count, cash_desks_count, recovery_rate, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSchool.run(1, 'lyc-sainte-marie', "Lycée Sainte-Marie d'Abidjan", "Lycée Sainte-Marie", 1, "COLLÈGE & LYCÉE", "Abidjan Cocody", "Boulevard de l'Université, Cocody", "+225 27 22 44 22", "direction@lyceesaintemarie.ci", "🏛️", "XOF", "2026-2027", 0, 24, 3, 0.0, 1);
  insertSchool.run(2, 'col-sainte-anne', "Collège Sainte-Anne de Treichville", "Collège Sainte-Anne", 1, "PREMIER CYCLE (COLLÈGE)", "Abidjan Treichville", "Avenue 12, Rue 15, Treichville", "+225 27 21 24 10", "contact@sainteanne.ci", "📖", "XOF", "2026-2027", 0, 16, 1, 0.0, 1);
  insertSchool.run(3, 'ep-les-lauriers', "École Primaire d'Application Les Lauriers", "Les Lauriers", 1, "PRIMAIRE", "Abidjan Yopougon", "Yopougon Selmer, Rue Principale", "+225 27 23 45 67", "secretariat@leslauriers.ci", "🌱", "XOF", "2026-2027", 0, 12, 1, 0.0, 1);

  // 3. Utilisateurs
  const insertUser = db.prepare(`
    INSERT INTO users (id, school_id, foundation_id, nom, prenom, email, phone, role, role_label, scope_type, scope_label, level, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  insertUser.run(0, null, null, "KOFFI", "Dr. Patrick", "patrick.koffi@innovagroup.ci", "+225 07 00 00 01", "concepteur", "Concepteur Système & Super Admin (INNOVA GROUP)", "GLOBAL", "SOUVERAIN (Global)", "PLATFORM");
  insertUser.run(1, null, 1, "KOUAMÉ", "Dr. Patrice", "patrice.kouame@fondation-fea.ci", "+225 07 00 00 02", "fondateur", "Président du Conseil de Fondation", "FOUNDATION", "FONDATION (FEA)", "FOUNDATION");
  insertUser.run(2, 1, 1, "DIARRA", "Dolourou Mathieu", "m.diarra@lyceesaintemarie.ci", "+225 07 48 29 10", "admin", "Proviseur / Administrateur Établissement", "SCHOOL", "Établissement (Lycée Sainte-Marie)", "SCHOOL");
  insertUser.run(3, 1, 1, "N'GUETTA", "Kouadio Simplice", "s.nguetta@lyceesaintemarie.ci", "+225 05 12 34 56", "de", "Directeur des Études (D.E / A.CE)", "SCHOOL", "Établissement (Lycée Sainte-Marie)", "SCHOOL");
  insertUser.run(4, 1, 1, "TRAORÉ", "Souleymane", "s.traore@lyceesaintemarie.ci", "+225 01 23 45 67", "cf", "Correspondant Fichier (CF)", "SCHOOL", "Écolage Établissement", "SCHOOL");
  insertUser.run(5, 1, 1, "BAMBA", "Fatou Alimata", "f.bamba@lyceesaintemarie.ci", "+225 07 89 01 23", "educateur", "Éducateur", "CLASSES", "Classes 4EME 5 & 6EME 1", "SCHOOL");
  insertUser.run(6, 1, 1, "AHOU", "Clarisse Marie", "c.ahou@lyceesaintemarie.ci", "+225 05 67 89 01", "caisse_principale", "Responsable Caisse Principale", "CASH_DESK", "Caisse Principale", "SCHOOL");
  insertUser.run(7, 1, 1, "KOFFI", "Yao Paul", "y.koffi@lyceesaintemarie.ci", "+225 01 02 03 04", "caisse_secondaire", "Responsable Caisse 2", "CASH_DESK", "Caisse 2 uniquement (Strict)", "SCHOOL");
  insertUser.run(8, 1, 1, "DIALLO", "Ibrahima Amadou", "i.diallo@lyceesaintemarie.ci", "+225 07 11 22 33", "consultation", "Utilisateur Consultation", "SCHOOL", "Établissement (Lecture Seule)", "SCHOOL");

  // 4. Classes
  const insertClass = db.prepare(`
    INSERT INTO classes (id, school_id, name, level, cycle, capacity, titulaire, educateur, room, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const initialClasses = [
    [1, 1, '6EME 1', '6EME', 'Premier Cycle', 45, 'Mme Bamba Fatou', 'Mme Bamba Fatou', 'Salle 101', 'ACTIF'],
    [2, 1, '6EME 2', '6EME', 'Premier Cycle', 45, 'M. Koné Bakary', 'Mme Bamba Fatou', 'Salle 102', 'ACTIF'],
    [3, 1, '5EME 3', '5EME', 'Premier Cycle', 45, 'M. Coulibaly L.', 'M. Yao Alexis', 'Salle 103', 'ACTIF'],
    [4, 1, '4EME 5', '4EME', 'Premier Cycle', 45, 'M. Kouassi Kouamé', 'Mme Bamba Fatou', 'Salle 104', 'ACTIF'],
    [5, 1, '3EME 1', '3EME', 'Premier Cycle', 40, 'M. Traoré Souleymane', 'M. Yao Alexis', 'Salle 105', 'ACTIF'],
    [6, 1, '3EME 5', '3EME', 'Premier Cycle', 40, 'Mme Ahou Clarisse', 'M. Yao Alexis', 'Salle 106', 'ACTIF'],
    [7, 1, '2NDE A', '2NDE', 'Second Cycle', 40, 'M. Sanogo Bakary', 'Mme Konan Brigitte', 'Salle 201', 'ACTIF'],
    [8, 1, '1ERE C', '1ERE', 'Second Cycle', 35, "M. N'Guetta Kouadio", 'Mme Konan Brigitte', 'Salle 202', 'ACTIF'],
    [9, 1, 'TLE D 2', 'TLE', 'Second Cycle', 35, 'M. Diarra Dolourou', 'M. Soro Gnenema', 'Salle 203', 'ACTIF'],
    [10, 2, '6EME A', '6EME', 'Premier Cycle', 40, 'M. Gnagne Paul', 'Mme Koffi Solange', 'Bât A-01', 'ACTIF'],
    [11, 2, '5EME A', '5EME', 'Premier Cycle', 40, 'Mme Djedje Diane', 'Mme Koffi Solange', 'Bât A-02', 'ACTIF'],
    [12, 2, '3EME A', '3EME', 'Premier Cycle', 40, 'M. Ahikpa Denis', 'Mme Koffi Solange', 'Bât A-03', 'ACTIF']
  ];
  initialClasses.forEach(c => insertClass.run(...c));

  // 5. Caisses (Initialisées à solde 0 XOF - Zéro fausse donnée)
  const insertDesk = db.prepare(`
    INSERT INTO cash_desks (id, school_id, code, name, type, balance, physical, status, cashier)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertDesk.run('PRINCIPALE', 1, 'CAISSE-01', 'Caisse Principale (Centrale)', 'PRINCIPALE', 0, 0, 'ACTIVE', 'Clarisse Marie AHOU');
  insertDesk.run('CAISSE_1', 1, 'CAISSE-02', 'Caisse Secondaire 1 (Guichet A)', 'SECONDAIRE', 0, 0, 'ACTIVE', 'Ibrahima SOW');
  insertDesk.run('CAISSE_2', 1, 'CAISSE-03', 'Caisse Secondaire 2 (Guichet B)', 'SECONDAIRE', 0, 0, 'ACTIVE', 'Yao Paul KOFFI');
  insertDesk.run('CAISSE_STE_ANNE', 2, 'CSA-01', 'Caisse Unique Collège Sainte-Anne', 'PRINCIPALE', 0, 0, 'ACTIVE', 'Mme KOUASSI Julie');

  // (Élèves, Versements et Paiements : tables 100% propres sans données factices, prêtes pour les saisies réelles)

  // 9. Journaux d'audit
  const insertAudit = db.prepare(`
    INSERT INTO audit_logs (school_id, foundation_id, user_id, action, module, target, old_val, new_val, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertAudit.run(1, 1, 0, 'SYSTEM_BOOT', 'Système', 'Plateforme ScolaPro', '', 'Initialisation de la base SQLite et du socle multi-tenant', 'SUCCÈS');
  insertAudit.run(1, 1, 6, 'CASH_SESSION_OPEN', 'Caisse', 'Caisse Principale', '', 'Ouverture de session matinale (8 400 000 XOF)', 'SUCCÈS');

  console.log('[Database] Ensemencement initial terminé avec succès.');
}

// Initialisation au chargement
initSchema();
seedDatabase();

// ---------------------------------------------------------------------
// GESTIONNAIRES D'ACCÈS AUX DONNÉES (RBAC & MULTI-TENANT)
// ---------------------------------------------------------------------

/**
 * Formatage d'un élève SQLite vers l'objet JSON attendu par le client
 */
function formatStudent(row) {
  if (!row) return null;
  return {
    id: row.id,
    schoolId: row.school_id,
    matricule: row.matricule,
    nomPrenom: row.nom_prenom,
    sexe: row.sexe,
    red: row.red || '',
    statut: row.statut,
    niveau: row.niveau,
    classe: row.classe,
    feeDue: row.fee_due,
    feePaid: row.fee_paid,
    noteDev: row.note_dev,
    isAbsent: Boolean(row.is_absent),
    rank: row.rank,
    mention: row.mention,
    avg: row.avg,
    tuteur: row.tuteur,
    phone: row.phone,
    email: row.email,
    enrolledAt: row.enrolled_at,
    cashDesk: row.cash_desk,
    overdueDays: row.overdue_days || 0
  };
}

/**
 * Formatage d'une caisse SQLite vers l'objet JSON client
 */
function formatCashDesk(row) {
  if (!row) return null;
  return {
    id: row.id,
    schoolId: row.school_id,
    code: row.code,
    name: row.name,
    type: row.type,
    balance: row.balance,
    physical: row.physical,
    status: row.status,
    cashier: row.cashier
  };
}

/**
 * Formatage d'un versement SQLite vers l'objet JSON client
 */
function formatCashDeposit(row) {
  if (!row) return null;
  return {
    id: row.id,
    schoolId: row.school_id,
    ref: row.ref,
    source: row.source_name,
    sourceId: row.source_id,
    target: row.target_name,
    amount: row.amount,
    operator: row.operator,
    timestamp: row.timestamp,
    status: row.status,
    validatedBy: row.validated_by,
    validatedAt: row.validated_at,
    rejectionReason: row.rejection_reason,
    refNote: row.ref_note
  };
}

/**
 * Récupération du jeu de données complet scopé pour l'initialisation du frontend
 */
function getBootstrapData(user) {
  let foundations = [];
  let schools = [];
  let classes = [];
  let students = [];
  let cashDesks = [];
  let cashDeposits = [];
  let auditLogs = [];
  let payments = [];

  // NIVEAU 1 : Concepteur (Vue Globale et Souveraine)
  if (user.role === 'concepteur') {
    foundations = db.prepare('SELECT * FROM foundations ORDER BY id ASC').all().map(f => ({
      id: f.id,
      code: f.code,
      name: f.name,
      sigle: f.sigle,
      hq: f.hq,
      president: f.president,
      phone: f.phone,
      email: f.email,
      logo: f.logo,
      description: f.description,
      createdAt: f.created_at
    }));

    schools = db.prepare('SELECT * FROM schools ORDER BY id ASC').all().map(s => ({
      id: s.id,
      code: s.code,
      name: s.name,
      shortName: s.short_name,
      foundationId: s.foundation_id,
      schoolType: s.school_type,
      city: s.city,
      address: s.address,
      phone: s.phone,
      email: s.email,
      logo: s.logo,
      currency: s.currency,
      academicYear: s.academic_year,
      studentsCount: s.students_count,
      classesCount: s.classes_count,
      cashDesksCount: s.cash_desks_count,
      recoveryRate: s.recovery_rate,
      isActive: Boolean(s.is_active)
    }));

    classes = db.prepare('SELECT * FROM classes ORDER BY id ASC').all().map(c => ({
      id: c.id,
      schoolId: c.school_id,
      name: c.name,
      level: c.level,
      cycle: c.cycle,
      capacity: c.capacity,
      titulaire: c.titulaire,
      educateur: c.educateur,
      room: c.room,
      status: c.status
    }));

    students = db.prepare('SELECT * FROM students ORDER BY id DESC').all().map(formatStudent);
    payments = db.prepare(`
      SELECT p.*, s.nom_prenom as student_name, s.matricule as student_matricule, s.classe as student_classe 
      FROM payments p 
      LEFT JOIN students s ON s.id = p.student_id 
      ORDER BY p.id DESC
    `).all().map(formatPayment);
    cashDesks = db.prepare('SELECT * FROM cash_desks ORDER BY id ASC').all().map(formatCashDesk);
    cashDeposits = db.prepare('SELECT * FROM cash_deposits ORDER BY id DESC').all().map(formatCashDeposit);
    auditLogs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100').all();
  }
  // NIVEAU 2 : Fondateur (Scope restreint à sa Fondation et ses Écoles)
  else if (user.role === 'fondateur') {
    const fId = user.foundationId;
    foundations = db.prepare('SELECT * FROM foundations WHERE id = ?').all(fId).map(f => ({
      id: f.id,
      code: f.code,
      name: f.name,
      sigle: f.sigle,
      hq: f.hq,
      president: f.president,
      phone: f.phone,
      email: f.email,
      logo: f.logo,
      description: f.description,
      createdAt: f.created_at
    }));

    schools = db.prepare('SELECT * FROM schools WHERE foundation_id = ? ORDER BY id ASC').all(fId).map(s => ({
      id: s.id,
      code: s.code,
      name: s.name,
      shortName: s.short_name,
      foundationId: s.foundation_id,
      schoolType: s.school_type,
      city: s.city,
      address: s.address,
      phone: s.phone,
      email: s.email,
      logo: s.logo,
      currency: s.currency,
      academicYear: s.academic_year,
      studentsCount: s.students_count,
      classesCount: s.classes_count,
      cashDesksCount: s.cash_desks_count,
      recoveryRate: s.recovery_rate,
      isActive: Boolean(s.is_active)
    }));

    const schoolIds = schools.map(s => s.id);
    if (schoolIds.length > 0) {
      const placeholders = schoolIds.map(() => '?').join(',');
      classes = db.prepare(`SELECT * FROM classes WHERE school_id IN (${placeholders}) ORDER BY id ASC`).all(...schoolIds).map(c => ({
        id: c.id,
        schoolId: c.school_id,
        name: c.name,
        level: c.level,
        cycle: c.cycle,
        capacity: c.capacity,
        titulaire: c.titulaire,
        educateur: c.educateur,
        room: c.room,
        status: c.status
      }));

      students = db.prepare(`SELECT * FROM students WHERE school_id IN (${placeholders}) ORDER BY id DESC`).all(...schoolIds).map(formatStudent);
      payments = db.prepare(`
        SELECT p.*, s.nom_prenom as student_name, s.matricule as student_matricule, s.classe as student_classe 
        FROM payments p 
        LEFT JOIN students s ON s.id = p.student_id 
        WHERE p.school_id IN (${placeholders}) 
        ORDER BY p.id DESC
      `).all(...schoolIds).map(formatPayment);
      cashDesks = db.prepare(`SELECT * FROM cash_desks WHERE school_id IN (${placeholders}) ORDER BY id ASC`).all(...schoolIds).map(formatCashDesk);
      cashDeposits = db.prepare(`SELECT * FROM cash_deposits WHERE school_id IN (${placeholders}) ORDER BY id DESC`).all(...schoolIds).map(formatCashDeposit);
      auditLogs = db.prepare(`SELECT * FROM audit_logs WHERE foundation_id = ? OR school_id IN (${placeholders}) ORDER BY id DESC LIMIT 100`).all(fId, ...schoolIds);
    }
  }
  // NIVEAU 3 : École (Cloisonnement strict sur l'établissement)
  else {
    const sId = user.schoolId || 1;
    const schoolRow = db.prepare('SELECT * FROM schools WHERE id = ?').get(sId);
    if (schoolRow) {
      schools = [{
        id: schoolRow.id,
        code: schoolRow.code,
        name: schoolRow.name,
        shortName: schoolRow.short_name,
        foundationId: schoolRow.foundation_id,
        schoolType: schoolRow.school_type,
        city: schoolRow.city,
        address: schoolRow.address,
        phone: schoolRow.phone,
        email: schoolRow.email,
        logo: schoolRow.logo,
        currency: schoolRow.currency,
        academicYear: schoolRow.academic_year,
        studentsCount: schoolRow.students_count,
        classesCount: schoolRow.classes_count,
        cashDesksCount: schoolRow.cash_desks_count,
        recoveryRate: schoolRow.recovery_rate,
        isActive: Boolean(schoolRow.is_active)
      }];

      if (schoolRow.foundation_id) {
        const foundRow = db.prepare('SELECT * FROM foundations WHERE id = ?').get(schoolRow.foundation_id);
        if (foundRow) {
          foundations = [{
            id: foundRow.id,
            code: foundRow.code,
            name: foundRow.name,
            sigle: foundRow.sigle,
            hq: foundRow.hq,
            president: foundRow.president,
            phone: foundRow.phone,
            email: foundRow.email,
            logo: foundRow.logo,
            description: foundRow.description,
            createdAt: foundRow.created_at
          }];
        }
      }
    }

    classes = db.prepare('SELECT * FROM classes WHERE school_id = ? ORDER BY id ASC').all(sId).map(c => ({
      id: c.id,
      schoolId: c.school_id,
      name: c.name,
      level: c.level,
      cycle: c.cycle,
      capacity: c.capacity,
      titulaire: c.titulaire,
      educateur: c.educateur,
      room: c.room,
      status: c.status
    }));

    students = db.prepare('SELECT * FROM students WHERE school_id = ? ORDER BY id DESC').all(sId).map(formatStudent);
    payments = db.prepare(`
      SELECT p.*, s.nom_prenom as student_name, s.matricule as student_matricule, s.classe as student_classe 
      FROM payments p 
      LEFT JOIN students s ON s.id = p.student_id 
      WHERE p.school_id = ? 
      ORDER BY p.id DESC
    `).all(sId).map(formatPayment);
    cashDesks = db.prepare('SELECT * FROM cash_desks WHERE school_id = ? ORDER BY id ASC').all(sId).map(formatCashDesk);
    cashDeposits = db.prepare('SELECT * FROM cash_deposits WHERE school_id = ? ORDER BY id DESC').all(sId).map(formatCashDeposit);
    auditLogs = db.prepare('SELECT * FROM audit_logs WHERE school_id = ? ORDER BY id DESC LIMIT 100').all(sId);
  }

  return {
    currentUser: user,
    foundations,
    schools,
    classes,
    students,
    payments,
    users: getUsers(user),
    cashDesks,
    cashDeposits,
    auditLogs
  };
}

// ---------------------------------------------------------------------
// CRUD ÉLÈVES
// ---------------------------------------------------------------------

function getStudents(user, schoolId = null) {
  const targetSchoolId = (user.role === 'concepteur' && schoolId) ? schoolId : (user.schoolId || 1);
  if (user.role === 'concepteur' && !schoolId) {
    return db.prepare('SELECT * FROM students ORDER BY id DESC').all().map(formatStudent);
  }
  return db.prepare('SELECT * FROM students WHERE school_id = ? ORDER BY id DESC').all(targetSchoolId).map(formatStudent);
}

function getStudentById(id) {
  const row = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  return formatStudent(row);
}

function createStudent(user, data) {
  const schoolId = (user.role === 'concepteur' && data.schoolId) ? data.schoolId : (user.schoolId || 1);
  const matricule = data.matricule || `ST-${Date.now().toString().slice(-6)}`;
  const nomPrenom = data.nomPrenom || `${data.nom || ''} ${data.prenoms || ''}`.trim().toUpperCase();

  const stmt = db.prepare(`
    INSERT INTO students (
      school_id, matricule, nom_prenom, sexe, red, statut, niveau, classe,
      fee_due, fee_paid, note_dev, is_absent, rank, mention, avg,
      tuteur, phone, email, enrolled_at, cash_desk, overdue_days
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);

  const result = stmt.run(
    schoolId,
    matricule,
    nomPrenom,
    data.sexe || 'M',
    data.red || '',
    data.statut || 'AFF',
    data.niveau || '6EME',
    data.classe || 'Non assigné',
    data.feeDue !== undefined ? data.feeDue : 120000,
    data.feePaid !== undefined ? data.feePaid : 0,
    data.noteDev !== undefined ? data.noteDev : 10.0,
    data.isAbsent ? 1 : 0,
    data.rank || 1,
    data.mention || 'Passable',
    data.avg !== undefined ? data.avg : 10.0,
    data.tuteur || '',
    data.phone || '',
    data.email || '',
    data.enrolledAt || new Date().toLocaleDateString('fr-FR'),
    data.cashDesk || 'CAISSE_2',
    data.overdueDays || 0
  );

  const newId = Number(result.lastInsertRowid);
  addAuditLog(user, {
    action: 'STUDENT_ENROLL',
    module: 'Inscription',
    target: `Élève #${newId}`,
    oldVal: '',
    newVal: `${nomPrenom} (${matricule})`,
    schoolId: schoolId
  });

  return getStudentById(newId);
}

function updateStudent(user, id, data) {
  const current = getStudentById(id);
  if (!current) throw new Error("Élève non trouvé");

  // Contrôle RBAC multi-tenant
  if (user.role !== 'concepteur' && user.schoolId && current.schoolId !== user.schoolId) {
    throw new Error("Accès refusé : cet élève n'appartient pas à votre établissement");
  }

  const stmt = db.prepare(`
    UPDATE students SET
      nom_prenom = COALESCE(?, nom_prenom),
      matricule = COALESCE(?, matricule),
      sexe = COALESCE(?, sexe),
      red = COALESCE(?, red),
      statut = COALESCE(?, statut),
      niveau = COALESCE(?, niveau),
      classe = COALESCE(?, classe),
      fee_due = COALESCE(?, fee_due),
      fee_paid = COALESCE(?, fee_paid),
      note_dev = COALESCE(?, note_dev),
      is_absent = COALESCE(?, is_absent),
      tuteur = COALESCE(?, tuteur),
      phone = COALESCE(?, phone),
      email = COALESCE(?, email)
    WHERE id = ?
  `);

  stmt.run(
    data.nomPrenom || null,
    data.matricule || null,
    data.sexe || null,
    data.red !== undefined ? data.red : null,
    data.statut || null,
    data.niveau || null,
    data.classe || null,
    data.feeDue !== undefined ? data.feeDue : null,
    data.feePaid !== undefined ? data.feePaid : null,
    data.noteDev !== undefined ? data.noteDev : null,
    data.isAbsent !== undefined ? (data.isAbsent ? 1 : 0) : null,
    data.tuteur || null,
    data.phone || null,
    data.email || null,
    id
  );

  addAuditLog(user, {
    action: 'STUDENT_UPDATE',
    module: 'Inscription',
    target: `Élève #${id}`,
    oldVal: current.nomPrenom,
    newVal: data.nomPrenom || current.nomPrenom,
    schoolId: current.schoolId
  });

  return getStudentById(id);
}

function deleteStudent(user, id) {
  const current = getStudentById(id);
  if (!current) throw new Error("Élève introuvable");

  // Règle financière stricte (TEST 14) : impossible de supprimer si des versements ont été enregistrés
  if (current.feePaid > 0) {
    throw new Error(`Sécurité financière : L'élève a déjà versé ${current.feePaid.toLocaleString()} XOF. Annulez les quittances au préalable.`);
  }

  if (user.role !== 'concepteur' && user.schoolId && current.schoolId !== user.schoolId) {
    throw new Error("Accès refusé : cet élève n'appartient pas à votre établissement");
  }

  db.prepare('DELETE FROM students WHERE id = ?').run(id);

  addAuditLog(user, {
    action: 'STUDENT_DELETE',
    module: 'Inscription',
    target: `Élève #${id}`,
    oldVal: current.nomPrenom,
    newVal: 'SUPPRIMÉ',
    schoolId: current.schoolId
  });

  return { success: true, id };
}

// ---------------------------------------------------------------------
// GESTION DES CAISSES & VERSEMENTS (TRANSACTIONS ATOMIQUES)
// ---------------------------------------------------------------------

function getCashDesks(user) {
  if (user.role === 'concepteur') {
    return db.prepare('SELECT * FROM cash_desks ORDER BY id ASC').all().map(formatCashDesk);
  }
  const sId = user.schoolId || 1;
  return db.prepare('SELECT * FROM cash_desks WHERE school_id = ? ORDER BY id ASC').all(sId).map(formatCashDesk);
}

function createCashDesk(user, data) {
  const schoolId = user.schoolId || 1;
  const id = data.id || `CAISSE_${Date.now()}`;
  const code = data.code || `CS-${Date.now().toString().slice(-4)}`;
  const name = data.name;

  db.prepare(`
    INSERT INTO cash_desks (id, school_id, code, name, type, balance, physical, status, cashier)
    VALUES (?, ?, ?, ?, 'SECONDAIRE', 0, 0, 'ACTIVE', ?)
  `).run(id, schoolId, code, name, data.cashier || 'Non assigné');

  addAuditLog(user, {
    action: 'CASH_DESK_CREATE',
    module: 'Caisse',
    target: name,
    oldVal: '',
    newVal: `Nouvelle caisse créée (${code})`,
    schoolId: schoolId
  });

  return formatCashDesk(db.prepare('SELECT * FROM cash_desks WHERE id = ?').get(id));
}

function getCashDeposits(user) {
  if (user.role === 'concepteur') {
    return db.prepare('SELECT * FROM cash_deposits ORDER BY id DESC').all().map(formatCashDeposit);
  }
  const sId = user.schoolId || 1;
  return db.prepare('SELECT * FROM cash_deposits WHERE school_id = ? ORDER BY id DESC').all(sId).map(formatCashDeposit);
}

function createCashDeposit(user, data) {
  const schoolId = user.schoolId || 1;
  const amount = parseInt(data.amount, 10);
  if (isNaN(amount) || amount <= 0) throw new Error("Montant invalide");

  const ref = data.ref || `DEP-${Date.now().toString().slice(-6)}`;
  const operator = `${user.prenom} ${user.nom}`;
  const timestamp = new Date().toLocaleDateString('fr-FR') + ' ' + new Date().toLocaleTimeString('fr-FR');

  const stmt = db.prepare(`
    INSERT INTO cash_deposits (
      school_id, ref, source_name, source_id, target_name,
      amount, operator, timestamp, status, ref_note
    ) VALUES (?, ?, ?, ?, 'Caisse Principale', ?, ?, ?, 'PENDING', ?)
  `);

  const result = stmt.run(
    schoolId,
    ref,
    data.source || 'Caisse Secondaire n°2',
    data.sourceId || 'CAISSE_2',
    amount,
    operator,
    timestamp,
    data.refNote || ref
  );

  const newId = Number(result.lastInsertRowid);
  addAuditLog(user, {
    action: 'CASH_DEPOSIT_INIT',
    module: 'Caisse',
    target: `Dépôt #${newId}`,
    oldVal: '',
    newVal: `${amount.toLocaleString()} XOF vers Caisse Principale (Statut: EN ATTENTE)`,
    schoolId: schoolId
  });

  return formatCashDeposit(db.prepare('SELECT * FROM cash_deposits WHERE id = ?').get(newId));
}

/**
 * Validation atomique d'un versement inter-caisse :
 * - Débit de la caisse source
 * - Crédit de la caisse principale
 * - Marque le bordereau comme VALIDATED
 */
function validateCashDeposit(user, depositId) {
  const dep = db.prepare('SELECT * FROM cash_deposits WHERE id = ?').get(depositId);
  if (!dep) throw new Error("Bordereau de versement introuvable");
  if (dep.status !== 'PENDING') throw new Error(`Le versement a déjà été traité (${dep.status})`);

  // Cloisonnement strict école (Niveau 3)
  if (user.role !== 'concepteur' && user.schoolId && dep.school_id !== user.schoolId) {
    throw new Error("Accès refusé : vous ne pouvez pas valider de versements d'un autre établissement");
  }

  const amount = dep.amount;
  const validator = `${user.prenom} ${user.nom}`;
  const validatedAt = new Date().toLocaleTimeString('fr-FR');

  // Transaction SQLite
  db.exec('BEGIN TRANSACTION');
  try {
    // 1. Mettre à jour le statut du versement
    db.prepare(`
      UPDATE cash_deposits
      SET status = 'VALIDATED', validated_by = ?, validated_at = ?
      WHERE id = ?
    `).run(validator, validatedAt, depositId);

    // 2. Créditer la Caisse Principale
    db.prepare(`
      UPDATE cash_desks
      SET balance = balance + ?
      WHERE id = 'PRINCIPALE' AND school_id = ?
    `).run(amount, dep.school_id);

    // 3. Débiter la Caisse Secondaire source
    db.prepare(`
      UPDATE cash_desks
      SET balance = balance - ?
      WHERE id = ? AND school_id = ?
    `).run(amount, dep.source_id, dep.school_id);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  addAuditLog(user, {
    action: 'CASH_DEPOSIT_VALIDATE',
    module: 'Caisse',
    target: `Dépôt #${dep.id}`,
    oldVal: 'PENDING',
    newVal: `VALIDÉ : ${amount.toLocaleString()} XOF crédités à la Caisse Principale`,
    schoolId: dep.school_id
  });

  return {
    deposit: formatCashDeposit(db.prepare('SELECT * FROM cash_deposits WHERE id = ?').get(depositId)),
    cashDesks: getCashDesks(user)
  };
}

function rejectCashDeposit(user, depositId, reason) {
  const dep = db.prepare('SELECT * FROM cash_deposits WHERE id = ?').get(depositId);
  if (!dep) throw new Error("Bordereau de versement introuvable");
  if (dep.status !== 'PENDING') throw new Error(`Le versement a déjà été traité (${dep.status})`);

  // Cloisonnement strict école (Niveau 3)
  if (user.role !== 'concepteur' && user.schoolId && dep.school_id !== user.schoolId) {
    throw new Error("Accès refusé : vous ne pouvez pas rejeter de versements d'un autre établissement");
  }

  const validator = `${user.prenom} ${user.nom}`;
  db.prepare(`
    UPDATE cash_deposits
    SET status = 'REJECTED', rejection_reason = ?, validated_by = ?
    WHERE id = ?
  `).run(reason || 'Rejeté par la Caisse Principale', validator, depositId);

  addAuditLog(user, {
    action: 'CASH_DEPOSIT_REJECT',
    module: 'Caisse',
    target: `Dépôt #${dep.id}`,
    oldVal: 'PENDING',
    newVal: `REFUSÉ : ${reason || 'Non spécifié'}`,
    schoolId: dep.school_id
  });

  return formatCashDeposit(db.prepare('SELECT * FROM cash_deposits WHERE id = ?').get(depositId));
}

// ---------------------------------------------------------------------
// GESTION DES PAIEMENTS ÉCOLAGES
// ---------------------------------------------------------------------

function formatPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    schoolId: row.school_id,
    studentId: row.student_id,
    studentName: row.student_name || 'Élève inconnu',
    studentMatricule: row.student_matricule || '',
    studentClasse: row.student_classe || '',
    amount: row.amount,
    paymentMethod: row.payment_method,
    ref: row.ref,
    cashierId: row.cashier_id,
    cashierName: row.cashier_name,
    cashDesk: row.cash_desk,
    createdAt: row.created_at
  };
}

function getPayments(user, schoolId = null) {
  let query = `
    SELECT p.*, s.nom_prenom as student_name, s.matricule as student_matricule, s.classe as student_classe 
    FROM payments p 
    LEFT JOIN students s ON s.id = p.student_id
  `;
  const params = [];

  if (user.role === 'concepteur') {
    if (schoolId) {
      query += ' WHERE p.school_id = ?';
      params.push(schoolId);
    }
  } else if (user.role === 'fondateur') {
    const schools = db.prepare('SELECT id FROM schools WHERE foundation_id = ?').all(user.foundationId);
    const sIds = schools.map(s => s.id);
    if (sIds.length === 0) return [];
    if (schoolId && sIds.includes(schoolId)) {
      query += ' WHERE p.school_id = ?';
      params.push(schoolId);
    } else {
      query += ` WHERE p.school_id IN (${sIds.map(() => '?').join(',')})`;
      params.push(...sIds);
    }
  } else {
    query += ' WHERE p.school_id = ?';
    params.push(user.schoolId || 1);
  }

  query += ' ORDER BY p.id DESC';
  return db.prepare(query).all(...params).map(formatPayment);
}

function recordPayment(user, data) {
  const studentId = parseInt(data.studentId, 10);
  const amount = parseInt(data.amount, 10);
  if (!studentId || isNaN(amount) || amount <= 0) throw new Error("Données de paiement invalides");

  const st = getStudentById(studentId);
  if (!st) throw new Error("Élève introuvable");

  // Cloisonnement strict école (Niveau 3)
  if (user.role !== 'concepteur' && user.schoolId && st.schoolId !== user.schoolId) {
    throw new Error("Accès refusé : vous ne pouvez enregistrer de paiements que pour les élèves de votre établissement");
  }

  const method = data.paymentMethod || 'ESPECES';
  const ref = data.ref || `RC-${Date.now().toString().slice(-6)}`;
  const deskId = data.cashDesk || (user.scopeLabel && user.scopeLabel.includes('Caisse 2') ? 'CAISSE_2' : 'PRINCIPALE');

  db.exec('BEGIN TRANSACTION');
  try {
    // 1. Incrémenter le montant payé de l'élève
    db.prepare(`
      UPDATE students
      SET fee_paid = fee_paid + ?
      WHERE id = ?
    `).run(amount, studentId);

    // 2. Créditer la caisse correspondante
    db.prepare(`
      UPDATE cash_desks
      SET balance = balance + ?
      WHERE id = ?
    `).run(amount, deskId);

    // 3. Insérer la quittance / paiement
    db.prepare(`
      INSERT INTO payments (school_id, student_id, amount, payment_method, ref, cashier_id, cashier_name, cash_desk)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      st.schoolId,
      studentId,
      amount,
      method,
      ref,
      user.id,
      `${user.prenom} ${user.nom}`,
      deskId
    );

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  addAuditLog(user, {
    action: 'PAYMENT_CONFIRM',
    module: 'Comptabilité',
    target: `Élève #${st.id}`,
    oldVal: `${st.feePaid}`,
    newVal: `${st.feePaid + amount} XOF via ${method} (Ref: ${ref})`,
    schoolId: st.schoolId
  });

  return {
    student: getStudentById(studentId),
    cashDesks: getCashDesks(user)
  };
}

// ---------------------------------------------------------------------
// CLASSES, ÉCOLES & FONDATIONS
// ---------------------------------------------------------------------

function formatClass(c) {
  if (!c) return null;
  return {
    id: c.id,
    schoolId: c.school_id,
    name: c.name,
    level: c.level,
    cycle: c.cycle,
    capacity: c.capacity,
    titulaire: c.titulaire,
    educateur: c.educateur,
    room: c.room,
    status: c.status
  };
}

function getClasses(user) {
  if (user.role === 'concepteur') {
    return db.prepare('SELECT * FROM classes ORDER BY id ASC').all().map(formatClass);
  }
  if (user.role === 'fondateur') {
    const fId = user.foundationId || 1;
    return db.prepare(`
      SELECT * FROM classes 
      WHERE school_id IN (SELECT id FROM schools WHERE foundation_id = ?)
      ORDER BY id ASC
    `).all(fId).map(formatClass);
  }
  const sId = user.schoolId || 1;
  return db.prepare('SELECT * FROM classes WHERE school_id = ? ORDER BY id ASC').all(sId).map(formatClass);
}

function createClass(user, data) {
  const schoolId = (user.role === 'concepteur' && data.schoolId) ? data.schoolId : (user.schoolId || 1);
  const stmt = db.prepare(`
    INSERT INTO classes (school_id, name, level, cycle, capacity, titulaire, educateur, room, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const res = stmt.run(
    schoolId,
    data.name,
    data.level,
    data.cycle || 'Premier Cycle',
    data.capacity || 45,
    data.titulaire || 'En cours d\'affectation',
    data.educateur || 'En cours d\'affectation',
    data.room || 'Salle Principale',
    data.status || 'ACTIF'
  );

  const newId = Number(res.lastInsertRowid);
  addAuditLog(user, {
    action: 'CLASS_CREATE',
    module: 'Pédagogie',
    target: `Classe ${data.name}`,
    oldVal: '',
    newVal: `${data.name} [${data.level}]`,
    schoolId: schoolId
  });

  return formatClass(db.prepare('SELECT * FROM classes WHERE id = ?').get(newId));
}

function updateClass(user, id, data) {
  const current = db.prepare('SELECT * FROM classes WHERE id = ?').get(id);
  if (!current) throw new Error("Classe introuvable");
  if (user.role !== 'concepteur' && current.school_id !== (user.schoolId || 1)) {
    throw new Error("Accès refusé");
  }

  const name = data.name !== undefined ? data.name : current.name;
  const level = data.level !== undefined ? data.level : current.level;
  const cycle = data.cycle !== undefined ? data.cycle : current.cycle;
  const capacity = data.capacity !== undefined ? data.capacity : current.capacity;
  const titulaire = data.titulaire !== undefined ? data.titulaire : current.titulaire;
  const educateur = data.educateur !== undefined ? data.educateur : current.educateur;
  const room = data.room !== undefined ? data.room : current.room;
  const status = data.status !== undefined ? data.status : current.status;

  db.prepare(`
    UPDATE classes
    SET name = ?, level = ?, cycle = ?, capacity = ?, titulaire = ?, educateur = ?, room = ?, status = ?
    WHERE id = ?
  `).run(name, level, cycle, capacity, titulaire, educateur, room, status, id);

  addAuditLog(user, {
    action: 'CLASS_UPDATE',
    module: 'Pédagogie',
    target: `Classe #${id}`,
    oldVal: `${current.name} [${current.level}]`,
    newVal: `${name} [${level}]`,
    schoolId: current.school_id
  });

  return formatClass(db.prepare('SELECT * FROM classes WHERE id = ?').get(id));
}

function deleteClass(user, id) {
  const current = db.prepare('SELECT * FROM classes WHERE id = ?').get(id);
  if (!current) throw new Error("Classe introuvable");
  if (user.role !== 'concepteur' && current.school_id !== (user.schoolId || 1)) {
    throw new Error("Accès refusé");
  }

  db.prepare('DELETE FROM classes WHERE id = ?').run(id);

  addAuditLog(user, {
    action: 'CLASS_DELETE',
    module: 'Pédagogie',
    target: `Classe #${id} (${current.name})`,
    oldVal: current.name,
    newVal: 'SUPPRIMÉ',
    schoolId: current.school_id
  });

  return { success: true, deletedId: id };
}

// ---------------------------------------------------------------------
// GESTION DES UTILISATEURS RBAC PERSISTANTS
// ---------------------------------------------------------------------

function formatUser(u) {
  if (!u) return null;
  let perms = ['students.view'];
  if (u.role === 'concepteur') perms = ['*', 'system.superadmin'];
  else if (u.role === 'fondateur') perms = ['foundation.view', 'foundation.schools.view', 'foundation.manage', 'foundation.reports', 'foundation.switch_school'];
  else if (u.role === 'admin') perms = ['admin.access', 'settings.manage', 'students.*', 'classes.*', 'cash.*', 'grades.*', 'reports.*', 'audit.view', 'ecolage.*', 'attendance.*', 'accounting.*', 'consultation.*'];
  else if (u.role === 'de') perms = ['students.*', 'classes.*', 'grades.*', 'attendance.*', 'reports.pedagogie'];
  else if (u.role === 'cf') perms = ['students.*', 'ecolage.*', 'reports.fichier'];
  else if (u.role === 'educateur') perms = ['students.view', 'attendance.*', 'grades.view'];
  else if (u.role === 'caisse_principale' || u.role === 'caisse_secondaire') perms = ['cash.*', 'ecolage.view', 'payments.create'];
  else if (u.role === 'consultation') perms = ['consultation.view', 'reports.view'];

  const schoolId = (u.school_id !== null && u.school_id !== undefined) ? u.school_id : null;
  const foundationId = (u.foundation_id !== null && u.foundation_id !== undefined) ? u.foundation_id : null;

  return {
    id: u.id,
    nom: u.nom,
    prenom: u.prenom,
    email: u.email || '',
    phone: u.phone || '',
    role: u.role,
    roleLabel: u.role_label,
    school: u.school_name || (schoolId ? `École #${schoolId}` : (foundationId ? 'Fondation FEA' : 'INNOVA GROUP — Siège Éditeur')),
    schoolId: schoolId,
    foundationId: foundationId,
    scopeType: u.scope_type,
    scopeLabel: u.scope_label,
    scopeValue: u.scope_type === 'CASH_DESK' ? ['CAISSE_2'] : (u.scope_type === 'CLASSES' ? ['4EME 5', '6EME 1'] : (schoolId || 1)),
    level: u.level || (u.role === 'concepteur' ? 'PLATFORM' : (u.role === 'fondateur' ? 'FOUNDATION' : 'SCHOOL')),
    status: u.is_active ? 'ACTIF' : 'INACTIF',
    lastLogin: 'Récemment',
    createdAt: u.created_at || '01/09/2026',
    permissions: perms
  };
}

function getUserById(id) {
  const row = db.prepare(`
    SELECT u.*, s.name as school_name 
    FROM users u 
    LEFT JOIN schools s ON u.school_id = s.id 
    WHERE u.id = ?
  `).get(id);
  return formatUser(row);
}

function getUsers(user) {
  if (user.role === 'concepteur') {
    return db.prepare(`
      SELECT u.*, s.name as school_name 
      FROM users u 
      LEFT JOIN schools s ON u.school_id = s.id 
      ORDER BY u.id ASC
    `).all().map(formatUser);
  }
  if (user.role === 'fondateur') {
    const fId = user.foundationId || 1;
    return db.prepare(`
      SELECT u.*, s.name as school_name 
      FROM users u 
      LEFT JOIN schools s ON u.school_id = s.id 
      WHERE u.foundation_id = ? OR u.school_id IN (SELECT id FROM schools WHERE foundation_id = ?)
      ORDER BY u.id ASC
    `).all(fId, fId).map(formatUser);
  }
  const sId = user.schoolId || 1;
  return db.prepare(`
    SELECT u.*, s.name as school_name 
    FROM users u 
    LEFT JOIN schools s ON u.school_id = s.id 
    WHERE u.school_id = ?
    ORDER BY u.id ASC
  `).all(sId).map(formatUser);
}

function createUser(user, data) {
  if (user.role !== 'concepteur' && user.role !== 'fondateur' && user.role !== 'admin') {
    throw new Error("Permissions insuffisantes pour créer un utilisateur");
  }

  let schoolId = (user.role === 'concepteur' && data.schoolId !== undefined) ? data.schoolId : (user.schoolId || 1);
  let foundationId = (user.role === 'concepteur' && data.foundationId !== undefined) ? data.foundationId : (user.foundationId || null);

  // Niveau 3 École : strictement confiné à sa propre école
  if (user.role === 'admin') {
    schoolId = user.schoolId || 1;
    foundationId = null;
  } else if (user.role === 'fondateur') {
    foundationId = user.foundationId;
    if (data.schoolId) {
      const sch = db.prepare('SELECT foundation_id FROM schools WHERE id = ?').get(data.schoolId);
      if (!sch || sch.foundation_id !== user.foundationId) {
        throw new Error("Accès refusé : vous ne pouvez pas créer d'utilisateurs pour un établissement extérieur à votre fondation");
      }
      schoolId = data.schoolId;
    }
  }

  const role = data.role || 'consultation';
  const roleLabel = data.roleLabel || role.toUpperCase();
  const scopeType = data.scopeType || (schoolId ? 'SCHOOL' : 'GLOBAL');
  const scopeLabel = data.scopeLabel || (schoolId ? `Établissement #${schoolId}` : 'SOUVERAIN (Global)');
  const level = role === 'concepteur' ? 'PLATFORM' : (role === 'fondateur' ? 'FOUNDATION' : 'SCHOOL');

  const maxIdRow = db.prepare('SELECT MAX(id) as maxId FROM users').get();
  const nextId = (maxIdRow && maxIdRow.maxId !== null ? maxIdRow.maxId : 8) + 1;

  const stmt = db.prepare(`
    INSERT INTO users (
      id, school_id, foundation_id, nom, prenom, email, phone, role, role_label, scope_type, scope_label, level, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  stmt.run(
    nextId,
    schoolId,
    foundationId,
    data.nom,
    data.prenom,
    data.email || '',
    data.phone || '',
    role,
    roleLabel,
    scopeType,
    scopeLabel,
    level
  );

  addAuditLog(user, {
    action: 'USER_CREATE',
    module: 'Administration',
    target: `Utilisateur #${nextId}`,
    oldVal: '',
    newVal: `${data.nom} ${data.prenom} (${roleLabel})`,
    schoolId: schoolId,
    foundationId: foundationId
  });

  const row = db.prepare(`
    SELECT u.*, s.name as school_name 
    FROM users u 
    LEFT JOIN schools s ON u.school_id = s.id 
    WHERE u.id = ?
  `).get(nextId);

  return formatUser(row);
}

function deleteUser(user, id) {
  if (user.role !== 'concepteur' && user.role !== 'admin' && user.role !== 'fondateur') {
    throw new Error("Permissions insuffisantes pour supprimer un utilisateur");
  }
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw new Error("Utilisateur introuvable");
  if (u.id === 0) throw new Error("Impossible de supprimer le Super Admin souverain");

  // Contrôle strict de tenant
  if (user.role === 'admin' && u.school_id !== (user.schoolId || 1)) {
    throw new Error("Accès refusé : vous ne pouvez pas supprimer d'utilisateurs d'un autre établissement");
  }
  if (user.role === 'fondateur') {
    const sch = u.school_id ? db.prepare('SELECT foundation_id FROM schools WHERE id = ?').get(u.school_id) : null;
    if (u.foundation_id !== user.foundationId && (!sch || sch.foundation_id !== user.foundationId)) {
      throw new Error("Accès refusé : vous ne pouvez pas supprimer d'utilisateurs extérieurs à votre fondation");
    }
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);

  addAuditLog(user, {
    action: 'USER_DELETE',
    module: 'Administration',
    target: `Utilisateur #${id}`,
    oldVal: `${u.nom} ${u.prenom}`,
    newVal: 'SUPPRIMÉ',
    schoolId: u.school_id,
    foundationId: u.foundation_id
  });

  return { success: true, deletedId: id };
}

function createSchool(user, data) {
  if (user.role !== 'concepteur' && user.role !== 'fondateur') {
    throw new Error("Permissions insuffisantes pour créer un établissement");
  }

  const foundationId = (user.role === 'fondateur') ? user.foundationId : (data.foundationId || null);
  const code = data.code || `sch-${Date.now().toString().slice(-4)}`;

  const stmt = db.prepare(`
    INSERT INTO schools (
      code, name, short_name, foundation_id, school_type, city, address, phone, email, logo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const res = stmt.run(
    code,
    data.name,
    data.shortName || data.name,
    foundationId,
    data.schoolType || 'COLLÈGE & LYCÉE',
    data.city || 'Abidjan',
    data.address || '',
    data.phone || '',
    data.email || '',
    data.logo || '🏛️'
  );

  const newId = Number(res.lastInsertRowid);
  addAuditLog(user, {
    action: 'SCHOOL_CREATE',
    module: 'Administration',
    target: `École #${newId}`,
    oldVal: '',
    newVal: `${data.name} (${code})`,
    schoolId: newId,
    foundationId: foundationId
  });

  return db.prepare('SELECT * FROM schools WHERE id = ?').get(newId);
}

function createFoundation(user, data) {
  if (user.role !== 'concepteur') {
    throw new Error("Seul le Concepteur du SaaS peut créer une nouvelle Fondation Mère");
  }

  const code = data.code || `fond-${Date.now().toString().slice(-4)}`;
  const stmt = db.prepare(`
    INSERT INTO foundations (
      code, name, sigle, hq, president, phone, email, logo, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const res = stmt.run(
    code,
    data.name,
    data.sigle || '',
    data.hq || '',
    data.president || '',
    data.phone || '',
    data.email || '',
    data.logo || '🏛️',
    data.description || ''
  );

  const newId = Number(res.lastInsertRowid);
  addAuditLog(user, {
    action: 'FOUNDATION_CREATE',
    module: 'Souverain',
    target: `Fondation #${newId}`,
    oldVal: '',
    newVal: `${data.name} (${code})`,
    foundationId: newId
  });

  return db.prepare('SELECT * FROM foundations WHERE id = ?').get(newId);
}

function deleteSchool(user, schoolId) {
  const sId = parseInt(schoolId, 10);
  if (!sId) throw new Error("ID d'établissement invalide");

  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(sId);
  if (!school) {
    const err = new Error(`Établissement #${sId} introuvable.`);
    err.status = 404;
    throw err;
  }

  // Seul le Concepteur (Rang 1) ou le Fondateur de tutelle (Rang 2) peut supprimer
  if (user.role !== 'concepteur') {
    if (user.role !== 'fondateur' || user.foundationId !== school.foundation_id) {
      const err = new Error("Accès refusé : La suppression d'un établissement est strictement réservée au Concepteur du SaaS ou à sa Fondation de tutelle.");
      err.status = 403;
      throw err;
    }
  }

  db.exec('BEGIN TRANSACTION');
  try {
    db.prepare('DELETE FROM students WHERE school_id = ?').run(sId);
    db.prepare('DELETE FROM payments WHERE school_id = ?').run(sId);
    db.prepare('DELETE FROM cash_deposits WHERE school_id = ?').run(sId);
    db.prepare('DELETE FROM classes WHERE school_id = ?').run(sId);
    db.prepare('DELETE FROM cash_desks WHERE school_id = ?').run(sId);
    db.prepare('DELETE FROM school_settings WHERE school_id = ?').run(sId);
    db.prepare('DELETE FROM schools WHERE id = ?').run(sId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  addAuditLog(user, {
    action: 'SCHOOL_DELETE',
    module: 'Administration Souveraine',
    target: `École #${sId} (${school.name})`,
    oldVal: `${school.name} (${school.code})`,
    newVal: 'SUPPRIMÉ',
    schoolId: sId,
    foundationId: school.foundation_id
  });

  return { success: true, message: `Établissement #${sId} (${school.name}) supprimé avec succès.`, deletedId: sId };
}

function deleteFoundation(user, foundationId) {
  const fId = parseInt(foundationId, 10);
  if (!fId) throw new Error("ID de fondation invalide");

  const foundation = db.prepare('SELECT * FROM foundations WHERE id = ?').get(fId);
  if (!foundation) {
    const err = new Error(`Fondation #${fId} introuvable.`);
    err.status = 404;
    throw err;
  }

  // Strictement réservé au Concepteur du SaaS (Niveau 1)
  if (user.role !== 'concepteur') {
    const err = new Error("Accès souverain refusé : Seul le Concepteur du SaaS (Niveau 1) peut dissoudre ou supprimer une Fondation Mère.");
    err.status = 403;
    throw err;
  }

  db.exec('BEGIN TRANSACTION');
  try {
    // Détacher les écoles affiliées (les rendre autonomes)
    db.prepare('UPDATE schools SET foundation_id = NULL WHERE foundation_id = ?').run(fId);
    db.prepare('DELETE FROM foundation_settings WHERE foundation_id = ?').run(fId);
    db.prepare('DELETE FROM foundations WHERE id = ?').run(fId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  addAuditLog(user, {
    action: 'FOUNDATION_DELETE',
    module: 'Souverain',
    target: `Fondation #${fId} (${foundation.name})`,
    oldVal: `${foundation.name} (${foundation.code})`,
    newVal: 'SUPPRIMÉ',
    foundationId: fId
  });

  return { success: true, message: `Fondation #${fId} (${foundation.name}) supprimée avec succès.`, deletedId: fId };
}

// ---------------------------------------------------------------------
// JOURNAUX D'AUDIT
// ---------------------------------------------------------------------

function addAuditLog(user, { action, module, target, oldVal, newVal, status = 'SUCCÈS', schoolId, foundationId }) {
  try {
    const sId = schoolId !== undefined ? schoolId : (user.schoolId || null);
    const fId = foundationId !== undefined ? foundationId : (user.foundationId || null);
    db.prepare(`
      INSERT INTO audit_logs (school_id, foundation_id, user_id, action, module, target, old_val, new_val, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sId, fId, user.id, action, module, target, String(oldVal || ''), String(newVal || ''), status);
  } catch (e) {
    console.error('[Audit Error]', e.message);
  }
}

function getAuditLogs(user) {
  if (user.role === 'concepteur') {
    return db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 150').all();
  }
  if (user.role === 'fondateur') {
    return db.prepare('SELECT * FROM audit_logs WHERE foundation_id = ? ORDER BY id DESC LIMIT 150').all(user.foundationId);
  }
  const sId = user.schoolId || 1;
  return db.prepare('SELECT * FROM audit_logs WHERE school_id = ? ORDER BY id DESC LIMIT 150').all(sId);
}

// ---------------------------------------------------------------------
// CONFIGURATIONS SYSTÈME & PARAMÈTRES GLOBAUX (NIVEAU 1 SOUVERAIN)
// ---------------------------------------------------------------------

function getSystemSettings(user) {
  if (user.role !== 'concepteur') {
    throw new Error("Accès refusé : La consultation des configurations système globales est réservée au Concepteur du SaaS.");
  }
  const rows = db.prepare('SELECT * FROM system_settings ORDER BY key ASC').all();
  const settingsObj = {};
  rows.forEach(r => { settingsObj[r.key] = r.value; });
  return { list: rows, settings: settingsObj };
}

function updateSystemSettings(user, settings) {
  if (user.role !== 'concepteur') {
    throw new Error("Accès refusé : Seul le Concepteur du SaaS (Niveau 1 Souverain) peut modifier les configurations globales de la plateforme.");
  }

  const stmt = db.prepare(`
    INSERT INTO system_settings (key, value, updated_by, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `);

  db.exec('BEGIN TRANSACTION');
  try {
    for (const [k, v] of Object.entries(settings)) {
      stmt.run(k, String(v), `${user.prenom} ${user.nom}`);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  addAuditLog(user, {
    action: 'SYSTEM_CONFIG_UPDATE',
    module: 'Souverain',
    target: 'Configurations Globales Plateforme',
    oldVal: '',
    newVal: `Mise à jour de ${Object.keys(settings).length} paramètres système`
  });

  return getSystemSettings(user);
}

// ---------------------------------------------------------------------
// DONNÉES CONSOLIDÉES DE FONDATION (NIVEAU 2)
// ---------------------------------------------------------------------

// =====================================================================
// CONTRÔLE D'ACCÈS HIÉRARCHIQUE & PARAMÈTRES MULTI-NIVEAUX (N1, N2, N3)
// =====================================================================

function getUserHierarchyRank(user) {
  if (!user) return 3;
  if (user.role === 'concepteur') return 1;
  if (user.role === 'fondateur') return 2;
  return 3; // admin, de, caisse, etc.
}

function logSecurityViolation(user, violationType, target, details) {
  const u = user || { id: 0, nom: 'Inconnu', prenom: 'Utilisateur', role: 'anonyme' };
  const log = addAuditLog(u, {
    action: violationType || 'SECURITY_UPWARD_ESCALATION_BLOCKED',
    module: 'Sécurité Hiérarchique',
    target: target || 'Ressource Protégée',
    oldVal: details || 'Tentative d\'accès non autorisé',
    newVal: 'REFUSÉ (403)'
  });
  return log;
}

function getFoundationSettings(user, foundationId) {
  const fId = parseInt(foundationId, 10);
  const userRank = getUserHierarchyRank(user);

  // RÈGLE ANTI-ESCALADE ASCENDANTE :
  // Un utilisateur d'établissement (Rang 3) ne peut en aucun cas accéder aux paramètres d'une fondation (Rang 2)
  if (userRank > 2) {
    logSecurityViolation(user, 'SECURITY_UPWARD_ESCALATION_BLOCKED', `Paramètres Fondation #${fId}`,
      `Utilisateur Rang 3 (${user.role}) a tenté d'accéder aux paramètres de la Fondation #${fId}`);
    const err = new Error("Accès refusé [Anti-Escalade Ascendante] : Les utilisateurs de niveau Établissement (Niveau 3) ne peuvent pas accéder aux paramètres de la Fondation Mère (Niveau 2).");
    err.status = 403;
    err.code = 'UPWARD_PRIVILEGE_ESCALATION';
    throw err;
  }

  // RÈGLE DE CLOISONNEMENT HORIZONTAL :
  // Un Fondateur (Rang 2) ne peut accéder qu'à sa propre fondation
  if (userRank === 2 && user.foundationId !== fId) {
    logSecurityViolation(user, 'SECURITY_CROSS_TENANT_BLOCKED', `Paramètres Fondation #${fId}`,
      `Fondateur #${user.foundationId} a tenté d'accéder aux paramètres de la Fondation tierce #${fId}`);
    const err = new Error(`Accès refusé : Vous ne pouvez accéder qu'aux paramètres de votre propre Fondation (#${user.foundationId}).`);
    err.status = 403;
    err.code = 'CROSS_TENANT_FOUNDATION_DENIED';
    throw err;
  }

  let rows = db.prepare('SELECT * FROM foundation_settings WHERE foundation_id = ? ORDER BY key ASC').all(fId);
  if (rows.length === 0) {
    const insertFoundSetting = db.prepare(`
      INSERT OR IGNORE INTO foundation_settings (foundation_id, key, value, description, updated_by)
      VALUES (?, ?, ?, ?, 'Initialisation Système')
    `);
    insertFoundSetting.run(fId, 'consolidation_currency', 'XOF', 'Devise de consolidation comptable');
    insertFoundSetting.run(fId, 'group_fee_percent', '5.0', 'Taux de quote-part siège (%)');
    insertFoundSetting.run(fId, 'centralized_supervision', 'true', 'Supervision temps réel autorisée');
    insertFoundSetting.run(fId, 'pedagogical_harmonization', 'STRICT', 'Règle d\'harmonisation des barèmes');
    rows = db.prepare('SELECT * FROM foundation_settings WHERE foundation_id = ? ORDER BY key ASC').all(fId);
  }
  const settingsObj = {};
  rows.forEach(r => { settingsObj[r.key] = r.value; });
  return { foundationId: fId, list: rows, settings: settingsObj };
}

function updateFoundationSettings(user, foundationId, newSettings) {
  const fId = parseInt(foundationId, 10);
  const userRank = getUserHierarchyRank(user);

  if (userRank > 2) {
    logSecurityViolation(user, 'SECURITY_UPWARD_ESCALATION_BLOCKED', `Paramètres Fondation #${fId}`,
      `Utilisateur Rang 3 (${user.role}) a tenté de modifier les paramètres de la Fondation #${fId}`);
    const err = new Error("Accès refusé [Anti-Escalade Ascendante] : Les utilisateurs d'établissement ne peuvent pas modifier les paramètres d'une Fondation.");
    err.status = 403;
    err.code = 'UPWARD_PRIVILEGE_ESCALATION';
    throw err;
  }

  if (userRank === 2 && user.foundationId !== fId) {
    logSecurityViolation(user, 'SECURITY_CROSS_TENANT_BLOCKED', `Paramètres Fondation #${fId}`,
      `Fondateur #${user.foundationId} a tenté de modifier les paramètres de la Fondation tierce #${fId}`);
    const err = new Error("Accès refusé : Modification interdite sur une Fondation tierce.");
    err.status = 403;
    err.code = 'CROSS_TENANT_FOUNDATION_DENIED';
    throw err;
  }

  const stmt = db.prepare(`
    INSERT INTO foundation_settings (foundation_id, key, value, updated_by, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(foundation_id, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `);

  db.exec('BEGIN TRANSACTION');
  try {
    for (const [k, v] of Object.entries(newSettings)) {
      stmt.run(fId, k, String(v), `${user.prenom} ${user.nom}`);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  addAuditLog(user, {
    action: 'FOUNDATION_CONFIG_UPDATE',
    module: 'Fondation',
    target: `Paramètres Fondation #${fId}`,
    oldVal: '',
    newVal: `Mise à jour de ${Object.keys(newSettings).length} paramètres de fondation`
  });

  return getFoundationSettings(user, fId);
}

function getSchoolSettings(user, schoolId) {
  const sId = parseInt(schoolId, 10);
  const userRank = getUserHierarchyRank(user);

  // Vérification de rattachement de l'école
  const school = db.prepare('SELECT id, name, foundation_id FROM schools WHERE id = ?').get(sId);
  if (!school) {
    const err = new Error(`Établissement #${sId} introuvable.`);
    err.status = 404;
    throw err;
  }

  // Rang 3 : Accès UNIQUEMENT à sa propre école
  if (userRank === 3 && user.schoolId !== sId) {
    logSecurityViolation(user, 'SECURITY_CROSS_SCHOOL_BLOCKED', `Paramètres École #${sId}`,
      `Utilisateur école #${user.schoolId} a tenté d'accéder aux paramètres de l'école tierce #${sId}`);
    const err = new Error(`Accès refusé : Vous ne pouvez accéder qu'aux paramètres de votre propre établissement (#${user.schoolId}).`);
    err.status = 403;
    err.code = 'CROSS_SCHOOL_DENIED';
    throw err;
  }

  // Rang 2 : Accès UNIQUEMENT aux écoles affiliées à sa fondation
  if (userRank === 2 && school.foundation_id !== user.foundationId) {
    logSecurityViolation(user, 'SECURITY_UNATTACHED_SCHOOL_BLOCKED', `Paramètres École #${sId}`,
      `Fondateur #${user.foundationId} a tenté d'accéder aux paramètres de l'école non rattachée #${sId}`);
    const err = new Error("Accès refusé : Cet établissement n'est pas sous la tutelle de votre Fondation.");
    err.status = 403;
    err.code = 'UNATTACHED_SCHOOL_DENIED';
    throw err;
  }

  // Rang 1 (Concepteur) a accès total

  let rows = db.prepare('SELECT * FROM school_settings WHERE school_id = ? ORDER BY key ASC').all(sId);
  if (rows.length === 0) {
    const insertSchoolSetting = db.prepare(`
      INSERT OR IGNORE INTO school_settings (school_id, key, value, description, updated_by)
      VALUES (?, ?, ?, ?, 'Initialisation Système')
    `);
    insertSchoolSetting.run(sId, 'school_name', school.name, 'Dénomination officielle');
    insertSchoolSetting.run(sId, 'currency', 'XOF', 'Monnaie de caisse locale');
    insertSchoolSetting.run(sId, 'tuition_terms_count', '3', 'Nombre d\'échéances d\'écolage');
    insertSchoolSetting.run(sId, 'auto_reminders_active', 'true', 'Relances automatiques activées');
    insertSchoolSetting.run(sId, 'timetable_max_daily_hours', '8', 'Plafond horaire journalier classe');
    rows = db.prepare('SELECT * FROM school_settings WHERE school_id = ? ORDER BY key ASC').all(sId);
  }
  const settingsObj = {};
  rows.forEach(r => { settingsObj[r.key] = r.value; });
  return { schoolId: sId, schoolName: school.name, list: rows, settings: settingsObj };
}

function updateSchoolSettings(user, schoolId, newSettings) {
  const sId = parseInt(schoolId, 10);
  const userRank = getUserHierarchyRank(user);

  const school = db.prepare('SELECT id, name, foundation_id FROM schools WHERE id = ?').get(sId);
  if (!school) {
    const err = new Error(`Établissement #${sId} introuvable.`);
    err.status = 404;
    throw err;
  }

  if (userRank === 3 && user.schoolId !== sId) {
    logSecurityViolation(user, 'SECURITY_CROSS_SCHOOL_BLOCKED', `Paramètres École #${sId}`,
      `Utilisateur école #${user.schoolId} a tenté de modifier les paramètres de l'école tierce #${sId}`);
    const err = new Error("Accès refusé : Modification interdite sur un établissement tiers.");
    err.status = 403;
    err.code = 'CROSS_SCHOOL_DENIED';
    throw err;
  }

  if (userRank === 2 && school.foundation_id !== user.foundationId) {
    logSecurityViolation(user, 'SECURITY_UNATTACHED_SCHOOL_BLOCKED', `Paramètres École #${sId}`,
      `Fondateur #${user.foundationId} a tenté de modifier les paramètres de l'école non rattachée #${sId}`);
    const err = new Error("Accès refusé : Modification interdite sur un établissement non rattaché.");
    err.status = 403;
    err.code = 'UNATTACHED_SCHOOL_DENIED';
    throw err;
  }

  const stmt = db.prepare(`
    INSERT INTO school_settings (school_id, key, value, updated_by, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(school_id, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `);

  db.exec('BEGIN TRANSACTION');
  try {
    for (const [k, v] of Object.entries(newSettings)) {
      stmt.run(sId, k, String(v), `${user.prenom} ${user.nom}`);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  addAuditLog(user, {
    action: 'SCHOOL_CONFIG_UPDATE',
    module: 'Établissement',
    target: `Paramètres École #${sId} (${school.name})`,
    oldVal: '',
    newVal: `Mise à jour de ${Object.keys(newSettings).length} paramètres d'école`
  });

  return getSchoolSettings(user, sId);
}

function getFoundationConsolidatedData(user, foundationId) {
  const fId = parseInt(foundationId, 10);
  if (!fId) throw new Error("ID Fondation invalide");

  const isConcepteur = (user.role === 'concepteur');
  const isOwnerFoundation = (user.role === 'fondateur' && user.foundationId === fId);

  if (!isConcepteur && !isOwnerFoundation) {
    throw new Error(`Accès refusé : vous n'avez pas la permission de consulter les données consolidées de la Fondation #${fId}`);
  }

  const foundation = db.prepare('SELECT * FROM foundations WHERE id = ?').get(fId);
  if (!foundation) throw new Error("Fondation introuvable");

  const schools = db.prepare('SELECT * FROM schools WHERE foundation_id = ? ORDER BY id ASC').all(fId);
  const schoolIds = schools.map(s => s.id);

  let totalStudents = 0;
  let totalClasses = 0;
  let totalCash = 0;
  let totalPaid = 0;
  let totalDue = 0;
  let schoolStats = [];

  if (schoolIds.length > 0) {
    const placeholders = schoolIds.map(() => '?').join(',');

    // Statistiques élèves et recouvrement
    const stStats = db.prepare(`
      SELECT 
        school_id,
        COUNT(*) as count,
        COALESCE(SUM(fee_paid), 0) as paid,
        COALESCE(SUM(fee_due), 0) as due,
        AVG(CASE WHEN avg > 0 THEN avg ELSE NULL END) as class_avg
      FROM students 
      WHERE school_id IN (${placeholders})
      GROUP BY school_id
    `).all(...schoolIds);

    const stStatsMap = {};
    stStats.forEach(st => { stStatsMap[st.school_id] = st; });

    // Classes par établissement
    const clStats = db.prepare(`
      SELECT school_id, COUNT(*) as count 
      FROM classes 
      WHERE school_id IN (${placeholders})
      GROUP BY school_id
    `).all(...schoolIds);

    const clStatsMap = {};
    clStats.forEach(c => { clStatsMap[c.school_id] = c.count; });

    // Caisses par établissement
    const cashStats = db.prepare(`
      SELECT school_id, COALESCE(SUM(balance), 0) as total_balance 
      FROM cash_desks 
      WHERE school_id IN (${placeholders})
      GROUP BY school_id
    `).all(...schoolIds);

    const cashStatsMap = {};
    cashStats.forEach(cs => { cashStatsMap[cs.school_id] = cs.total_balance; });

    schoolStats = schools.map(s => {
      const st = stStatsMap[s.id] || { count: s.students_count || 0, paid: 0, due: 0, class_avg: 12.5 };
      const classesCount = clStatsMap[s.id] || s.classes_count || 0;
      const cashBalance = cashStatsMap[s.id] || 0;
      const recRate = st.due > 0 ? Number(((st.paid / st.due) * 100).toFixed(1)) : (s.recovery_rate || 0);

      totalStudents += st.count;
      totalClasses += classesCount;
      totalCash += cashBalance;
      totalPaid += st.paid;
      totalDue += st.due;

      return {
        id: s.id,
        code: s.code,
        name: s.name,
        shortName: s.short_name,
        city: s.city,
        schoolType: s.school_type,
        studentsCount: st.count,
        classesCount: classesCount,
        cashBalance: cashBalance,
        recoveryRate: recRate,
        generalAverage: st.class_avg ? Number(st.class_avg.toFixed(2)) : 12.5
      };
    });
  }

  const globalRecoveryRate = totalDue > 0 ? Number(((totalPaid / totalDue) * 100).toFixed(1)) : 82.3;

  return {
    foundation: {
      id: foundation.id,
      code: foundation.code,
      name: foundation.name,
      sigle: foundation.sigle,
      hq: foundation.hq,
      president: foundation.president
    },
    consolidated: {
      totalSchools: schools.length,
      totalStudents: totalStudents,
      totalClasses: totalClasses,
      totalCashConsolidated: totalCash,
      totalPaid: totalPaid,
      totalDue: totalDue,
      averageRecoveryRate: globalRecoveryRate
    },
    schools: schoolStats
  };
}

// ---------------------------------------------------------------------
// ASSAINISSEMENT COMPLET POUR LA PRODUCTION (PURGE DES RÉSIDUS DE DEV)
// ---------------------------------------------------------------------

function sanitizeProductionDatabase() {
  db.exec('BEGIN TRANSACTION');
  try {
    // 1. Purge intégrale de tous les élèves factices (Zero fake students)
    db.prepare(`DELETE FROM students`).run();
    try { db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'students'`).run(); } catch (_) {}

    // 2. Purge intégrale de toutes les quittances de paiements de test (Zero fake payments)
    db.prepare(`DELETE FROM payments`).run();
    try { db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'payments'`).run(); } catch (_) {}

    // 3. Purge intégrale de tous les versements de caisse factices (Zero fake deposits)
    db.prepare(`DELETE FROM cash_deposits`).run();
    try { db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'cash_deposits'`).run(); } catch (_) {}

    // 4. Remise à zéro intégrale des soldes de caisse (0 XOF)
    db.prepare(`UPDATE cash_desks SET balance = 0, physical = 0`).run();

    // 5. Purge complète des fausses fondations et écoles de démonstration (Zéro fausse entité)
    db.prepare(`DELETE FROM classes WHERE school_id IN (4, 5) OR name LIKE '%HIRONDELLE%' OR school_id > 3`).run();
    db.prepare(`DELETE FROM cash_desks WHERE school_id IN (4, 5) OR id = 'CAISSE_HIRONDELLES' OR school_id > 3`).run();
    db.prepare(`DELETE FROM school_settings WHERE school_id IN (4, 5) OR school_id > 3`).run();
    db.prepare(`DELETE FROM foundation_settings WHERE foundation_id = 2 OR foundation_id > 1`).run();
    db.prepare(`DELETE FROM schools WHERE id IN (4, 5) OR code IN ('lyc-einstein', 'inst-hirondelles', 'lyc-sci-yamoussoukro', 'inst-les-hirondelles') OR name LIKE '%Einstein%' OR name LIKE '%Hirondelle%' OR code LIKE 'col-alpha-%' OR name LIKE '%Test%' OR id > 3`).run();
    db.prepare(`DELETE FROM foundations WHERE id = 2 OR code = 'reseau-rse' OR sigle = 'RSE-CI' OR code LIKE 'fond-%' OR name LIKE '%Test%' OR id > 1`).run();

    // Réinitialisation des indicateurs des 3 écoles officielles (0 élève factice, 0.0% recouvrement)
    db.prepare(`UPDATE schools SET students_count = 0, recovery_rate = 0.0 WHERE id <= 3`).run();

    // 6. Purge des utilisateurs créés lors de tests temporaires
    db.prepare(`DELETE FROM users WHERE id > 8 OR nom LIKE '%TEST%'`).run();

    // 7. Purge des classes temporaires de test
    db.prepare(`DELETE FROM classes WHERE id > 12 OR name LIKE '%TEST%'`).run();

    // 8. Purge des clés de configuration de test et injection des clés de production
    db.prepare(`
      DELETE FROM system_settings 
      WHERE key = 'AUDIT_CUSTOM_FLAG' 
         OR key LIKE '%TEST%' 
         OR key LIKE '%HACKED%' 
         OR value LIKE '%TEST%'
         OR value LIKE '%HACKED%'
    `).run();

    const insertSetting = db.prepare(`
      INSERT INTO system_settings (key, value, description, updated_by, updated_at)
      VALUES (?, ?, ?, 'Concepteur Système', datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `);
    insertSetting.run('platform_name', 'ScolaPro', 'Nom officiel de la plateforme SaaS');
    insertSetting.run('platform_version', '2.5.0', 'Version du noyau applicatif');
    insertSetting.run('maintenance_mode', 'false', 'Verrouillage de maintenance globale');
    insertSetting.run('allow_tenant_registration', 'true', 'Autorisation de provisionnement de nouveaux établissements');
    insertSetting.run('sms_gateway_provider', 'orange_ci', 'Passerelle SMS transactionnelle');
    insertSetting.run('currency_default', 'XOF', 'Devise financière de référence');
    insertSetting.run('academic_year_active', '2026-2027', 'Année académique courante');
    insertSetting.run('security_session_timeout_minutes', '120', 'Durée de validité des sessions utilisateur');
    insertSetting.run('max_login_attempts', '5', 'Seuil de verrouillage anti-bruteforce');
    insertSetting.run('payment_reminder_threshold_days', '15', 'Seuil d\'alerte des impayés d\'écolage');
    insertSetting.run('enforce_strict_isolation', 'true', 'Cloisonnement multi-tenant hermétique');

    // 9. Purge des faux journaux d'audit de démonstration
    db.prepare(`
      DELETE FROM audit_logs 
      WHERE action != 'SYSTEM_BOOT'
    `).run();

    // 10. Inscription du log souverain de purge en base
    db.prepare(`
      INSERT INTO audit_logs (school_id, foundation_id, user_id, action, module, target, old_val, new_val, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      null, null, 0,
      'PRODUCTION_PURGE_EXECUTED',
      'Administration Souveraine',
      'Base SQLite ScolaPro',
      'Mode Démonstration (Données factices)',
      'Mode Production Réel (0 élève factice, 0 quittance de test, tables assainies)',
      'SUCCÈS'
    );

    db.exec('COMMIT');
    console.log('[Database] Purge réussie : Toutes les fausses données ont été supprimées.');
    return {
      success: true,
      message: 'Base de données assainie avec succès : 0 élève factice, 0 paiement de test, soldes à zéro.',
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('[Database Error] Échec de l\'assainissement:', err);
    throw err;
  }
}

module.exports = {
  db,
  getBootstrapData,
  getStudents,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
  getCashDesks,
  createCashDesk,
  getCashDeposits,
  createCashDeposit,
  validateCashDeposit,
  rejectCashDeposit,
  recordPayment,
  getPayments,
  formatPayment,
  getClasses,
  createClass,
  updateClass,
  deleteClass,
  getUserById,
  getUsers,
  createUser,
  deleteUser,
  createSchool,
  deleteSchool,
  createFoundation,
  deleteFoundation,
  getSystemSettings,
  updateSystemSettings,
  getUserHierarchyRank,
  logSecurityViolation,
  getFoundationSettings,
  updateFoundationSettings,
  getSchoolSettings,
  updateSchoolSettings,
  getFoundationConsolidatedData,
  addAuditLog,
  getAuditLogs,
  sanitizeProductionDatabase
};
