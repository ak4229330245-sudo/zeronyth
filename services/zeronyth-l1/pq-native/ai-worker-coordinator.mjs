import { createHash, randomBytes } from 'node:crypto';
import { sentimentFeatures } from '../dashboard/assets/ai-federated-math.mjs';
import { AI_PUBLIC_EVALUATION_PROMPTS } from '../dashboard/assets/ai-public-prompts.mjs';

export const AI_MODEL_CATALOG = Object.freeze([
  {
    id: 'smollm2-135m',
    repo: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    revision: '12fd25f77366fa6b3b4b768ec3050bf629380bac',
    label: 'SmolLM2 135M Instruct',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct',
    baseline: true,
  },
  {
    id: 'smollm2-360m',
    repo: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    revision: 'a10cc1512eabd3dde888204e902eca88bddb4951',
    label: 'SmolLM2 360M Instruct',
    license: 'Apache-2.0',
    url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct',
    baseline: false,
  },
]);

const EVALUATION_SET = Object.freeze([
  { ...AI_PUBLIC_EVALUATION_PROMPTS[0], accepted: ['42'] },
  { ...AI_PUBLIC_EVALUATION_PROMPTS[1], accepted: ['72'] },
  { ...AI_PUBLIC_EVALUATION_PROMPTS[2], accepted: ['tokyo'] },
  { ...AI_PUBLIC_EVALUATION_PROMPTS[3], accepted: ['6'] },
  { ...AI_PUBLIC_EVALUATION_PROMPTS[4], accepted: ['おはよう'] },
  { ...AI_PUBLIC_EVALUATION_PROMPTS[5], accepted: ['5'] },
  { ...AI_PUBLIC_EVALUATION_PROMPTS[6], accepted: ['{"ok":true}'] },
  { ...AI_PUBLIC_EVALUATION_PROMPTS[7], accepted: ['no', 'should not', 'never share'] },
]);

const TRAINING_SAMPLES = Object.freeze([
  { text: 'This is wonderful and very helpful.', label: 1 },
  { text: 'I love this excellent result.', label: 1 },
  { text: 'A great, friendly experience.', label: 1 },
  { text: 'The service is good and useful.', label: 1 },
  { text: 'That was fantastic, thanks!', label: 1 },
  { text: 'I am happy with this product.', label: 1 },
  { text: 'This is awful and not helpful.', label: 0 },
  { text: 'I hate this terrible result.', label: 0 },
  { text: 'A bad, unfriendly experience.', label: 0 },
  { text: 'The service is poor and useless.', label: 0 },
  { text: 'That was horrible and frustrating.', label: 0 },
  { text: 'I am unhappy with this product.', label: 0 },
]);
const HOLDOUT = Object.freeze([
  { text: 'A useful and excellent tool.', label: 1 },
  { text: 'A wonderful, good experience.', label: 1 },
  { text: 'A frustrating and bad tool.', label: 0 },
  { text: 'A poor and awful experience.', label: 0 },
  { text: 'I am happy and love the result.', label: 1 },
  { text: 'I hate this useless product.', label: 0 },
]);

const FEATURE_DIM = 3;
const MAX_WORKERS = 32;
const WORKER_TTL_MS = 30 * 60_000;
const TASK_LEASE_MS = 90_000;
const MIN_INDEPENDENT_WORKERS = 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const fingerprint = (text) => createHash('sha256').update(text).digest('hex');

function predict(weights, features) {
  const z = weights.reduce((sum, weight, index) => sum + weight * features[index], 0);
  return 1 / (1 + Math.exp(-clamp(z, -30, 30)));
}

function accuracy(weights, rows) {
  if (!rows.length) return 0;
  const correct = rows.reduce((sum, row) =>
    sum + (Number(predict(weights, sentimentFeatures(row.text)) >= 0.5) === row.label ? 1 : 0), 0);
  return Math.round(correct * 10_000 / rows.length) / 100;
}

