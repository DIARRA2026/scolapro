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

test('AUTH-CODE-19 : Importation transactionnelle multi-tenant anti-doublon, rapport d\'import et cohérence dashboard/comptabilité', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  assert.strictEqual(adminLogin.statusCode, 200);

  // 1. Créer une nouvelle école dédiée pour le test d'importation étanche
  const testSchoolCode = 'SCH-IMP-' + Math.floor(Math.random() * 90000 + 10000);
  const schoolRes = await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    name: 'Groupe Scolaire Anti Doublon ' + testSchoolCode,
    code: testSchoolCode,
    directorPassword: 'AdminSchoolTest2026!'
  });
  assert.strictEqual(schoolRes.statusCode, 201);
  const testSchoolId = schoolRes.json.school ? schoolRes.json.school.id : schoolRes.json.id;
  assert.ok(testSchoolId, 'L\'école de test doit être créée avec un ID');

  // 2. Préparer un lot de 4 élèves avec matricule et dates de naissance
  const batchStudents = [
    {
      matricule: 'MAT-TEST-001',
      nomPrenom: 'TRAORE MAMADOU',
      sexe: 'M',
      statut: 'AFF',
      niveau: '6EME',
      classe: '6EME A',
      dob: '2012-05-15',
      feeDue: 150000
    },
    {
      matricule: 'MAT-TEST-002',
      nomPrenom: 'KOUAME AMOIN GRACE',
      sexe: 'F',
      statut: 'NAFF',
      niveau: '6EME',
      classe: '6EME B',
      dob: '2012-08-22',
      feeDue: 180000
    },
    {
      matricule: 'MAT-TEST-003',
      nomPrenom: 'DIALLO IBRAHIMA',
      sexe: 'M',
      statut: 'AFF',
      niveau: '5EME',
      classe: '5EME 1',
      dob: '2011-02-10',
      feeDue: 160000
    },
    {
      // Sans matricule initial, identification par nom_prenom + dob
      matricule: '',
      nomPrenom: 'BAH FATIMATA',
      sexe: 'F',
      statut: 'AFF',
      niveau: '4EME',
      classe: '4EME 2',
      dob: '2010-11-30',
      feeDue: 175000
    }
  ];

  // PREMIER IMPORT : Les 4 élèves doivent être créés avec succès
  const firstImportRes = await makeRequest(baseUrl, {
    path: '/api/students/import',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    schoolId: testSchoolId,
    students: batchStudents
  });

  assert.strictEqual(firstImportRes.statusCode, 200, 'Le premier import doit réussir');
  assert.strictEqual(firstImportRes.json.success, true);
  assert.strictEqual(firstImportRes.json.summary.imported, 4, '4 nouveaux élèves doivent être importés');
  assert.strictEqual(firstImportRes.json.summary.updated, 0);
  assert.strictEqual(firstImportRes.json.summary.ignored, 0);
  assert.strictEqual(firstImportRes.json.summary.errors, 0);
  assert.strictEqual(firstImportRes.json.details.length, 4, 'Le rapport doit détailler chaque élève');

  // Vérifier en base : exactement 4 élèves dans cette école
  const countAfterFirst = db.db.prepare('SELECT COUNT(*) as count FROM students WHERE school_id = ?').get(testSchoolId).count;
  assert.strictEqual(countAfterFirst, 4, 'La base doit contenir exactement 4 élèves');

  // DEUXIÈME IMPORT : Ré-importation du MÊME fichier exact
  // DOIT GÉNÉRER STRICTEMENT 0 DOUBLON : 4 ignorés
  const secondImportRes = await makeRequest(baseUrl, {
    path: '/api/students/import',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    schoolId: testSchoolId,
    students: batchStudents
  });

  assert.strictEqual(secondImportRes.statusCode, 200, 'Le second import doit réussir sans erreur');
  assert.strictEqual(secondImportRes.json.summary.imported, 0, 'Zéro doublon créé lors du second import');
  assert.strictEqual(secondImportRes.json.summary.updated, 0, 'Aucune mise à jour car données identiques');
  assert.strictEqual(secondImportRes.json.summary.ignored, 4, 'Les 4 élèves existants doivent être ignorés');
  assert.strictEqual(secondImportRes.json.summary.errors, 0);

  // Vérifier en base : toujours STRICTEMENT 4 élèves
  const countAfterSecond = db.db.prepare('SELECT COUNT(*) as count FROM students WHERE school_id = ?').get(testSchoolId).count;
  assert.strictEqual(countAfterSecond, 4, 'La base doit TOUJOURS contenir 4 élèves sans aucun doublon');

  // TROISIÈME IMPORT : 1 élève modifié (changement de classe), 1 nouvel élève, et les autres identiques
  const modifiedBatch = [
    { ...batchStudents[0], classe: '6EME EXCELLENCE' }, // Modifié
    batchStudents[1], // Identique (ignoré)
    batchStudents[2], // Identique (ignoré)
    batchStudents[3], // Identique (ignoré)
    {
      matricule: 'MAT-TEST-005',
      nomPrenom: 'SORO GNENEMA',
      sexe: 'M',
      statut: 'AFF',
      niveau: '3EME',
      classe: '3EME 1',
      dob: '2009-04-12',
      feeDue: 200000
    } // Nouveau
  ];

  const thirdImportRes = await makeRequest(baseUrl, {
    path: '/api/students/import',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    schoolId: testSchoolId,
    students: modifiedBatch
  });

  assert.strictEqual(thirdImportRes.statusCode, 200);
  assert.strictEqual(thirdImportRes.json.summary.imported, 1, '1 nouvel élève importé');
  assert.strictEqual(thirdImportRes.json.summary.updated, 1, '1 élève mis à jour');
  assert.strictEqual(thirdImportRes.json.summary.ignored, 3, '3 élèves inchangés ignorés');

  // Vérifier en base : exactement 5 élèves maintenant
  const countAfterThird = db.db.prepare('SELECT COUNT(*) as count FROM students WHERE school_id = ?').get(testSchoolId).count;
  assert.strictEqual(countAfterThird, 5, 'La base doit contenir exactement 5 élèves');

  // Vérifier que la classe a bien été mise à jour en base
  const updatedStudent = db.db.prepare('SELECT classe FROM students WHERE school_id = ? AND matricule = ?').get(testSchoolId, 'MAT-TEST-001');
  assert.strictEqual(updatedStudent.classe, '6EME EXCELLENCE');

  // 4. Test de la contrainte d'unicité en base de données (sécurité concurrente)
  assert.throws(() => {
    db.db.prepare(`
      INSERT INTO students (school_id, matricule, nom_prenom, niveau, classe, fee_due, fee_paid)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(testSchoolId, 'MAT-TEST-001', 'DOUBLON FRAUDULEUX', '6EME', '6EME A', 100000, 0);
  }, /UNIQUE constraint failed/, 'La base de données doit bloquer un doublon concurrent de matricule via l\'index UNIQUE');

  assert.throws(() => {
    db.db.prepare(`
      INSERT INTO students (school_id, matricule, nom_prenom, dob, niveau, classe, fee_due, fee_paid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(testSchoolId, 'AUTRE-MAT-999', 'TRAORE MAMADOU', '2012-05-15', '6EME', '6EME A', 100000, 0);
  }, /UNIQUE constraint failed/, 'La base de données doit bloquer un doublon concurrent d\'identité (nom, prénom, dob) via l\'index UNIQUE');

  // 5. Enregistrer des paiements réels pour tester la comptabilité et le tableau de bord
  const student1 = db.db.prepare('SELECT id FROM students WHERE school_id = ? AND matricule = ?').get(testSchoolId, 'MAT-TEST-001');
  const pay1Res = await makeRequest(baseUrl, {
    path: '/api/payments',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    studentId: student1.id,
    amount: 50000,
    paymentMethod: 'ESPECES',
    academicYear: '2026-2027',
    notes: 'Acompte 1',
    schoolId: testSchoolId
  });
  assert.strictEqual(pay1Res.statusCode, 201);

  const student2 = db.db.prepare('SELECT id FROM students WHERE school_id = ? AND matricule = ?').get(testSchoolId, 'MAT-TEST-002');
  const pay2Res = await makeRequest(baseUrl, {
    path: '/api/payments',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    studentId: student2.id,
    amount: 100000,
    paymentMethod: 'WAVE',
    academicYear: '2026-2027',
    notes: 'Acompte 2',
    schoolId: testSchoolId
  });
  assert.strictEqual(pay2Res.statusCode, 201);

  // 6. Réconciliation et vérification exacte
  const recStats = db.reconcileAccountingBalances(testSchoolId);
  assert.strictEqual(recStats.reconciledStudents, 5);

  const dbSumDue = db.db.prepare('SELECT COALESCE(SUM(fee_due), 0) as total FROM students WHERE school_id = ?').get(testSchoolId).total;
  const dbSumPaid = db.db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE school_id = ?').get(testSchoolId).total;
  const expectedRemaining = dbSumDue - dbSumPaid;

  assert.strictEqual(dbSumPaid, 150000, 'Total encaissé doit être exactement 150000 XOF');

  // Vérifier /api/dashboard/stats
  const dashRes = await makeRequest(baseUrl, {
    path: `/api/dashboard/stats?schoolId=${testSchoolId}`,
    method: 'GET',
    headers: { cookie: adminLogin.cookie }
  });
  assert.strictEqual(dashRes.statusCode, 200);
  assert.strictEqual(dashRes.json.totalStudents, 5, 'Total élèves du dashboard doit être 5');
  assert.strictEqual(dashRes.json.totalDue, dbSumDue, 'Total prévu doit correspondre exactement');
  assert.strictEqual(dashRes.json.totalPaid, 150000, 'Total encaissé doit correspondre exactement');
  assert.strictEqual(dashRes.json.balanceRemaining, expectedRemaining, 'Reste à recouvrer exact');

  // Vérifier /api/finance/summary
  const finRes = await makeRequest(baseUrl, {
    path: `/api/finance/summary?schoolId=${testSchoolId}`,
    method: 'GET',
    headers: { cookie: adminLogin.cookie }
  });
  assert.strictEqual(finRes.statusCode, 200);
  assert.strictEqual(finRes.json.totalDue, dbSumDue);
  assert.strictEqual(finRes.json.totalPaid, 150000);
  assert.strictEqual(finRes.json.balanceRemaining, expectedRemaining);

  // 7. Vérifier la présence du modal de rapport et ses fonctions JS dans index.html
  const fs = require('node:fs');
  const path = require('node:path');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.ok(indexHtml.includes('id="import-report-modal"'), 'index.html doit contenir le modal import-report-modal');
  assert.ok(indexHtml.includes('openImportReportModal'), 'openImportReportModal doit être définie dans index.html');
  assert.ok(indexHtml.includes('closeImportReportModal'), 'closeImportReportModal doit être définie dans index.html');
  assert.ok(indexHtml.includes('filterImportReportRows'), 'filterImportReportRows doit être définie dans index.html');
  assert.ok(indexHtml.includes('exportImportReportCSV'), 'exportImportReportCSV doit être définie dans index.html');
  assert.ok(indexHtml.includes('rep-imported'), 'Le compteur rep-imported doit exister');
  assert.ok(indexHtml.includes('rep-updated'), 'Le compteur rep-updated doit exister');
  assert.ok(indexHtml.includes('rep-ignored'), 'Le compteur rep-ignored doit exister');
  assert.ok(indexHtml.includes('rep-errors'), 'Le compteur rep-errors doit exister');
});

