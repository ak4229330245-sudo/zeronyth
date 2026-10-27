#!/bin/bash
# ZERONYTH primary health (box). Usage: scripts/health.sh [rpcPort=9545]
P=${1:-9545}; r(){ curl -s -m 5 127.0.0.1:$P -H content-type:application/json -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":${2:-[]}}" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("result"))'; }
H=$(r eth_blockNumber); echo "chainId=$(r eth_chainId) height=$((H)) peers=$(($(r net_peerCount)))"
echo "validators=$(r qbft_getValidatorsByBlockNumber '["latest"]')"
python3 - "$P" "$((H))" <<'PY'
import json,sys,urllib.request,collections
p,h=sys.argv[1],int(sys.argv[2]); c=collections.Counter()
for n in range(h-39,h+1):
  q=json.dumps({"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":[hex(n),False]}).encode()
  b=json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{p}",q,{"content-type":"application/json"}),timeout=5))["result"]
  c[b["miner"]]+=1
print("proposers(last40)=",dict(c))
PY
# Main-chain economy (coordinator 9801) and plan access service (9805), loopback only.
e=$(curl -s -m 5 127.0.0.1:9801/status | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["network"],d["contract"],"epoch="+str(d["epochs"][-1]["epoch"] if d.get("epochs") else 0),"providers="+str(len(d.get("providers") or [])))' 2>/dev/null)
[ -n "$e" ] && echo "econ-main=OK ($e)" || echo "econ-main=FAIL (127.0.0.1:9801)"
a=$(curl -s -m 5 127.0.0.1:9805/health | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["network"],"vps="+d["vpsBackend"]) if d.get("ok") else None' 2>/dev/null)
[ -n "$a" ] && [ "$a" != None ] && echo "access-main=OK ($a)" || echo "access-main=FAIL (127.0.0.1:9805)"
# Testnet points service (9807, loopback) and AMM price keeper (pm2 zeronyth-amm-keeper).
pt=$(curl -s -m 5 127.0.0.1:9807/health | python3 -c 'import json,sys;d=json.load(sys.stdin);print("lastBlock="+str(d["lastBlock"]),"head="+str(d["head"]),"ledgerSeq="+str(d["ledgerSeq"]),"wallets="+str(d["wallets"])) if d.get("ok") else None' 2>/dev/null)
[ -n "$pt" ] && [ "$pt" != None ] && echo "points=OK ($pt)" || echo "points=FAIL (127.0.0.1:9807)"
ks=$(~/.local/bin/pm2 jlist 2>/dev/null | python3 -c 'import json,sys;print(next((p["pm2_env"]["status"] for p in json.load(sys.stdin) if p["name"]=="zeronyth-amm-keeper"),"missing"))' 2>/dev/null)
kp=$(python3 -c 'import json,sys,time,datetime as D;d=json.load(open(sys.argv[1]));a=time.time()-D.datetime.fromisoformat(d["updatedAt"].replace("Z","+00:00")).timestamp();print("prices_age=%ds"%a,*("%s=%s%%"%(k,v.get("deviationPct")) for k,v in d.get("pools",{}).items()))' "$(dirname "$0")/../services/zeronyth-l1/deployments/main-amm-prices.json" 2>/dev/null)
[ "$ks" = online ] && echo "amm-keeper=OK (${kp:-no prices file})" || echo "amm-keeper=FAIL (pm2 status=${ks:-unknown})"
# ZERONYTH Scan explorer (pm2 zeronyth-explorer, 127.0.0.1:9815; public https://scan.zeronyth.dpdns.org).
ex=$(curl -s -m 5 127.0.0.1:9815/api/health | python3 -c 'import json,sys;d=json.load(sys.stdin);print("indexed="+str(d["indexed"]),"lag="+str(d["lag"]),"backfill="+str(d["backfillDone"]),"rss=%sMB"%d["rssMB"],"db=%sMB"%d["dbMB"]) if d.get("ok") and d["lag"]<30 else None' 2>/dev/null)
[ -n "$ex" ] && [ "$ex" != None ] && echo "explorer=OK ($ex)" || echo "explorer=FAIL (127.0.0.1:9815)"
# Public URL (Cloudflare tunnel). Override with ZERONYTH_PUBLIC_URL; skip with ZERONYTH_PUBLIC_URL=off.
U=${ZERONYTH_PUBLIC_URL:-https://zeronyth.dpdns.org}
if [ "$U" != off ]; then
  hc=$(curl -s -m 8 -o /dev/null -w '%{http_code}' "$U/"); cid=$(curl -s -m 8 "$U/rpc" -H content-type:application/json -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | python3 -c 'import json,sys;print(json.load(sys.stdin).get("result"))' 2>/dev/null)
  [ "$hc" = 200 ] && [ "$cid" = 0x23a7 ] && echo "public=OK ($U http=$hc chainId=$cid)" || echo "public=FAIL ($U http=$hc chainId=${cid:-none})"
  for q in /api/econ/status /api/access/plans /plans.html /api/points/health /points.html /amm.html; do pc=$(curl -s -m 8 -o /dev/null -w '%{http_code}' "$U$q"); [ "$pc" = 200 ] && echo "public$q=OK" || echo "public$q=FAIL (http=$pc)"; done
  SU=${ZERONYTH_SCAN_URL:-https://scan.zeronyth.dpdns.org}
  sc=$(curl -s -m 8 -o /dev/null -w '%{http_code}' "$SU/api/health"); rd=$(curl -s -m 8 -o /dev/null -w '%{http_code} %{redirect_url}' "$U/tx/0x$(printf '0%.0s' {1..64})")
  [ "$sc" = 200 ] && echo "public-scan=OK ($SU)" || echo "public-scan=FAIL ($SU http=$sc)"
  case "$rd" in "301 $SU/tx/"*) echo "public-scan-redirect=OK";; *) echo "public-scan-redirect=FAIL ($rd)";; esac
fi
