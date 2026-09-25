/**
 * ScolaPro — Suite de Tests d'Authentification par Code Établissement (AUTH-CODE)
 * Valide les exigences :
 * - Création d'un établissement avec mot de passe administrateur
 * - Connexion universelle par Code Établissement (insensible à la casse) + mot de passe
 * - Connexion alternative par E-mail + mot de passe
 * - Provisionnement automatique du compte Administrateur (rôle 'admin', périmètre école)
 * - Mise à jour du mot de passe de l'établissement via PUT /api/schools/:id
 * - Rejet des mots de passe erronés ou politiques non conformes
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

let baseUrl;

test.before(async () => {
  const srv = await startTestServer();
  baseUrl = srv.baseUrl;
});

test.after(async () => {
  await stopTestServer();
});

test('AUTH-CODE-01 : Création d\'une école avec mot de passe administrateur dédié', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  assert.strictEqual(adminLogin.statusCode, 200);

  const schoolCode = 'GSH-AUTH-' + Math.floor(Math.random() * 9000 + 1000);
  const schoolPassword = 'SecureSchoolPwd2026!';

  const createRes = await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: {
      cookie: adminLogin.cookie
    }
  }, {
    name: 'Groupe Scolaire Horizon Test',
    code: schoolCode,
    shortName: 'GS Horizon',
    schoolType: 'COLLÈGE & LYCÉE',
    city: 'Abidjan',
    email: schoolCode.toLowerCase() + '@scolapro.ci',
    password: schoolPassword
  });

  assert.strictEqual(createRes.statusCode, 201);
  assert.ok(createRes.json.school);
  assert.strictEqual(createRes.json.school.code.toLowerCase(), schoolCode.toLowerCase());

  const schoolRow = db.db.prepare('SELECT id, code, password_hash FROM schools WHERE lower(code) = ?').get(schoolCode.toLowerCase());
  assert.ok(schoolRow);
  assert.ok(schoolRow.password_hash);
  assert.ok(schoolRow.password_hash.startsWith('scrypt$'));

  const userRow = db.db.prepare('SELECT id, email, role, school_id, password_hash FROM users WHERE school_id = ? AND role = ?').get(schoolRow.id, 'admin');
  assert.ok(userRow, 'Un compte administrateur doit être rattaché à l\'école créée');
  assert.strictEqual(userRow.role, 'admin');
  assert.strictEqual(userRow.school_id, schoolRow.id);
  assert.strictEqual(userRow.password_hash, schoolRow.password_hash);
});

test('AUTH-CODE-02 : Connexion réussie avec le Code Établissement en MAJUSCULE et mot de passe', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  const schoolCode = 'TEST-MAJ-' + Math.floor(Math.random() * 9000 + 1000);
  const schoolPassword = 'SchoolPassword2026!';

  await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    name: 'École Majuscule Test',
    code: schoolCode,
    password: schoolPassword
  });

  const loginRes = await makeRequest(baseUrl, {
    path: '/api/auth/login',
    method: 'POST'
  }, {
    identifier: schoolCode,
    password: schoolPassword
  });

  assert.strictEqual(loginRes.statusCode, 200);
  assert.ok(loginRes.json.success);
  assert.ok(loginRes.json.user);
  assert.strictEqual(loginRes.json.user.role, 'admin');

  const setCookie = loginRes.headers['set-cookie'];
  assert.ok(setCookie, 'Un cookie de session doit être retourné');
});

test('AUTH-CODE-03 : Connexion réussie avec le Code Établissement en minuscule (insensibilité à la casse)', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  const schoolCode = 'CS-CASE-' + Math.floor(Math.random() * 9000 + 1000);
  const schoolPassword = 'CasePassword2026!';

  await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    name: 'Collège Case Test',
    code: schoolCode,
    password: schoolPassword
  });

  const loginRes = await makeRequest(baseUrl, {
    path: '/api/auth/login',
    method: 'POST'
  }, {
    identifier: schoolCode.toLowerCase(),
    password: schoolPassword
  });

  assert.strictEqual(loginRes.statusCode, 200);
  assert.ok(loginRes.json.success);
  assert.strictEqual(loginRes.json.user.role, 'admin');
});

test('AUTH-CODE-04 : Échec de connexion avec mot de passe erroné pour le Code Établissement', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  const schoolCode = 'ERR-PWD-' + Math.floor(Math.random() * 9000 + 1000);
  const schoolPassword = 'CorrectPassword2026!';

  await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    name: 'École Mauvais Mot de Passe',
    code: schoolCode,
    password: schoolPassword
  });

  const loginRes = await makeRequest(baseUrl, {
    path: '/api/auth/login',
    method: 'POST'
  }, {
    identifier: schoolCode,
    password: 'FauxMotDePasse999!'
  });

  assert.strictEqual(loginRes.statusCode, 401);
  assert.ok(loginRes.json.error.includes('Identifiants invalides') || loginRes.json.error.includes('incorrect'));
});

test('AUTH-CODE-05 : Mise à jour du mot de passe école via PUT /api/schools/:id et reconnexion immédiate', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  const schoolCode = 'UPD-PWD-' + Math.floor(Math.random() * 9000 + 1000);
  const initialPassword = 'InitialPassword2026!';
  const updatedPassword = 'NewUpdatedPassword2026!';

  const createRes = await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    name: 'École Update Password Test',
    code: schoolCode,
    password: initialPassword
  });

  const schoolId = createRes.json.school.id;

  const updateRes = await makeRequest(baseUrl, {
    path: '/api/schools/' + schoolId,
    method: 'PUT',
    headers: { cookie: adminLogin.cookie }
  }, {
    name: 'École Update Password Test (Modifié)',
    password: updatedPassword
  });

  assert.strictEqual(updateRes.statusCode, 200);

  const oldLogin = await makeRequest(baseUrl, {
    path: '/api/auth/login',
    method: 'POST'
  }, {
    identifier: schoolCode,
    password: initialPassword
  });
  assert.strictEqual(oldLogin.statusCode, 401);

  const newLogin = await makeRequest(baseUrl, {
    path: '/api/auth/login',
    method: 'POST'
  }, {
    identifier: schoolCode,
    password: updatedPassword
  });
  assert.strictEqual(newLogin.statusCode, 200);
  assert.ok(newLogin.json.success);
});

test('AUTH-CODE-06 : Connexion réussie avec un Code Fondation (insensible à la casse) et mot de passe dédié', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  const foundCode = 'FND-TEST-' + Math.floor(Math.random() * 9000 + 1000);
  const foundPassword = 'FoundationPwd2026!';

  const createRes = await makeRequest(baseUrl, {
    path: '/api/foundations',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    name: 'Fondation Éducation Test',
    code: foundCode,
    sigle: 'FET',
    password: foundPassword
  });

  assert.strictEqual(createRes.statusCode, 201);
  assert.ok(createRes.json.foundation);

  // Connexion en minuscules
  const loginRes = await makeRequest(baseUrl, {
    path: '/api/auth/login',
    method: 'POST'
  }, {
    identifier: foundCode.toLowerCase(),
    password: foundPassword
  });

  assert.strictEqual(loginRes.statusCode, 200);
  assert.ok(loginRes.json.success);
  assert.strictEqual(loginRes.json.user.role, 'fondateur');
  assert.strictEqual(loginRes.json.user.foundationId, createRes.json.foundation.id);
});

test('AUTH-CODE-07 : Accès Souverain : Le Concepteur accède à un compte École avec le code établissement et son mot de passe Concepteur', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  const schoolCode = 'SCH-SOV-' + Math.floor(Math.random() * 9000 + 1000);
  const schoolPassword = 'SchoolOwnPassword2026!';

  await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    name: 'École Souveraine Test',
    code: schoolCode,
    password: schoolPassword
  });

  // Le Concepteur utilise le code établissement et SON mot de passe maître (TEST_PASSWORD)
  const masterLoginRes = await makeRequest(baseUrl, {
    path: '/api/auth/login',
    method: 'POST'
  }, {
    identifier: schoolCode,
    password: TEST_PASSWORD
  });

  assert.strictEqual(masterLoginRes.statusCode, 200);
  assert.ok(masterLoginRes.json.success);
  assert.strictEqual(masterLoginRes.json.user.role, 'admin');

  // Vérifier qu'un audit log souverain a été tracé
  const audit = db.db.prepare("SELECT action, module FROM audit_logs WHERE action = 'SOVEREIGN_TENANT_LOGIN' ORDER BY id DESC LIMIT 1").get();
  assert.ok(audit, 'Un audit SOVEREIGN_TENANT_LOGIN doit être tracé');
  assert.strictEqual(audit.action, 'SOVEREIGN_TENANT_LOGIN');
});

test('AUTH-CODE-08 : Accès Souverain : Le Concepteur accède à un compte Fondation avec le code fondation et son mot de passe Concepteur', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  const foundCode = 'FND-SOV-' + Math.floor(Math.random() * 9000 + 1000);
  const foundPassword = 'FoundationOwnPwd2026!';

  await makeRequest(baseUrl, {
    path: '/api/foundations',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    name: 'Fondation Souveraine Test',
    code: foundCode,
    password: foundPassword
  });

  // Le Concepteur utilise le code fondation et SON mot de passe maître
  const masterLoginRes = await makeRequest(baseUrl, {
    path: '/api/auth/login',
    method: 'POST'
  }, {
    identifier: foundCode,
    password: TEST_PASSWORD
  });

  assert.strictEqual(masterLoginRes.statusCode, 200);
  assert.ok(masterLoginRes.json.success);
  assert.strictEqual(masterLoginRes.json.user.role, 'fondateur');
});

test('AUTH-CODE-09 : Basculement souverain /api/auth/switch par code d\'établissement ou de fondation', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  const schoolCode = 'SW-SCH-' + Math.floor(Math.random() * 9000 + 1000);

  const schRes = await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    name: 'École Switch Test',
    code: schoolCode,
    password: 'SchoolPassword2026!'
  });

  // Switch direct via le code de l'école
  const switchRes = await makeRequest(baseUrl, {
    path: '/api/auth/switch',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    code: schoolCode
  });

  assert.strictEqual(switchRes.statusCode, 200);
  assert.ok(switchRes.json.success);
  assert.strictEqual(switchRes.json.user.schoolId, schRes.json.school.id);
});

test('AUTH-CODE-10 : Vérification des fonctions et éléments DOM d\'ouverture d\'interface et barre d\'accès rapide', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // Fonctions JS globales
  assert.ok(content.includes('function openFoundationInterface('), 'openFoundationInterface doit exister');
  assert.ok(content.includes('function openSchoolInterface('), 'openSchoolInterface doit exister');
  assert.ok(content.includes('function openConcepteurInterface('), 'openConcepteurInterface doit exister');
  assert.ok(content.includes('function accessTenantByCode('), 'accessTenantByCode doit exister');

  // Boutons et barre d'accès rapide
  assert.ok(content.includes('id="quick-access-tenant-code"'), 'quick-access-tenant-code doit exister');
  assert.ok(content.includes('accessTenantByCode()'), 'accessTenantByCode doit être appelé');
  assert.ok(content.includes('openFoundationInterface()'), 'openFoundationInterface doit être relié');
  assert.ok(content.includes('openSchoolInterface()'), 'openSchoolInterface doit être relié');
});

test('AUTH-CODE-11 : Exploration en direct /api/auth/demo délivre une session active valide', async () => {
  const demoRes = await makeRequest(baseUrl, {
    path: '/api/auth/demo',
    method: 'POST'
  });

  assert.strictEqual(demoRes.statusCode, 200);
  assert.ok(demoRes.json.success);
  assert.strictEqual(demoRes.json.mode, 'LIVE_EXPLORATION');
  assert.ok(demoRes.headers['set-cookie'], 'Un cookie de session doit être délivré');

  // La session démo permet d'accéder au bootstrap et aux données
  const bootRes = await makeRequest(baseUrl, {
    path: '/api/bootstrap',
    headers: { cookie: demoRes.headers['set-cookie'] }
  });
  assert.strictEqual(bootRes.statusCode, 200);
  assert.ok(Array.isArray(bootRes.json.schools));
});

test('AUTH-CODE-12 : La vitrine publique (/ et /index.html) est accessible publiquement (200 OK)', async () => {
  const rootRes = await makeRequest(baseUrl, { path: '/' });
  assert.strictEqual(rootRes.statusCode, 200);
  assert.ok(rootRes.headers['content-type'].includes('text/html'));
  assert.ok(rootRes.body.includes('Explorer le Logiciel en Direct'));

  const indexRes = await makeRequest(baseUrl, { path: '/index.html' });
  assert.strictEqual(indexRes.statusCode, 200);
  assert.ok(indexRes.headers['content-type'].includes('text/html'));
});

test('AUTH-CODE-13 : Le bouton et contrôleurs d\'exploration directe n\'appellent pas openSecureLoginModal', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // Vérifier le bouton "Explorer le Logiciel en Direct"
  assert.ok(content.includes('Explorer le Logiciel en Direct'), 'Bouton explorer doit exister');
  assert.ok(content.includes("onclick=\"enterApp('dashboard')\""), 'Bouton relié à enterApp');

  // Extraire le corps de enterApp
  const enterAppMatch = content.match(/function enterApp\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(enterAppMatch, 'enterApp doit être défini');
  const enterAppBody = enterAppMatch[1];

  // enterApp ne doit pas bloquer avec openSecureLoginModal
  assert.ok(!enterAppBody.includes('openSecureLoginModal'), 'enterApp ne doit pas appeler openSecureLoginModal');
  assert.ok(enterAppBody.includes('ensureDemoSession'), 'enterApp doit appeler ensureDemoSession');

  // enterAsConcepteur ne doit pas bloquer avec openSecureLoginModal
  const enterConcepteurMatch = content.match(/function enterAsConcepteur\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(enterConcepteurMatch, 'enterAsConcepteur doit être défini');
  assert.ok(!enterConcepteurMatch[1].includes('openSecureLoginModal'), 'enterAsConcepteur ne doit pas appeler openSecureLoginModal');
});

