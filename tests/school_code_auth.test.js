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

test('AUTH-CODE-14 : Mot de passe fondation défini lors de l\'inscription et contrôle d\'accès sécurisé', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // 1. Vérification des éléments DOM de définition de mot de passe dans le générateur de fondation
  assert.ok(content.includes('id="gen-found-password"'), 'gen-found-password doit exister dans index.html');
  assert.ok(content.includes('id="gen-found-password-confirm"'), 'gen-found-password-confirm doit exister dans index.html');
  assert.ok(content.includes("generateRandomPasswordForField('gen-found-password', 'gen-found-password-confirm')"), 'Générateur rapide de mot de passe fondation');
  assert.ok(content.includes('id="edit-found-password"'), 'edit-found-password doit exister dans le modal d\'édition');

  // 2. Vérification que openFoundationInterface exige l'authentification par mot de passe si non connecté
  const openFoundMatch = content.match(/function openFoundationInterface\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(openFoundMatch, 'openFoundationInterface doit être défini');
  const openFoundBody = openFoundMatch[1];
  assert.ok(openFoundBody.includes("openSecureLoginModal('foundation'"), 'openFoundationInterface doit ouvrir le modal de login si non authentifié');

  // 3. Création d'une fondation avec son mot de passe dédié
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  const foundCode = 'FND-PWD-' + Math.floor(Math.random() * 9000 + 1000);
  const foundPassword = 'FoundSecurePwd2026!';

  const createRes = await makeRequest(baseUrl, {
    path: '/api/foundations',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    name: 'Fondation Sécurisée Test',
    code: foundCode,
    sigle: 'FST',
    password: foundPassword
  });

  assert.strictEqual(createRes.statusCode, 201);
  assert.ok(createRes.json.success);

  // 4. Connexion réussie avec le code fondation et son mot de passe défini lors de l'inscription
  const loginRes = await makeRequest(baseUrl, {
    path: '/api/auth/login',
    method: 'POST'
  }, {
    identifier: foundCode,
    password: foundPassword
  });

  assert.strictEqual(loginRes.statusCode, 200);
  assert.ok(loginRes.json.success);
  assert.strictEqual(loginRes.json.user.role, 'fondateur');

  // 5. Échec de connexion avec mot de passe erroné
  const badLoginRes = await makeRequest(baseUrl, {
    path: '/api/auth/login',
    method: 'POST'
  }, {
    identifier: foundCode,
    password: 'MauvaisMotDePasse123!'
  });

  assert.strictEqual(badLoginRes.statusCode, 401);
});

