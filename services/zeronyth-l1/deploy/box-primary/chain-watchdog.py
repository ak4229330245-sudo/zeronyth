#!/usr/bin/env python3
"""ZERONYTH chain watchdog. VPS: pm2 zeronyth-v4-watchdog (solbot) -> restarts zeronyth-testnet (V2-V4).
Box: pm2 zeronyth-v1-watchdog -> restarts zeronyth-primary (V1, pm2 restart WITHOUT --update-env).

Restarts pm2 app `zeronyth-testnet` (the VPS validators) ONLY when a local validator is stuck:
  rule A: a local validator's height has not moved for > STALL_SEC while a reference node
          (box gateway via the ssh tunnel) is ahead of it            -> restart
  rule B: (only if LOCAL_QUORUM=1, i.e. the VPS holds >= 3 of 4 validators) ALL local
          validators frozen for > QUORUM_STALL_SEC, reference or not -> restart
  no reference reachable and rule B not met (e.g. box paused)          -> just wait
Rate limit: >= MIN_GAP_SEC between restarts, doubling backoff up to MAX_GAP_SEC, reset after
RESET_AFTER_SEC healthy. Grace GRACE_SEC after every restart. Every action is logged.
Never touches any other pm2 app; uses the default ~/.pm2 daemon only (not .pm2-hyperscalp).
"""
import json, os, subprocess, sys, time, urllib.request

def env(k, d): return os.environ.get(k, d)
LOCAL = [tuple(x.split("=", 1)) for x in env("LOCAL_RPCS", "node4=http://127.0.0.1:8545").split(",") if x]
REFS = [tuple(x.split("=", 1)) for x in env("REF_RPCS", "box=http://127.0.0.1:22781/rpc").split(",") if x]
APP = env("TARGET_APP", "zeronyth-testnet")
STALL = int(env("STALL_SEC", "120")); QSTALL = int(env("QUORUM_STALL_SEC", "180"))
LOCAL_QUORUM = env("LOCAL_QUORUM", "0") == "1"
MIN_GAP = int(env("MIN_GAP_SEC", "300")); MAX_GAP = int(env("MAX_GAP_SEC", "3600"))
RESET_AFTER = int(env("RESET_AFTER_SEC", "1800")); GRACE = int(env("GRACE_SEC", "90"))
POLL = int(env("POLL_SEC", "10")); AHEAD = int(env("AHEAD_BLOCKS", "3"))
DRY = env("DRY_RUN", "0") == "1"
LOGF = os.path.expanduser(env("ACTION_LOG", "~/zeronyth-ops/logs/watchdog-actions.jsonl"))
os.makedirs(os.path.dirname(LOGF), exist_ok=True)

def now_s(): return time.strftime("%Y-%m-%d %H:%M:%S JST", time.localtime())
def log(event, **kw):
    rec = {"t": now_s(), "event": event, **kw}
    print(json.dumps(rec, ensure_ascii=False), flush=True)
    if event not in ("tick",):
        with open(LOGF, "a") as f: f.write(json.dumps(rec, ensure_ascii=False) + "\n")

def height(url):
    try:
        req = urllib.request.Request(url, data=b'{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}',
                                     headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=4) as r:
            return int(json.load(r)["result"], 16)
    except Exception:
        return None

def restart(reason, detail):
    log("restart", app=APP, reason=reason, dry_run=DRY, **detail)
    if DRY: return True
    e = {"PATH": env("PM2_PATH", "/usr/local/bin:/usr/bin:/bin"), "HOME": os.path.expanduser("~"),
         "PM2_HOME": env("PM2_HOME", os.path.expanduser("~/.pm2"))}
    p = subprocess.run([env("PM2_BIN", "pm2"), "restart", APP], env=e, capture_output=True, text=True, timeout=120)
    log("restart-result", app=APP, rc=p.returncode, out=p.stdout[-300:].strip(), err=p.stderr[-300:].strip())
    return p.returncode == 0

last = {n: (None, time.time()) for n, _ in LOCAL}   # name -> (height, time it last changed)
gap = MIN_GAP; last_restart = 0.0; grace_until = time.time() + GRACE; healthy_since = time.time(); last_state = None
log("start", local=[n for n, _ in LOCAL], refs=[n for n, _ in REFS], stall=STALL, local_quorum=LOCAL_QUORUM, min_gap=MIN_GAP, dry_run=DRY)
prev_t = time.time()
while True:
    t = time.time()
    if t - prev_t > 3 * POLL + 20:   # this host was paused/suspended (box VM): give nodes time to catch up first
        log("time-jump", gap_s=int(t - prev_t)); last = {n: (None, t) for n, _ in LOCAL}; grace_until = t + GRACE
    prev_t = t
    hs = {n: height(u) for n, u in LOCAL}
    refs = {n: height(u) for n, u in REFS}
    for n, h in hs.items():
        ph, pt = last[n]
        if h is not None and h != ph: last[n] = (h, t)
    ref = max([h for h in refs.values() if h is not None], default=None)
    stuck = {n: int(t - last[n][1]) for n in hs if t - last[n][1] > STALL}
    reason = None
    if ref is not None:
        behind = {n: s for n, s in stuck.items() if hs[n] is None or ref - hs[n] >= AHEAD}
        if behind: reason = ("A: local stalled while reference ahead", {"stalled_s": behind})
    if reason is None and LOCAL_QUORUM and all(t - last[n][1] > QSTALL for n in hs):
        reason = ("B: all local validators frozen (VPS holds quorum)", {"stalled_s": {n: int(t - last[n][1]) for n in hs}})
    state = "stalled" if stuck else "ok"
    if state != last_state:
        log("state", state=state, heights=hs, refs=refs); last_state = state
    if not stuck and t - healthy_since > RESET_AFTER and gap != MIN_GAP:
        log("backoff-reset", gap=MIN_GAP); gap = MIN_GAP
    if stuck: healthy_since = t
    if reason and t >= grace_until:
        if t - last_restart < gap:
            log("restart-deferred", reason=reason[0], wait_s=int(gap - (t - last_restart)))
            grace_until = t + 60
        else:
            restart(reason[0], {**reason[1], "heights": hs, "refs": refs, "gap_s": gap})
            last_restart = t; gap = min(gap * 2, MAX_GAP); grace_until = t + GRACE
            last = {n: (None, time.time()) for n, _ in LOCAL}
    elif stuck and ref is None and not LOCAL_QUORUM and t >= grace_until:
        log("waiting", note="local stalled but no reference reachable (box paused?)", stalled_s=stuck); grace_until = t + 60
    time.sleep(POLL)
