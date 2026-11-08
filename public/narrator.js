// 单独复用一个媒体元素，在用户操作时先解锁；切页时取消旧请求和旧播放回调。
function silentWave() {
  const bytes=new Uint8Array(44+1280),d=new DataView(bytes.buffer);
  const text=(at,s)=>Array.from(s).forEach((c,i)=>bytes[at+i]=c.charCodeAt(0));
  text(0,'RIFF');d.setUint32(4,bytes.length-8,true);text(8,'WAVE');text(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,16000,true);d.setUint32(28,32000,true);d.setUint16(32,2,true);d.setUint16(34,16,true);text(36,'data');d.setUint32(40,1280,true);
  return 'data:audio/wav;base64,'+btoa(String.fromCharCode(...bytes));
}
const SILENCE=silentWave();
export class Narrator {
  constructor({ context, duck, error }) {
    this.context=context;this.duck=duck;this.error=error;this.sequence=0;this.controller=null;this.url=null;this.finish=null;
    this.unlocked=false;this.unlocking=null;this.state='idle';
    this.audio=document.createElement('audio');this.audio.id='narrator';this.audio.preload='auto';this.audio.hidden=true;this.audio.volume=.92;
    document.body.append(this.audio);
  }
  notify(state) { this.state=state;document.dispatchEvent(new CustomEvent('narrator-state-change',{detail:{state}})); }
  unlock() {
    if(this.unlocked||this.unlocking||this.state==='playing'||this.state==='loading')return;
    this.audio.onplaying=this.audio.onended=this.audio.onerror=this.audio.onpause=null;
    const token=this.sequence;this.audio.src=SILENCE;
    const job=this.audio.play();this.unlocking=job;
    job.then(()=>{this.unlocked=true;if(token===this.sequence&&this.audio.getAttribute('src')===SILENCE){this.audio.pause();this.audio.removeAttribute('src');this.audio.load()}}).catch(()=>{}).finally(()=>{if(this.unlocking===job)this.unlocking=null});
  }
  stop() {
    this.sequence++;this.controller?.abort();this.controller=null;
    this.audio.onplaying=this.audio.onended=this.audio.onerror=this.audio.onpause=null;
    this.audio.pause();this.audio.removeAttribute('src');this.audio.load();
    if(this.url)URL.revokeObjectURL(this.url);this.url=null;
    window.speechSynthesis?.cancel();this.duck(false);const finish=this.finish;this.finish=null;finish?.(false);this.notify('idle');
  }
  async request(path, options, token) {
    for(let attempt=0;attempt<2;attempt++){
      try{
        const r=await fetch(path,options);
        if(r.ok)return r;
        const j=await r.json().catch(()=>({})),e=new Error(j.error||'旁白暂时无法播放，请点重播');
        e.retry=r.status>=500&&!/鉴权|权限|尚未配置/.test(e.message);throw e;
      }catch(e){
        if(e.name==='AbortError'||token!==this.sequence||attempt===1||!(e.retry||e instanceof TypeError))throw e;
        await new Promise(resolve=>setTimeout(resolve,350));
        if(options.signal.aborted)throw new DOMException('Aborted','AbortError');
      }
    }
  }
  async say(text,{preview=false}={}) {
    this.stop();const token=this.sequence,ctx=this.context();this.notify('loading');
    if(!ctx.speech?.available)return this.system(text,token);
    this.controller=new AbortController();
    try{
      const path=ctx.room&&!preview?'/api/rooms/'+encodeURIComponent(ctx.room)+'/speech':'/api/speech';
      const staticPreview=preview&&ctx.speech.previewSrc;
      const options=staticPreview?{signal:this.controller.signal}:{method:'POST',signal:this.controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:ctx.sid,room:ctx.room,code:ctx.code,preview,text})};
      const response=await this.request(staticPreview||path,options,token),blob=await response.blob();
      if(token!==this.sequence)return false;
      if(!blob.size)throw new Error('旁白音频为空，请重播');
      this.url=URL.createObjectURL(blob);this.audio.src=this.url;
      return await new Promise(resolve=>{
        let done=false;
        const complete=played=>{if(done)return;done=true;if(token===this.sequence){this.duck(false);this.finish=null;this.notify(played?'ended':'error')}resolve(played)};
        this.finish=complete;
        this.audio.onplaying=()=>{if(token===this.sequence){this.unlocked=true;this.duck(true);this.notify('playing')}};
        this.audio.onended=()=>{if(token===this.sequence)complete(true)};
        this.audio.onerror=()=>{if(token===this.sequence){complete(false);this.error('旁白播放失败，点击重播再试一次')}};
        this.audio.onpause=()=>{if(token===this.sequence&&!this.audio.ended&&this.state==='playing'&&!document.hidden){complete(false);this.error('旁白已暂停，点击重播继续')}};
        this.audio.play().catch(e=>{
          if(token!==this.sequence||e.name==='AbortError'){complete(false);return}
          complete(false);this.error(e.name==='NotAllowedError'?'点击“重播”开启本页旁白':'旁白暂未播放，点击重播再试一次');
        });
      });
    }catch(e){
      if(e.name!=='AbortError'&&token===this.sequence){this.notify('error');this.error(e.message)}
      return false;
    }
  }
  system(text,token) {
    if(!window.speechSynthesis){this.notify('error');return Promise.resolve(false)}
    return new Promise(resolve=>{
      let done=false;
      const complete=played=>{if(done)return;done=true;if(token===this.sequence){this.duck(false);this.finish=null;this.notify(played?'ended':'error')}resolve(played)};
      this.finish=complete;
      const u=new SpeechSynthesisUtterance(text);u.lang='zh-CN';u.rate=.9;u.volume=.85;
      u.onstart=()=>{if(token===this.sequence){this.duck(true);this.notify('playing')}};
      u.onend=()=>complete(true);u.onerror=()=>complete(false);speechSynthesis.speak(u);
    });
  }
}
