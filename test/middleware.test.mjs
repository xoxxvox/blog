import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/_middleware.js';

test('CORS preserves private-resource Vary and authentication headers', async () => {
  const response = await onRequest({
    env: {ADMIN_ORIGIN:'https://admin.example.test'},
    request: new Request('https://blog.example.test/api/private-bio', {headers:{Origin:'https://admin.example.test'}}),
    next: async () => new Response('{}', {headers:{Vary:'Cookie', 'Cache-Control':'private, no-store', 'Set-Cookie':'test=1; Secure'}}),
  });
  assert.equal(response.headers.get('Vary'), 'Cookie, Origin');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Set-Cookie'), 'test=1; Secure');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://admin.example.test');
});

test('CORS rejects foreign origins and allows the admin session preflight', async () => {
  const preflight = origin => onRequest({env:{ADMIN_ORIGIN:'https://admin.example.test'}, request:new Request('https://blog.example.test/api/auth', {method:'OPTIONS',headers:{Origin:origin}})});
  assert.equal((await preflight('https://foreign.example.test')).status,403);
  const response = await preflight('https://admin.example.test');
  assert.equal(response.status,204);
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /X-Admin-Session/);
});
