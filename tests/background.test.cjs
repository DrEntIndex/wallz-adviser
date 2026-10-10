const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const rules=require('../extension/rules.js');
const opening={pawns:{p1:{x:4,y:0},p2:{x:4,y:8}},walls:[],wallsRemaining:{p1:10,p2:10},turn:'p1',winner:null,variant:'classic'};
function harness() {
  let receive,action;const timers=[],analyses=[],responses=[];
  const context={URL,Map,importScripts:()=>{},WallzRules:rules,
    WallzEngine:{analyse:(state,options)=>{analyses.push({state,options});return {candidates:[]};}},
    setTimeout:fn=>{const timer={fn};timers.push(timer);return timer;},clearTimeout:timer=>{timer.cancelled=true;},
    chrome:{runtime:{onMessage:{addListener:fn=>{receive=fn;}}},action:{onClicked:{addListener:fn=>{action=fn;}}},tabs:{sendMessage:()=>Promise.resolve()}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),context);
  return {context,analyses,responses,
    message:(request,tabId=1,url='https://www.wallz.gg/')=>receive(request,{url,tab:{id:tabId}},response=>responses.push(response)),
    send:(id,state=opening,tabId=1,budgetMs=1800,url='https://www.wallz.gg/')=>receive({type:'WALLZ_ANALYSE',id,state,budgetMs},{url,tab:{id:tabId}},response=>responses.push(response)),
    flush:()=>{for(const timer of timers.splice(0))if(!timer.cancelled)timer.fn();}
  };
}
test('a burst of positions searches only the newest waiting request in each tab',()=>{
  const h=harness();
  assert.equal(h.send(1),true);assert.equal(h.send(2),true);
  const next={...opening,pawns:{...opening.pawns,p1:{x:4,y:1}}};
  h.send(3,next);h.send(4,opening,2);h.flush();
  assert.equal(h.analyses.length,2);
  assert.equal(h.analyses[0].options.budgetMs,3000);
  assert.equal(h.analyses[0].state.pawns[0],13);
  assert.deepEqual(h.responses.map(r=>r.id),[1,2,3,4]);
  assert.ok(h.responses[0].error.includes('Superseded'));
  assert.ok(h.responses[1].error.includes('Superseded'));
  assert.ok(h.responses[2].result);assert.ok(h.responses[3].result);
});
test('an unsupported origin or malformed position never queues search',()=>{
  const h=harness();
  assert.equal(h.send(1,opening,1,1200,'https://example.com/'),false);
  assert.equal(h.send(2,{...opening,turn:'invalid'}),false);
  h.flush();assert.equal(h.analyses.length,0);
  assert.ok(h.responses.every(r=>r.error));
});
test('every request uses the strongest search regardless of old mode settings',()=>{
  const h=harness();h.send(1);h.flush();h.send(2,opening,1,12);h.flush();
  assert.equal(h.analyses.length,2);
  assert.equal(h.analyses[1].options.budgetMs,3000);
  assert.deepEqual(h.responses.map(r=>r.id),[1,2]);
  assert.ok(h.responses.every(r=>r.result));
});
test('search errors respond once and do not strand the next request',()=>{
  const h=harness();h.context.WallzEngine.analyse=()=>{throw new Error('Search failed');};
  h.send(1);h.flush();h.send(2);h.flush();
  assert.deepEqual(h.responses.map(r=>r.error),['Search failed','Search failed']);
});

test('a changed board cancels active neural search and queues the newest request',async()=>{
  const h=harness(),pending=[];
  h.context.WallzNeural={analyse:(state,options)=>new Promise(resolve=>pending.push({state,options,resolve}))};
  h.send(1);h.flush();await new Promise(setImmediate);
  assert.equal(pending.length,1);assert.equal(pending[0].options.shouldStop(),false);
  h.send(2);h.flush();assert.equal(pending[0].options.shouldStop(),true);
  pending[0].resolve({candidates:[]});await new Promise(setImmediate);
  assert.equal(pending.length,2);assert.equal(pending[1].options.budgetMs,3000);
  assert.equal(pending[1].options.shouldStop(),false);
  pending[1].resolve({candidates:[]});await new Promise(setImmediate);
  assert.deepEqual(h.responses.map(r=>r.id),[1,2]);
});

