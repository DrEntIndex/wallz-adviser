'use strict';
importScripts('rules.js','engine.js');
const waiting=new Map();

chrome.runtime.onMessage.addListener((request,sender,respond)=>{
  if(request?.type!=='WALLZ_ANALYSE') return false;
  try {
    const url=new URL(sender.url || '');
    if(url.protocol!=='https:' || !['wallz.gg','www.wallz.gg'].includes(url.hostname) || sender.tab?.id == null) throw new Error('Unsupported tab');
    const state=WallzRules.normalize(request.state);
    const budgetMs=[350,1200,3500].includes(request.budgetMs)?request.budgetMs:1200;
    const tabId=sender.tab.id,previous=waiting.get(tabId);
    if(previous) {
      clearTimeout(previous.timer);
      previous.respond({id:previous.id,error:'Superseded by a newer position'});
    }
    const job={id:request.id,respond};
    // Coalesce messages delivered after a running search releases the worker.
    // The active synchronous search finishes; only the latest waiting position runs.
    job.timer=setTimeout(()=>{
      waiting.delete(tabId);
      try {respond({id:request.id,result:WallzEngine.analyse(state,{budgetMs})});}
      catch(error) {respond({id:request.id,error:error.message});}
    },50);
    waiting.set(tabId,job);
    return true;
  } catch(error) { respond({id:request.id,error:error.message});return false; }
});

chrome.action.onClicked.addListener(tab=>{
  if(tab.id!=null) chrome.tabs.sendMessage(tab.id,{type:'WALLZ_TOGGLE'}).catch(()=>{});
});
