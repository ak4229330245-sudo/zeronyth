// Static UI only. No third-party scripts, token persisted only in this tab's memory.
'use strict';
const byId=id=>document.getElementById(id);
let token='';
function el(tag,cls,text){
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=String(text);
  return node;
}
function value(id,data){byId(id).textContent=String(data);}
function nodeCard(node){
  const card=el('article','panel node');
  const head=el('div','node-head');
  head.append(el('h3','',`${node.deviceClass.toUpperCase()} · ${node.address.slice(0,14)}…`),
    el('span',node.online?'pill on':'pill',node.online?'● ONLINE':'OFFLINE'));
  card.append(head);
  const cols=el('div','cols');
  for(const [number,label] of [[node.cpuCores,'CPU CORE'],[node.ramMiB,'RAM MiB'],[node.gpuCount,'GPU']]){
    const unit=el('div','mini');unit.append(el('b','',number),el('small','',label));cols.append(unit);
  }
  card.append(cols);
  const line1=el('div','line');
  line1.append(el('span','',`L1 ${node.l1Percent}%`),el('span','',`AI ${node.aiPercent}%`),
    el('span','',`VPS/GPU ${node.rentalPercent}%`));
  const bar=el('div','bar');
  for(const [cls,n] of [['l1',node.l1Percent],['ai',node.aiPercent],['rent',node.rentalPercent]]){
    const part=el('div',cls);part.style.width=`${n}%`;bar.append(part);
  }
  card.append(line1,bar);
  const meta=el('div','line');
  meta.style.marginTop='13px';
  meta.append(el('span','',`CPU負荷 ${node.cpuLoadPct??'—'}%`),
    el('b','','ZNYT・AI特典: 未認証'));
  card.append(meta);
  const gpu=el('div','line');gpu.style.marginTop='8px';
  gpu.append(el('span','',`GPU情報: ${node.gpuSummary}`));card.append(gpu);
  return card;
}
async function refresh(){
  if(!token){value('status','管理者トークンを入力してください。');return;}
  value('status','署名済みノード情報を読み込み中…');
  try{
    const response=await fetch('/v1/admin/nodes',{
      headers:{authorization:`Bearer ${token}`},cache:'no-store'});
    if(!response.ok)throw new Error(response.status===401?'トークンが違います。':'接続エラー');
    const state=await response.json();
    value('registered',state.nodesRegistered);value('online',state.online);
    value('cpu',state.declaredCpuCores);value('gpu',state.declaredGpuCount);
    value('chain',`CHAIN · ${state.chainId}`);
    const list=byId('nodes');list.replaceChildren();
    if(!state.nodes.length){list.append(el('div','panel empty','参加ノードはまだありません。'));}
    for(const node of state.nodes)list.append(nodeCard(node));
    value('status',`${new Date().toLocaleTimeString('ja-JP')} 更新 · ${state.nodesRegistered} ノード登録（実行未検証）`);
  }catch(error){value('status',error.message);}
}
byId('auth').addEventListener('submit',event=>{
  event.preventDefault();token=byId('token').value;
  byId('token').value='';void refresh();
});
byId('refresh').addEventListener('click',()=>void refresh());
