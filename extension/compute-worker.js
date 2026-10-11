'use strict';
globalThis.WallzThreads=Number(new URL(location.href).searchParams.get('threads'))||1;
importScripts('rules.js','engine.js','vendor/ort.webgpu.worker.min.js','inference.js','neural.js');
const active=new Map();
let tasks=Promise.resolve();
self.onmessage=event=>{
  const request=event.data;
  if(request.action==='cancel'){const job=active.get(request.id);if(job)job.cancelled=true;return;}
  const job={cancelled:false,control:request.control?new Int32Array(request.control):null};active.set(request.id,job);
  tasks=tasks.catch(()=>{}).then(async()=>{
    try{
      let result;
      if(request.action==='init'){await WallzNeural.init();result=WallzInference.info();}
      else{
        const options={budgetMs:request.budgetMs,maxBudgetMs:request.maxBudgetMs,shouldStop:()=>job.cancelled||(job.control&&Atomics.load(job.control,0)!==0),onProgress:progress=>postMessage({id:request.id,progress})};
        result=await WallzNeural[request.action](request.state,options);
      }
      postMessage({id:request.id,result});
    }catch(error){postMessage({id:request.id,error:String(error.message||error)});}
    finally{active.delete(request.id);}
  });
};