test('AUTH-CODE-15 : Réinitialisation intégrale des formulaires de création (école, fondation, élève) pour garantir des formulaires vierges', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // 1. Présence de resetSchoolGeneratorForm et réinitialisation de tous les champs
  const resetSchoolMatch = content.match(/function resetSchoolGeneratorForm\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(resetSchoolMatch, 'resetSchoolGeneratorForm doit être définie');
  const resetSchoolBody = resetSchoolMatch[1];
  assert.ok(resetSchoolBody.includes("'gen-school-name'"), 'Doit vider gen-school-name');
  assert.ok(resetSchoolBody.includes("'gen-school-code'"), 'Doit vider gen-school-code');
  assert.ok(resetSchoolBody.includes("'gen-school-address'"), 'Doit vider gen-school-address');
  assert.ok(resetSchoolBody.includes("'gen-school-phone'"), 'Doit vider gen-school-phone');
  assert.ok(resetSchoolBody.includes("'gen-school-email'"), 'Doit vider gen-school-email');
  assert.ok(resetSchoolBody.includes("'gen-school-password'"), 'Doit vider gen-school-password');
  assert.ok(resetSchoolBody.includes("'gen-school-password-confirm'"), 'Doit vider gen-school-password-confirm');
  assert.ok(resetSchoolBody.includes("'gen-school-custom-logo'"), 'Doit vider gen-school-custom-logo');
  assert.ok(resetSchoolBody.includes("'gen-school-logo-file'"), 'Doit vider gen-school-logo-file');
  assert.ok(resetSchoolBody.includes('selectSchoolLogoPreset'), 'Doit réinitialiser le logo preset');

  // 2. Présence de resetFoundationGeneratorForm
  const resetFoundMatch = content.match(/function resetFoundationGeneratorForm\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(resetFoundMatch, 'resetFoundationGeneratorForm doit être définie');
  const resetFoundBody = resetFoundMatch[1];
  assert.ok(resetFoundBody.includes("'gen-found-name'"), 'Doit vider gen-found-name');
  assert.ok(resetFoundBody.includes("'gen-found-sigle'"), 'Doit vider gen-found-sigle');
  assert.ok(resetFoundBody.includes("'gen-found-password'"), 'Doit vider gen-found-password');
  assert.ok(resetFoundBody.includes("'gen-found-password-confirm'"), 'Doit vider gen-found-password-confirm');

  // 3. openSchoolGeneratorModal et closeSchoolGeneratorModal déclenchent les réinitialisations
  const openGenMatch = content.match(/function openSchoolGeneratorModal\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(openGenMatch, 'openSchoolGeneratorModal doit être définie');
  assert.ok(openGenMatch[1].includes('resetSchoolGeneratorForm()'), 'openSchoolGeneratorModal doit appeler resetSchoolGeneratorForm');
  assert.ok(openGenMatch[1].includes('resetFoundationGeneratorForm()'), 'openSchoolGeneratorModal doit appeler resetFoundationGeneratorForm');

  const closeGenMatch = content.match(/function closeSchoolGeneratorModal\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(closeGenMatch, 'closeSchoolGeneratorModal doit être définie');
  assert.ok(closeGenMatch[1].includes('resetSchoolGeneratorForm()'), 'closeSchoolGeneratorModal doit appeler resetSchoolGeneratorForm');
  assert.ok(closeGenMatch[1].includes('resetFoundationGeneratorForm()'), 'closeSchoolGeneratorModal doit appeler resetFoundationGeneratorForm');

  // 4. saveSchoolGeneratorForm et saveFoundationGeneratorForm appellent aussi les réinitialisations
  const saveSchoolMatch = content.match(/async function saveSchoolGeneratorForm\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(saveSchoolMatch, 'saveSchoolGeneratorForm doit être définie');
  assert.ok(saveSchoolMatch[1].includes('resetSchoolGeneratorForm()'), 'saveSchoolGeneratorForm doit appeler resetSchoolGeneratorForm');

  const saveFoundMatch = content.match(/async function saveFoundationGeneratorForm\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(saveFoundMatch, 'saveFoundationGeneratorForm doit être définie');
  assert.ok(saveFoundMatch[1].includes('resetFoundationGeneratorForm()'), 'saveFoundationGeneratorForm doit appeler resetFoundationGeneratorForm');

  // 5. Inscription élève vierge garantie
  const resetStudentMatch = content.match(/function resetAddStudentForm\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(resetStudentMatch, 'resetAddStudentForm doit être définie');
  const resetStudentBody = resetStudentMatch[1];
  assert.ok(resetStudentBody.includes("'m-nom'"), 'Doit vider m-nom');
  assert.ok(resetStudentBody.includes("'m-prenoms'"), 'Doit vider m-prenoms');
  assert.ok(resetStudentBody.includes("'m-matricule'"), 'Doit vider m-matricule');

  const openStudentMatch = content.match(/function openAddStudentModal\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(openStudentMatch, 'openAddStudentModal doit être définie');
  assert.ok(openStudentMatch[1].includes('resetAddStudentForm()'), 'openAddStudentModal doit appeler resetAddStudentForm');

  const closeStudentMatch = content.match(/function closeAddStudentModal\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(closeStudentMatch, 'closeAddStudentModal doit être définie');
  assert.ok(closeStudentMatch[1].includes('resetAddStudentForm()'), 'closeAddStudentModal doit appeler resetAddStudentForm');
});

test('AUTH-CODE-16 : Réinitialisation systématique de TOUS les formulaires d\'inscription et de création', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // 1. Formulaire de création / inscription d'utilisateur (resetNewUserForm)
  const resetUserMatch = content.match(/function resetNewUserForm\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(resetUserMatch, 'resetNewUserForm doit être définie');
  const resetUserBody = resetUserMatch[1];
  assert.ok(resetUserBody.includes("'nu-nom'"), 'Doit réinitialiser nu-nom');
  assert.ok(resetUserBody.includes("'nu-prenoms'"), 'Doit réinitialiser nu-prenoms');
  assert.ok(resetUserBody.includes("'nu-email'"), 'Doit réinitialiser nu-email');
  assert.ok(resetUserBody.includes("'nu-phone'"), 'Doit réinitialiser nu-phone');
  assert.ok(resetUserBody.includes("'nu-password'"), 'Doit réinitialiser nu-password');
  assert.ok(resetUserBody.includes("'nu-password-confirm'"), 'Doit réinitialiser nu-password-confirm');

  const openUserMatch = content.match(/function openNewUserModal\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(openUserMatch, 'openNewUserModal doit être définie');
  assert.ok(openUserMatch[1].includes('resetNewUserForm()'), 'openNewUserModal doit appeler resetNewUserForm');

  const closeUserMatch = content.match(/function closeNewUserModal\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(closeUserMatch, 'closeNewUserModal doit être définie');
  assert.ok(closeUserMatch[1].includes('resetNewUserForm()'), 'closeNewUserModal doit appeler resetNewUserForm');

  // 2. Formulaire d'encaissement / paiement (resetPaymentForm)
  const resetPayMatch = content.match(/function resetPaymentForm\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(resetPayMatch, 'resetPaymentForm doit être définie');
  assert.ok(content.includes('openPaymentModal') && content.includes('resetPaymentForm()'), 'openPaymentModal doit appeler resetPaymentForm');
  assert.ok(content.includes('closePaymentModal') && content.includes('resetPaymentForm()'), 'closePaymentModal doit appeler resetPaymentForm');

  // 3. Formulaire de versement caisse secondaire (resetSecondaryDepositForm)
  const resetSecDepMatch = content.match(/function resetSecondaryDepositForm\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(resetSecDepMatch, 'resetSecondaryDepositForm doit être définie');

  // 4. Formulaire de création de caisse secondaire (resetCreateCashDeskForm)
  const resetCdkMatch = content.match(/function resetCreateCashDeskForm\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(resetCdkMatch, 'resetCreateCashDeskForm doit être définie');

  // 5. Formulaires d'écolage & tarification
  assert.ok(content.includes('function resetFeeInstallmentForm'), 'resetFeeInstallmentForm doit être définie');
  assert.ok(content.includes('function resetFeeTypeForm'), 'resetFeeTypeForm doit être définie');
  assert.ok(content.includes('function resetCostLevelForm'), 'resetCostLevelForm doit être définie');
  assert.ok(content.includes('function resetReductionForm'), 'resetReductionForm doit être définie');

  // 6. Formulaires de transfert et discipline
  assert.ok(content.includes('function resetTransferForm'), 'resetTransferForm doit être définie');
  assert.ok(content.includes('function resetBlacklistForm'), 'resetBlacklistForm doit être définie');

  // 7. Formulaires pédagogiques
  assert.ok(content.includes('function resetPeriodForm'), 'resetPeriodForm doit être définie');
  assert.ok(content.includes('function resetClassForm'), 'resetClassForm doit être définie');
  assert.ok(content.includes('function resetMatiereForm'), 'resetMatiereForm doit être définie');
  assert.ok(content.includes('function resetTeacherScheduleForm'), 'resetTeacherScheduleForm doit être définie');
  assert.ok(content.includes('function resetHomeworkForm'), 'resetHomeworkForm doit être définie');
  assert.ok(content.includes('function resetAbsenceForm'), 'resetAbsenceForm doit être définie');
  assert.ok(content.includes('function resetDocumentForm'), 'resetDocumentForm doit être définie');
  assert.ok(content.includes('function resetTimetableSlotForm'), 'resetTimetableSlotForm doit être définie');

  // 8. Vérification de l'absence de valeurs en dur polluant les formulaires vierges
  assert.ok(!content.includes('id="p-amount" value="30000"'), 'p-amount ne doit pas avoir de valeur par défaut en dur');
  assert.ok(!content.includes('id="p-ref" value="WAVE-CI-99482103"'), 'p-ref ne doit pas avoir de valeur par défaut en dur');
  assert.ok(!content.includes('id="sdep-slip" value="BORD-DEP-2026-09"'), 'sdep-slip ne doit pas avoir de valeur par défaut en dur');
  assert.ok(!content.includes('id="m-abs-time" value="08h00 - 10h00"'), 'm-abs-time ne doit pas avoir de valeur par défaut en dur');
  assert.ok(!content.includes('id="tt-teacher" value="Prof. Titulaire"'), 'tt-teacher ne doit pas avoir de valeur par défaut en dur');
  assert.ok(!content.includes('id="tt-room" value="Salle 104"'), 'tt-room ne doit pas avoir de valeur par défaut en dur');
  assert.ok(!content.includes('id="m-dob" value="2012-05-14"'), 'm-dob ne doit pas avoir de valeur par défaut en dur');
});

test('AUTH-CODE-17 : Fichier modèle d\'importation avec date de naissance séparée (JOUR - MOIS - ANNÉE) et colonne STATUT - AFF/NAFF', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // 1. Définition du modèle d'importation dans downloadSampleImportTemplate
  const tplMatch = content.match(/function downloadSampleImportTemplate\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(tplMatch, 'downloadSampleImportTemplate doit être définie');
  const tplBody = tplMatch[1];

  // En-têtes du fichier type
  assert.ok(tplBody.includes('"JOUR"'), 'Le modèle d\'importation doit contenir la colonne JOUR');
  assert.ok(tplBody.includes('"MOIS"'), 'Le modèle d\'importation doit contenir la colonne MOIS');
  assert.ok(tplBody.includes('"ANNEE"'), 'Le modèle d\'importation doit contenir la colonne ANNEE');
  assert.ok(tplBody.includes('"STATUT - AFF/NAFF"'), 'Le modèle d\'importation doit contenir la colonne STATUT - AFF/NAFF');
  assert.ok(!tplBody.includes('"DATE_NAISSANCE"'), 'DATE_NAISSANCE ne doit plus être en un seul bloc dans le modèle');

  // Échantillon avec AFF et NAFF
  assert.ok(tplBody.includes('"AFF"'), 'L\'échantillon doit démontrer le statut AFF');
  assert.ok(tplBody.includes('"NAFF"'), 'L\'échantillon doit démontrer le statut NAFF');

  // 2. Parser handleFileImport : reconnaissance des colonnes et tolérance
  const importMatch = content.match(/function handleFileImport\(e\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(importMatch, 'handleFileImport doit être définie');
  const importBody = importMatch[1];

  assert.ok(importBody.includes('idxJour') && importBody.includes('idxMois') && importBody.includes('idxAnnee'), 'handleFileImport doit extraire jour, mois et année');
  assert.ok(importBody.includes('SATATUT') && importBody.includes('STATUT'), 'handleFileImport doit être tolérant sur l\'orthographe de statut');
  assert.ok(importBody.includes('NAFF'), 'handleFileImport doit gérer le statut NAFF');

  // 3. Tableau d'aperçu HTML
  assert.ok(content.includes('Date Naiss. (J/M/A)'), 'La table d\'aperçu doit afficher la colonne Date Naiss.');
  assert.ok(content.includes('Statut (AFF/NAFF)'), 'La table d\'aperçu doit afficher la colonne Statut.');

  // 4. Formulaire d'inscription élève : m-dob vidé
  const resetStudentMatch = content.match(/function resetAddStudentForm\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(resetStudentMatch, 'resetAddStudentForm doit être définie');
  assert.ok(resetStudentMatch[1].includes("'m-dob'"), 'resetAddStudentForm doit réinitialiser m-dob');
});

test('AUTH-CODE-18 : Confirmation de l\'importation des élèves fiabilisée (API, état, UI, KPIs) et bouton ScolaIA Copilot déplaçable', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // 1. Bouton ScolaIA déplaçable : styles, gestionnaires d'événements et fonction d'initialisation
  assert.ok(content.includes('initDraggableScolaAIBtn'), 'initDraggableScolaAIBtn doit être définie');
  assert.ok(content.includes('scolaAIDragMoved'), 'Le suivi de déplacement du bouton ScolaIA doit être géré');
  assert.ok(content.includes('scolaAIIgnoreClick'), 'Le clic doit être ignoré si le bouton a été déplacé');
  assert.ok(content.includes('scolapro_scolaia_btn_pos'), 'La position personnalisée du bouton doit être mémorisée dans le stockage local');
  assert.ok(content.includes('cursor-grab') && content.includes('touch-none'), 'Le bouton ScolaIA doit comporter les classes pour le glisser-déposer');

  // 2. Fonction confirmImport : fiabilisation de l'enregistrement et mise à jour de l'UI
  const confirmMatch = content.match(/async function confirmImport\(\)\s*\{([\s\S]*?)\n    \}/);
  assert.ok(confirmMatch, 'confirmImport doit être définie');
  const confirmBody = confirmMatch[1];

  assert.ok(confirmBody.includes('targetSchoolId'), 'confirmImport doit résoudre targetSchoolId');
  assert.ok(confirmBody.includes('schoolId: targetSchoolId'), 'confirmImport doit inclure schoolId dans la charge utile de chaque élève');
  assert.ok(confirmBody.includes('registeredStudent = data.student || (data.id ? data : null)'), 'confirmImport doit extraire l\'élève créé quelle que soit la forme du retour API');
  assert.ok(confirmBody.includes('Importation en cours...'), 'confirmImport doit afficher un retour d\'état visuel en cours d\'importation');
  assert.ok(confirmBody.includes("setSubTab('inscrits')"), 'confirmImport doit basculer automatiquement sur l\'onglet inscrits');
  assert.ok(confirmBody.includes('renderStudentsTable()'), 'confirmImport doit rafraîchir la table des élèves inscrits');
  assert.ok(confirmBody.includes('updateKPIs()'), 'confirmImport doit recalculer les KPIs de scolarité');

  // 3. Backend db.js createStudent : conservation du nom complet via nomPrenom
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  const testMatricule = 'IMP-' + Date.now().toString().slice(-6);
  const testStudentName = 'KOUASSI YAO INVENTAIRE ' + Date.now().toString().slice(-4);

  const createRes = await makeRequest(baseUrl, {
    path: '/api/students',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    schoolId: 1,
    matricule: testMatricule,
    nomPrenom: testStudentName,
    sexe: 'M',
    statut: 'AFF',
    niveau: '5EME',
    classe: '5EME 2',
    feeDue: 135000
  });

  assert.strictEqual(createRes.statusCode, 201, 'La création d\'élève avec nomPrenom doit réussir');
  const createdStudent = createRes.json;
  assert.ok(createdStudent.id, 'L\'élève créé doit avoir un ID');
  assert.strictEqual(createdStudent.nomPrenom, testStudentName, 'Le nom complet doit être préservé sans repli sur Élève Anonyme');

  const dbStudent = db.db.prepare('SELECT nom_prenom, matricule, school_id FROM students WHERE id = ?').get(createdStudent.id);
  assert.ok(dbStudent, 'L\'élève doit exister en base');
  assert.strictEqual(dbStudent.nom_prenom, testStudentName);
  assert.strictEqual(dbStudent.school_id, 1);
});



