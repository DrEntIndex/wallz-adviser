const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const R=require('../extension/rules.js');
const E=require('../extension/engine.js');

function harness(stable=false){
  let clock=0;
  const state={id:'root',pawns:[4,76],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'};
  const apply=(s,move)=>({...s,id:s.id+'/'+move.wall,turn:1-s.turn});
  const rules={stateKey:s=>s.id,apply,moveKey:m=>String(m.wall),distances:()=>[8,8],path:()=>[],pawnMoves:()=>[],goal:()=>8,
    successors:s=>(s.id==='root'?[0,1]:[0]).map(wall=>{const move={type:'wall',wall};return {move,state:apply(s,move)};})};
  const context={WallzRules:rules,WallzEngine:{certify:()=>null,proveThreat:()=>null,analyse:()=>({candidates:[],nodes:0})},
    performance:{now:()=>++clock},setTimeout:fn=>{clock++;fn();},clearTimeout:()=>{}};
  const source=fs.readFileSync(require.resolve('../extension/neural.js'),'utf8');
  vm.runInNewContext(source.replace('root.WallzNeural=api;','api.timing={thinkingBudget,unsettled,searchChoice};root.WallzNeural=api;'),context);
  const predictor=async()=>{clock+=10;const logits=new Float32Array(136);if(stable)logits[8]=12;return {logits,value:0};};
  return {api:context.WallzNeural,state,predictor,time:()=>clock};
}

test('a settled decision keeps the normal three-second budget',async()=>{
  const h=harness(true),result=await h.api.analyse(h.state,{budgetMs:3000,maxBudgetMs:6000,predictor:h.predictor});
  assert.equal(result.engine,'neural-puct');assert.equal(result.searchBudgetMs,3000);
  assert.ok(result.elapsedMs>=2900&&result.elapsedMs<=3000);
});

test('competitive alternatives extend thinking but cannot exceed six seconds',async()=>{
  const h=harness(),updates=[];
  const result=await h.api.analyse(h.state,{budgetMs:3000,maxBudgetMs:60000,predictor:h.predictor,onProgress:p=>updates.push({time:h.time(),nodes:p.nodes})});
  assert.equal(result.engine,'neural-puct');assert.equal(result.searchBudgetMs,6000);
  assert.ok(result.elapsedMs>=5900&&result.elapsedMs<=6000);
  assert.ok(updates.some(p=>p.time>3000&&p.nodes>0));
});

test('cancellation still interrupts an extended search',async()=>{
  const h=harness(),result=await h.api.analyse(h.state,{budgetMs:3000,maxBudgetMs:6000,predictor:h.predictor,shouldStop:()=>h.time()>=3300});
  assert.equal(result.engine,'neural-puct');assert.equal(result.searchBudgetMs,3500);
  assert.ok(result.elapsedMs>=3300&&result.elapsedMs<3400);
});

test('quick mode settles at two seconds and extends in half-second steps up to four',async()=>{
  const stable=harness(true),settled=await stable.api.analyse(stable.state,{budgetMs:2000,maxBudgetMs:4000,predictor:stable.predictor});
  assert.equal(settled.searchBudgetMs,2000);assert.ok(settled.elapsedMs>=1900&&settled.elapsedMs<=2000);
  const h=harness(),extended=await h.api.analyse(h.state,{budgetMs:2000,maxBudgetMs:4000,predictor:h.predictor});
  assert.equal(extended.searchBudgetMs,4000);assert.ok(extended.elapsedMs>=3900&&extended.elapsedMs<=4000);
  for(const [stop,budget] of [[2200,2500],[2700,3000],[3200,3500],[3700,4000]]){
    const h=harness(),result=await h.api.analyse(h.state,{budgetMs:2000,maxBudgetMs:4000,predictor:h.predictor,shouldStop:()=>h.time()>=stop});
    assert.equal(result.searchBudgetMs,budget);assert.ok(result.elapsedMs>=stop&&result.elapsedMs<stop+100);
  }
});

test('fixed-budget callers retain their requested search limit',async()=>{
  const h=harness(),result=await h.api.analyse(h.state,{budgetMs:1000,predictor:h.predictor});
  assert.equal(result.searchBudgetMs,1000);assert.ok(result.elapsedMs<=1000);
});

test('extension decisions recognize changing leaders, changing values and close alternatives',()=>{
  const {unsettled}=harness().api.timing;
  const sample={move:'a',value:.3,visits:100,challengerValue:0,challengerVisits:10};
  assert.equal(unsettled([sample,sample]),false);
  assert.equal(unsettled([{...sample,move:'b'},sample]),true);
  assert.equal(unsettled([{...sample,value:.1},sample]),true);
  const close={...sample,challengerValue:.31,challengerVisits:85};
  assert.equal(unsettled([close,close]),true);
  const promising={...sample,challengerValue:.4,challengerVisits:30};
  assert.equal(unsettled([promising,promising]),true);
  const only={...sample,challengerValue:null,challengerVisits:0};
  assert.equal(unsettled([only,only]),false);
});

test('proven winning routes still return immediately with extension enabled',async()=>{
  const context={WallzRules:R,WallzEngine:E,performance,setTimeout,clearTimeout};
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/neural.js'),'utf8'),context);
  const state={pawns:[61,29],walls:[12,14,47,49,53,62,68,72,77,79,93,94,104,106,118,124],remaining:[2,2],turn:0,winner:null,variant:'classic'};
  const result=await context.WallzNeural.analyse(state,{budgetMs:3000,maxBudgetMs:6000,predictor:async()=>{throw new Error('Unnecessary inference');}});
  assert.equal(result.engine,'exact-protected-route');assert.ok(result.elapsedMs<100);
  assert.equal(result.candidates[0].move.to,62);
});

test('the compute bridge and worker preserve the maximum thinking budget',async()=>{
  let sent,receive,options;
  const bridge={crypto:{randomUUID:()=> 'fixture'},chrome:{runtime:{getURL:p=>p,getContexts:async()=>[{}],onMessage:{addListener:()=>{}},sendMessage:async message=>{sent=message;return {result:{nodes:1}};}}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/compute.js'),'utf8'),bridge);
  await bridge.WallzCompute.analyse({}, {budgetMs:3000,maxBudgetMs:6000});
  assert.equal(sent.budgetMs,3000);assert.equal(sent.maxBudgetMs,6000);
  const responses=[];
  const worker={URL,location:{href:'https://fixture/compute-worker.js?threads=1'},importScripts:()=>{},self:{},postMessage:m=>responses.push(m),
    WallzNeural:{analyse:async(s,o)=>{options=o;return {nodes:1};}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/compute-worker.js'),'utf8'),worker);
  receive=worker.self.onmessage;receive({data:sent});await new Promise(setImmediate);
  assert.equal(options.budgetMs,3000);assert.equal(options.maxBudgetMs,6000);assert.equal(responses[0].result.nodes,1);
});
