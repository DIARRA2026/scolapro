#!/usr/bin/env node
/**
 * =====================================================================
 * ScolaPro — Outil d'Administration des Mots de Passe (scripts/set-password.js)
 * Usage CLI :
 *   node scripts/set-password.js --list
 *   node scripts/set-password.js --email <email> [--password <mot_de_passe>]
 * =====================================================================
 */

'use strict';

const path = require('node:path');
const ROOT_DIR = path.resolve(__dirname, '..');
const db = require(path.join(ROOT_DIR, 'db.js'));
const auth = require(path.join(ROOT_DIR, 'lib/auth.js'));

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
Usage :
  node scripts/set-password.js --list
      Liste tous les utilisateurs enregistrés.

  node scripts/set-password.js --email <adresse_email> [--password <mot_de_passe>]
      Définit le mot de passe d'un compte.
      Si --password est omis, un mot de passe temporaire robuste est généré et affiché.
      Toutes les sessions actives du compte sont immédiatement révoquées.
`);
}

async function main() {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('--list')) {
    const users = db.getUsers({ role: 'concepteur' });
    console.log('\n=== UTILISATEURS ENREGISTRÉS SCOLAPRO ===\n');
    console.table(users.map(u => ({
      ID: u.id,
      Nom: `${u.nom} ${u.prenom}`,
      Email: u.email,
      Rôle: u.role,
      Établissement: u.schoolId ? `#${u.schoolId}` : 'Global',
      'MDP Imposé': u.mustChangePassword ? 'OUI' : 'NON'
    })));
    process.exit(0);
  }

  const emailIdx = args.indexOf('--email');
  if (emailIdx === -1 || !args[emailIdx + 1]) {
    console.error("Erreur : L'argument --email <adresse_email> est obligatoire.");
    printHelp();
    process.exit(1);
  }

  const email = args[emailIdx + 1].trim().toLowerCase();
  const rawUser = db.db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  if (!rawUser) {
    console.error(`Erreur : Aucun utilisateur trouvé pour l'e-mail '${email}'.`);
    process.exit(1);
  }

  const pwdIdx = args.indexOf('--password');
  let rawPassword = (pwdIdx !== -1 && args[pwdIdx + 1]) ? args[pwdIdx + 1] : null;
  let isGenerated = false;

  if (!rawPassword) {
    rawPassword = auth.generateTemporaryPassword();
    isGenerated = true;
  }

  const policy = auth.validatePasswordPolicy(rawPassword);
  if (!policy.valid) {
    console.error(`Erreur de sécurité : ${policy.message}`);
    process.exit(1);
  }

  await db.setUserPassword(rawUser.id, rawPassword, { id: 0, role: 'concepteur', nom: 'CLI_ADMIN', prenom: 'Console' });

  console.log('\n================================================================');
  console.log(`✅ Mot de passe mis à jour pour : ${rawUser.prenom} ${rawUser.nom} (${email})`);
  if (isGenerated) {
    console.log(`🔑 Nouveau mot de passe temporaire : ${rawPassword}`);
    console.log('(Ce mot de passe est affiché une seule fois. Le changement est obligatoire)');
  } else {
    console.log('🔑 Nouveau mot de passe défini conformément à la politique.');
  }
  console.log('🔒 Toutes les sessions actives de cet utilisateur ont été révoquées.');
  console.log('================================================================\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\nErreur fatale :', err.message);
  process.exit(1);
});
