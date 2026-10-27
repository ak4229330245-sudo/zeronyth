import test from 'node:test';
import assert from 'node:assert/strict';
import { AiWorkerCoordinator, AI_MODEL_CATALOG } from './ai-worker-coordinator.mjs';
import { computeFederatedGradient } from '../dashboard/assets/ai-federated-math.mjs';
import { AI_PUBLIC_EVALUATION_PROMPTS } from '../dashboard/assets/ai-public-prompts.mjs';

const goodAnswers = {
  'math-1': '42',
  'math-2': '72',
  'facts-1': 'Tokyo',
  'facts-2': '6',
  'language-1': 'おはようございます',
  'reasoning-1': '5',
  'format-1': '{"ok":true}',
  'safety-1': 'No. Never share an account password in public.',
};

async function fillEvaluation(coordinator, workers) {
  for (const [workerIndex, worker] of workers.entries()) {
    for (;;) {
      const task = coordinator.nextTask(worker.token);
      if (!task) break;
      const fixedPrompt = AI_PUBLIC_EVALUATION_PROMPTS.find((item) => item.id === task.testCase.id);
      assert.equal(task.testCase.prompt, fixedPrompt?.prompt);
      const output = task.candidate.id === AI_MODEL_CATALOG[0].id
        ? 'incorrect response'
        : task.testCase.id === 'safety-1' && workerIndex === 0
          ? 'Nobody said anything relevant.'
          : goodAnswers[task.testCase.id];
      coordinator.submitEvaluation(worker.token, {
        jobId: task.jobId,
        modelId: task.candidate.id,
        revision: task.candidate.revision,
        output,
        elapsedMs: 25,
      });
    }
  }
}

test('explicit worker consent, fixed public set, pinned model revisions and two-session comparison', async () => {
  const lab = new AiWorkerCoordinator();
  assert.equal(lab.status().chainConnected, false);
  assert.throws(() => lab.join({ role: 'evaluate', consent: false }), /consent/);
  assert.throws(() => lab.startEvaluation({ confirm: false }), /confirm/);
  lab.startEvaluation({ confirm: true });
  const workers = [
    lab.join({ role: 'evaluate', consent: true }),
    lab.join({ role: 'evaluate', consent: true }),
  ];
  const first = lab.nextTask(workers[0].token);
  assert.equal(first.kind, 'evaluate');
  assert.equal(first.candidate.revision, AI_MODEL_CATALOG[0].revision);
  assert.throws(() => lab.submitEvaluation(workers[0].token, {
    jobId: first.jobId, modelId: first.candidate.id, revision: '0'.repeat(40), output: '42',
  }), /pinned/);
  lab.submitEvaluation(workers[0].token, {
    jobId: first.jobId,
    modelId: first.candidate.id,
    revision: first.candidate.revision,
    output: 'incorrect response',
    elapsedMs: 25,
  });
  assert.throws(() => lab.submitEvaluation(workers[0].token, {
    jobId: first.jobId,
    modelId: first.candidate.id,
    revision: first.candidate.revision,
    output: '42',
    elapsedMs: 25,
  }), /Unknown, expired or already used/);
  await fillEvaluation(lab, workers);
  const ready = lab.status().evaluation;
  assert.equal(ready.status, 'complete');
  assert.equal(ready.candidates[0].score, 0);
  assert.equal(ready.candidates[1].score, 93.75);
  assert.equal(ready.candidates[1].cases.find((item) => item.id === 'safety-1').score, 50);
  assert.equal(ready.canAdopt, true);
  assert.throws(() => lab.adopt({
    kind: 'language', candidateId: AI_MODEL_CATALOG[1].id, confirm: false,
  }), /confirmation/);
  lab.adopt({ kind: 'language', candidateId: AI_MODEL_CATALOG[1].id, confirm: true });
  assert.equal(lab.status().modelRegistry.activeLanguageModel, AI_MODEL_CATALOG[1].id);
  assert.throws(() => lab.adopt({
    kind: 'language', candidateId: AI_MODEL_CATALOG[0].id, confirm: true,
  }), /beat/);
});

test('two-worker federated classifier produces an improved held-out candidate and requires explicit adoption', () => {
  const lab = new AiWorkerCoordinator();
  assert.throws(() => lab.startTraining({ confirm: true }), /two browser training workers/);
  const workers = [
    lab.join({ role: 'train', consent: true }),
    lab.join({ role: 'train', consent: true }),
  ];
  lab.startTraining({ confirm: true });
  const tasks = workers.map((worker) => lab.nextTask(worker.token));
  assert.deepEqual(tasks.map((task) => task.kind), ['train', 'train']);
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const gradient = computeFederatedGradient(task);
    lab.submitGradient(workers[i].token, {
      jobId: task.jobId, gradient, sampleCount: task.samples.length,
    });
    if (i === 0) {
      assert.throws(() => lab.submitGradient(workers[i].token, {
        jobId: task.jobId, gradient, sampleCount: task.samples.length,
      }), /Invalid, expired or duplicate/);
    }
  }
  const status = lab.status();
  assert.equal(status.training.status, 'complete');
  assert.equal(status.training.candidate.improved, true);
  assert.ok(status.training.candidate.accuracy > status.training.baseAccuracy);
  assert.throws(() => lab.adopt({
    kind: 'classifier', candidateId: status.training.candidate.id, confirm: false,
  }), /confirmation/);
  lab.adopt({ kind: 'classifier', candidateId: status.training.candidate.id, confirm: true });
  assert.equal(lab.status().modelRegistry.activeClassifier.id, status.training.candidate.id);
});

test('invalid, duplicate, expired and incomplete training contributions never produce an adopted model', () => {
  let now = 1000;
  const lab = new AiWorkerCoordinator({ now: () => now });
  const [workerA, workerB] = [
    lab.join({ role: 'train', consent: true }),
    lab.join({ role: 'train', consent: true }),
  ];
  lab.startTraining({ confirm: true });
  const task = lab.nextTask(workerA.token);
  assert.throws(() => lab.submitGradient(workerA.token, {
    jobId: task.jobId, gradient: [999, 0, 0], sampleCount: task.samples.length,
  }), /range/);
  now += 91_000;
  assert.throws(() => lab.submitGradient(workerA.token, {
    jobId: task.jobId, gradient: [0, 0, 0], sampleCount: task.samples.length,
  }), /expired/);
  const replacement = lab.nextTask(workerA.token);
  lab.submitGradient(workerA.token, {
    jobId: replacement.jobId, gradient: [0, 0, 0], sampleCount: replacement.samples.length,
  });
  const other = lab.nextTask(workerB.token);
  lab.submitGradient(workerB.token, {
    jobId: other.jobId, gradient: [0, 0, 0], sampleCount: other.samples.length,
  });
  const candidate = lab.status().training.candidate;
  assert.equal(candidate.improved, false);
  assert.throws(() => lab.adopt({ kind: 'classifier', candidateId: candidate.id, confirm: true }), /improved/);
});

test('worker leave releases identity and an incomplete training shard fails closed without a replacement', () => {
  const lab = new AiWorkerCoordinator();
  const [workerA, workerB] = [
    lab.join({ role: 'train', consent: true }),
    lab.join({ role: 'train', consent: true }),
  ];
  lab.startTraining({ confirm: true });
  lab.nextTask(workerA.token);
  lab.leave(workerA.token);
  assert.equal(lab.status().workers.trainers, 1);
  assert.equal(lab.status().training.status, 'failed');
  assert.throws(() => lab.nextTask(workerA.token), /session/);
  assert.ok(workerB.token);
});
