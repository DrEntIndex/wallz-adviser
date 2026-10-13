const {test}=require('node:test');
const assert=require('node:assert/strict');
const R=require('../extension/rules.js');
const N=require('../extension/neural.js');
const start=()=>({pawns:[4,76],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'});

test('neural input preserves vertical-wall segments after changing player perspective',()=>{
  const s={...start(),walls:[3,84],remaining:[8,9],turn:1},input=N.encode(s);
  assert.equal(input[4],1);
  assert.equal(input[81+76],1);
  assert.equal(input[162+66],1);assert.equal(input[162+67],1);
  assert.equal(input[243+49],1);assert.equal(input[243+58],1);
  assert.ok(Math.abs(input[324]-.9)<1e-6);
  assert.ok(Math.abs(input[405]-.8)<1e-6);
  assert.deepEqual(Array.from(input.slice(486,567)),Array.from(R.graph(s).maps[1],(_,p)=>Math.fround(R.graph(s).maps[1][(8-(p/9|0))*9+p%9]/80)));
});

test('policy indices distinguish straight jumps, diagonal jumps, and flipped walls',()=>{
  const s={...start(),pawns:[31,40]};
  assert.equal(N.policyIndex(s,{type:'pawn',to:49}),0);
  assert.equal(N.policyIndex(s,{type:'pawn',to:39}),4);
  const flipped={...s,pawns:[40,49],turn:1};
  assert.equal(N.policyIndex(flipped,{type:'pawn',to:31}),0);
  assert.equal(N.policyIndex(flipped,{type:'wall',wall:3}),67);
  assert.equal(N.policyIndex(flipped,{type:'wall',wall:84}),116);
});

test('search retains every legal root wall even with concentrated learned priors',async()=>{
  N.clear();const s=start(),before=JSON.stringify(s);
  const predictor=async()=>({logits:Float32Array.from({length:136},(_,i)=>i===0?8:0),value:0});
  const result=await N.analyse(s,{budgetMs:200,predictor});
  assert.equal(result.engine,'neural-puct');assert.equal(result.provenWin,false);assert.equal(result.legalCount,131);assert.equal(result.wallWidth,128);
  assert.ok(result.simulations>0);assert.ok(result.searchedCount>=8);
  for(const c of result.candidates)assert.doesNotThrow(()=>R.apply(s,c.move));
  assert.equal(JSON.stringify(s),before);
});

test('overconfident attacking priors still explore legal defences to a goal threat',async()=>{
  N.clear();const s={...start(),pawns:[58,13]};
  const predictor=async()=>({logits:Float32Array.from({length:136},(_,i)=>i<8?1000:0),value:.8});
  const result=await N.analyse(s,{budgetMs:200,predictor});
  assert.equal(result.engine,'neural-puct');
  const best=result.candidates[0],child=R.apply(s,best.move);
  assert.equal(best.move.type,'wall');assert.ok(best.prior>.1);
  assert.equal(R.pawnMoves(child).some(move=>Math.floor(move.to/9)===R.goal(child,child.turn)),false);
});

test('a confident model cannot overrule an immediate winning pawn move',async()=>{
  N.clear();let calls=0;
  const s={...start(),pawns:[67,40]};
  const result=await N.analyse(s,{budgetMs:200,predictor:async()=>{calls++;throw new Error('Not needed');}});
  assert.deepEqual(result.candidates[0].move,{type:'pawn',to:76});assert.equal(calls,0);
});

test('race positions use the correct shared goal instead of the classic-only model',async()=>{
  N.clear();const s={...start(),pawns:[12,77],variant:'race'};
  const result=await N.analyse(s,{budgetMs:80,predictor:async()=>{throw new Error('Wrong ruleset');}});
  assert.equal(result.engine,'race-search');assert.deepEqual(result.candidates[0].move,{type:'pawn',to:3});
});

test('a failed inference still returns legal advice within the remaining time',async()=>{
  N.clear();const s=start();
  const result=await N.analyse(s,{budgetMs:100,predictor:async()=>{throw new Error('Inference failed');}});
  assert.equal(result.engine,'classical-fallback');assert.doesNotThrow(()=>R.apply(s,result.candidates[0].move));
  let calls=0;
  const retry=await N.analyse(s,{budgetMs:100,predictor:async()=>{calls++;return {logits:new Float32Array(136),value:0};}});
  assert.equal(retry.engine,'neural-puct');assert.ok(calls>0);assert.ok(retry.candidates[0].prior>0);
});

test('a proved race follows the winning lateral jump without consulting the model',async()=>{
  N.clear();let calls=0;
  const s={...start(),pawns:[49,58],walls:[52],remaining:[1,0]},before=JSON.stringify(s);
  const result=await N.analyse(s,{budgetMs:200,predictor:async()=>{calls++;throw new Error('Not needed');}});
  assert.equal(result.engine,'exact-race-bound');assert.equal(result.candidates[0].bound,'proven');
  assert.deepEqual(result.candidates[0].move,{type:'pawn',to:57});assert.equal(result.depth,5);
  assert.equal(calls,0);assert.equal(JSON.stringify(s),before);
  const child=R.apply(s,result.candidates[0].move);
  for(const reply of R.pawnMoves(child)){
    const next=R.apply(child,reply),answer=await N.analyse(next,{budgetMs:200,predictor:async()=>{calls++;throw new Error('Not needed');}});
    assert.equal(answer.engine,'exact-race-bound');assert.ok(answer.depth<result.depth);
    assert.equal(answer.candidates[0].move.type,'pawn');assert.equal(answer.candidates[0].bound,'proven');
  }
  assert.equal(calls,0);
});

test('preparation caches evaluations without adding speculative search visits',async()=>{
  N.clear();const inference=globalThis.WallzInference;let calls=0;
  globalThis.WallzInference={init:async()=>{},info:()=>({inferenceMs:1,backend:'fixture'}),evaluate:async()=>{calls++;return {logits:new Float32Array(136),value:.25};}};
  try{
    const s=start(),before=JSON.stringify(s);
    const prepared=await N.prepare(s,{budgetMs:200,shouldStop:()=>calls>=1});
    assert.equal(prepared.prepared,1);assert.equal(prepared.stopped,true);assert.equal(calls,1);
    const result=await N.analyse(s,{budgetMs:100,shouldStop:()=>true});
    assert.equal(calls,1);assert.equal(result.simulations,0);assert.equal(result.legalCount,131);
    assert.ok(result.candidates.every(c=>c.visits===0));assert.equal(JSON.stringify(s),before);
  }finally{N.clear();globalThis.WallzInference=inference;}
});

test('preparation resumes after its time slice without evaluating the root twice',async()=>{
  N.clear();const inference=globalThis.WallzInference,clock=globalThis.performance;let now=0,calls=0;
  globalThis.performance={now:()=>now};
  globalThis.WallzInference={init:async()=>{},evaluate:async()=>{calls++;now+=50;return {logits:Float32Array.from({length:136},(_,i)=>i===0?12:0),value:0};}};
  try{
    const state=start(),first=await N.prepare(state,{budgetMs:40});
    assert.equal(first.visited,1);assert.equal(first.stopped,false);assert.equal(first.done,false);
    const second=await N.prepare(state,{budgetMs:40});
    assert.equal(second.visited,2);assert.equal(second.done,false);assert.equal(calls,2);
    await N.prepare(state,{budgetMs:40,shouldStop:()=>true});assert.equal(calls,2);
  }finally{globalThis.performance=clock;N.clear();globalThis.WallzInference=inference;}
});

test('preparation covers opponent replies and continues beyond two plies',async()=>{
  N.clear();const inference=globalThis.WallzInference,inputs=[];let calls=0;
  globalThis.WallzInference={init:async()=>{},evaluate:async input=>{calls++;inputs.push(input);return {logits:Float32Array.from({length:136},(_,i)=>i===0?12:0),value:0};}};
  try{
    const state=start(),before=JSON.stringify(state);
    const result=await N.prepare(state,{budgetMs:4000,shouldStop:()=>calls>=180});
    assert.equal(result.visited,180);assert.equal(result.done,false);
    const signature=input=>Buffer.from(input.buffer,input.byteOffset,input.byteLength).toString('base64');
    const evaluated=new Set(inputs.map(signature));
    for(const child of R.successors(state))assert.ok(evaluated.has(signature(N.encode(child.state))));
    const deeper=R.apply(R.apply(R.apply(state,{type:'pawn',to:13}),{type:'pawn',to:67}),{type:'pawn',to:22});
    assert.ok(evaluated.has(signature(N.encode(deeper))));assert.equal(JSON.stringify(state),before);
  }finally{N.clear();globalThis.WallzInference=inference;}
});

test('alternating opponent positions resume their own preparation progress',async()=>{
  N.clear();const inference=globalThis.WallzInference;let calls=0;
  globalThis.WallzInference={init:async()=>{},evaluate:async()=>{calls++;return {logits:new Float32Array(136),value:0};}};
  try{
    const a=start(),b={...start(),pawns:[13,67]},progress=[];
    const first=await N.prepare(a,{budgetMs:1000,shouldStop:()=>calls>=8});
    await N.prepare(b,{budgetMs:1000,shouldStop:()=>calls>=12});
    const next=await N.prepare(a,{budgetMs:1000,shouldStop:()=>calls>=14,onProgress:update=>progress.push(update.nodes)});
    assert.equal(progress[0],first.visited,'returning to a tab must resume rather than restart its preparation counter and queue');
    assert.ok(next.visited>first.visited);
  }finally{N.clear();globalThis.WallzInference=inference;}
});

test('short preparation reaches likely continuations before sweeping every opponent wall',async()=>{
  N.clear();const inference=globalThis.WallzInference,inputs=[];let calls=0;
  globalThis.WallzInference={init:async()=>{},evaluate:async input=>{calls++;inputs.push(Array.from(input));return {logits:Float32Array.from({length:136},(_,i)=>i===0?12:0),value:0};}};
  try{
    const state=start(),result=await N.prepare(state,{budgetMs:1000,shouldStop:()=>calls>=12});
    const likely=R.apply(R.apply(state,{type:'pawn',to:13}),{type:'pawn',to:67}),expected=N.encode(likely);
    assert.equal(result.visited,12);
    assert.ok(inputs.some(input=>input.every((value,i)=>value===expected[i])),'the likely next search continuation should be ready within twelve evaluations');
  }finally{N.clear();globalThis.WallzInference=inference;}
});

test('search reports prepared evaluations consumed separately from fresh model work',async()=>{
  N.clear();const inference=globalThis.WallzInference;let calls=0;
  globalThis.WallzInference={init:async()=>{},info:()=>({inferenceMs:1,backend:'fixture'}),evaluate:async()=>{calls++;return {logits:new Float32Array(136),value:.25};}};
  try{
    const opponent={...start(),turn:1},state=R.apply(opponent,{type:'pawn',to:67});
    await N.prepare(opponent,{budgetMs:200,shouldStop:()=>calls>=6});
    const before=calls,first=await N.analyse(state,{budgetMs:100,shouldStop:()=>true});
    assert.equal(calls,before,'the actual opponent reply should reuse its prepared model evaluation');
    assert.deepEqual(first.evaluationStats,{preparedHits:1,searchHits:0,fresh:0});
    // A fresh tree after clearing, with no preparation, must report a model evaluation.
    N.clear();
    const cold=await N.analyse(state,{budgetMs:100,shouldStop:()=>true});
    assert.deepEqual(cold.evaluationStats,{preparedHits:0,searchHits:0,fresh:1});
  }finally{N.clear();globalThis.WallzInference=inference;}
});

test('cancelled preparation and other rulesets do not start model evaluation',async()=>{
  N.clear();const inference=globalThis.WallzInference;let calls=0;
  globalThis.WallzInference={init:async()=>{calls++;},evaluate:async()=>{throw new Error('Not needed');}};
  try{
    await N.prepare(start(),{shouldStop:()=>true});
    await N.prepare({...start(),variant:'race'});
    await N.prepare({...start(),winner:0});
    await N.prepare({...start(),remaining:[0,0]});assert.equal(calls,0);
  }finally{N.clear();globalThis.WallzInference=inference;}
});
