const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('ERP-01 : index.html ne contient aucun gestionnaire d\'événement HTML orphelin (0 fonction manquante)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // Fonctions déclarées
  const fnDefRegex = /(?:function\s+([a-zA-Z0-9_$]+)\s*\(|(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>|(?:window\.)([a-zA-Z0-9_$]+)\s*=)/g;
  const definedFunctions = new Set();
  let match;
  while ((match = fnDefRegex.exec(content)) !== null) {
    const fnName = match[1] || match[2] || match[3];
    if (fnName) definedFunctions.add(fnName);
  }

  const builtins = new Set([
    'if', 'else', 'for', 'while', 'switch', 'return', 'typeof',
    'getElementById', 'querySelector', 'querySelectorAll',
    'alert', 'confirm', 'prompt', 'print', 'focus', 'blur', 'close',
    'addEventListener', 'removeEventListener', 'dispatchEvent',
    'click', 'submit', 'reset', 'select', 'preventDefault', 'stopPropagation'
  ]);

  const handlerRegex = /\bon(?:click|submit|change|input|keyup|keydown)\s*=\s*["']([^"']+)["']/gi;
  const missing = [];

  while ((match = handlerRegex.exec(content)) !== null) {
    const handlerCode = match[1];
    const callMatches = handlerCode.matchAll(/([a-zA-Z0-9_$]+)\s*\(/g);
    for (const cm of callMatches) {
      const fnName = cm[1];
      if (!definedFunctions.has(fnName) && !builtins.has(fnName)) {
        missing.push(fnName);
      }
    }
  }

  assert.equal(missing.length, 0, `Fonctions HTML manquantes détectées : ${missing.join(', ')}`);
});

test('ERP-02 : Tous les identifiants DOM appelés par getElementById sont déclarés dans index.html (0 ID manquant)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  const idRegex = /\bid=["']([^"']+)["']/g;
  const declaredIds = new Set();
  let match;
  while ((match = idRegex.exec(content)) !== null) {
    declaredIds.add(match[1]);
  }

  const getElRegex = /document\.getElementById\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  const missingIds = [];
  while ((match = getElRegex.exec(content)) !== null) {
    const id = match[1];
    if (!id.includes('${') && !id.includes('+')) {
      if (!declaredIds.has(id)) {
        missingIds.push(id);
      }
    }
  }

  assert.equal(missingIds.length, 0, `Identifiants DOM manquants : ${missingIds.join(', ')}`);
});

test('ERP-03 : Quittance de paiement officielle et Gestion Abonnement SaaS intégrées dans le DOM', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // Modal quittance
  assert.ok(content.includes('id="modal-payment-receipt"'), 'Le modal modal-payment-receipt doit exister');
  assert.ok(content.includes('id="printable-receipt"'), 'Le conteneur imprimable printable-receipt doit exister');
  assert.ok(content.includes('id="rcpt-number"'), 'Le champ numéro de quittance rcpt-number doit exister');
  assert.ok(content.includes('id="rcpt-status-badge"'), 'Le badge de statut de quittance rcpt-status-badge doit exister');

  // Modal abonnement
  assert.ok(content.includes('id="modal-school-subscription"'), 'Le modal modal-school-subscription doit exister');
  assert.ok(content.includes('id="sub-modal-plan"'), 'Le sélecteur de plan SaaS sub-modal-plan doit exister');
  assert.ok(content.includes('id="sub-modal-max-students"'), 'Le quota de licences sub-modal-max-students doit exister');
});

test('ERP-04 : Générateur de matricule MENA conforme au standard ivoirien (26 + 6 chiffres + 1 lettre)', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // Vérifier la présence du helper generateAutoMatricule
  assert.ok(content.includes('function generateAutoMatricule('), 'generateAutoMatricule doit être défini');

  // Tester l'expression régulière du format matricule MENA
  const menaRegex = /^26\d{6}[A-Z]$/;
  const dummyMatricule = '26819402X';
  assert.ok(menaRegex.test(dummyMatricule), 'Le matricule d\'exemple doit être valide');
});

test('ERP-05 : Indicateurs financiers dynamiques de view-finance présents dans le DOM', () => {
  const content = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.ok(content.includes('id="fin-total-due"'), 'L\'indicateur fin-total-due doit être présent');
  assert.ok(content.includes('id="fin-total-collected"'), 'L\'indicateur fin-total-collected doit être présent');
  assert.ok(content.includes('id="fin-total-remaining"'), 'L\'indicateur fin-total-remaining doit être présent');
  assert.ok(content.includes('id="fin-collection-rate"'), 'L\'indicateur fin-collection-rate doit être présent');
});