function safeText(value, limit = 2048) {
  if (typeof value !== 'string' || value.length < 1 || value.length > limit) {
    throw new Error('Invalid worker text');
  }
  return value;
}

export class AiWorkerCoordinator {
  #workers = new Map();
  #tokens = new Map();
  #evaluation = null;
  #training = null;
  #activeLanguageModel = AI_MODEL_CATALOG[0].id;
  #activeClassifier = { id: 'tiny-sentiment-v1', weights: [0, 0, 0], accuracy: accuracy([0, 0, 0], HOLDOUT) };
  #now;

  constructor({ now = () => Date.now() } = {}) {
    if (typeof now !== 'function') throw new Error('Invalid coordinator clock');
    this.#now = now;
  }

  #expire() {
    const now = this.#now();
    for (const [id, worker] of this.#workers) {
      if (now - worker.lastSeen > WORKER_TTL_MS) {
        this.#workers.delete(id);
        this.#tokens.delete(worker.token);
        const shard = this.#training?.status === 'running'
          ? this.#training.shards.find((item) => item.workerId === id && !item.gradient)
          : null;
        if (shard) {
          const replacement = [...this.#workers.values()].find((item) =>
            ['train', 'both'].includes(item.role) &&
            !this.#training.shards.some((other) => other.workerId === item.workerId));
          if (replacement) shard.workerId = replacement.workerId;
          else this.#training.status = 'failed';
        }
      }
    }
  }