test('AUTH-CODE-20 : Option de répartition automatique équilibrée vs affectation manuelle des classes', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  assert.strictEqual(adminLogin.statusCode, 200);

  // 1. Créer une nouvelle école test pour ce scénario
  const schCode = `DISTRIB-${Date.now().toString().slice(-4)}`;
  const schRes = await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    name: 'Collège Répartition Test',
    code: schCode,
    director: 'Directeur Test',
    email: `distrib-${Date.now()}@scolapro.ci`,
    phone: '+225 0700000000',
    type: 'SECONDAIRE',
    academicYear: '2026-2027',
    password: 'Password@2026'
  });
  assert.strictEqual(schRes.statusCode, 201);
  const testSchoolId = schRes.json.school ? schRes.json.school.id : schRes.json.id;

  // Créer 2 classes actives pour le niveau 6EME dans cette école
  const cl1Res = await makeRequest(baseUrl, {
    path: '/api/classes',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    schoolId: testSchoolId,
    name: '6EME 1',
    level: '6EME',
    cycle: 'Premier Cycle',
    capacity: 35,
    status: 'ACTIF'
  });
  assert.strictEqual(cl1Res.statusCode, 201);

  const cl2Res = await makeRequest(baseUrl, {
    path: '/api/classes',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    schoolId: testSchoolId,
    name: '6EME 2',
    level: '6EME',
    cycle: 'Premier Cycle',
    capacity: 35,
    status: 'ACTIF'
  });
  assert.strictEqual(cl2Res.statusCode, 201);

  // 2. TEST MODE MANUEL (autoDistributeClasses = false) :
  // Les élèves sans classe explicite doivent rester 'Non assigné'
  const manualBatch = [
    {
      matricule: 'MAT-MAN-001',
      nomPrenom: 'ELEVE SANS CLASSE 1',
      sexe: 'M',
      niveau: '6EME',
      classe: '', // Pas de classe spécifiée
      dob: '2012-01-01'
    },
    {
      matricule: 'MAT-MAN-002',
      nomPrenom: 'ELEVE AVEC CLASSE',
      sexe: 'F',
      niveau: '6EME',
      classe: '6EME 1', // Classe explicite
      dob: '2012-02-02'
    }
  ];

  const manualImportRes = await makeRequest(baseUrl, {
    path: '/api/students/import',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    schoolId: testSchoolId,
    autoDistributeClasses: false,
    students: manualBatch
  });

  assert.strictEqual(manualImportRes.statusCode, 200);
  assert.strictEqual(manualImportRes.json.summary.imported, 2);

  // Vérifier en base : l'élève sans classe doit être STRICTEMENT 'Non assigné'
  const st1 = db.db.prepare('SELECT classe FROM students WHERE school_id = ? AND matricule = ?').get(testSchoolId, 'MAT-MAN-001');
  assert.strictEqual(st1.classe, 'Non assigné', 'En mode manuel, l\'élève sans classe doit être Non assigné');

  // L'élève avec classe explicite doit avoir sa classe
  const st2 = db.db.prepare('SELECT classe FROM students WHERE school_id = ? AND matricule = ?').get(testSchoolId, 'MAT-MAN-002');
  assert.strictEqual(st2.classe, '6EME 1', 'La classe explicite fournie dans le fichier doit toujours être conservée');

  // Vérifier les stats du dashboard : 1 assigné, 1 non assigné
  const statsRes = await makeRequest(baseUrl, {
    path: `/api/dashboard/stats?schoolId=${testSchoolId}`,
    method: 'GET',
    headers: { cookie: adminLogin.cookie }
  });
  assert.strictEqual(statsRes.statusCode, 200);
  assert.strictEqual(statsRes.json.students.unassigned, 1, 'Le compteur non assigné doit compter exactement 1');
  assert.strictEqual(statsRes.json.students.assigned, 1, 'Le compteur assigné doit compter exactement 1');
  assert.strictEqual(statsRes.json.totalStudents, 2, 'Total élèves = 2');

  // 3. TEST MODE AUTOMATIQUE ÉQUILIBRÉ (autoDistributeClasses = true) :
  // Actuellement : 6EME 1 a 1 élève (MAT-MAN-002), 6EME 2 a 0 élève.
  // Si on importe 2 nouveaux élèves sans classe :
  // - Le 1er doit aller en 6EME 2 (effectif le plus faible = 0)
  // - Le 2ème doit aller en 6EME 1 (effectif à égalité = 1)
  const autoBatch = [
    {
      matricule: 'MAT-AUTO-001',
      nomPrenom: 'ELEVE EQUILIBRE 1',
      sexe: 'M',
      niveau: '6EME',
      classe: '',
      dob: '2012-03-03'
    },
    {
      matricule: 'MAT-AUTO-002',
      nomPrenom: 'ELEVE EQUILIBRE 2',
      sexe: 'F',
      niveau: '6EME',
      classe: '',
      dob: '2012-04-04'
    }
  ];

  const autoImportRes = await makeRequest(baseUrl, {
    path: '/api/students/import',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    schoolId: testSchoolId,
    autoDistributeClasses: true,
    students: autoBatch
  });

  assert.strictEqual(autoImportRes.statusCode, 200);
  assert.strictEqual(autoImportRes.json.summary.imported, 2);

  const autoSt1 = db.db.prepare('SELECT classe FROM students WHERE school_id = ? AND matricule = ?').get(testSchoolId, 'MAT-AUTO-001');
  const autoSt2 = db.db.prepare('SELECT classe FROM students WHERE school_id = ? AND matricule = ?').get(testSchoolId, 'MAT-AUTO-002');

  // L'un doit être en 6EME 2 et l'autre en 6EME 1 (répartition équitable)
  assert.strictEqual(autoSt1.classe, '6EME 2', 'Le premier élève sans classe doit être affecté à la classe la moins chargée (6EME 2)');
  assert.strictEqual(autoSt2.classe, '6EME 1', 'Le deuxième élève sans classe doit équilibrer en 6EME 1');

  // Vérifier la préservation de classe lors d'une mise à jour sans colonne classe
  const updateWithoutClass = [
    {
      matricule: 'MAT-AUTO-001',
      nomPrenom: 'ELEVE EQUILIBRE 1 MODIFIE',
      sexe: 'M',
      niveau: '6EME',
      classe: '', // Absence de classe dans le fichier de mise à jour
      dob: '2012-03-03'
    }
  ];

  const updateRes = await makeRequest(baseUrl, {
    path: '/api/students/import',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    schoolId: testSchoolId,
    autoDistributeClasses: false,
    students: updateWithoutClass
  });

  assert.strictEqual(updateRes.statusCode, 200);
  assert.strictEqual(updateRes.json.summary.updated, 1);
  const preservedSt1 = db.db.prepare('SELECT nom_prenom, classe FROM students WHERE school_id = ? AND matricule = ?').get(testSchoolId, 'MAT-AUTO-001');
  assert.strictEqual(preservedSt1.nom_prenom, 'ELEVE EQUILIBRE 1 MODIFIE');
  assert.strictEqual(preservedSt1.classe, '6EME 2', 'L\'élève existant doit conserver sa classe 6EME 2 même si le fichier ne spécifie pas de classe');

  // 4. Vérifier les composants UI dans index.html
  const fs = require('node:fs');
  const path = require('node:path');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.ok(indexHtml.includes('id="import-auto-distribute-toggle"'), 'La case à cocher toggle doit être présente dans index.html');
  assert.ok(indexHtml.includes('id="import-distribution-badge"'), 'Le badge de mode de distribution doit exister');
  assert.ok(indexHtml.includes('id="import-distribution-help-text"'), 'Le texte d\'aide explicatif doit exister');
  assert.ok(indexHtml.includes('id="import-distribution-mode-label"'), 'Le libellé du mode doit exister');
  assert.ok(indexHtml.includes('onImportDistributionModeChanged'), 'La fonction onImportDistributionModeChanged doit être définie');
  assert.ok(indexHtml.includes('updateImportPreview'), 'La fonction updateImportPreview doit être définie');
});

