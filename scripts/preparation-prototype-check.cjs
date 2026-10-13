const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const R=require('../extension/rules.js'),E=require('../extension/engine.js');
const start=()=>({pawns:[4,76],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'});
const output=()=>({logits:Float32Array.from({length:136},(_,i)=>i===0?12:0),value:.5});
function harness(){
  let calls=0;const context={WallzRules:R,WallzEngine:E,performance,setTimeout,clearTimeout,Float32Array,WallzInference:{init:async()=>{},info:()=>({inferenceMs:1,backend:'fixture'}),evaluate:async()=>{calls++;return output();}}};
  let source=fs.readFileSync(path.join(__dirname,'../work/preparation-design/bounded.js'),'utf8');
  source=source.replace('root.WallzNeural=api;','api.inspect=s=>positions.get(R.stateKey(s));api.jobs=()=>preparations;api.graph=()=>({nodes:positions.size,edges:graphEdges,live:[...positions.values()].reduce((n,x)=>n+(x.edges?.length||0),0)});api.positions=positions;api.position=position;api.retain=retainSearch;api.simulate=ponderSimulation;root.WallzNeural=api;');
  vm.runInNewContext(source,context);return {context,N:context.WallzNeural,calls:()=>calls};
}
(async()=>{
  const h=harness(),state=start(),next=R.apply(state,{type:'pawn',to:13}),before=JSON.stringify(state);
  await h.N.prepare(state,{budgetMs:1000,shouldStop:()=>h.N.inspect(next)?.visits>=1});
  const node=h.N.inspect(next),edge=node.edges.find(e=>e.visits);
  assert.equal(node.visits,1);assert.equal(edge.total,-.5);assert.equal(node.preparedVisits,1);
  const advice=await h.N.analyse(next,{budgetMs:100,shouldStop:()=>true});assert.equal(advice.preparedVisits,1);assert.equal(advice.simulations,0);R.apply(next,advice.candidates[0].move);
  assert.equal(JSON.stringify(state),before);assert.equal(h.N.graph().edges,h.N.graph().live);
  for(const job of h.N.jobs().values())assert.ok(job.root.edges.every(e=>!e.child));
  for(const cancelAt of [1,2,3]){
    const c=harness();let count=0,resolve,entered,stopped=false;
    const pendingInference=new Promise(r=>entered=r);
    c.context.WallzInference.evaluate=async()=>{count++;if(count===cancelAt){entered();return new Promise(r=>resolve=r);}return output();};
    const pending=c.N.prepare(start(),{budgetMs:1000,shouldStop:()=>stopped});await pendingInference;stopped=true;resolve(output());await pending;
    assert.equal(c.N.graph().edges,c.N.graph().live,`cancel inference ${cancelAt} live edge accounting`);
    for(const n of c.N.positions.values())assert.equal(n.visits,0,'unfinished simulation cannot publish visits');
    for(const job of c.N.jobs().values())assert.ok(job.root.edges.every(e=>!e.child));
    stopped=false;await c.N.prepare(start(),{budgetMs:1000,shouldStop:()=>c.N.inspect(next)?.visits>=1});
    assert.ok(c.N.inspect(next).visits>=1);assert.equal(c.N.graph().edges,c.N.graph().live);
  }
  const fail=harness();let failedCalls=0;
  fail.context.WallzInference.evaluate=async()=>{if(++failedCalls===3)throw Error('fixture failure');return output();};
  await assert.rejects(fail.N.prepare(start(),{budgetMs:1000}),/fixture failure/);
  assert.equal(fail.N.graph().edges,fail.N.graph().live);for(const job of fail.N.jobs().values())assert.ok(job.root.edges.every(e=>!e.child));
  // Fill disconnected storage to force retention; retain the actual observed root
  // object and its evidence, and remove both directions of discarded links.
  const oldRoot=h.N.position(state),rootVisits=node.visits;
  oldRoot.edges=[{child:node}];node.parents.add(oldRoot);
  for(let i=0;i<12000;i++)h.N.positions.set('unrelated-'+i,{key:'unrelated-'+i,edges:null,parents:new Set()});
  h.N.retain(next);assert.equal(h.N.inspect(next),node);assert.equal(node.visits,rootVisits);
  assert.ok(!node.parents.has(oldRoot));assert.ok(h.N.graph().nodes<=6000);assert.ok(h.N.graph().edges<=125000);assert.equal(h.N.graph().edges,h.N.graph().live);assert.equal(h.N.jobs().size,0);
  for(const retained of h.N.positions.values())for(const e of retained.edges||[])if(e.child)assert.equal(h.N.positions.get(e.child.key),e.child);
  // A retained exact proof must not outlive the winning move's witness. Exercise
  // conservative invalidation with a synthetic proof over real legal states.
  node.solved=1;node.mate=3;node.probes=[edge];node.ponderProbes=[edge];node.preparedVisits=9;
  h.N.retain(next);assert.equal(node.solved,null);assert.equal(node.edges,null);
  assert.equal(node.visits,0);assert.equal(node.preparedVisits,0);assert.equal(node.probes,undefined);assert.equal(node.ponderProbes,undefined);
  assert.equal(h.N.graph().edges,h.N.graph().live);
  const renewed=await h.N.analyse(next,{budgetMs:100,shouldStop:()=>true});
  assert.equal(renewed.provenWin,false);assert.equal(renewed.legalCount,R.moves(next).length);R.apply(next,renewed.candidates[0].move);
  // A cycle is a path-local estimated draw; it must terminate and never become
  // an exact proof. Build a small explicit transposition graph to exercise backup.
  const cyc=harness(),a=cyc.N.position(state),b=cyc.N.position(next);
  const ab={move:{type:'pawn',to:13},prior:1,visits:0,total:0,child:b},ba={move:{type:'pawn',to:67},prior:1,visits:0,total:0,child:a};
  a.edges=[ab];b.edges=[ba];a.ponderProbes=[];b.ponderProbes=[];a.parents.add(b);b.parents.add(a);
  const value=await cyc.N.simulate(a,performance.now()+1000,()=>false);
  assert.equal(value,0);assert.equal(ab.visits,1);assert.equal(ba.visits,1);assert.equal(a.solved,null);assert.equal(b.solved,null);
  const coverage=harness();coverage.context.performance={now:()=>0};
  await coverage.N.prepare(state,{budgetMs:4000,shouldStop:()=>coverage.calls()>=900});
  const job=[...coverage.N.jobs().values()][0];
  assert.equal(job.root.edges.length,R.successors(state).filter(c=>c.state.winner==null).length);
  assert.ok(job.root.edges.filter(e=>e.visits||coverage.N.inspect(R.apply(state,e.move))?.solved!=null).length>=40,'coverage lane must reach alternatives even with a concentrated policy');
  assert.ok(coverage.N.graph().nodes<=12000);assert.ok(coverage.N.graph().edges<=250000);assert.equal(coverage.N.graph().edges,coverage.N.graph().live);
  const tabs=harness(),boards=[state,{...start(),pawns:[13,67]},{...start(),pawns:[22,58]},{...start(),pawns:[31,49]},{...start(),pawns:[31,40]}];
  const slice=async board=>{const until=tabs.calls()+8;return tabs.N.prepare(board,{budgetMs:1000,shouldStop:()=>tabs.calls()>=until});};
  const first=await slice(boards[0]);await slice(boards[1]);const progress=[],until=tabs.calls()+8;
  await tabs.N.prepare(boards[0],{budgetMs:1000,shouldStop:()=>tabs.calls()>=until,onProgress:u=>progress.push(u.nodes)});
  assert.equal(progress[0],first.visited,'alternating tabs resume their own completed work');
  await slice(boards[2]);await slice(boards[3]);assert.equal(tabs.N.jobs().size,4);await slice(boards[4]);assert.equal(tabs.N.jobs().size,4);
  assert.ok(tabs.N.jobs().has(R.stateKey(boards[0])));assert.ok(!tabs.N.jobs().has(R.stateKey(boards[1])),'fifth tab evicts the least recent job');
  const worker=harness(),messages=[];let inferenceCalls=0,release,entered;
  const deferred=new Promise(r=>entered=r);
  worker.context.WallzInference.evaluate=async()=>{if(++inferenceCalls===3){entered();return new Promise(r=>release=r);}return output();};
  Object.assign(worker.context,{self:worker.context,location:{href:'https://fixture/compute-worker.js?threads=4'},URL,importScripts:()=>{},postMessage:m=>messages.push(m)});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/compute-worker.js'),'utf8'),worker.context);
  worker.context.onmessage({data:{action:'prepare',id:'old',state,budgetMs:1000}});await deferred;
  worker.context.onmessage({data:{action:'cancel',id:'old'}});
  worker.context.onmessage({data:{action:'analyse',id:'new',state:next,budgetMs:100}});
  await Promise.resolve();assert.ok(!messages.some(m=>m.id==='new'),'foreground waits for interrupted inference to settle');
  release(output());const workerDeadline=performance.now()+2000;
  while(!messages.some(m=>m.id==='new'&&m.result)&&performance.now()<workerDeadline)await new Promise(r=>setTimeout(r,5));
  assert.ok(messages.some(m=>m.id==='new'&&m.result),'worker returns current advice after cancellation');
  assert.ok(messages.find(m=>m.id==='old'&&m.result).result.stopped);
  assert.ok(!messages.some(m=>m.error));R.apply(next,messages.find(m=>m.id==='new'&&m.result).result.candidates[0].move);
  assert.equal(worker.N.graph().edges,worker.N.graph().live);
  console.log('Bounded pondering checks: PASS (signs, observed-root adoption, cancellation at every inference stage, recovery, failure cleanup, exact edge counts, graph retention, cycles)');
})().catch(error=>{console.error(error);process.exitCode=1;});
