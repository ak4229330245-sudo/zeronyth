import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from './replit-gateway.mjs';
import { AI_PUBLIC_EVALUATION_PROMPTS } from '../dashboard/assets/ai-public-prompts.mjs';

const dashboard = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dashboard');

test('AI routes are same-origin, consent-gated, and isolated from the Chain 9127 RPC', async (t) => {
  const server = createGateway(dashboard);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = async (route, options = {}) => {
    const response = await fetch(`${base}${route}`, options);
    return { response, body: await response.json() };
  };
  const get = async (route, headers = {}) => {
    const response = await fetch(`${base}${route}`, { headers });
    return { response, body: await response.json() };
  };
  const post = async (route, body, headers = {}) => json(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  const status = await get('/ai-lab/status');
  assert.equal(status.response.status, 200);
  assert.equal(status.body.chainConnected, false);
  assert.equal(status.body.modelRegistry.languageModels.length, 2);
  assert.equal(JSON.stringify(status.body).includes('token'), false);

  const aiPage = await fetch(`${base}/ai.html`);
  assert.equal(aiPage.status, 200);
  assert.match(aiPage.headers.get('content-security-policy'), /cdn\.jsdelivr\.net/);
  const promptAsset = await fetch(`${base}/assets/ai-public-prompts.mjs`);
  assert.equal(promptAsset.status, 200);
  assert.match(promptAsset.headers.get('content-type'), /javascript/);
  const promptSource = await promptAsset.text();
  for (const item of AI_PUBLIC_EVALUATION_PROMPTS) assert.ok(promptSource.includes(item.prompt));
  assert.match(await aiPage.text(), /id="publicPromptList"/);
  const mainPage = await fetch(`${base}/`);
  assert.equal(mainPage.status, 200);
  assert.doesNotMatch(mainPage.headers.get('content-security-policy'), /cdn\.jsdelivr\.net/);

  const crossOrigin = await post('/ai-lab/worker/join', { role: 'evaluate', consent: true }, {
    origin: 'https://attacker.invalid',
  });
  assert.equal(crossOrigin.response.status, 403);
  const noConsent = await post('/ai-lab/worker/join', { role: 'evaluate', consent: false });
  assert.equal(noConsent.response.status, 400);

  const joined = await post('/ai-lab/worker/join', { role: 'evaluate', consent: true });
  assert.equal(joined.response.status, 200);
  const { token, workerId } = joined.body;
  assert.match(token, /^[A-Za-z0-9_-]{32,128}$/);
  assert.ok(workerId);

  const started = await post('/ai-lab/evaluation/start', { confirm: true });
  assert.equal(started.response.status, 200);
  const next = await get('/ai-lab/worker/next', { authorization: `Bearer ${token}` });
  assert.equal(next.response.status, 200);
  assert.equal(next.body.task.kind, 'evaluate');
  const task = next.body.task;
  const badRevision = await post('/ai-lab/worker/result', {
    jobId: task.jobId, modelId: task.candidate.id, revision: '0'.repeat(40), output: 'test', elapsedMs: 1,
  }, { authorization: `Bearer ${token}` });
  assert.equal(badRevision.response.status, 400);
  const accepted = await post('/ai-lab/worker/result', {
    jobId: task.jobId,
    modelId: task.candidate.id,
    revision: task.candidate.revision,
    output: task.testCase.id === 'math-1' ? '42' : 'sample',
    elapsedMs: 15,
  }, { authorization: `Bearer ${token}` });
  assert.equal(accepted.response.status, 200);
  const left = await post('/ai-lab/worker/leave', {}, { authorization: `Bearer ${token}` });
  assert.equal(left.response.status, 200);
  const expired = await get('/ai-lab/worker/next', { authorization: `Bearer ${token}` });
  assert.equal(expired.response.status, 400);

  const unknown = await fetch(`${base}/ai-lab/unknown`);
  assert.equal(unknown.status, 404);
  const malformed = await post('/ai-lab/evaluation/start', { confirm: true }, { origin: 'null' });
  assert.equal(malformed.response.status, 403);
});
