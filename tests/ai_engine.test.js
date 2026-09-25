/**
 * ScolaPro — Suite de Tests du Moteur d'Intelligence Artificielle ScolaIA
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const aiEngine = require('../lib/ai-engine');
const {
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

test('AI-01 : computeStudentAIRiskScore calcule un score 0-100 avec décomposition multidimensionnelle', () => {
  const student = {
    id: 1,
    nomPrenom: 'Kouassi Jean',
    matricule: 'MAT-001',
    classe: '6EME 1',
    sexe: 'M',
    statut: 'AFF',
    fee_due: 120000,
    fee_paid: 60000
  };

  const risk = aiEngine.computeStudentAIRiskScore(student, {
    moyenne: 7.5,
    absencesHours: 26,
    disciplineIncidents: 3
  });

  assert.ok(risk.score >= 0 && risk.score <= 100, 'Le score doit être entre 0 et 100');
  assert.equal(risk.level, 'CRITICAL', 'Un profil à fortes absences et moyenne faible doit être classé CRITICAL');
  assert.equal(risk.breakdown.academic, 40, 'Moyenne < 8.5 donne 40 points');
  assert.equal(risk.breakdown.attendance, 30, 'Absences > 24h donne 30 points');
  assert.equal(risk.breakdown.discipline, 10, 'Incidents >= 3 donne 10 points');
  assert.ok(risk.factors.length >= 3, 'Au moins 3 facteurs d alerte identifiés');
  assert.ok(risk.recommendation.length > 10, 'Une recommandation pédagogique doit être fournie');
});

test('AI-02 : computeStudentAIRiskScore identifie un profil stable avec risque faible', () => {
  const student = {
    id: 2,
    nomPrenom: 'Amani Yao',
    matricule: 'MAT-002',
    classe: '3EME 2',
    sexe: 'M',
    statut: 'AFF',
    fee_due: 150000,
    fee_paid: 150000
  };

  const risk = aiEngine.computeStudentAIRiskScore(student, {
    moyenne: 15.5,
    absencesHours: 0,
    disciplineIncidents: 0
  });

  assert.ok(risk.score <= 20, 'Un bon profil doit avoir un score faible');
  assert.equal(risk.level, 'LOW', 'Le niveau doit être LOW');
  assert.equal(risk.breakdown.financial, 0, 'Scolarité à jour -> 0 point de pénalité');
});

test('AI-03 : generateStudentAIEvaluation produit des appréciations conformes aux standards MENA', () => {
  const student = { nomPrenom: 'Traoré Fatou' };

  const evalExcellente = aiEngine.generateStudentAIEvaluation(student, { moyenne: 17, rang: 1 });
  assert.ok(evalExcellente.includes('Félicitations'), 'Excellente moyenne doit mentionner les félicitations');
  assert.ok(evalExcellente.includes('1er'), 'Le rang doit être mentionné');

  const evalFaible = aiEngine.generateStudentAIEvaluation(student, { moyenne: 7.8 });
  assert.ok(evalFaible.includes('alerte critique') || evalFaible.includes('lacunes'), 'Moyenne faible doit contenir une alerte');
});

test('AI-04 : computeFinancialAIPredictions calcule les prévisions de trésorerie et la segmentation', () => {
  const mockStudents = [
    { id: 1, fee_due: 100000, fee_paid: 100000 },
    { id: 2, fee_due: 100000, fee_paid: 30000 },
    { id: 3, fee_due: 100000, fee_paid: 70000 }
  ];

  const predictions = aiEngine.computeFinancialAIPredictions(mockStudents, []);
  assert.equal(predictions.totalDue, 300000);
  assert.equal(predictions.totalCollected, 200000);
  assert.equal(predictions.totalRemaining, 100000);
  assert.equal(predictions.segments.upToDate, 1);
  assert.equal(predictions.segments.criticalDebtors, 1);
  assert.equal(predictions.segments.moderateDebtors, 1);
  assert.ok(predictions.projectedRate30Days >= predictions.recoveryRate);
});

test('AI-05 : processScolaAINLPQuery résout les requêtes sémantiques', () => {
  const mockAppState = {
    students: [
      { id: 10, nomPrenom: 'Bamba Souleymane', matricule: 'BAM-10', classe: 'Terminale D', fee_due: 100000, fee_paid: 100000 }
    ],
    classes: [{ id: 1, name: 'Terminale D' }],
    cashDesks: [{ id: 1, balance: 500000 }]
  };

  const qDiagnostic = aiEngine.processScolaAINLPQuery('diagnostic global', mockAppState);
  assert.equal(qDiagnostic.intent, 'GLOBAL_DIAGNOSTIC');
  assert.ok(qDiagnostic.actions.length > 0);

  const qRisque = aiEngine.processScolaAINLPQuery('élèves à risque', mockAppState);
  assert.equal(qRisque.intent, 'AT_RISK_STUDENTS');

  const qFinance = aiEngine.processScolaAINLPQuery('état de la caisse', mockAppState);
  assert.equal(qFinance.intent, 'FINANCES');

  const qLookup = aiEngine.processScolaAINLPQuery('bamba', mockAppState);
  assert.equal(qLookup.intent, 'STUDENT_LOOKUP');
  assert.ok(qLookup.text.includes('Bamba Souleymane'));
});

test('AI-06 : index.html contient les composants DOM et fonctions de ScolaIA', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // Éléments DOM
  assert.ok(html.includes('id="btn-toggle-scola-ai"'), 'Bouton Copilot présent');
  assert.ok(html.includes('id="scola-ai-copilot-drawer"'), 'Tiroir Copilot présent');
  assert.ok(html.includes('id="scola-ai-spotlight"'), 'Spotlight Ctrl+K présent');
  assert.ok(html.includes('id="modal-student-ai-synthesis"'), 'Modal de diagnostic élève présent');
  assert.ok(html.includes('id="bulletin-council-appreciation"'), 'Appréciation IA du bulletin présente');

  // Fonctions JS
  assert.ok(html.includes('function toggleScolaAICopilot'), 'toggleScolaAICopilot déclarée');
  assert.ok(html.includes('function askScolaAI'), 'askScolaAI déclarée');
  assert.ok(html.includes('function openStudentAISynthesis'), 'openStudentAISynthesis déclarée');
  assert.ok(html.includes('function toggleScolaAISpotlight'), 'toggleScolaAISpotlight déclarée');
  assert.ok(html.includes('function computeStudentAIRiskScore'), 'computeStudentAIRiskScore déclarée');
  assert.ok(html.includes('function generateStudentAIEvaluationForCurrentBulletin'), 'generateStudentAIEvaluationForCurrentBulletin déclarée');
});

test('AI-07 : POST /api/ai/query répond avec une analyse sémantique via l API serveur', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  assert.strictEqual(adminLogin.statusCode, 200);

  const res = await makeRequest(baseUrl, {
    path: '/api/ai/query',
    method: 'POST',
    headers: {
      cookie: adminLogin.cookie
    }
  }, { query: 'diagnostic global' });

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json.success, true);
  assert.ok(res.json.answer);
  assert.strictEqual(res.json.answer.intent, 'GLOBAL_DIAGNOSTIC');
});

test('AI-08 : POST /api/ai/student-risk calcule et retourne le diagnostic élève', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  assert.strictEqual(adminLogin.statusCode, 200);

  const res = await makeRequest(baseUrl, {
    path: '/api/ai/student-risk',
    method: 'POST',
    headers: {
      cookie: adminLogin.cookie
    }
  }, {
    student: {
      id: 99,
      nomPrenom: 'Test Élève',
      matricule: 'TST-099',
      classe: '4EME 1',
      fee_due: 100000,
      fee_paid: 20000
    },
    context: {
      moyenne: 8.0,
      absencesHours: 15
    }
  });

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json.success, true);
  assert.ok(res.json.risk.score >= 50);
});

test('AI-09 : POST /api/ai/evaluation génère l appréciation officielle', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  assert.strictEqual(adminLogin.statusCode, 200);

  const res = await makeRequest(baseUrl, {
    path: '/api/ai/evaluation',
    method: 'POST',
    headers: {
      cookie: adminLogin.cookie
    }
  }, {
    student: { nomPrenom: 'Kone Mariam' },
    stats: { moyenne: 16.5, rang: 2 }
  });

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json.success, true);
  assert.ok(res.json.evaluation.includes('Kone Mariam'));
  assert.ok(res.json.evaluation.includes('Félicitations'));
});

test('AI-10 : GET /api/ai/financial-forecast retourne les prévisions de trésorerie à 30 jours', async () => {
  const adminLogin = await loginUser(baseUrl, TEST_USERS.concepteur, TEST_PASSWORD);
  assert.strictEqual(adminLogin.statusCode, 200);

  const res = await makeRequest(baseUrl, {
    path: '/api/ai/financial-forecast',
    method: 'GET',
    headers: {
      cookie: adminLogin.cookie
    }
  });

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json.success, true);
  assert.ok(res.json.forecast);
  assert.ok(typeof res.json.forecast.recoveryRate === 'number');
  assert.ok(res.json.forecast.segments);
});
