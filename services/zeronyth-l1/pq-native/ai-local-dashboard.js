'use strict';
const $=id=>document.getElementById(id);
let secret='';let processing=false;
const set=(id,value)=>{$(id).textContent=String(value);};
function line(style,message){
  const item=document.createElement('div');
  item.className=`bubble ${style}`;
  item.textContent=message;
  $('messages').append(item);
  $('messages').scrollTop=$('messages').scrollHeight;
}
function update(state){
  set('customer',state.customerZnytLab);set('provider',state.providerZnytLab);
  set('quota',state.providerAiQuota);set('available-model',state.model);
  set('model',`/ ${state.model}`);set('answers',state.answered);
  set('payment',state.settled?'ZNYT-LAB 精算済み':
    state.pendingSettlement?'署名検証済み・承認待ち':'未請求');
  set('network',state.mode==='ZNYT_LAB_LOCAL_ONLY'?'LOCAL AI TEST':'未接続');
  $('ask').disabled=processing||!secret;
  $('settle').disabled=processing||!state.pendingSettlement;
}
async function api(path,body){
  if(!secret)throw new Error('管理者トークンを入力してください');
  const response=await fetch(path,{method:body?'POST':'GET',
    headers:{authorization:`Bearer ${secret}`,...(body?{'content-type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
  let result;
  try{result=await response.json();}catch{throw new Error('AIサーバーの応答が不正です');}
  if(!response.ok)throw new Error(result.error||'接続できません');
  return result;
}
async function refresh(){
  try{update(await api('/v1/ai/state'));set('status','ローカルAIラボに接続しています');}
  catch(error){set('status',error.message);}
}
$('connect').addEventListener('click',()=>{
  secret=$('admin').value;$('admin').value='';void refresh();
});
$('refresh').addEventListener('click',()=>void refresh());
$('chat').addEventListener('submit',async(event)=>{
  event.preventDefault();
  if(processing)return;
  const prompt=$('prompt').value.trim();if(!prompt)return;
  processing=true;$('ask').disabled=true;$('settle').disabled=true;
  line('user',prompt);$('prompt').value='';set('status','実際のAIモデルを実行中…');
  try{
    const result=await api('/v1/ai/ask',{prompt,maxTokens:Number($('tokens').value),
      asProvider:$('role').value==='provider'});
    line('ai',result.reply);
    update(result.state);
    set('status',result.providerBenefit?'提供者AI特典枠で実行しました':
      'AI回答を検証。ZNYTテスト精算は承認待ちです');
  }catch(error){line('notice',`実行できませんでした：${error.message}`);set('status',error.message);}
  finally{processing=false;void refresh();}
});
$('settle').addEventListener('click',async()=>{
  if(processing||!window.confirm('ZNYT-LABの模擬残高を署名付きで精算しますか？（実トークンではありません）'))return;
  processing=true;$('settle').disabled=true;
  try{
    const result=await api('/v1/ai/settle',{confirm:true});
    update(result.state);
    line('notice',`ZNYT-LAB テスト精算完了：${result.receipt.charged} ZNYT-LAB`);
    set('status','テスト残高を精算しました（実トークンは移動していません）');
  }catch(error){set('status',error.message);}finally{processing=false;void refresh();}
});