test('foreground analysis interrupts preparation and retains the full search budget',async()=>{
  const h=harness(),preparations=[],pending=[];
  h.context.WallzNeural={
    prepare:(state,options)=>new Promise(resolve=>preparations.push({state,options,resolve})),
    analyse:(state,options)=>new Promise(resolve=>pending.push({state,options,resolve}))
  };
  h.message({type:'WALLZ_PREPARE',id:1,state:opening});await new Promise(setImmediate);
  assert.equal(preparations.length,1);assert.equal(preparations[0].options.shouldStop(),false);
  h.send(2);h.flush();assert.equal(preparations[0].options.shouldStop(),true);
  assert.equal(pending.length,0);
  preparations[0].resolve({stopped:true});await new Promise(setImmediate);
  assert.equal(pending.length,1);assert.equal(pending[0].options.budgetMs,3000);
  pending[0].resolve({candidates:[]});await new Promise(setImmediate);
  assert.equal(preparations.length,1);assert.ok(h.responses.find(r=>r.id===2).result);
});

test('stop cancels waiting and active work without producing playable advice',async()=>{
  const h=harness(),pending=[];
  h.context.WallzNeural={prepare:(state,options)=>new Promise(resolve=>pending.push({options,resolve}))};
  h.message({type:'WALLZ_PREPARE',id:1,state:opening});await new Promise(setImmediate);
  h.message({type:'WALLZ_STOP',id:2});assert.equal(pending[0].options.shouldStop(),true);
  pending[0].resolve({stopped:true});await new Promise(setImmediate);
  h.send(3);h.message({type:'WALLZ_STOP',id:4});h.flush();await new Promise(setImmediate);
  assert.equal(h.analyses.length,0);assert.equal(pending.length,1);
  assert.ok(h.responses.find(r=>r.id===3).error);assert.ok(h.responses.find(r=>r.id===4).stopped);
  assert.equal(h.responses.some(r=>r.result),false);
});

test('an opponent update cancels active advice and starts preparation after it yields',async()=>{
  const h=harness(),pending=[],preparations=[];
  h.context.WallzNeural={
    analyse:(state,options)=>new Promise(resolve=>pending.push({options,resolve})),
    prepare:async(state,options)=>{preparations.push({state,options});return {stopped:false};}
  };
  h.send(1);h.flush();await new Promise(setImmediate);
  h.message({type:'WALLZ_PREPARE',id:2,state:{...opening,turn:'p2'}});
  assert.equal(pending[0].options.shouldStop(),true);assert.equal(preparations.length,0);
  pending[0].resolve({candidates:[]});await new Promise(setImmediate);
  assert.equal(preparations.length,1);assert.equal(preparations[0].state.turn,1);
  assert.ok(h.responses.find(r=>r.id===1).error);
});

test('foreground work in another tab takes priority and preparation resumes serially',async()=>{
  const h=harness(),preparations=[],pending=[];
  h.context.WallzNeural={
    prepare:(state,options)=>new Promise(resolve=>preparations.push({state,options,resolve})),
    analyse:(state,options)=>new Promise(resolve=>pending.push({state,options,resolve}))
  };
  h.message({type:'WALLZ_PREPARE',id:1,state:opening},1);await new Promise(setImmediate);
  h.send(2,opening,2);h.flush();assert.equal(preparations[0].options.shouldStop(),true);
  preparations[0].resolve({stopped:true});await new Promise(setImmediate);
  assert.equal(pending.length,1);assert.equal(preparations.length,1);
  pending[0].resolve({candidates:[]});await new Promise(setImmediate);
  assert.equal(preparations.length,2);assert.equal(preparations[1].options.shouldStop(),false);
  preparations[1].resolve({stopped:false});await new Promise(setImmediate);
  assert.equal(preparations.length,2);
});
