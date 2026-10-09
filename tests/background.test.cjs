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
    send:(id,state=opening,tabId=1,budgetMs=3500,url='https://www.wallz.gg/')=>receive({type:'WALLZ_ANALYSE',id,state,budgetMs},{url,tab:{id:tabId}},response=>responses.push(response)),
    flush:()=>{for(const timer of timers.splice(0))if(!timer.cancelled)timer.fn();}
  };
}
test('a burst of positions searches only the newest waiting request in each tab',()=>{
  const h=harness();
  assert.equal(h.send(1),true);assert.equal(h.send(2),true);
  const next={...opening,pawns:{...opening.pawns,p1:{x:4,y:1}}};
  h.send(3,next);h.send(4,opening,2);h.flush();
  assert.equal(h.analyses.length,2);
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
test('a completed request leaves the tab ready for another search',()=>{
  const h=harness();h.send(1);h.flush();h.send(2,opening,1,12);h.flush();
  assert.equal(h.analyses.length,2);
  assert.equal(h.analyses[1].options.budgetMs,1200);
  assert.deepEqual(h.responses.map(r=>r.id),[1,2]);
  assert.ok(h.responses.every(r=>r.result));
});
test('search errors respond once and do not strand the next request',()=>{
  const h=harness();h.context.WallzEngine.analyse=()=>{throw new Error('Search failed');};
  h.send(1);h.flush();h.send(2);h.flush();
  assert.deepEqual(h.responses.map(r=>r.error),['Search failed','Search failed']);
});
