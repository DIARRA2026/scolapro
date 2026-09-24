/**
 * ScolaPro — Utilitaires de Test Automatisé
 * Fournit un environnement éphémère et isolé pour chaque suite de tests :
 * - Base SQLite temporaire copiée depuis la référence
 * - Serveur HTTP éphémère sur port dynamique (port 0)
 * - Mots de passe de test prévisibles et sécurisés
 * - Nettoyage automatique en fin de test
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

// Définir la base de test éphémère avant de charger db.js
const testDbDir = os.tmpdir();
const testDbName = 'scolapro_test_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.db';
const testDbPath = path.join(testDbDir, testDbName);

// Copier la base de référence vers la base temporaire
const sourceDbPath = path.join(__dirname, '..', 'scolapro.db');
if (fs.existsSync(sourceDbPath)) {
  fs.copyFileSync(sourceDbPath, testDbPath);
}

process.env.SQLITE_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const db = require('../db.js');
const { server } = require('../server.js');
const auth = require('../lib/auth.js');

// Mots de passe connus pour les tests
const TEST_PASSWORD = 'TestPassword123!';

const TEST_USERS = {
  concepteur: 'diarra.dolourou@scolapro.ci',
  fondateur: 'patrice.kouame@fondation-fea.ci',
  adminSainteMarie: 'm.diarra@lyceesaintemarie.ci',
  directeurEtudes: 's.nguetta@lyceesaintemarie.ci',
  chefFinancier: 's.traore@lyceesaintemarie.ci',
  educateur: 'f.bamba@lyceesaintemarie.ci',
  caissePrincipale: 'c.ahou@lyceesaintemarie.ci',
  caisseSecondaire: 'y.koffi@lyceesaintemarie.ci',
  consultation: 'i.diallo@lyceesaintemarie.ci'
};

const FIXTURE_USERS = [
  { id: 1, school_id: null, foundation_id: 1, nom: 'KOUAMÉ', prenom: 'Dr. Patrice', email: 'patrice.kouame@fondation-fea.ci', phone: '+225 27 20 22 00', role: 'fondateur', role_label: 'Président Fondation', scope_type: 'FOUNDATION', scope_label: 'Fondation FEA', level: 'N2', scope_value: '1' },
  { id: 2, school_id: 1, foundation_id: 1, nom: 'DIARRA', prenom: 'Dolourou Mathieu', email: 'm.diarra@lyceesaintemarie.ci', phone: '+225 07 08 09 10', role: 'admin', role_label: 'Proviseur / Admin', scope_type: 'SCHOOL', scope_label: 'Lycée Sainte-Marie', level: 'N3', scope_value: '1' },
  { id: 3, school_id: 1, foundation_id: 1, nom: "N'GUETTA", prenom: 'Kouadio Simplice', email: 's.nguetta@lyceesaintemarie.ci', phone: '+225 05 11 22 33', role: 'de', role_label: 'Directeur des Études', scope_type: 'SCHOOL', scope_label: 'Lycée Sainte-Marie', level: 'N3', scope_value: '1' },
  { id: 4, school_id: 1, foundation_id: 1, nom: 'TRAORÉ', prenom: 'Souleymane', email: 's.traore@lyceesaintemarie.ci', phone: '+225 07 44 55 66', role: 'cf', role_label: 'Correspondant Fichier', scope_type: 'SCHOOL', scope_label: 'Lycée Sainte-Marie', level: 'N3', scope_value: '1' },
  { id: 5, school_id: 1, foundation_id: 1, nom: 'BAMBA', prenom: 'Fatou Alimata', email: 'f.bamba@lyceesaintemarie.ci', phone: '+225 01 02 03 04', role: 'educateur', role_label: 'Éducateur', scope_type: 'CLASSES', scope_label: 'Classes 4EME 5 & 6EME 1', level: 'N3', scope_value: JSON.stringify(['4EME 5', '6EME 1']) },
  { id: 6, school_id: 1, foundation_id: 1, nom: 'AHOU', prenom: 'Clarisse Marie', email: 'c.ahou@lyceesaintemarie.ci', phone: '+225 07 88 77 66', role: 'caisse_principale', role_label: 'Resp. Caisse Principale', scope_type: 'CASH_DESK', scope_label: 'Caisse Principale', level: 'N3', scope_value: JSON.stringify(['PRINCIPALE', 'S1_PRINCIPALE']) },
  { id: 7, school_id: 1, foundation_id: 1, nom: 'KOFFI', prenom: 'Yao Paul', email: 'y.koffi@lyceesaintemarie.ci', phone: '+225 05 99 00 11', role: 'caisse_secondaire', role_label: 'Resp. Caisse Secondaire', scope_type: 'CASH_DESK', scope_label: 'Caisse 2', level: 'N3', scope_value: JSON.stringify(['CAISSE_2']) },
  { id: 8, school_id: 1, foundation_id: 1, nom: 'DIALLO', prenom: 'Ibrahima Amadou', email: 'i.diallo@lyceesaintemarie.ci', phone: '+225 07 33 22 11', role: 'consultation', role_label: 'Utilisateur Consultation', scope_type: 'SCHOOL', scope_label: 'Lycée Sainte-Marie', level: 'N3', scope_value: '1' }
];

let passwordsInitialized = false;

async function initTestCredentials() {
  if (passwordsInitialized) return;
  const adminSystem = { id: 0, role: 'concepteur', rank: 1 };

  // S'assurer que le compte Souverain existe dans la base de test avec le nom DIARRA Dolourou
  const sov = db.db.prepare("SELECT id FROM users WHERE id = 0 OR role = 'concepteur'").get();
  if (!sov) {
    db.db.prepare(`
      INSERT OR REPLACE INTO users (id, school_id, foundation_id, nom, prenom, email, phone, role, role_label, scope_type, scope_label, level, is_active)
      VALUES (0, NULL, NULL, 'DIARRA', 'Dolourou', 'diarra.dolourou@scolapro.ci', '+225 07 00 00 01', 'concepteur', 'Concepteur Système', 'GLOBAL', 'SOUVERAIN', 'N1', 1)
    `).run();
  } else {
    db.db.prepare(`
      UPDATE users SET nom = 'DIARRA', prenom = 'Dolourou', email = 'diarra.dolourou@scolapro.ci' WHERE id = ?
    `).run(sov.id);
  }

  // Provisionner les fondations de test si absentes
  db.db.prepare(`
    INSERT OR REPLACE INTO foundations (id, code, name, sigle, hq, president, phone, email, logo, description, is_active)
    VALUES (1, 'fondation-fea', 'Fondation Éducation & Avenir', 'FEA', 'Plateau, Immeuble CCIA, Abidjan', 'Dr. Kouamé A. Patrice', '+225 27 20 22 00', 'contact@fondation-fea.ci', '🏛️', 'Réseau test', 1)
  `).run();

  // Provisionner les écoles de test si absentes
  const insertSchool = db.db.prepare(`
    INSERT OR REPLACE INTO schools (id, code, name, short_name, foundation_id, school_type, city, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  insertSchool.run(1, 'lyc-sainte-marie', "Lycée Sainte-Marie d'Abidjan", 'Lycée Sainte-Marie', 1, 'COLLÈGE & LYCÉE', 'Abidjan Cocody');
  insertSchool.run(2, 'col-sainte-anne', 'Collège Sainte-Anne de Treichville', 'Collège Sainte-Anne', 1, 'PREMIER CYCLE (COLLÈGE)', 'Abidjan Treichville');
  insertSchool.run(3, 'ep-les-lauriers', "École Primaire d'Application Les Lauriers", 'Les Lauriers', 1, 'PRIMAIRE', 'Abidjan Marcory');

  // Provisionner la caisse principale de l'école 1 si absente
  db.db.prepare(`
    INSERT OR REPLACE INTO cash_desks (id, school_id, code, name, type, balance, physical, status, cashier)
    VALUES ('PRINCIPALE', 1, 'CAISSE-01', 'Caisse Principale (Centrale)', 'PRINCIPALE', 0, 0, 'ACTIVE', 'Clarisse Marie AHOU')
  `).run();

  // Provisionner les utilisateurs de test s'ils ne sont pas déjà présents
  const insertUser = db.db.prepare(`
    INSERT OR REPLACE INTO users (id, school_id, foundation_id, nom, prenom, email, phone, role, role_label, scope_type, scope_label, level, scope_value, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const fu of FIXTURE_USERS) {
    insertUser.run(fu.id, fu.school_id, fu.foundation_id, fu.nom, fu.prenom, fu.email, fu.phone, fu.role, fu.role_label, fu.scope_type, fu.scope_label, fu.level, fu.scope_value);
  }

  // Provisionner les caisses de test nécessaires (ex: CAISSE_2 et S2_PRINCIPALE)
  db.db.prepare(`
    INSERT OR REPLACE INTO cash_desks (id, school_id, code, name, type, balance, physical, status, cashier)
    VALUES ('CAISSE_2', 1, 'CAISSE-02', 'Caisse Secondaire 2 (Guichet B)', 'SECONDAIRE', 0, 0, 'ACTIVE', 'M. Koffi Yao Paul')
  `).run();
  db.db.prepare(`
    INSERT OR REPLACE INTO cash_desks (id, school_id, code, name, type, balance, physical, status, cashier)
    VALUES ('S2_PRINCIPALE', 2, 'PRIN-2', 'Caisse Principale (Collège Sainte-Anne)', 'PRINCIPALE', 0, 0, 'ACTIVE', 'Responsable Caisse Sainte-Anne')
  `).run();

  // Provisionner la classe 6EME 1 si absente
  db.db.prepare(`
    INSERT OR REPLACE INTO classes (id, school_id, name, level, cycle, capacity, titulaire, educateur, room, status)
    VALUES (1, 1, '6EME 1', '6EME', 'Premier Cycle', 45, 'Mme Bamba Fatou', 'Mme Bamba Fatou', 'Salle 101', 'ACTIF')
  `).run();

  // Provisionner la caisse principale de l'école 3 si absente
  db.ensurePrincipalDesk(3);

  // Provisionner des élèves de test pour les tests d'isolation et financiers si absents
  db.db.prepare(`
    INSERT OR REPLACE INTO students (id, school_id, matricule, nom_prenom, sexe, niveau, classe, fee_due, fee_paid, is_absent)
    VALUES (1, 1, 'MAT-001', 'Kouamé Jean', 'M', '6EME', '6EME 1', 150000, 50000, 0)
  `).run();
  db.db.prepare(`
    INSERT OR REPLACE INTO students (id, school_id, matricule, nom_prenom, sexe, niveau, classe, fee_due, fee_paid, is_absent)
    VALUES (2, 2, 'MAT-002', 'Traoré Fatou', 'F', '5EME', '5EME 1', 120000, 30000, 0)
  `).run();

  const allUsers = db.db.prepare('SELECT id, email FROM users').all();
  for (const u of allUsers) {
    await db.setUserPassword(u.id, TEST_PASSWORD, adminSystem);
  }
  // Réinitialiser le drapeau de changement obligatoire pour les comptes de test
  db.db.prepare('UPDATE users SET must_change_password = 0').run();
  passwordsInitialized = true;
}

let activeServer = null;
let serverPort = null;

async function startTestServer() {
  await initTestCredentials();
  if (activeServer && activeServer.listening) {
    return { port: serverPort, baseUrl: 'http://127.0.0.1:' + serverPort };
  }

  return new Promise((resolve) => {
    activeServer = server.listen(0, '127.0.0.1', () => {
      serverPort = activeServer.address().port;
      resolve({ port: serverPort, baseUrl: 'http://127.0.0.1:' + serverPort });
    });
  });
}

async function stopTestServer() {
  if (activeServer && activeServer.listening) {
    await new Promise(resolve => activeServer.close(resolve));
  }
  try {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
  } catch {}
}

function makeRequest(baseUrl, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(options.path || '/', baseUrl);
    const headers = { ...(options.headers || {}) };
    const hasOrigin = Object.keys(headers).some(k => k.toLowerCase() === 'origin');
    if (!hasOrigin) {
      headers['origin'] = baseUrl;
    }

    let payload = null;
    if (postData !== null && postData !== undefined) {
      if (typeof postData === 'object' && !(postData instanceof Buffer)) {
        payload = JSON.stringify(postData);
        if (!headers['content-type']) {
          headers['content-type'] = 'application/json';
        }
      } else {
        payload = postData;
      }
      headers['content-length'] = Buffer.byteLength(payload);
    }

    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || (postData !== null ? 'POST' : 'GET'),
      headers: headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          json
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function loginUser(baseUrl, email, password = TEST_PASSWORD) {
  const res = await makeRequest(baseUrl, {
    path: '/api/auth/login',
    method: 'POST'
  }, { email, password });

  let cookie = null;
  const setCookie = res.headers['set-cookie'];
  if (setCookie) {
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    cookie = first.split(';')[0];
  }

  return {
    statusCode: res.statusCode,
    cookie,
    user: res.json ? res.json.user : null,
    json: res.json,
    rawSetCookie: setCookie
  };
}

module.exports = {
  db,
  server,
  testDbPath,
  TEST_PASSWORD,
  TEST_USERS,
  startTestServer,
  stopTestServer,
  makeRequest,
  loginUser
};
