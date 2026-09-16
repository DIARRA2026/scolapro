const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { server } = require('../server.js');

test('GET /health retourne le statut UP et les informations système', async (t) => {
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
      http.get(`http://127.0.0.1:${port}/health`, (res) => {
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.headers['content-type'], 'application/json; charset=utf-8');
        assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
        assert.strictEqual(res.headers['x-frame-options'], 'SAMEORIGIN');

        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            assert.strictEqual(json.status, 'UP');
            assert.strictEqual(json.name, 'ScolaPro');
            assert.strictEqual(json.version, '2.5.0');
            assert.strictEqual(json.database.status, 'connected');
            assert.ok(typeof json.uptimeSeconds === 'number');
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', reject);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
