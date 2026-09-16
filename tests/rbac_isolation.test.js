const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const db = require('../db.js');
const { server, USERS } = require('../server.js');

test('RBAC Isolation : Concepteur (N1) a accès aux réglages système', () => {
  const concepteur = db.getUserById(0) || USERS[0];
  assert.strictEqual(concepteur.role, 'concepteur');
  assert.strictEqual(concepteur.level, 'PLATFORM');

  const settings = db.getSystemSettings(concepteur);
  assert.ok(settings.settings);
  assert.ok(settings.settings.platform_name);
});

test('RBAC Isolation : Fondateur (N2) ne peut PAS accéder aux réglages Concepteur (N1)', () => {
  const fondateur = db.getUserById(1) || USERS[1];
  assert.strictEqual(fondateur.role, 'fondateur');
  assert.strictEqual(fondateur.level, 'FOUNDATION');

  assert.throws(() => {
    db.getSystemSettings(fondateur);
  }, /Accès refusé/);
});

test('RBAC Isolation : Proviseur Établissement (N3) ne peut PAS escalader vers N2 ou N1', () => {
  const proviseur = db.getUserById(2) || USERS[2];
  assert.strictEqual(proviseur.role, 'admin');
  assert.strictEqual(proviseur.level, 'SCHOOL');

  assert.throws(() => {
    db.getSystemSettings(proviseur);
  }, /Accès refusé/);

  assert.throws(() => {
    db.getFoundationSettings(proviseur, 1);
  }, /Accès refusé/);
});

test('HTTP Isolation : Tentative d\'accès à /platform par un utilisateur non-concepteur retourne HTTP 403', async () => {
  await new Promise((resolve) => {
    if (!server.listening) {
      server.listen(0, '127.0.0.1', resolve);
    } else {
      resolve();
    }
  });

  const port = server.address().port;

  try {
    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: port,
        path: '/platform',
        method: 'GET',
        headers: {
          'x-scolapro-user-id': '2' // Proviseur Lycée Sainte-Marie
        }
      }, (res) => {
        assert.strictEqual(res.statusCode, 403);
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          assert.ok(body.includes('403 - Accès Refusé') || body.includes('ISOLATION MULTI-TENANT'));
          resolve();
        });
      });
      req.on('error', reject);
      req.end();
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
