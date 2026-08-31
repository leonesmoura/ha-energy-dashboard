import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, parseCookies, verifyPassword } from '../hariges_energy/lib/auth.js';

test('passwords use a salted hash', () => {
  const encoded = hashPassword('segredo-muito-forte');
  assert.equal(verifyPassword('segredo-muito-forte', encoded), true);
  assert.equal(verifyPassword('senha-errada', encoded), false);
  assert.equal(encoded.includes('segredo-muito-forte'), false);
});

test('cookies are parsed', () => assert.deepEqual(parseCookies('a=1; hariges_session=abc'), { a: '1', hariges_session: 'abc' }));
