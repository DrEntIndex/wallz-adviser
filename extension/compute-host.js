'use strict';
const pending=new Map(),cancelled=new Set(),inflight=new Set();
let sequence=0,selected=null,selectedThreads=1,recovering=null;
function makeWorker(threads){
  const worker=new Worker('compute-worker.js?threads='+threads);
  worker.onmessage=event=>{
    const message=event.data,job=pending.get(message.id);if(!job)return;
    if(message.progress){chrome.runtime.sendMessage({type:'WALLZ_COMPUTE_PROGRESS',id:job.externalId,progress:message.progress}).catch(()=>{});return;}
    clearTimeout(job.timer);pending.delete(message.id);
    if(message.error)job.reject(new Error(message.error));else job.resolve(message.result);
  };
  worker.onerror=()=>{
    worker.failed=true;
    for(const [id,job]of pending)if(job.worker===worker){clearTimeout(job.timer);pending.delete(id);job.reject(new Error('Compute worker stopped'));}
  };
  return worker;
}
function call(worker,request,externalId){
  if(worker.failed)return Promise.reject(new Error('Compute worker stopped'));
  const id=++sequence,control=crossOriginIsolated&&typeof SharedArrayBuffer!=='undefined'?new SharedArrayBuffer(4):null;
  const promise=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);worker.failed=true;worker.terminate();reject(new Error('Compute worker timed out'));},request.action==='init'?12000:10000);
    pending.set(id,{worker,externalId,resolve,reject,timer,control});worker.postMessage({...request,id,control});
  });
  return promise;
}
const ready=(async()=>{
  const cores=Math.max(1,Math.floor(navigator.hardwareConcurrency||1));
  const counts=crossOriginIsolated&&typeof SharedArrayBuffer!=='undefined'?[...new Set([1,Math.min(4,cores),cores])]:[1];
  let best=null;const profiles=[];
  for(const threads of counts){
    const worker=makeWorker(threads);
    try{
      const info=await call(worker,{action:'init'});profiles.push(info);
      if(!best||info.inferenceMs<best.info.inferenceMs*.85){best?.worker.terminate();best={worker,info};}
      else worker.terminate();
    }catch(error){profiles.push({threads,error:String(error.message||error)});worker.terminate();if(!best&&threads===counts.at(-1))throw error;}
  }
  if(!best)throw new Error('No compute backend available');
  selected=best.worker;selectedThreads=best.info.threads;return {...best.info,profiles};
})();
ready.catch(()=>{});
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.tab)return false;
  if(request?.type==='WALLZ_COMPUTE_CANCEL'){
    if(!inflight.has(request.id))return false;
    cancelled.add(request.id);
    for(const [id,job]of pending)if(job.externalId===request.id){if(job.control)Atomics.store(new Int32Array(job.control),0,1);job.worker.postMessage({action:'cancel',id});}
    return false;
  }
  if(request?.type!=='WALLZ_COMPUTE')return false;
  if(!['init','analyse','prepare'].includes(request.action)){respond({error:'Unsupported compute request'});return false;}
  inflight.add(request.id);
  ready.then(async info=>{
    if(selected.failed){
      if(!recovering)recovering=(async()=>{const worker=makeWorker(selectedThreads);await call(worker,{action:'init'});selected=worker;})().finally(()=>{recovering=null;});
      await recovering;
    }
    if(cancelled.has(request.id))throw new Error('Superseded by a newer position');
    return request.action==='init'?info:call(selected,request,request.id);
  }).then(result=>respond({result}),error=>respond({error:String(error.message||error)})).finally(()=>{cancelled.delete(request.id);inflight.delete(request.id);});
  return true;
});