test('AUTH-CODE-21 : Studio de déploiement en masse des divisions et classes', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  assert.strictEqual(adminLogin.statusCode, 200);

  // 1. Créer une nouvelle école dédiée pour ce test
  const uniqueCode = 'SCH-BATCH-' + Date.now();
  const schRes = await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    name: 'Institut Expérimental du Batch',
    code: uniqueCode,
    type: 'COLLEGE_LYCEE',
    city: 'Yamoussoukro',
    phone: '+225 0500000021',
    email: `batch-${Date.now()}@ecole.ci`,
    academicYear: '2026-2027',
    password: 'Password@2026'
  });
  assert.strictEqual(schRes.statusCode, 201);
  const testSchoolId = schRes.json.school ? schRes.json.school.id : schRes.json.id;

  // 2. Pré-créer une classe existante (ex: 6EME 1)
  const preClassRes = await makeRequest(baseUrl, {
    path: '/api/classes',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    schoolId: testSchoolId,
    name: '6EME 1',
    level: '6EME',
    cycle: 'Premier Cycle',
    capacity: 40,
    status: 'ACTIF'
  });
  assert.strictEqual(preClassRes.statusCode, 201);

  // 3. Appel de l'API batch création :
  // - 6EME 1 (déjà existante : doit être ignorée / retournée dans skipped)
  // - 6EME 2 (nouvelle)
  // - 6EME 3 (nouvelle)
  // - 3EME A (nouvelle)
  // - 3EME B (nouvelle)
  // - TLE D 1 (nouvelle)
  const batchPayload = {
    schoolId: testSchoolId,
    classes: [
      { name: '6EME 1', level: '6EME', cycle: 'Premier Cycle', capacity: 40, room: 'Salle 1' },
      { name: '6EME 2', level: '6EME', cycle: 'Premier Cycle', capacity: 40, room: 'Salle 2' },
      { name: '6EME 3', level: '6EME', cycle: 'Premier Cycle', capacity: 40, room: 'Salle 3' },
      { name: '3EME A', level: '3EME', cycle: 'Premier Cycle', capacity: 35, room: 'Salle 4' },
      { name: '3EME B', level: '3EME', cycle: 'Premier Cycle', capacity: 35, room: 'Salle 5' },
      { name: 'TLE D 1', level: 'TLE D', cycle: 'Second Cycle', capacity: 45, room: 'Labo 1' }
    ]
  };

  const batchRes = await makeRequest(baseUrl, {
    path: '/api/classes/batch',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, batchPayload);

  assert.strictEqual(batchRes.statusCode, 201);
  assert.strictEqual(batchRes.json.success, true);
  assert.strictEqual(batchRes.json.createdCount, 5, '5 nouvelles classes doivent avoir été créées');
  assert.strictEqual(batchRes.json.skippedCount, 1, '1 classe existante (6EME 1) doit avoir été ignorée');
  assert.strictEqual(batchRes.json.created.length, 5);
  assert.ok(batchRes.json.skipped.includes('6EME 1'));

  // 4. Vérifier en base de données que les classes existent bien pour cette école
  const schoolClasses = db.db.prepare('SELECT name, level, cycle, capacity, room FROM classes WHERE school_id = ? ORDER BY name').all(testSchoolId);
  assert.strictEqual(schoolClasses.length, 6, 'Total 6 classes (1 existante + 5 créées par le lot)');

  const names = schoolClasses.map(c => c.name);
  assert.ok(names.includes('6EME 1'));
  assert.ok(names.includes('6EME 2'));
  assert.ok(names.includes('6EME 3'));
  assert.ok(names.includes('3EME A'));
  assert.ok(names.includes('3EME B'));
  assert.ok(names.includes('TLE D 1'));

  // 5. Tester l'alternative Array sur POST /api/classes (compatibilité polyvalente)
  const directArrayRes = await makeRequest(baseUrl, {
    path: '/api/classes',
    method: 'POST',
    headers: { cookie: adminLogin.cookie }
  }, {
    schoolId: testSchoolId,
    classes: [
      { name: '5EME 1', level: '5EME', cycle: 'Premier Cycle', capacity: 40 },
      { name: '5EME 2', level: '5EME', cycle: 'Premier Cycle', capacity: 40 }
    ]
  });
  assert.strictEqual(directArrayRes.statusCode, 201);
  assert.strictEqual(directArrayRes.json.createdCount, 2);

  // 6. Vérifier les composants UI du Studio dans index.html
  const fs = require('node:fs');
  const path = require('node:path');
  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.ok(indexHtml.includes('id="modal-class-batch-generator"'), 'Le modal Studio de déploiement en masse doit exister');
  assert.ok(indexHtml.includes('id="btn-ped-batch-classes-top"'), 'Le bouton Générateur de Divisions doit exister');
  assert.ok(indexHtml.includes('openClassBatchGeneratorModal'), 'La fonction openClassBatchGeneratorModal doit être déclarée');
  assert.ok(indexHtml.includes('closeClassBatchGeneratorModal'), 'La fonction closeClassBatchGeneratorModal doit être déclarée');
  assert.ok(indexHtml.includes('renderBatchGeneratorUI'), 'Le moteur de rendu live renderBatchGeneratorUI doit être défini');
  assert.ok(indexHtml.includes('confirmBatchClassCreation'), 'La fonction d\'enregistrement confirmBatchClassCreation doit être définie');
  assert.ok(indexHtml.includes('adjustBatchLevelCount'), 'Le stepper intelligent de division adjustBatchLevelCount doit être défini');
  assert.ok(indexHtml.includes('setBatchNumberingFormat'), 'Le choix de format de numérotation setBatchNumberingFormat doit exister');
});




