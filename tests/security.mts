import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ALLOWED = 'https://courtage.modulr.fr';
(globalThis as any).Netlify = {
  env: { get: (key: string) => key === 'AIRCALL_API_ID' ? 'test-id' : key === 'AIRCALL_API_TOKEN' ? 'test-token' : '' }
};

let upstreamCalls = 0;
(globalThis as any).fetch = async (input: any) => {
  upstreamCalls++;
  const url = String(input);
  if (url.includes('/calls?')) return new Response(JSON.stringify({ calls: [], meta: {} }), { status: 200 });
  if (url.includes('/calls/')) return new Response(JSON.stringify({ call: { id: 123, direction: 'outbound', raw_digits: '33600000000', user: { id: 1, name: 'Ghais Kalah' }, tags: [] } }), { status: 200 });
  return new Response(JSON.stringify({}), { status: 200 });
};

const { default: handler, config } = await import('../netlify/functions/aircall.mts');

function request(path: string, method = 'GET', origin?: string) {
  const headers = new Headers();
  if (origin !== undefined) headers.set('Origin', origin);
  return new Request(`https://aircallmodulr.netlify.app${path}`, { method, headers });
}

const context = (id?: string) => ({ params: id ? { id } : {} }) as any;

let before = upstreamCalls;
let res = await handler(request('/api/calls?phones=0612345678&hours=48', 'GET', ALLOWED), context());
assert.equal(res.status, 200, 'D: valid Origin must be allowed');
assert.equal(res.headers.get('Access-Control-Allow-Origin'), ALLOWED, 'CORS must be strict');
assert.ok(upstreamCalls > before, 'valid request must reach Aircall proxy');

before = upstreamCalls;
res = await handler(request('/api/calls?phones=0612345678&hours=48', 'GET', 'https://evil.example'), context());
assert.equal(res.status, 403, 'E: foreign Origin must be 403');
assert.equal(upstreamCalls, before, 'foreign Origin must be rejected before Aircall');

before = upstreamCalls;
res = await handler(request('/api/calls?phones=0612345678&hours=48'), context());
assert.equal(res.status, 403, 'F: missing Origin must be 403');
assert.equal(upstreamCalls, before, 'missing Origin must be rejected before Aircall');

before = upstreamCalls;
res = await handler(request('/api/calls?phones=0612345678&hours=48', 'POST', ALLOWED), context());
assert.equal(res.status, 405, 'G: unsupported method must be 405');
assert.equal(upstreamCalls, before, 'unsupported method must not call Aircall');

for (const path of [
  '/api/calls?phones=abc&hours=48',
  '/api/calls?phones=0612345678&hours=0',
  '/api/calls?phones=0612345678&hours=169',
  '/api/calls?phones=0612345678&hours=1.5',
]) {
  before = upstreamCalls;
  res = await handler(request(path, 'GET', ALLOWED), context());
  assert.equal(res.status, 400, `H: invalid parameters must be 400: ${path}`);
  assert.equal(upstreamCalls, before, 'invalid parameters must not call Aircall');
}

before = upstreamCalls;
res = await handler(request('/api/calls/bad-id', 'GET', ALLOWED), context('bad-id'));
assert.equal(res.status, 400, 'invalid call id must be 400');
assert.equal(upstreamCalls, before, 'invalid call id must not call Aircall');

res = await handler(request('/api/calls', 'OPTIONS', ALLOWED), context());
assert.equal(res.status, 204, 'valid preflight must be 204');
assert.equal(res.headers.get('Access-Control-Allow-Origin'), ALLOWED);
assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');

assert.equal(config?.rateLimit?.windowLimit, 20, 'import rate limit must be 20/min');
assert.equal(config?.rateLimit?.windowSize, 60);

const userscript = await readFile(new URL('../modulr-aircall-import.user.js', import.meta.url), 'utf8');
assert.match(userscript, /call\.direction === 'inbound' \? '49' : '50'/, 'incoming/outgoing ModulR types must be 49/50');
assert.match(userscript, /'task\[name\]'\s*:\s*''/, 'native expandable event must keep task[name] empty');
assert.match(userscript, /Collaborateur concerné/, 'collaborator selector must exist');
assert.doesNotMatch(userscript, /AIRCALL_API_TOKEN|AIRCALL_API_ID|Authorization\s*:\s*['"`]Basic/i, 'userscript must not contain Aircall secrets/auth');

const functionSource = await readFile(new URL('../netlify/functions/aircall.mts', import.meta.url), 'utf8');
assert.doesNotMatch(functionSource, /console\.log|console\.error/, 'proxy must not log personal data/secrets');
assert.match(functionSource, /Netlify\.env\.get\("AIRCALL_API_ID"\)/);
assert.match(functionSource, /Netlify\.env\.get\("AIRCALL_API_TOKEN"\)/);

console.log('All security regression tests passed.');
