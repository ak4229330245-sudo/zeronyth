#!/usr/bin/env python3
"""Keep the box clock in step with the NTP-synced VPS (validator 4's host).

Why: outbound NTP (UDP 123) is blocked on the box, so the box clock drifted
~1.3-1.4 s ahead of real time and validator 4 (on the VPS) kept missing its
QBFT proposal rounds. This loop measures the VPS-minus-box offset over one SSH
session (min-RTT samples) and corrects the box clock with a gentle adjtime()
slew (<= 0.05 %, never a backward step). Genesis, block period and round
timeouts are untouched.

Safety: skips when the VPS reports it is not NTP-synchronized, when RTT is
high, or when the offset is implausibly large (> MAX_MS). Needs `sudo -n`.
Usage: clock-sync-vps.py <ssh-key-path> [interval-seconds]
"""
import subprocess, sys, time, statistics, os

KEY = os.path.expanduser(os.path.expandvars(sys.argv[1]))
INTERVAL = int(sys.argv[2]) if len(sys.argv) > 2 else 300
HOST = os.environ.get('CLOCK_REF_HOST', 'deploy@YOUR_VPS_IP')
DEADBAND_MS, MAX_MS, MAX_RTT_MS = 10, 5000, 400
REMOTE = ('python3 -u -c "import sys,time,subprocess\n'
          's=subprocess.run([\'timedatectl\',\'show\',\'-p\',\'NTPSynchronized\',\'--value\'],capture_output=True,text=True).stdout.strip()\n'
          'print(s,flush=True)\n'
          'for l in sys.stdin: print(repr(time.time()),flush=True)"')
SLEW = ('import ctypes,ctypes.util,sys\n'
        'L=ctypes.CDLL(ctypes.util.find_library("c"),use_errno=True)\n'
        'class T(ctypes.Structure): _fields_=[("s",ctypes.c_long),("u",ctypes.c_long)]\n'
        'us=int(sys.argv[1]); d=T(us//1000000, us%1000000)\n'
        'r=L.adjtime(ctypes.byref(d),None); sys.exit(0 if r==0 else 1)\n')

def log(*a):
    print(time.strftime('%Y-%m-%d %H:%M:%S'), *a, flush=True)

def measure(n=12):
    p = subprocess.Popen(['ssh', '-i', KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST, REMOTE],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        synced = p.stdout.readline().strip()
        res = []
        for _ in range(n):
            t0 = time.time(); p.stdin.write('x\n'); p.stdin.flush()
            r = float(p.stdout.readline()); t1 = time.time()
            res.append(((t1 - t0) * 1000, (r - (t0 + t1) / 2) * 1000)); time.sleep(0.2)
    finally:
        p.kill(); p.wait()
    res.sort(); best = res[:4]
    return synced, statistics.median(o for _, o in best), best[0][0]

while True:
    try:
        synced, off, rtt = measure()
        if synced != 'yes':
            log(f'skip: reference not NTP-synced ({synced!r})')
        elif rtt > MAX_RTT_MS or abs(off) > MAX_MS:
            log(f'skip: implausible sample offset={off:.0f}ms rtt={rtt:.0f}ms')
        elif abs(off) <= DEADBAND_MS:
            log(f'ok offset={off:+.0f}ms rtt={rtt:.0f}ms')
        else:
            us = int(off * 1000)  # positive = box behind -> speed up
            ok = subprocess.run(['sudo', '-n', 'python3', '-c', SLEW, str(us)]).returncode == 0
            log(f'slew offset={off:+.0f}ms rtt={rtt:.0f}ms applied={ok}')
    except Exception as e:  # keep running; next round retries
        log('error', type(e).__name__, e)
    time.sleep(INTERVAL)
