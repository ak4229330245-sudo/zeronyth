# ZERONYTH AI Lab v0.1

## Scope and isolation

This is a browser-run experiment served by the ZERONYTH dashboard. The coordinator is process-local and stores worker sessions, evaluation results and model-adoption choices only in memory. It does not call the Besu JSON-RPC, Chain ID 9127, wallet, validator keys, tokens, or swap contracts. Restarting the dashboard clears the AI lab state.

The lab offers two separate activities:

1. **Public language-model evaluation and inference.** A user explicitly selects a pinned public model, checks its download consent and starts the download. Inference runs in that browser. Evaluation tasks contain only the fixed public prompt set; there is no free-form prompt field. A worker result includes the model ID, immutable revision, output, and self-reported inference duration.
2. **Toy federated training.** Two opted-in browser sessions each compute a gradient over a fixed public feature batch for a small three-feature logistic classifier. The coordinator averages the two gradients and checks the result against a fixed held-out set. This is not LLM fine-tuning or a production model training system.

The experiment makes no claim of Besu QBFT compatibility, post-quantum security, real-world model quality, or training-worker identity.

## Pinned public language models

The public Hugging Face model metadata reports Apache-2.0 for both candidates. Revisions are pinned so model configuration, tokenizer and weights cannot silently follow a moving branch.

| Candidate | Repository | Pinned revision | CPU q4 weight file | WebGPU q4f16 weight file |
| --- | --- | --- | ---: | ---: |
| SmolLM2 135M Instruct | [HuggingFaceTB/SmolLM2-135M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct) | `12fd25f77366fa6b3b4b768ec3050bf629380bac` | 182,068,553 bytes | 117,691,126 bytes |
| SmolLM2 360M Instruct | [HuggingFaceTB/SmolLM2-360M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct) | `a10cc1512eabd3dde888204e902eca88bddb4951` | 387,943,246 bytes | 272,737,275 bytes |

Sizes are the HTTP `Content-Length` values for the pinned ONNX weight files; tokenizer, configuration and runtime files add downloads. The model files are not stored in this repository. The browser loads `@huggingface/transformers` 3.7.2 from jsDelivr and uses the browser cache only after the user presses a model download button with its consent checkbox selected. WebGPU uses q4f16 when available; a failed WebGPU initialization retries with CPU/WASM q4.

## Evaluation rules and limitations

- Dataset ID: `zeronyth-public-eval-v1`; eight fixed prompts.
- Both models are evaluated on the same prompts. A completed comparison requires two distinct worker session IDs per model and prompt.
- Scoring checks for fixed answer terms. It is reproducible but shallow, and can be fooled; it is not a semantic evaluator or human review.
- Candidate language-model adoption requires a complete comparison and a score strictly higher than the active baseline, followed by an explicit user confirmation.
- Inference durations are measured in the browser and reported by that worker. They are untrusted, hardware-dependent measurements, not benchmark attestations.
- Session IDs do not prove separate people or machines. There is no Sybil resistance, remote attestation, signed worker result, reputation, reward, or payment.

## Toy federated-training rules

- Each round has two worker shards drawn from the fixed public training examples. The browser computes the bounded three-value logistic-regression gradient locally.
- The coordinator validates job leases, sample count, gradient shape and range, averages gradients, and evaluates the resulting weights on a separate fixed holdout set.
- Classifier adoption requires a strictly improved held-out score and explicit confirmation.
- There is no secure aggregation, differential privacy, private-user-data support, durable checkpoint, GPU requirement, or LLM weight update.

## API and safeguards

The same-origin gateway exposes `GET /ai-lab/status`, `POST /ai-lab/evaluation/start`, `POST /ai-lab/training/start`, `POST /ai-lab/worker/join`, `GET /ai-lab/worker/next`, `POST /ai-lab/worker/result`, `POST /ai-lab/worker/gradient`, `POST /ai-lab/worker/leave`, and `POST /ai-lab/models/adopt`. This unique prefix avoids the separate API artifact's `/api` route.

Worker requests use short-lived random bearer tokens held only in page memory. Participation requires an explicit role and consent. The gateway restricts request size, applies per-route rate limits, checks same-origin requests, rejects unknown routes, and sends no worker task to the Besu RPC. The AI page alone receives the CSP allowances needed for the pinned browser runtime and model hosts.

## Reproduction

From the repository root:

```sh
node --test services/zeronyth-l1/pq-native/ai-worker-coordinator.test.mjs \
  services/zeronyth-l1/scripts/replit-gateway-ai.test.mjs
pnpm --filter @workspace/zeronyth run build
```

For a browser evaluation, open **AI Lab**, select both models, check each model's download consent, and download them. Then start the fixed-set comparison. To contribute, check the relevant evaluation or training consent and join from the browser. A training round needs two distinct active training sessions. The inference path itself must be verified on the target browser; automated coordinator tests use controlled outputs and do not download the large model files.

## Current verification boundary and next steps

Automated tests cover coordinator validation, pinned revisions, worker consent, duplicate and expired jobs, two-worker completion, adoption gates, toy-gradient averaging, same-origin routes and the memory-only chain separation. Public model metadata and pinned weight-file availability/sizes were checked over HTTPS. The actual browser download, WebGPU/WASM inference, cross-browser output reproducibility, memory pressure and two-device worker run remain unverified until exercised in a browser with the model files.

Before considering broader participation: run a controlled browser/device benchmark; independently review the evaluation set and scoring; add robust worker identity and adversarial-result handling; and design privacy-preserving aggregation before accepting non-public data. Persisted adoption or model artifacts require a separate backup/retention and recovery design.
