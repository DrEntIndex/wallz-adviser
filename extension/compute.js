'use strict';
const computePending=new Map(),computeEpoch=crypto.randomUUID();
let computeCreating=null,computeSequence=0;
async function computeDocument(){
  if(computeCreating)return computeCreating;
  computeCreating=(async()=>{
    const url=chrome.runtime.getURL('compute-host.html');
    const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]});
    if(!contexts.length)await chrome.offscreen.createDocument({url:'compute-host.html',reasons:['WORKERS'],justification:'Run local GPU and multicore CPU game analysis in dedicated workers.'});
  })();
  try{await computeCreating;}finally{computeCreating=null;}
}
async function computeCall(action,state,options={}){
  await computeDocument();
  const id=computeEpoch+':'+(++computeSequence);
  let cancelled=false;
  const cancel=()=>{
    if(!cancelled&&options.shouldStop?.()){cancelled=true;chrome.runtime.sendMessage({type:'WALLZ_COMPUTE_CANCEL',id}).catch(()=>{});}
  };
  computePending.set(id,{...options,cancel});
  const timer=options.shouldStop?setInterval(cancel,25):null;
  try{
    const response=await chrome.runtime.sendMessage({type:'WALLZ_COMPUTE',id,action,state,budgetMs:options.budgetMs,maxBudgetMs:options.maxBudgetMs,...(options.opening?{opening:options.opening}:{})});
    if(response?.error||!response?.result)throw new Error(response?.error||'Compute unavailable');
    return response.result;
  }finally{if(timer)clearInterval(timer);computePending.delete(id);}
}
chrome.runtime.onMessage.addListener((message,sender)=>{
  if(message?.type==='WALLZ_COMPUTE_PROGRESS'&&sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('compute-host.html')){
    const job=computePending.get(message.id);if(job&&!job.shouldStop?.())job.onProgress?.(message.progress);
  }
  return false;
});
globalThis.WallzCompute={cancelStale:()=>{for(const job of computePending.values())job.cancel();},init:()=>computeCall('init'),analyse:(state,options)=>computeCall('analyse',state,options),prepare:(state,options)=>computeCall('prepare',state,options)};
