const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApplication } = require('../index');

test('Produktionsläge kräver sessionshemlighet och använder säker proxy-cookie', async t => {
  const previousEnvironment = {
    nodeEnv: process.env.NODE_ENV,
    sessionSecret: process.env.SESSION_SECRET
  };
  process.env.NODE_ENV = 'production';
  delete process.env.SESSION_SECRET;
  assert.throws(
    () => createApplication({}),
    /SESSION_SECRET/
  );

  process.env.SESSION_SECRET = 'test-only-render-session-secret';
  t.after(() => {
    if (previousEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment.nodeEnv;
    if (previousEnvironment.sessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousEnvironment.sessionSecret;
  });

  const app = createApplication({
    pool: {
      async query(sql) {
        if (sql.includes('WHERE username = $1 OR email = $1')) {
          return { rows: [{ id: 1, username: 'Demo', email: 'demo@example.test', password: 'hash', status_message: '' }] };
        }
        throw new Error('Oväntad SQL i Render-testet');
      }
    },
    getDbStatus: () => 'connected',
    supabase: {},
    hashPassword: async value => value,
    comparePassword: async () => true
  });
  t.after(() => new Promise(resolve => app.io.close(resolve)));

  assert.equal(app.app.get('trust proxy'), 1);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');

  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-proto': 'https'
    },
    body: JSON.stringify({ identifier: 'Demo', password: 'demo' })
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /;\s*Secure/i);
  assert.match(response.headers.get('set-cookie'), /;\s*HttpOnly/i);
});