  join({ role, consent }) {
    this.#expire();
    if (!['evaluate', 'train', 'both'].includes(role) || consent !== true) {
      throw new Error('Explicit evaluation or training consent is required');
    }
    if (this.#workers.size >= MAX_WORKERS) throw new Error('AI worker capacity is full');
    const workerId = randomBytes(16).toString('hex');
    const token = randomBytes(32).toString('base64url');
    const worker = { workerId, token, role, joinedAt: this.#now(), lastSeen: this.#now(), jobs: new Map() };
    this.#workers.set(workerId, worker);
    this.#tokens.set(token, workerId);
    return { workerId, token, role, expiresInSeconds: WORKER_TTL_MS / 1000 };
  }

  leave(token) {
    const worker = this.#worker(token);
    this.#workers.delete(worker.workerId);
    this.#tokens.delete(token);
    if (this.#training?.status === 'running') {
      const shard = this.#training.shards.find((item) => item.workerId === worker.workerId && !item.gradient);
      if (shard) {
        const replacement = [...this.#workers.values()].find((item) =>
          ['train', 'both'].includes(item.role) &&
          !this.#training.shards.some((other) => other.workerId === item.workerId));
        if (replacement) shard.workerId = replacement.workerId;
        else this.#training.status = 'failed';
      }
    }
    return { left: true, workerId: worker.workerId, state: this.status() };
  }

  #worker(token) {
    this.#expire();
    if (typeof token !== 'string' || !this.#tokens.has(token)) throw new Error('Valid AI worker session required');
    const worker = this.#workers.get(this.#tokens.get(token));
    if (!worker) throw new Error('AI worker session expired');
    worker.lastSeen = this.#now();
    return worker;
  }

  startEvaluation({ confirm }) {
    if (confirm !== true) throw new Error('Explicitly confirm the public evaluation run');
    if (this.#evaluation && !['idle', 'failed'].includes(this.#evaluation.status)) {
      throw new Error('An evaluation is already running or complete');
    }
    this.#evaluation = {
      id: randomBytes(12).toString('hex'),
      status: 'running',
      startedAt: this.#now(),
      minWorkers: MIN_INDEPENDENT_WORKERS,
      results: [],
      revisions: new Map(),
    };
    return this.status();
  }

  startTraining({ confirm }) {
    if (confirm !== true) throw new Error('Explicitly confirm the isolated training round');
    if (this.#training && !['idle', 'failed'].includes(this.#training.status)) {
      throw new Error('A training round is already running or complete');
    }
    this.#expire();
    const workers = [...this.#workers.values()].filter((worker) => ['train', 'both'].includes(worker.role));
    if (workers.length < 2) throw new Error('Join at least two browser training workers first');
    const initialWeights = [...this.#activeClassifier.weights];
    const samples = TRAINING_SAMPLES.map((row) => ({
      features: sentimentFeatures(row.text),
      label: row.label,
    }));
    const split = Math.ceil(samples.length / 2);
    const participants = workers.slice(0, 2);
    this.#training = {
      id: randomBytes(12).toString('hex'),
      status: 'running',
      startedAt: this.#now(),
      baseModelId: this.#activeClassifier.id,
      baseWeights: initialWeights,
      baseAccuracy: this.#activeClassifier.accuracy,
      learningRate: 0.8,
      shards: participants.map((worker, index) => ({
        workerId: worker.workerId,
        samples: samples.slice(index * split, (index + 1) * split),
        lease: null,
        gradient: null,
      })),
      candidate: null,
    };
    return this.status();
  }

  nextTask(token) {
    const worker = this.#worker(token);
    const now = this.#now();
    if (['evaluate', 'both'].includes(worker.role) && this.#evaluation?.status === 'running') {
      for (const candidate of AI_MODEL_CATALOG) {
        for (const testCase of EVALUATION_SET) {
          const key = `${candidate.id}:${testCase.id}`;
          const submitted = this.#evaluation.results.some((result) =>
            result.key === key && result.workerId === worker.workerId);
          const currentLease = worker.jobs.get(key);
          if (submitted || (currentLease && currentLease.until > now)) continue;
          const jobId = randomBytes(16).toString('hex');
          worker.jobs.set(key, { jobId, until: now + TASK_LEASE_MS, kind: 'evaluate' });
          return {
            kind: 'evaluate',
            jobId,
            evaluationId: this.#evaluation.id,
            candidate,
            testCase: { id: testCase.id, prompt: testCase.prompt },
            leaseSeconds: TASK_LEASE_MS / 1000,
          };
        }
      }
    }
    if (['train', 'both'].includes(worker.role) && this.#training?.status === 'running') {
      const shard = this.#training.shards.find((item) => item.workerId === worker.workerId && !item.gradient);
      if (shard) {
        const currentLease = shard.lease;
        if (!currentLease || currentLease.until <= now) {
          const jobId = randomBytes(16).toString('hex');
          shard.lease = { jobId, until: now + TASK_LEASE_MS };
          return {
            kind: 'train',
            jobId,
            trainingId: this.#training.id,
            modelId: this.#training.baseModelId,
            weights: [...this.#training.baseWeights],
            learningRate: this.#training.learningRate,
            samples: structuredClone(shard.samples),
            leaseSeconds: TASK_LEASE_MS / 1000,
          };
        }
      }
    }
    return null;
  }

  submitEvaluation(token, body) {
    const worker = this.#worker(token);
    const { jobId, modelId, revision, output, elapsedMs } = body || {};
    const candidate = AI_MODEL_CATALOG.find((item) => item.id === modelId);
    if (!candidate || revision !== candidate.revision) throw new Error('Unknown model or model revision does not match the pinned candidate');
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 120_000) {
      throw new Error('Invalid inference duration');
    }
    const response = safeText(output);
    if (!this.#evaluation || this.#evaluation.status !== 'running') throw new Error('No active evaluation');
    const testCase = EVALUATION_SET.find((item) => worker.jobs.get(`${modelId}:${item.id}`)?.jobId === jobId);
    if (!testCase) throw new Error('Unknown, expired or already used evaluation job');
    const lease = worker.jobs.get(`${modelId}:${testCase.id}`);
    if (lease.until <= this.#now()) throw new Error('Evaluation task expired; request another task');
    const accepted = testCase.accepted.some((term) => {
      const normalizedTerm = term.toLocaleLowerCase();
      const normalizedResponse = response.toLocaleLowerCase();
      if (/^[a-z0-9]+$/i.test(term)) {
        const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(normalizedResponse);
      }
      return normalizedResponse.includes(normalizedTerm);
    });
    const revisionKey = this.#evaluation.revisions.get(modelId);
    if (revisionKey && revisionKey !== revision) throw new Error('Model revision changed during this evaluation');
    this.#evaluation.revisions.set(modelId, revision);
    const key = `${modelId}:${testCase.id}`;
    if (this.#evaluation.results.some((result) => result.key === key && result.workerId === worker.workerId)) {
      throw new Error('This worker already submitted this evaluation case');
    }
    this.#evaluation.results.push({
      key, workerId: worker.workerId, modelId, caseId: testCase.id, revision,
      score: accepted ? 100 : 0,
      output: response.slice(0, 600),
      outputHash: fingerprint(response),
      elapsedMs: Math.round(elapsedMs),
      submittedAt: this.#now(),
    });
    worker.jobs.delete(key);
    this.#refreshEvaluationStatus();
    return this.status().evaluation;
  }

  #evaluationSummary(modelId) {
    const total = EVALUATION_SET.length;
    const cases = EVALUATION_SET.map((testCase) => {
      const rows = this.#evaluation?.results.filter((result) =>
        result.modelId === modelId && result.caseId === testCase.id) || [];
      const unique = new Set(rows.map((row) => row.workerId));
      return {
        id: testCase.id,
        submissions: rows.length,
        workers: unique.size,
        score: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length) : null,
        averageDurationMs: rows.length
          ? Math.round(rows.reduce((sum, row) => sum + row.elapsedMs, 0) / rows.length) : null,
        complete: unique.size >= MIN_INDEPENDENT_WORKERS,
      };
    });
    const complete = cases.every((item) => item.complete);
    const score = complete
      ? Math.round(cases.reduce((sum, item) => sum + item.score, 0) / total * 100) / 100
      : null;
    const averageDurationMs = complete
      ? Math.round(this.#evaluation.results.filter((result) => result.modelId === modelId)
        .reduce((sum, result) => sum + result.elapsedMs, 0) /
        this.#evaluation.results.filter((result) => result.modelId === modelId).length)
      : null;
    return { modelId, score, averageDurationMs, cases, complete, revision: this.#evaluation?.revisions.get(modelId) || null };
  }

  #refreshEvaluationStatus() {
    if (!this.#evaluation) return;
    const summaries = AI_MODEL_CATALOG.map((item) => this.#evaluationSummary(item.id));
    if (summaries.every((item) => item.complete)) this.#evaluation.status = 'complete';
  }

  submitGradient(token, body) {
    const worker = this.#worker(token);
    const { jobId, gradient, sampleCount } = body || {};
    if (!this.#training || this.#training.status !== 'running') throw new Error('No active training round');
    const shard = this.#training.shards.find((item) => item.workerId === worker.workerId);
    if (!shard || !shard.lease || shard.lease.jobId !== jobId ||
        shard.lease.until <= this.#now() || shard.gradient) throw new Error('Invalid, expired or duplicate training job');
    if (!Array.isArray(gradient) || gradient.length !== FEATURE_DIM ||
        gradient.some((value) => !Number.isFinite(value) || Math.abs(value) > 2) ||
        sampleCount !== shard.samples.length) throw new Error('Gradient failed shape, range or sample-count checks');
    shard.gradient = gradient.map((value) => clamp(value, -2, 2));
    if (this.#training.shards.every((item) => item.gradient)) {
      const average = Array(FEATURE_DIM).fill(0);
      for (const item of this.#training.shards) {
        for (let i = 0; i < FEATURE_DIM; i++) average[i] += item.gradient[i] / this.#training.shards.length;
      }
      const weights = this.#training.baseWeights.map((weight, index) =>
        clamp(weight - this.#training.learningRate * average[index], -8, 8));
      const measuredAccuracy = accuracy(weights, HOLDOUT);
      const candidate = {
        id: `${this.#training.baseModelId}-round-${this.#training.id.slice(0, 8)}`,
        weights, accuracy: measuredAccuracy,
        improved: measuredAccuracy > this.#training.baseAccuracy,
      };
      this.#training.candidate = candidate;
      this.#training.status = 'complete';
    }
    return this.status().training;
  }

  adopt({ confirm, kind, candidateId }) {
    if (confirm !== true) throw new Error('Explicit model adoption confirmation required');
    if (kind === 'language') {
      if (!this.#evaluation || this.#evaluation.status !== 'complete') throw new Error('Complete the full two-worker evaluation first');
      const candidate = AI_MODEL_CATALOG.find((item) => item.id === candidateId);
      if (!candidate || candidateId === this.#activeLanguageModel) throw new Error('Invalid or already active language model');
      const current = this.#evaluationSummary(this.#activeLanguageModel);
      const proposed = this.#evaluationSummary(candidateId);
      if (!current.complete || !proposed.complete || proposed.score <= current.score) {
        throw new Error('A candidate that did not beat the active model cannot be adopted');
      }
      this.#activeLanguageModel = candidateId;
    } else if (kind === 'classifier') {
      const candidate = this.#training?.candidate;
      if (!candidate || candidate.id !== candidateId || !candidate.improved ||
          candidate.accuracy <= this.#activeClassifier.accuracy) {
        throw new Error('Only an improved held-out classifier candidate can be adopted');
      }
      this.#activeClassifier = candidate;
    } else throw new Error('Unknown model registry');
    return this.status();
  }

  status() {
    this.#expire();
    const workers = [...this.#workers.values()];
    const results = AI_MODEL_CATALOG.map((item) => this.#evaluationSummary(item.id));
    const baseline = results.find((item) => item.modelId === AI_MODEL_CATALOG[0].id);
    return {
      mode: 'isolated-browser-ai-lab',
      chainConnected: false,
      persistence: 'memory-only; restart clears workers and experiments',
      modelRegistry: {
        languageModels: AI_MODEL_CATALOG.map(({ id, repo, revision, label, license, url }) => ({ id, repo, revision, label, license, url })),
        activeLanguageModel: this.#activeLanguageModel,
        activeClassifier: { id: this.#activeClassifier.id, accuracy: this.#activeClassifier.accuracy },
      },
      evaluation: {
        status: this.#evaluation?.status || 'idle',
        id: this.#evaluation?.id || null,
        startedAt: this.#evaluation?.startedAt || null,
        minWorkers: MIN_INDEPENDENT_WORKERS,
        dataset: { id: 'zeronyth-public-eval-v1', public: true, caseCount: EVALUATION_SET.length },
        candidates: results,
        activeScore: baseline?.score ?? null,
        canAdopt: results.some((item) => item.complete && item.modelId !== this.#activeLanguageModel &&
          baseline?.complete && item.score > baseline.score),
      },
      training: {
        status: this.#training?.status || 'idle',
        id: this.#training?.id || null,
        baseModel: this.#training?.baseModelId || this.#activeClassifier.id,
        baseAccuracy: this.#training?.baseAccuracy ?? this.#activeClassifier.accuracy,
        candidate: this.#training?.candidate ? {
          id: this.#training.candidate.id,
          accuracy: this.#training.candidate.accuracy,
          improved: this.#training.candidate.improved,
          canAdopt: this.#training.candidate.improved &&
            this.#training.candidate.accuracy > this.#activeClassifier.accuracy,
        } : null,
        trainingData: 'fixed public toy sentiment dataset; no user data',
        algorithm: 'two-worker federated averaged gradients; untrusted client computation',
      },
      workers: {
        active: workers.length,
        evaluators: workers.filter((item) => ['evaluate', 'both'].includes(item.role)).length,
        trainers: workers.filter((item) => ['train', 'both'].includes(item.role)).length,
        sybilResistant: false,
      },
    };
  }
}
