const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

describe('SUITE : Module Écolage Fullstack & Élimination des Données Fictives', () => {
  const indexPath = path.join(__dirname, '..', 'index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  const dbPath = path.join(__dirname, '..', 'db.js');
  const dbContent = fs.readFileSync(dbPath, 'utf8');
  const serverPath = path.join(__dirname, '..', 'server.js');
  const serverContent = fs.readFileSync(serverPath, 'utf8');

  test('FULLSTACK-01: db.js déclare getSchoolEcolageConfig et updateSchoolEcolageConfig', () => {
    assert.ok(dbContent.includes('function getSchoolEcolageConfig'), 'getSchoolEcolageConfig doit exister dans db.js');
    assert.ok(dbContent.includes('function updateSchoolEcolageConfig'), 'updateSchoolEcolageConfig doit exister dans db.js');
    assert.ok(dbContent.includes('getSchoolEcolageConfig,'), 'getSchoolEcolageConfig doit être exporté dans db.js');
    assert.ok(dbContent.includes('updateSchoolEcolageConfig,'), 'updateSchoolEcolageConfig doit être exporté dans db.js');
  });

  test('FULLSTACK-02: server.js intègre les routes REST /api/school/ecolage (GET et POST/PUT)', () => {
    assert.ok(serverContent.includes("reqPath === '/api/school/ecolage'"), 'Route /api/school/ecolage doit exister dans server.js');
    assert.ok(serverContent.includes('db.getSchoolEcolageConfig'), 'Le serveur doit appeler getSchoolEcolageConfig');
    assert.ok(serverContent.includes('db.updateSchoolEcolageConfig'), 'Le serveur doit appeler updateSchoolEcolageConfig');
  });

  test('FULLSTACK-03: index.html contient syncEcolageToServer et loadSchoolEcolageFromServer', () => {
    assert.ok(indexContent.includes('function syncEcolageToServer'), 'syncEcolageToServer doit être déclarée');
    assert.ok(indexContent.includes('function loadSchoolEcolageFromServer'), 'loadSchoolEcolageFromServer doit être déclarée');
    assert.ok(indexContent.includes('/api/school/ecolage'), 'index.html doit communiquer avec /api/school/ecolage');
  });

  test('FULLSTACK-04: renderEcolageSummary ne contient aucun montant statique codé en dur', () => {
    const start = indexContent.indexOf('function renderEcolageSummary() {');
    const end = indexContent.indexOf('// =================================================================', start);
    const summaryBlock = indexContent.slice(start, end);

    // Ne doit plus contenir de tranches codées en dur '120 000 XOF' ou '130 000 XOF'
    assert.ok(!summaryBlock.includes('<tr><td class="p-2 font-semibold">Collège</td>'), 'Le tableau HTML statique doit être éliminé');
    assert.ok(summaryBlock.includes('appState.costsByLevel.map'), 'Le tableau doit être généré dynamiquement depuis appState.costsByLevel');
    assert.ok(summaryBlock.includes('priseEnCharge'), 'Le calcul de prise en charge État doit être présent');
  });

  test('FULLSTACK-05: renderPersonalSchedule est dynamique et n a plus de texte fictif en dur', () => {
    const start = indexContent.indexOf('function renderPersonalSchedule(studentId) {');
    const end = indexContent.indexOf('function renderEcolageSummary() {', start);
    const schedBlock = indexContent.slice(start, end);

    assert.ok(!schedBlock.includes("Dr. N'Guetta (D.E)"), "Le nom fictif Dr. N'Guetta doit être supprimé");
    assert.ok(schedBlock.includes('runningTarget'), 'Les tranches individuelles doivent être calculées dynamiquement');
    assert.ok(schedBlock.includes('student.feeDue'), 'Les frais réels de l élève doivent être utilisés');
  });

  test('FULLSTACK-06: Les actions de modification persistent en base via syncEcolageToServer', () => {
    const saveCostsStart = indexContent.indexOf('function saveCostsByLevel() {');
    const saveCostsEnd = indexContent.indexOf('function editCostLevel(', saveCostsStart);
    const saveCostsBlock = indexContent.slice(saveCostsStart, saveCostsEnd);
    assert.ok(saveCostsBlock.includes('syncEcolageToServer({ costsByLevel:'), 'saveCostsByLevel doit appeler syncEcolageToServer');

    const feeSubmitStart = indexContent.indexOf('function handleFeeTypeSubmit(');
    const feeSubmitEnd = indexContent.indexOf('function editFeeType(', feeSubmitStart);
    const feeSubmitBlock = indexContent.slice(feeSubmitStart, feeSubmitEnd);
    assert.ok(feeSubmitBlock.includes('syncEcolageToServer({ feeTypes:'), 'handleFeeTypeSubmit doit appeler syncEcolageToServer');

    const redSubmitStart = indexContent.indexOf('function handleReductionSubmit(');
    const redSubmitEnd = indexContent.indexOf('function editReduction(', redSubmitStart);
    const redSubmitBlock = indexContent.slice(redSubmitStart, redSubmitEnd);
    assert.ok(redSubmitBlock.includes('syncEcolageToServer({ discountCases:'), 'handleReductionSubmit doit appeler syncEcolageToServer');
  });

  test('FULLSTACK-07: getBootstrapData injecte ecolageConfig pour l école active', () => {
    assert.ok(dbContent.includes('ecolageConfig:'), 'getBootstrapData doit inclure ecolageConfig');
    assert.ok(indexContent.includes('if (data.ecolageConfig)'), 'rehydrateAppData doit hydrater data.ecolageConfig');
  });
});
