/**
 * Tests de validation et conformité pour la fonctionnalité :
 * "DANS LA PAGE COÛT DE LA SCOLARITE IL DOIT AVOIR DEUX OPTIONS : AFF et NAFF"
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('SUITE : Deux Options Tarifaires (AFF & NAFF) sur la Page Coût de la Scolarité', () => {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  let htmlContent;

  before(() => {
    htmlContent = fs.readFileSync(htmlPath, 'utf8');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. VÉRIFICATION DU DOM DANS INDEX.HTML
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Structure DOM de la sous-vue Coûts de la Scolarité', () => {
    test('DOM-01: La sous-vue Coûts de la scolarité existe avec les boutons des deux options AFF et NAFF', () => {
      assert.ok(htmlContent.includes('id="subview-ecolage-costs"'), 'subview-ecolage-costs doit exister');
      assert.ok(htmlContent.includes('id="btn-cost-opt-all"'), 'btn-cost-opt-all doit exister');
      assert.ok(htmlContent.includes('id="btn-cost-opt-aff"'), 'btn-cost-opt-aff doit exister');
      assert.ok(htmlContent.includes('id="btn-cost-opt-naff"'), 'btn-cost-opt-naff doit exister');
    });

    test('DOM-02: Les mentions "AFF" et "NAFF" sont explicitement affichées dans la sous-vue', () => {
      const start = htmlContent.indexOf('id="subview-ecolage-costs"');
      const end = htmlContent.indexOf('id="subview-ecolage-reductions"', start);
      const subview = htmlContent.slice(start, end);

      assert.ok(subview.includes('AFF'), 'La sous-vue doit mentionner explicitement AFF');
      assert.ok(subview.includes('NAFF'), 'La sous-vue doit mentionner explicitement NAFF');
      assert.ok(subview.includes('id="ecolage-costs-grid"'), 'ecolage-costs-grid doit exister');
      assert.ok(subview.includes('id="ecolage-costs-table-tbody"'), 'ecolage-costs-table-tbody doit exister');
    });

    test('DOM-03: La modale de niveau tarifaire (modal-cost-level) propose les options AFF et NAFF', () => {
      assert.ok(htmlContent.includes('id="modal-cost-level"'), 'modal-cost-level doit exister');
      assert.ok(htmlContent.includes('id="cl-base-aff"'), 'cl-base-aff doit être présent pour le montant AFF');
      assert.ok(htmlContent.includes('id="cl-base-naff"'), 'cl-base-naff doit être présent pour le montant NAFF');
      assert.ok(htmlContent.includes('id="cl-base"'), 'cl-base doit être conservé pour rétro-compatibilité');
    });

    test('DOM-04: Le selecteur de statut dans l\'inscription (m-statut) inclut AFF et NAFF', () => {
      assert.ok(htmlContent.includes('id="m-statut"'), 'm-statut doit exister');
      const start = htmlContent.indexOf('id="m-statut"');
      const selectHtml = htmlContent.slice(start, start + 400);
      assert.ok(selectHtml.includes('value="AFF"'), 'm-statut doit proposer la valeur AFF');
      assert.ok(selectHtml.includes('value="NAFF"'), 'm-statut doit proposer la valeur NAFF');
      assert.ok(selectHtml.includes('updateTuitionFeePreview'), 'm-statut doit déclencher updateTuitionFeePreview');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. VÉRIFICATION DU MODÈLE ET DES FONCTIONS JAVASCRIPT
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Fonctions JavaScript et Logique Métier AFF / NAFF', () => {
    test('JS-01: setCostOptionFilter est déclarée et gère le filtrage AFF/NAFF/ALL', () => {
      assert.ok(htmlContent.includes('function setCostOptionFilter('), 'setCostOptionFilter doit être déclarée');
    });

    test('JS-02: renderEcolageCosts génère les champs de saisie pour Option AFF et Option NAFF', () => {
      const start = htmlContent.indexOf('function renderEcolageCosts()');
      const end = htmlContent.indexOf('function updateCostLevelInMemory(', start);
      const fnBody = htmlContent.slice(start, end);

      assert.ok(fnBody.includes('cost-base-aff-'), 'renderEcolageCosts doit générer des inputs pour cost-base-aff-');
      assert.ok(fnBody.includes('cost-base-naff-'), 'renderEcolageCosts doit générer des inputs pour cost-base-naff-');
      assert.ok(fnBody.includes('cost-base-'), 'renderEcolageCosts doit conserver cost-base-');
      assert.ok(fnBody.includes('totalAff'), 'renderEcolageCosts doit calculer totalAff');
      assert.ok(fnBody.includes('totalNaff'), 'renderEcolageCosts doit calculer totalNaff');
      assert.ok(fnBody.includes('ecolage-costs-table-tbody'), 'renderEcolageCosts doit alimenter le tableau comparatif');
    });

    test('JS-03: updateCostLevelInMemory permet de modifier indépendamment AFF et NAFF', () => {
      const start = htmlContent.indexOf('function updateCostLevelInMemory(');
      const end = htmlContent.indexOf('function resetCostLevelForm()', start);
      const fnBody = htmlContent.slice(start, end);

      assert.ok(fnBody.includes("'aff'"), "updateCostLevelInMemory doit gérer le type 'aff'");
      assert.ok(fnBody.includes("'naff'"), "updateCostLevelInMemory doit gérer le type 'naff'");
    });

    test('JS-04: saveCostsByLevel enregistre les montants AFF et NAFF et persiste dans localStorage', () => {
      const start = htmlContent.indexOf('function saveCostsByLevel()');
      const end = htmlContent.indexOf('function renderEcolageReductions()', start);
      const fnBody = htmlContent.slice(start, end);

      assert.ok(fnBody.includes('cost-base-aff-'), 'saveCostsByLevel doit lire cost-base-aff-');
      assert.ok(fnBody.includes('cost-base-naff-'), 'saveCostsByLevel doit lire cost-base-naff-');
      assert.ok(fnBody.includes('scolapro_costs_by_level'), 'saveCostsByLevel doit persister dans localStorage');
    });

    test('JS-05: editCostLevel est déclarée et charge les montants AFF et NAFF dans la modale', () => {
      assert.ok(htmlContent.includes('function editCostLevel('), 'editCostLevel doit être déclarée');
      const start = htmlContent.indexOf('function editCostLevel(');
      const end = htmlContent.indexOf('function closeCostLevelModal()', start);
      const fnBody = htmlContent.slice(start, end);

      assert.ok(fnBody.includes('cl-base-aff'), 'editCostLevel doit préremplir cl-base-aff');
      assert.ok(fnBody.includes('cl-base-naff'), 'editCostLevel doit préremplir cl-base-naff');
    });

    test('JS-06: handleCostLevelSubmit traite à la fois baseAff et baseNaff', () => {
      const start = htmlContent.indexOf('function handleCostLevelSubmit(');
      const end = htmlContent.indexOf('function addNewCostLevelPrompt()', start);
      const fnBody = htmlContent.slice(start, end);

      assert.ok(fnBody.includes('cl-base-aff'), 'handleCostLevelSubmit doit lire cl-base-aff');
      assert.ok(fnBody.includes('cl-base-naff'), 'handleCostLevelSubmit doit lire cl-base-naff');
      assert.ok(fnBody.includes('baseAff'), 'handleCostLevelSubmit doit enregistrer baseAff');
      assert.ok(fnBody.includes('baseNaff'), 'handleCostLevelSubmit doit enregistrer baseNaff');
    });

    test('JS-07: updateTuitionFeePreview applique automatiquement le barème AFF ou NAFF selon le statut', () => {
      const start = htmlContent.indexOf('function updateTuitionFeePreview(');
      const end = htmlContent.indexOf('async function handleNewStudentSubmit(', start);
      const fnBody = htmlContent.slice(start, end);

      assert.ok(fnBody.includes('AFF'), 'updateTuitionFeePreview doit vérifier le statut AFF');
      assert.ok(fnBody.includes('baseAff'), 'updateTuitionFeePreview doit appliquer baseAff');
      assert.ok(fnBody.includes('baseNaff'), 'updateTuitionFeePreview doit appliquer baseNaff');
    });

    test('JS-08: renderEcolageCosts et updateCostLevelInMemory gèrent les frais d\'examen (cost-exam-)', () => {
      assert.ok(htmlContent.includes('cost-exam-'), 'renderEcolageCosts doit générer un input pour cost-exam-');
      const start = htmlContent.indexOf('function updateCostLevelInMemory(');
      const end = htmlContent.indexOf('function resetCostLevelForm()', start);
      const fnBody = htmlContent.slice(start, end);
      assert.ok(fnBody.includes("'exam'"), "updateCostLevelInMemory doit gérer le type 'exam'");
    });

    test('JS-09: saveCostsByLevel enregistre les droits d\'examen modifiés', () => {
      const start = htmlContent.indexOf('function saveCostsByLevel()');
      const end = htmlContent.indexOf('function renderEcolageReductions()', start);
      const fnBody = htmlContent.slice(start, end);
      assert.ok(fnBody.includes('cost-exam-'), 'saveCostsByLevel doit lire cost-exam-');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. VÉRIFICATION DES DONNÉES PAR DÉFAUT
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Données par défaut des barèmes AFF et NAFF', () => {
    test('DATA-01: appState.costsByLevel contient les 2 options (baseAff et baseNaff) pour chaque niveau', () => {
      const start = htmlContent.indexOf('costsByLevel: [');
      const end = htmlContent.indexOf('discountCases: [', start);
      const dataBlock = htmlContent.slice(start, end);

      assert.ok(dataBlock.includes('baseAff: 0'), 'Option AFF initiale doit être à 0 (montants fictifs effacés)');
      assert.ok(dataBlock.includes('baseNaff: 0'), 'Option NAFF initiale doit être à 0 (montants fictifs effacés)');
      assert.ok(dataBlock.includes('totalAff:'), 'totalAff doit être présent');
      assert.ok(dataBlock.includes('totalNaff:'), 'totalNaff doit être présent');
    });

    test('DATA-02: rehydrateAppData restaure les barèmes personnalisés depuis localStorage', () => {
      const start = htmlContent.indexOf('function rehydrateAppData(');
      const end = htmlContent.indexOf('function ensureDemoSession()', start);
      const body = htmlContent.slice(start, end);

      assert.ok(body.includes('scolapro_costs_by_level'), 'rehydrateAppData doit restaurer scolapro_costs_by_level');
      assert.ok(body.includes('renderEcolageCosts()'), 'rehydrateAppData doit appeler renderEcolageCosts');
    });

    test('DATA-03: inscription.html est aligné avec les options AFF et NAFF', () => {
      const inscPath = path.join(__dirname, '..', 'inscription.html');
      const inscContent = fs.readFileSync(inscPath, 'utf8');
      assert.ok(inscContent.includes('value="AFF"'), 'inscription.html doit contenir AFF');
      assert.ok(inscContent.includes('value="NAFF"'), 'inscription.html doit contenir NAFF');
    });
  });
});
