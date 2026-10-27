#!/usr/bin/env python3
"""ZERONYTH nightly LoRA fine-tune (CPU, bf16) for a small open model (default Qwen2.5-0.5B-Instruct).
Trains a LoRA adapter on finetune/prepare.mjs output, merges it and saves a HF safetensors dir that
`ollama create --quantize q4_K_M` turns into a candidate model. Self-limits because the box has no cgroups:
  - torch threads (default 2), caller runs it under nice 19 / ionice idle / timeout
  - a watchdog aborts (exit 3) if MemAvailable drops below --mem-floor-mb or our RSS exceeds --rss-max-mb
  - --max-steps and --max-minutes caps
Writes <out>/train-report.json. Designed to run unchanged (with more steps / a bigger model) on GPU nodes later."""
import argparse, json, os, random, sys, threading, time

def meminfo():
    m = {}
    with open('/proc/meminfo') as f:
        for l in f:
            k, v = l.split(':', 1); m[k] = int(v.split()[0]) // 1024
    return m['MemAvailable']

def rss_mb():
    with open('/proc/self/status') as f:
        for l in f:
            if l.startswith('VmRSS:'): return int(l.split()[1]) // 1024
    return 0

ap = argparse.ArgumentParser()
ap.add_argument('--base', required=True); ap.add_argument('--data', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--max-steps', type=int, default=60); ap.add_argument('--max-minutes', type=float, default=25)
ap.add_argument('--threads', type=int, default=2); ap.add_argument('--max-len', type=int, default=384)
ap.add_argument('--lr', type=float, default=2e-4); ap.add_argument('--rank', type=int, default=8); ap.add_argument('--accum', type=int, default=4)
ap.add_argument('--mem-floor-mb', type=int, default=1200); ap.add_argument('--rss-max-mb', type=int, default=3000)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
report = {'base': a.base, 'started': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'status': 'running', 'peak_rss_mb': 0, 'min_mem_avail_mb': meminfo()}
abort = {'why': None}
def watchdog():
    while True:
        r, av = rss_mb(), meminfo()
        report['peak_rss_mb'] = max(report['peak_rss_mb'], r); report['min_mem_avail_mb'] = min(report['min_mem_avail_mb'], av)
        if av < a.mem_floor_mb: abort['why'] = f'MemAvailable {av} MB < {a.mem_floor_mb} MB'
        if r > a.rss_max_mb: abort['why'] = f'RSS {r} MB > {a.rss_max_mb} MB'
        if abort['why']:
            report.update(status='aborted', reason=abort['why']); json.dump(report, open(os.path.join(a.out, 'train-report.json'), 'w'), indent=1)
            print('watchdog abort:', abort['why'], flush=True); os._exit(3)
        time.sleep(1)
threading.Thread(target=watchdog, daemon=True).start()

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import LoraConfig, get_peft_model
torch.set_num_threads(a.threads); torch.manual_seed(7); random.seed(7)
tok = AutoTokenizer.from_pretrained(a.base)
model = AutoModelForCausalLM.from_pretrained(a.base, dtype=torch.bfloat16, low_cpu_mem_usage=True)
model.config.use_cache = False
model = get_peft_model(model, LoraConfig(r=a.rank, lora_alpha=2 * a.rank, lora_dropout=0.05, target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj'], task_type='CAUSAL_LM'))
trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
rows = [json.loads(l) for l in open(a.data) if l.strip()]
def encode(r):
    full = tok.apply_chat_template(r['messages'], tokenize=False)
    prompt = tok.apply_chat_template(r['messages'][:-1], tokenize=False, add_generation_prompt=True)
    ids = tok(full, add_special_tokens=False)['input_ids'][: a.max_len]; n = len(tok(prompt, add_special_tokens=False)['input_ids'])
    labels = [-100] * min(n, len(ids)) + ids[n:]
    return torch.tensor([ids]), torch.tensor([labels])
data = [encode(r) for r in rows]
data = [d for d in data if (d[1] != -100).any()]
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=a.lr)
model.train(); t0 = time.time(); losses = []; step = 0
order = []
while step < a.max_steps and (time.time() - t0) / 60 < a.max_minutes:
    if not order: order = list(range(len(data))); random.shuffle(order)
    acc = 0.0
    for _ in range(a.accum):
        if not order: order = list(range(len(data))); random.shuffle(order)
        ids, labels = data[order.pop()]
        loss = model(input_ids=ids, labels=labels).loss / a.accum; loss.backward(); acc += loss.item()
    opt.step(); opt.zero_grad(); step += 1; losses.append(round(acc, 4))
    if step == 1 or step % 5 == 0: print(f'step {step} loss {acc:.4f} {time.time() - t0:.0f}s rss {rss_mb()}MB avail {meminfo()}MB', flush=True)
train_s = time.time() - t0
model = model.merge_and_unload(); model.eval()
merged = os.path.join(a.out, 'merged'); model.save_pretrained(merged, safe_serialization=True); tok.save_pretrained(merged)
report.update(status='ok', steps=step, examples=len(data), trainable_params=trainable, loss_first=losses[0] if losses else None,
              loss_last=sum(losses[-5:]) / max(1, len(losses[-5:])), train_seconds=round(train_s), threads=a.threads, rank=a.rank, merged=merged,
              finished=time.strftime('%Y-%m-%dT%H:%M:%S%z'))
json.dump(report, open(os.path.join(a.out, 'train-report.json'), 'w'), indent=1)
print(json.dumps(report), flush=True)
