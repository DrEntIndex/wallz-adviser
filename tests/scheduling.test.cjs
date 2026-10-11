const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const R=require('../extension/rules.js');
const N=require('../extension/neural.js');

test('foreground requests coalesce without a fixed startup delay',async()=>{
  const timers=[],analyses=[],responses=[];let receive;
  const context={URL,Map,importScripts:()=>{},WallzRules:R,
    WallzNeural:{init:async()=>{},analyse:async(state,options)=>{analyses.push({state,options});return {nodes:1};}},
    setTimeout:(fn,delay)=>{const timer={fn,delay};timers.push(timer);return timer;},clearTimeout:timer=>{timer.cancelled=true;},
    chrome:{runtime:{onMessage:{addListener:fn=>{receive=fn;}}},tabs:{sendMessage:async()=>{}},action:{onClicked:{addListener:()=>{}}}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),context);
  const state={pawns:{p1:{x:4,y:0},p2:{x:4,y:8}},walls:[],wallsRemaining:{p1:10,p2:10},turn:'p1',winner:null,variant:'classic'};
  for(const id of [1,2])receive({type:'WALLZ_ANALYSE',id,state},{url:'https://www.wallz.gg/',tab:{id:1}},response=>responses.push(response));
  assert.ok(timers.every(timer=>timer.delay===0));
  for(const timer of timers)if(!timer.cancelled)timer.fn();
  await new Promise(setImmediate);
  assert.equal(analyses.length,1);assert.equal(analyses[0].options.budgetMs,3000);assert.equal(analyses[0].options.maxBudgetMs,6000);
  assert.ok(responses.find(response=>response.id===1).error);
  assert.ok(responses.find(response=>response.id===2).result);
});

test('the counter reports the first explored line without waiting for the progress interval',async()=>{
  N.clear();const updates=[];
  const state={pawns:[4,76],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'};
  const result=await N.analyse(state,{budgetMs:200,predictor:async()=>({logits:new Float32Array(136),value:0}),onProgress:update=>updates.push(update)});
  assert.ok(result.simulations>0);
  assert.equal(updates[0].nodes,0);assert.equal(updates[1].nodes,1);
  N.clear();
});

test('stale compute work is cancelled immediately without waiting for its polling tick',async()=>{
  const messages=[],intervals=[];let finish,stale=false;
  const context={crypto:{randomUUID:()=> 'fixture'},setInterval:fn=>{const timer={fn};intervals.push(timer);return timer;},clearInterval:timer=>{timer.cleared=true;},
    chrome:{runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,getContexts:async()=>[{}],onMessage:{addListener:()=>{}},sendMessage:message=>{
      messages.push(message);
      if(message.type==='WALLZ_COMPUTE_CANCEL')return Promise.resolve();
      return new Promise(resolve=>{finish=resolve;});
    }}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/compute.js'),'utf8'),context);
  const pending=context.WallzCompute.prepare({}, {budgetMs:500,shouldStop:()=>stale});
  await new Promise(setImmediate);
  context.WallzCompute.cancelStale();assert.equal(messages.length,1);
  stale=true;context.WallzCompute.cancelStale();context.WallzCompute.cancelStale();
  assert.equal(messages.length,2);assert.equal(messages[1].type,'WALLZ_COMPUTE_CANCEL');
  assert.equal(messages[0].id,messages[1].id);
  finish({result:{stopped:true}});await pending;
  assert.equal(intervals[0].cleared,true);
  context.WallzCompute.cancelStale();assert.equal(messages.length,2);
});
