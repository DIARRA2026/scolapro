/**
 * ScolaPro — Tests Automatisés de Consolidation Multi-Tenant (N1 / N2 / N3)
 * Vérifie :
 * 1. Sérialisation uniforme camelCase (formatSchool, formatFoundation)
 * 2. Respect strict de l'autonomie (foundationId: null -> foundation_id IS NULL, jamais 1)
 * 3. Consolidation temps réel par batch (les compteurs reflètent fidèlement les créations N3)
 * 4. Étanchéité de consolidation : une école autonome ne remonte jamais en N2 (Fondation), uniquement en N1 (Concepteur)
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

let baseUrl = '';

test.before(async () => {
  const srv = await startTestServer();
  baseUrl = srv.baseUrl;
});

test.after(async () => {
  await stopTestServer();
});

test('CONSOL-01 : Sérialisation camelCase des écoles et fondations sur /api/bootstrap', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  assert.ok(session.cookie, "Connexion concepteur requise");

  const bootRes = await makeRequest(baseUrl, {
    path: '/api/bootstrap',
    headers: { cookie: session.cookie }
  });

  assert.equal(bootRes.statusCode, 200);
  const data = bootRes.json;

  assert.ok(Array.isArray(data.schools), "schools doit être un tableau");
  assert.ok(Array.isArray(data.foundations), "foundations doit être un tableau");

  if (data.schools.length > 0) {
    const s = data.schools[0];
    assert.ok('id' in s, "Doit posséder id");
    assert.ok('code' in s, "Doit posséder code");
    assert.ok('name' in s, "Doit posséder name");
    assert.ok('shortName' in s, "Doit être sérialisé en camelCase (shortName)");
    assert.ok('schoolType' in s, "Doit être sérialisé en camelCase (schoolType)");
    assert.ok('studentsCount' in s, "Doit être sérialisé en camelCase (studentsCount)");
    assert.ok('classesCount' in s, "Doit être sérialisé en camelCase (classesCount)");
    assert.ok('cashDesksCount' in s, "Doit être sérialisé en camelCase (cashDesksCount)");
    assert.ok('recoveryRate' in s, "Doit être sérialisé en camelCase (recoveryRate)");
    assert.ok('isActive' in s, "Doit être sérialisé en camelCase (isActive)");
    assert.ok('createdAt' in s, "Doit être sérialisé en camelCase (createdAt)");
    assert.ok('foundationId' in s, "Doit posséder foundationId en camelCase");
  }

  if (data.foundations.length > 0) {
    const f = data.foundations[0];
    assert.ok('id' in f, "Doit posséder id");
    assert.ok('code' in f, "Doit posséder code");
    assert.ok('name' in f, "Doit posséder name");
    assert.ok('schoolsCount' in f, "Doit posséder schoolsCount consolidé");
    assert.ok('studentsCount' in f, "Doit posséder studentsCount consolidé");
    assert.ok('classesCount' in f, "Doit posséder classesCount consolidé");
    assert.ok('totalCash' in f, "Doit posséder totalCash consolidé");
    assert.ok('recoveryRate' in f, "Doit posséder recoveryRate consolidé");
  }
});

test('CONSOL-02 : Sérialisation et accès aux routes GET /api/schools et GET /api/foundations', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);

  const schRes = await makeRequest(baseUrl, {
    path: '/api/schools',
    headers: { cookie: session.cookie }
  });
  assert.equal(schRes.statusCode, 200);
  assert.ok(Array.isArray(schRes.json));
  assert.ok(schRes.json.length > 0);
  assert.ok('studentsCount' in schRes.json[0]);

  const fndRes = await makeRequest(baseUrl, {
    path: '/api/foundations',
    headers: { cookie: session.cookie }
  });
  assert.equal(fndRes.statusCode, 200);
  assert.ok(Array.isArray(fndRes.json));
  assert.ok(fndRes.json.length > 0);
  assert.ok('schoolsCount' in fndRes.json[0]);
});

test('CONSOL-03 : Création d\'école autonome — foundationId reste strictement NULL (jamais 1)', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);

  const code = `auto-test-${Date.now()}`;
  const res = await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: { cookie: session.cookie }
  }, {
    name: 'Institut Autonome Lumière',
    code,
    schoolType: 'LYCÉE',
    foundationId: null, // EXPLICITEMENT AUTONOME
    city: 'Yamoussoukro'
  });

  assert.equal(res.statusCode, 201);
  const createdSchool = res.json.school || res.json;
  assert.equal(createdSchool.name, 'Institut Autonome Lumière');
  assert.equal(createdSchool.foundationId, null, "foundationId doit être null");

  // Vérification directe en base SQLite : la colonne SQL foundation_id DOIT valoir NULL
  const sqlRow = db.db.prepare('SELECT foundation_id FROM schools WHERE id = ?').get(createdSchool.id);
  assert.equal(sqlRow.foundation_id, null, "La colonne SQL foundation_id doit être NULL en base de données");

  // Vérification que les compteurs de départ sont sincères (0 élève, 0 classe)
  assert.equal(createdSchool.studentsCount, 0, "Un nouvel établissement doit avoir 0 élève");
  assert.equal(createdSchool.classesCount, 0, "Un nouvel établissement doit avoir 0 classe");
});

test('CONSOL-04 : Création d\'école affiliée — rattachée avec succès à la fondation cible', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);

  const code = `affil-test-${Date.now()}`;
  const res = await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: { cookie: session.cookie }
  }, {
    name: 'Collège Privé Sainte-Thérèse',
    code,
    schoolType: 'COLLÈGE',
    foundationId: 1, // AFFILIÉE À FONDATION 1
    city: 'Abidjan'
  });

  assert.equal(res.statusCode, 201);
  const created = res.json.school || res.json;
  assert.equal(created.foundationId, 1);

  const sqlRow = db.db.prepare('SELECT foundation_id FROM schools WHERE id = ?').get(created.id);
  assert.equal(sqlRow.foundation_id, 1);
});

test('CONSOL-05 : Consolidation en temps réel — l\'ajout d\'élèves et de classes met à jour les totaux sans redémarrage', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);

  // 1. Créer une nouvelle école test
  const code = `consol-live-${Date.now()}`;
  const schRes = await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: { cookie: session.cookie }
  }, {
    name: 'École Live Consolidation',
    code,
    schoolType: 'PRIMAIRE & SECONDAIRE',
    foundationId: 1,
    city: 'Bouaké'
  });
  assert.equal(schRes.statusCode, 201);
  const testSchool = schRes.json.school || schRes.json;

  // 2. Vérifier les compteurs initiaux
  let schoolCheck = await makeRequest(baseUrl, {
    path: `/api/schools/${testSchool.id}`,
    headers: { cookie: session.cookie }
  });
  assert.equal(schoolCheck.statusCode, 200);
  assert.equal(schoolCheck.json.school.studentsCount, 0);
  assert.equal(schoolCheck.json.school.classesCount, 0);

  // 3. Ajouter 2 classes dans cette école
  const cl1 = await makeRequest(baseUrl, {
    path: '/api/classes',
    method: 'POST',
    headers: { cookie: session.cookie }
  }, {
    name: 'Classe 6E Live',
    level: '6EME',
    cycle: 'Premier Cycle',
    capacity: 35,
    schoolId: testSchool.id
  });
  assert.equal(cl1.statusCode, 201);

  const cl2 = await makeRequest(baseUrl, {
    path: '/api/classes',
    method: 'POST',
    headers: { cookie: session.cookie }
  }, {
    name: 'Classe 5E Live',
    level: '5EME',
    cycle: 'Premier Cycle',
    capacity: 35,
    schoolId: testSchool.id
  });
  assert.equal(cl2.statusCode, 201);

  // 4. Ajouter 1 élève dans cette école
  const mat = `LIVE-${Date.now()}`;
  const st = await makeRequest(baseUrl, {
    path: '/api/students',
    method: 'POST',
    headers: { cookie: session.cookie }
  }, {
    matricule: mat,
    nomPrenom: 'Gomez Antoine',
    sexe: 'M',
    statut: 'AFF',
    niveau: '6EME',
    classe: 'Classe 6E Live',
    feeDue: 150000,
    schoolId: testSchool.id
  });
  assert.equal(st.statusCode, 201);

  // 5. Interroger immédiatement l'école : compteurs synchronisés dynamiquement (pas de cache mort)
  schoolCheck = await makeRequest(baseUrl, {
    path: `/api/schools/${testSchool.id}`,
    headers: { cookie: session.cookie }
  });
  assert.equal(schoolCheck.statusCode, 200);
  assert.equal(schoolCheck.json.school.studentsCount, 1, "studentsCount doit valoir 1 après ajout de l'élève");
  assert.equal(schoolCheck.json.school.classesCount, 2, "classesCount doit valoir 2 après ajout des 2 classes");

  // 6. Vérifier que la consolidation de la Fondation 1 inclut bien ces nouveaux chiffres
  const foundRes = await makeRequest(baseUrl, {
    path: '/api/foundation/1/consolidated',
    headers: { cookie: session.cookie }
  });
  assert.equal(foundRes.statusCode, 200);
  const foundData = foundRes.json;

  // L'école doit figurer dans les écoles de la fondation avec ses compteurs exacts
  const foundSchoolEntry = foundData.schools.find(s => s.id === testSchool.id);
  assert.ok(foundSchoolEntry, "L'école affiliée doit être présente dans les écoles de la fondation");
  assert.equal(foundSchoolEntry.studentsCount, 1);
  assert.equal(foundSchoolEntry.classesCount, 2);
});

test('CONSOL-06 : Étanchéité — Une école autonome n\'apparaît dans aucune fondation N2, uniquement en N1', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);

  // Créer une école autonome
  const autoCode = `auto-isolated-${Date.now()}`;
  const schRes = await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: { cookie: session.cookie }
  }, {
    name: 'Académie Souveraine Autonome',
    code: autoCode,
    schoolType: 'COLLÈGE & LYCÉE',
    foundationId: null,
    city: 'San Pedro'
  });
  assert.equal(schRes.statusCode, 201);
  const autoSchool = schRes.json.school || schRes.json;

  // Vérifier en N2 (Fondation 1) : l'école autonome NE DOIT PAS s'y trouver
  const f1Consol = await makeRequest(baseUrl, {
    path: '/api/foundation/1/consolidated',
    headers: { cookie: session.cookie }
  });
  assert.equal(f1Consol.statusCode, 200);
  const f1Schools = f1Consol.json.schools || [];
  const foundInF1 = f1Schools.some(s => s.id === autoSchool.id);
  assert.equal(foundInF1, false, "Une école autonome ne doit JAMAIS apparaître dans la consolidation N2 de la Fondation 1");

  // Vérifier en N1 (Concepteur / Platform) : l'école autonome DOIT s'y trouver avec foundationId === null
  const bootRes = await makeRequest(baseUrl, {
    path: '/api/bootstrap',
    headers: { cookie: session.cookie }
  });
  assert.equal(bootRes.statusCode, 200);
  const allSchools = bootRes.json.schools || [];
  const foundInN1 = allSchools.find(s => s.id === autoSchool.id);
  assert.ok(foundInN1, "L'école autonome doit apparaître dans le dashboard N1 (Concepteur)");
  assert.equal(foundInN1.foundationId, null, "En N1, son foundationId doit être strictement null");
});

test('CONSOL-07 : Mise à jour du logo et informations d\'une école via PUT /api/schools/:id', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);

  // 1. Créer une école avec logo emoji initial
  const testCode = `logo-sch-${Date.now()}`;
  const createRes = await makeRequest(baseUrl, {
    path: '/api/schools',
    method: 'POST',
    headers: { cookie: session.cookie }
  }, {
    name: 'École Test Logo Initial',
    code: testCode,
    schoolType: 'COLLÈGE & LYCÉE',
    city: 'Abidjan',
    logo: '🏫'
  });
  assert.equal(createRes.statusCode, 201);
  const schoolId = createRes.json.id;

  // 2. Mettre à jour avec un logo image (data URL ou URL)
  const customLogo = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
  const updateRes = await makeRequest(baseUrl, {
    path: `/api/schools/${schoolId}`,
    method: 'PUT',
    headers: { cookie: session.cookie }
  }, {
    name: 'École Test Logo Modifié',
    logo: customLogo,
    city: 'Yamoussoukro'
  });

  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.json.logo, customLogo);
  assert.equal(updateRes.json.name, 'École Test Logo Modifié');
  assert.equal(updateRes.json.city, 'Yamoussoukro');

  // 3. Vérifier la persistance via GET direct et GET bootstrap
  const getRes = await makeRequest(baseUrl, {
    path: `/api/schools/${schoolId}`,
    headers: { cookie: session.cookie }
  });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.json.logo, customLogo);

  const bootRes = await makeRequest(baseUrl, {
    path: '/api/bootstrap',
    headers: { cookie: session.cookie }
  });
  const foundInBoot = (bootRes.json.schools || []).find(s => s.id === schoolId);
  assert.ok(foundInBoot, "L'école mise à jour doit être présente dans bootstrap");
  assert.equal(foundInBoot.logo, customLogo, "Le logo mis à jour doit être fidèlement persisté dans bootstrap");
});

test('CONSOL-08 : Mise à jour du logo et informations d\'une fondation via PUT /api/foundations/:id', async () => {
  const session = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);

  // 1. Créer une fondation avec logo emoji initial
  const foundCode = `logo-fnd-${Date.now()}`;
  const createRes = await makeRequest(baseUrl, {
    path: '/api/foundations',
    method: 'POST',
    headers: { cookie: session.cookie }
  }, {
    name: 'Fondation Test Logo Initial',
    code: foundCode,
    sigle: 'FTLI',
    hq: 'Abidjan',
    logo: '🏛️'
  });
  assert.equal(createRes.statusCode, 201);
  const foundId = createRes.json.id;

  // 2. Mettre à jour avec un logo image personnalisé
  const customLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const updateRes = await makeRequest(baseUrl, {
    path: `/api/foundations/${foundId}`,
    method: 'PUT',
    headers: { cookie: session.cookie }
  }, {
    name: 'Fondation Test Logo Modifiée',
    sigle: 'FTLM',
    logo: customLogo
  });

  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.json.logo, customLogo);
  assert.equal(updateRes.json.name, 'Fondation Test Logo Modifiée');

  // 3. Vérifier la persistance via GET direct et GET bootstrap
  const getRes = await makeRequest(baseUrl, {
    path: `/api/foundations/${foundId}`,
    headers: { cookie: session.cookie }
  });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.json.logo, customLogo);

  const bootRes = await makeRequest(baseUrl, {
    path: '/api/bootstrap',
    headers: { cookie: session.cookie }
  });
  const foundInBoot = (bootRes.json.foundations || []).find(f => f.id === foundId);
  assert.ok(foundInBoot, "La fondation mise à jour doit être présente dans bootstrap");
  assert.equal(foundInBoot.logo, customLogo, "Le logo de la fondation doit être fidèlement persisté dans bootstrap");
});
