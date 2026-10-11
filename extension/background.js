'use strict';
importScripts('rules.js','engine.js');
if(chrome.offscreen&&chrome.runtime.getContexts)importScripts('compute.js');
else importScripts('vendor/ort.webgpu.min.js','inference.js','neural.js');
const waiting=new Map(),generations=new Map(),preparing=new Map(),foreground=new Set();
const compute=()=>globalThis.WallzCompute||globalThis.WallzNeural;
function progress(tabId,id,generation){return update=>{if(generations.get(tabId)===generation)chrome.tabs.sendMessage(tabId,{type:'WALLZ_PROGRESS',id,...update}).catch(()=>{});};}
let searches=Promise.resolve(),preparationActive=false;
if(compute())compute().init().catch(error=>console.error('Neural initialization failed',error));

function invalidate(tabId){
  const generation=(generations.get(tabId)||0)+1;generations.set(tabId,generation);
  const previous=waiting.get(tabId);
  if(previous){clearTimeout(previous.timer);waiting.delete(tabId);foreground.delete(previous);previous.respond({id:previous.id,error:'Superseded by a newer position'});}
  preparing.delete(tabId);globalThis.WallzCompute?.cancelStale?.();return generation;
}
function queuePreparation(){
  if(preparationActive||foreground.size||!compute()?.prepare)return;
  const job=preparing.values().next().value;if(!job)return;
  preparationActive=true;
  searches=searches.catch(()=>{}).then(async()=>{
    if(foreground.size||generations.get(job.tabId)!==job.generation)return;
    const result=await compute().prepare(job.state,{budgetMs:500,shouldStop:()=>foreground.size>0||generations.get(job.tabId)!==job.generation,onProgress:progress(job.tabId,job.id,job.generation)});
    progress(job.tabId,job.id,job.generation)({nodes:result.visited||0,phase:'prepare'});
    if(preparing.get(job.tabId)===job){
      if(!result.stopped&&result.done!==false)preparing.delete(job.tabId);
      else{preparing.delete(job.tabId);preparing.set(job.tabId,job);}
    }
  }).catch(()=>{if(preparing.get(job.tabId)===job)preparing.delete(job.tabId);}).finally(()=>{preparationActive=false;queuePreparation();});
}
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
  if(!['WALLZ_ANALYSE','WALLZ_PREPARE','WALLZ_STOP'].includes(request?.type))return false;
  try{
    const url=new URL(sender.url||'');
    if(url.protocol!=='https:'||!['wallz.gg','www.wallz.gg'].includes(url.hostname)||sender.tab?.id==null)throw new Error('Unsupported tab');
    const tabId=sender.tab.id;
    if(request.type==='WALLZ_STOP'){invalidate(tabId);respond({id:request.id,stopped:true});return false;}
    const state=WallzRules.normalize(request.state),generation=invalidate(tabId);
    if(request.type==='WALLZ_PREPARE'){
      if(state.winner==null&&state.variant==='classic'){preparing.set(tabId,{tabId,id:request.id,state,generation});queuePreparation();}
      respond({id:request.id,preparing:true});return false;
    }
    const job={id:request.id,respond,tabId};foreground.add(job);globalThis.WallzCompute?.cancelStale?.();
    job.timer=setTimeout(()=>{
      waiting.delete(tabId);
      if(compute()){
        searches=searches.catch(()=>{}).then(async()=>{
          if(generations.get(tabId)!==generation){respond({id:request.id,error:'Superseded by a newer position'});return;}
          try{
            const result=await compute().analyse(state,{budgetMs:3000,maxBudgetMs:6000,shouldStop:()=>generations.get(tabId)!==generation,onProgress:progress(tabId,request.id,generation)});
            respond(generations.get(tabId)===generation?{id:request.id,result}:{id:request.id,error:'Superseded by a newer position'});
          }catch(error){
            if(globalThis.WallzCompute&&generations.get(tabId)===generation){try{respond({id:request.id,result:{...WallzEngine.analyse(state,{budgetMs:3000,onProgress:progress(tabId,request.id,generation)}),engine:'classical-fallback',modelError:error.message}});}catch(fallback){respond({id:request.id,error:fallback.message});}}
            else respond({id:request.id,error:error.message});
          }
        }).finally(()=>{foreground.delete(job);queuePreparation();});
      }else{
        try{respond({id:request.id,result:WallzEngine.analyse(state,{budgetMs:3000,onProgress:progress(tabId,request.id,generation)})});}
        catch(error){respond({id:request.id,error:error.message});}
        finally{foreground.delete(job);queuePreparation();}
      }
    },0);
    waiting.set(tabId,job);return true;
  }catch(error){respond({id:request.id,error:error.message});return false;}
});
chrome.tabs.onRemoved?.addListener(tabId=>{invalidate(tabId);generations.delete(tabId);for(const job of foreground)if(job.tabId===tabId)foreground.delete(job);});
chrome.action.onClicked.addListener(tab=>{
  if(tab.id!=null)chrome.tabs.sendMessage(tab.id,{type:'WALLZ_TOGGLE'}).catch(()=>{});
});
