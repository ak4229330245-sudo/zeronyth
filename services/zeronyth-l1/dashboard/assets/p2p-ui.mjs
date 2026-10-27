/** Optional foreground WebRTC lab. No account keys, payouts or public mainnet. */
import {WebP2PClient} from './web-p2p.mjs';
import {setText,setPlain} from './i18n.mjs';
import {localizeP2pError} from './i18n-errors.mjs';

const elements={};
for(const name of ['Room','New','Copy','Consent','Join','Leave','Status','Peers','Proofs','Rejected','Note']){
  elements[name]=document.querySelector(`#p2p${name}`);
}

const VALID_ROOM=/^[0-9a-f]{32}$/;
let busy=false;
const supported=window.isSecureContext&&typeof RTCPeerConnection==='function'&&
  !!globalThis.crypto?.subtle&&!!globalThis.crypto?.getRandomValues;

function makeCode(){
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function say(el,d){
  if(typeof d==='string')setPlain(el,d);else setText(el,d.key,d.params);
}

function render(info){
  const known=['idle','joining','joined','degraded','error'].includes(info.status)?info.status:null;
  if(info.connected.length)setText(elements.Status,'p2p.st.active',{n:info.connected.length});
  else setText(elements.Status,known?`p2p.st.${known}`:'p2p.st.checking');
  setPlain(elements.Peers,String(info.connected.length));
  setPlain(elements.Proofs,String(info.verified));
  setPlain(elements.Rejected,String(info.rejected));
  if(info.error)say(elements.Note,localizeP2pError(info.error));
  else if(!supported)setText(elements.Note,'p2p.note.unsupported');
  else setText(elements.Note,info.connected.length?'p2p.note.connected':
    info.status==='joined'&&info.negotiating.length?'p2p.note.negotiating':
    info.status==='joined'?'p2p.note.joined':'p2p.note.idle');
  const active=info.status==='joined'||info.status==='joining'||info.status==='degraded';
  elements.Join.disabled=busy||active||!supported||!elements.Consent.checked||
    !VALID_ROOM.test(elements.Room.value.trim());
  elements.Leave.disabled=!active&&info.status!=='error';
  elements.Room.disabled=busy||active;
  elements.New.disabled=busy||active;
  elements.Copy.disabled=!VALID_ROOM.test(elements.Room.value.trim());
}

export const client=new WebP2PClient({
  visible:()=>document.visibilityState==='visible',
  canWork:()=>elements.Consent.checked&&document.visibilityState==='visible',
  onUpdate:info=>render(info),
});

elements.New.addEventListener('click',()=>{
  elements.Room.value=makeCode();render(client.snapshot());
});
elements.Room.addEventListener('input',()=>{
  elements.Room.value=elements.Room.value.toLowerCase().replace(/[^0-9a-f]/g,'');
  render(client.snapshot());
});
elements.Copy.addEventListener('click',async()=>{
  if(!VALID_ROOM.test(elements.Room.value.trim()))return;
  try{
    await navigator.clipboard.writeText(elements.Room.value.trim());
    setText(elements.Note,'p2p.note.copied');
  }catch{
    elements.Room.focus();elements.Room.select();
    setText(elements.Note,'p2p.note.copyFail');
  }
});
elements.Join.addEventListener('click',async()=>{
  if(busy||!supported||!elements.Consent.checked||document.visibilityState!=='visible')return;
  const code=elements.Room.value.trim();
  if(!VALID_ROOM.test(code))return;
  busy=true;render(client.snapshot());
  try{await client.join(code);}
  catch(error){if(error?.message)say(elements.Note,localizeP2pError(error.message));else setText(elements.Note,'p2p.note.joinFail');}
  finally{busy=false;render(client.snapshot());}
});
elements.Leave.addEventListener('click',()=>{void client.leave();});
elements.Consent.addEventListener('change',()=>{
  if(!elements.Consent.checked)void client.leave();
  render(client.snapshot());
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible')void client.leave();
  else render(client.snapshot());
});
window.addEventListener('pagehide',()=>{void client.leave();});

if(!supported){
  setText(elements.Note,'p2p.note.unsupported');
}else{
  elements.Room.value=makeCode();
}
render(client.snapshot());
