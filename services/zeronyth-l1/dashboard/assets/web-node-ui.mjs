import {hashIterations,makeLocalJob} from './node-hash.mjs';
import {WebNodeSession} from './node-session.mjs';
import {setText,setPlain} from './i18n.mjs';
import {localizeNodeError} from './i18n-errors.mjs';

const get=id=>document.getElementById(id);
const ui=Object.fromEntries([
  'statusValue','statusDetail','completedValue','creditValue','znytValue',
  'deviceName','deviceHelp','deviceType','nodeMode','modeHelp',
  'visibilityValue','batteryValue','workLimit','uptimeValue',
  'nodeConsent','warningText','startNode','stopNode','nodeOrb',
  'runDescription','activityFill','proofValue','failureValue',
  'dockStatus','dockAction',
].map(id=>[id,get(id)]));

const agent=navigator.userAgent||'';
const ios=/iPhone|iPad|iPod/i.test(agent)||
  (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const android=/Android/i.test(agent);
const mobile=ios||android||/Mobile/i.test(agent);
const tablet=/iPad|Tablet/i.test(agent)||(android&&!/Mobile/i.test(agent))||
  (ios&&navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const deviceClassKey=tablet?'node.dev.tablet':mobile?'node.dev.phone':'node.dev.pc'; // PC / Server / VPS treated as desktop-class
const platform=ios?'iOS / iPadOS':android?'Android':{key:'node.platform.desktop'};
const webCryptoSupported=Boolean(globalThis.isSecureContext&&globalThis.crypto?.subtle&&
  globalThis.crypto?.getRandomValues&&typeof Worker==='function');
let battery=null;

setText(ui.deviceName,'node.device.name',{device:{key:deviceClassKey},platform});
setText(ui.deviceHelp,'node.device.help');
setText(ui.deviceType,ios?'node.device.type.light':mobile?'node.device.type.mobile':'node.device.type.desktop'); // includes PC, Server, VPS
if(ios)ui.nodeMode.querySelector('option[value="compute"]').disabled=true;

function iterations(){
  return ui.nodeMode.value==='light'?8:tablet?16:mobile?12:48;
}

function formatActive(ms){
  const total=Math.floor(ms/1000);
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
}

function modeEligibility(){
  if(!webCryptoSupported)return 'node.elig.crypto';
  if(!ui.nodeConsent.checked)return 'node.elig.consent';
  if(!ui.nodeMode.value||!['light','compute'].includes(ui.nodeMode.value))return 'node.elig.mode';
  if(ios&&ui.nodeMode.value==='compute')return 'node.elig.apple';
  if(android&&ui.nodeMode.value==='compute'){
    if(!battery)return 'node.elig.batteryApi';
    if(!battery.charging||battery.level<0.4)return 'node.elig.batteryLow';
    const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
    if(connection?.type!=='wifi')return 'node.elig.wifi';
  }
  return '';
}

function render(snapshot){
  const known=['idle','running','paused','error'].includes(snapshot.state)?snapshot.state:null;
  setText(ui.statusValue,known?`node.st.${known}`:'node.st.unknown');
  setText(ui.statusDetail,snapshot.state==='running'?'node.st.detail.running':
    snapshot.state==='paused'?'node.st.detail.paused':'node.st.detail.idle');
  setPlain(ui.completedValue,String(snapshot.completed));
  setPlain(ui.creditValue,String(snapshot.demoCredits));
  setPlain(ui.znytValue,'0');
  setPlain(ui.uptimeValue,formatActive(snapshot.activeMs));
  setPlain(ui.proofValue,snapshot.lastProof||'—');
  setPlain(ui.failureValue,String(snapshot.failed));
  ui.nodeOrb.classList.toggle('active',snapshot.state==='running');
  if(snapshot.error){
    const d=localizeNodeError(snapshot.error);
    if(typeof d==='string')setPlain(ui.runDescription,d);else setText(ui.runDescription,d.key);
  }else setText(ui.runDescription,`node.run.${known||'idle'}`);
  ui.activityFill.style.width=`${(snapshot.completed%10)*10}%`;
  setText(ui.visibilityValue,document.visibilityState==='visible'?'node.vis.visible':'node.vis.hidden');
  const active=snapshot.state==='running'||snapshot.state==='paused';
  ui.startNode.disabled=active||Boolean(modeEligibility());
  ui.stopNode.disabled=!active;
  ui.nodeMode.disabled=active;
  ui.dockAction.disabled=active?false:Boolean(modeEligibility());
  setText(ui.dockAction,active?'node.stop':'node.start');
  setText(ui.dockStatus,active?
    snapshot.state==='paused'?'node.dock.paused':'node.dock.running':'node.dock.stopped');
  ui.dockStatus.classList.toggle('on',snapshot.state==='running');
}

const session=new WebNodeSession({
  createWorker:()=>new Worker('assets/node-worker.mjs',{type:'module'}),
  createJob:()=>makeLocalJob(iterations()),
  verify:async(job,output)=>(await hashIterations(job.seed,job.iterations))===output,
  onUpdate:render,
  visible:()=>document.visibilityState==='visible',
  intervalMs:750,
});

function updateRules(){
  setText(ui.workLimit,'node.limit',{n:iterations()});
  setText(ui.modeHelp,ui.nodeMode.value==='light'?'node.mode.help.light':'node.mode.help.compute');
  const reason=modeEligibility();
  if(reason)setText(ui.warningText,reason);else setPlain(ui.warningText,'');
  render(session.snapshot());
}

function start(){
  const reason=modeEligibility();
  if(reason){setText(ui.warningText,reason);return;}
  session.start();
  updateRules();
}

function stop(){session.stop();updateRules();}

ui.startNode.addEventListener('click',start);
ui.stopNode.addEventListener('click',stop);
ui.dockAction.addEventListener('click',()=>{
  const status=session.snapshot();
  if(status.state==='running'||status.state==='paused')stop();else start();
});
ui.nodeConsent.addEventListener('change',()=>{
  if(!ui.nodeConsent.checked)session.stop();
  updateRules();
});
ui.nodeMode.addEventListener('change',()=>{session.stop();updateRules();});
document.addEventListener('visibilitychange',()=>{
  session.visibilityChanged();
  if(document.visibilityState==='visible'&&modeEligibility()&&session.snapshot().wanted){
    session.stop();
  }
  updateRules();
});
window.addEventListener('pagehide',()=>session.stop());

async function monitorBattery(){
  const api=navigator.getBattery;
  if(typeof api!=='function'){
    setText(ui.batteryValue,'node.battery.unavailable');
    updateRules();
    return;
  }
  try{
    battery=await api.call(navigator);
    const refresh=()=>{
      setText(ui.batteryValue,battery.charging?'node.battery.charging':'node.battery.level',{level:Math.round(battery.level*100)});
      if(modeEligibility()&&session.snapshot().wanted)session.stop();
      updateRules();
    };
    battery.addEventListener('levelchange',refresh);
    battery.addEventListener('chargingchange',refresh);
    refresh();
  }catch{setText(ui.batteryValue,'node.battery.unavailable');updateRules();}
}

setInterval(()=>{
  setPlain(ui.uptimeValue,formatActive(session.snapshot().activeMs));
  if(session.snapshot().state==='running'&&modeEligibility()){
    session.stop();updateRules();
  }
},1000);
setText(ui.batteryValue,'node.battery.checking');
updateRules();
void monitorBattery();


// Resource allocation UI (local simulation only)
function updateAllocation() {
  const slider = document.getElementById('allocSlider');
  const ai = document.getElementById('allocAI');
  const l1 = document.getElementById('allocL1');
  const vps = document.getElementById('allocVPS');
  const hint = document.getElementById('allocHint');
  if (!slider || !ai) return;
  const aiPct = Number(slider.value) || 0;
  const l1Pct = 40; // fixed L1 share
  const vpsPct = Math.max(0, 100 - aiPct - l1Pct);
  ai.textContent = aiPct + '%';
  l1.textContent = l1Pct + '%';
  vps.textContent = vpsPct + '%';
  if (hint) hint.textContent = `AI ${aiPct}% / L1 ${l1Pct}% / VPS ${vpsPct}% （AI30 / L1 40 / VPS 30 基準）`;
}
document.getElementById('allocSlider')?.addEventListener('input', updateAllocation);
updateAllocation();

// Token economy simulation (testnet only, no real value)
(function(){
  const costEl = document.getElementById('usageCost');
  const rewardEl = document.getElementById('providerReward');
  const statusEl = document.getElementById('tokenStatus');
  let totalCost = 0;
  let totalReward = 0;

  function update(){
    if(costEl) costEl.textContent = totalCost.toFixed(2) + ' ZNYT';
    if(rewardEl) rewardEl.textContent = totalReward.toFixed(2) + ' ZNYT';
  }

  document.getElementById('simUseAI')?.addEventListener('click', () => {
    const fee = 0.5;
    totalCost += fee;
    totalReward += fee * 0.7; // 70% to providers
    update();
    if(statusEl) statusEl.textContent = 'AI利用: 0.50 ZNYT 支払い → 提供者に報酬（シミュレーション）';
  });

  document.getElementById('simUseVPS')?.addEventListener('click', () => {
    const fee = 1.2;
    totalCost += fee;
    totalReward += fee * 0.6; // 60% to providers
    update();
    if(statusEl) statusEl.textContent = 'VPS利用: 1.20 ZNYT 支払い → 提供者に報酬（シミュレーション）';
  });

  update();
})();

import { rewardEngine, REWARD_CONFIG } from './reward-logic.mjs';

// Detailed reward UI updates
function refreshRewardUI() {
  const s = rewardEngine.summary();
  const costEl = document.getElementById('usageCost');
  const rewardEl = document.getElementById('providerReward');
  const statusEl = document.getElementById('tokenStatus');
  if (costEl) costEl.textContent = s.feesCollected + ' ZNYT';
  if (rewardEl) rewardEl.textContent = s.rewardsDistributed + ' ZNYT';
  const burnEl = document.getElementById('burnedAmount');
  if (burnEl) burnEl.textContent = (s.burned || '0.00') + ' ZNYT';
  // Also update if we have job count from existing UI
  const jobsEl = document.getElementById('completedValue');
  if (jobsEl) {
    const jobs = parseInt(jobsEl.textContent) || 0;
    rewardEngine.recordJobs(Math.max(0, jobs - rewardEngine.providerJobs));
  }
}

document.getElementById('simUseAI')?.addEventListener('click', () => {
  const r = rewardEngine.useAI();
  refreshRewardUI();
  const statusEl = document.getElementById('tokenStatus');
  if (statusEl) statusEl.textContent = `AI利用: ${r.fee.toFixed(2)} ZNYT → 提供者報酬 ${r.reward.toFixed(2)} ZNYT`;
});

document.getElementById('simUseVPS')?.addEventListener('click', () => {
  const r = rewardEngine.useVPS();
  refreshRewardUI();
  const statusEl = document.getElementById('tokenStatus');
  if (statusEl) statusEl.textContent = `VPS利用: ${r.fee.toFixed(2)} ZNYT → 提供者報酬 ${r.reward.toFixed(2)} ZNYT`;
});

// Periodic refresh
setInterval(refreshRewardUI, 2000);
refreshRewardUI();


// Simple VPS contribution persistence (local simulation)
(function(){
  const key = 'zeronyth-vps-offer';
  const btn = document.querySelector('#vpsLending button');
  const offer = document.getElementById('vpsOffer');
  if (localStorage.getItem(key) && offer) {
    offer.textContent = '貢献登録済み（保存済み）';
  }
  btn?.addEventListener('click', () => {
    localStorage.setItem(key, 'registered');
    if (offer) offer.textContent = '貢献登録済み（保存済み）';
  });
})();


// Reflect node jobs into AI growth display
setInterval(() => {
  const jobs = parseInt(document.getElementById('completedValue')?.textContent || '0', 10);
  const aiEl = document.getElementById('aiGrowthValue');
  if (aiEl && jobs > 0) aiEl.textContent = jobs;
}, 1500);
