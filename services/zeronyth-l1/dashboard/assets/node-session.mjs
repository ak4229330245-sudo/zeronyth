/** Foreground-only browser node session: no hidden CPU, no fabricated network payouts. */
export class WebNodeSession {
  #worker=null;
  #pending=null;
  #timer=null;
  #generation=0;
  #accumulatedMs=0;
  #since=0;
  #wanted=false;

  constructor({createWorker,createJob,verify,onUpdate,visible=()=>true,
    clock=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout,intervalMs=550}){
    if([createWorker,createJob,verify,onUpdate,visible,clock,setTimer,clearTimer]
      .some(fn=>typeof fn!=='function'))throw new TypeError('Required session dependency missing');
    if(!Number.isInteger(intervalMs)||intervalMs<100||intervalMs>30000){
      throw new RangeError('Unsafe browser compute interval');
    }
    Object.assign(this,{createWorker,createJob,verify,onUpdate,visible,clock,setTimer,clearTimer,intervalMs});
    this.state='idle';
    this.completed=0;
    this.failed=0;
    this.demoCredits=0;
    this.lastProof='';
    this.error='';
    this.onUpdate(this.snapshot());
  }

  snapshot(){
    const runningMs=this.state==='running'?Math.max(0,this.clock()-this.#since):0;
    return {state:this.state,wanted:this.#wanted,completed:this.completed,failed:this.failed,
      demoCredits:this.demoCredits,lastProof:this.lastProof,error:this.error,
      activeMs:this.#accumulatedMs+runningMs,realZnyt:'0',realNodeConnected:false};
  }

  #emit(){this.onUpdate(this.snapshot());}

  start(){
    if(this.#wanted&&this.state==='running')return;
    this.#wanted=true;
    this.error='';
    if(!this.visible()){
      this.state='paused';
      this.#emit();
      return;
    }
    this.#begin();
  }

  #begin(){
    if(this.state==='running')return;
    try{
      const worker=this.createWorker();
      if(!worker||typeof worker.postMessage!=='function'||typeof worker.terminate!=='function'){
        throw new Error('Dedicated Web Worker unavailable');
      }
      this.#worker=worker;
      const epoch=++this.#generation;
      this.#worker.onmessage=event=>{void this.#received(event?.data,epoch);};
      this.#worker.onerror=()=>this.#fail('ワーカーが停止したため、安全側で処理を終了しました');
      this.#since=this.clock();
      this.state='running';
      this.#emit();
      this.#dispatch(epoch);
    }catch{
      this.#fail('このブラウザでは計算ワーカーを開始できません');
    }
  }

  #dispatch(epoch){
    if(epoch!==this.#generation||this.state!=='running'||!this.#worker)return;
    if(!this.visible()) {this.visibilityChanged();return;}
    try{
      const job=this.createJob();
      if(!job||typeof job.id!=='string'||job.id!==job.seed||
         !Number.isInteger(job.iterations)||job.iterations<1||job.iterations>512){
        throw new Error('Invalid local research job');
      }
      this.#pending=Object.freeze({...job});
      this.#worker.postMessage(job);
    }catch{this.#fail('安全なジョブを生成できませんでした');}
  }

  async #received(message,epoch){
    if(epoch!==this.#generation||this.state!=='running'||!this.#pending)return;
    const job=this.#pending;
    this.#pending=null;
    if(!message||message.error||message.id!==job.id||
      typeof message.output!=='string'||!/^[0-9a-f]{64}$/.test(message.output)){
      this.#fail('計算結果の形式またはジョブIDが不正です');
      return;
    }
    let valid=false;
    try {valid=await this.verify(job,message.output);} catch{valid=false;}
    // A hidden/closed tab cannot collect credits from stale asynchronous work.
    if(epoch!==this.#generation||this.state!=='running'||!this.visible()){
      if(!this.visible())this.visibilityChanged();
      return;
    }
    if(!valid){this.#fail('結果の再検証に失敗しました');return;}
    this.completed++;
    this.demoCredits++;
    this.lastProof=message.output;
    this.#emit();
    this.#timer=this.setTimer(()=>{this.#timer=null;this.#dispatch(epoch);},this.intervalMs);
  }

  visibilityChanged(){
    if(!this.visible()){
      if(this.state==='running')this.#pause();
    }else if(this.#wanted&&this.state==='paused')this.#begin();
  }

  #endWorker(){
    ++this.#generation;
    if(this.#timer!==null){this.clearTimer(this.#timer);this.#timer=null;}
    this.#pending=null;
    const current=this.#worker;
    this.#worker=null;
    if(current){current.onmessage=null;current.onerror=null;current.terminate();}
    if(this.state==='running')this.#accumulatedMs+=Math.max(0,this.clock()-this.#since);
  }

  #pause(){this.#endWorker();this.state='paused';this.#emit();}

  #fail(message){
    this.#endWorker();
    this.#wanted=false;
    this.failed++;
    this.error=message;
    this.state='error';
    this.#emit();
  }

  stop(){
    this.#wanted=false;
    this.#endWorker();
    this.state='idle';
    this.error='';
    this.#emit();
  }
}
