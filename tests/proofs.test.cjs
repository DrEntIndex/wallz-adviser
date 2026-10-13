const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const R=require('../extension/rules.js');
const E=require('../extension/engine.js');
const N=require('../extension/neural.js');

const route=()=>({pawns:[61,29],walls:[12,14,47,49,53,62,68,72,77,79,93,94,104,106,118,124],remaining:[2,2],turn:0,winner:null,variant:'classic'});

test('an alternative protected route defeats every legal opponent reply',()=>{
  const state=route(),before=JSON.stringify(state),proof=E.certify(state,{protectedOnly:true,budgetMs:200});
  assert.equal(proof.value,1);assert.equal(proof.plies,5);assert.equal(proof.kind,'protected-route');
  assert.deepEqual(proof.move,{type:'pawn',to:62});
  const memo=new Map();
  function forced(s,plies){
    if(s.winner!=null)return s.winner===0;
    if(!plies)return false;
    const key=R.stateKey(s)+':'+plies;if(memo.has(key))return memo.get(key);
    const moves=s.turn===0?R.pawnMoves(s):R.moves(s);
    const wins=s.turn===0?moves.some(move=>forced(R.apply(s,move),plies-1)):moves.every(move=>forced(R.apply(s,move),plies-1));
    memo.set(key,wins);return wins;
  }
  assert.equal(forced(R.apply(state,proof.move),proof.plies-1),true);
  assert.equal(JSON.stringify(state),before);
});

test('a certified route returns its winning move without model inference',async()=>{
  N.clear();let calls=0;
  const result=await N.analyse(route(),{budgetMs:300,predictor:async()=>{calls++;throw new Error('Inference should not be needed');}});
  assert.equal(result.engine,'exact-protected-route');assert.equal(result.provenWin,true);assert.equal(result.candidates[0].bound,'proven');
  assert.deepEqual(result.candidates[0].move,{type:'pawn',to:62});assert.equal(calls,0);
});

function proofGraph(){
  const context={WallzRules:R,WallzEngine:E,performance,setTimeout,clearTimeout};
  const source=fs.readFileSync(require.resolve('../extension/neural.js'),'utf8');
  assert.ok(source.includes('root.WallzNeural=api;'));
  vm.runInNewContext(source.replace('root.WallzNeural=api;','api.proofs={position,connect,solved,updateSolved};root.WallzNeural=api;'),context);
  const api=context.WallzNeural.proofs;
  const node=id=>api.position({pawns:[id,76],walls:[],remaining:[10,10],turn:id%2,winner:null,variant:'classic'});
  const link=(parent,child)=>{const edge={child:null};parent.edges??=[];parent.edges.push(edge);api.connect(parent,edge,child.state);};
  return {...api,node,link};
}

test('a shared child proof propagates through both parents to their ancestor',()=>{
  const g=proofGraph(),root=g.node(4),left=g.node(13),right=g.node(15),leaf=g.node(22);
  g.link(root,left);g.link(root,right);g.link(left,leaf);g.link(right,leaf);
  g.solved(leaf,-1,3);
  assert.equal(left.solved,1);assert.equal(right.solved,1);assert.equal(root.solved,-1);
  assert.equal(left.mate,4);assert.equal(right.mate,4);assert.equal(root.mate,5);
});

test('proof propagation keeps unresolved cycles and incomplete losses unproven',()=>{
  const g=proofGraph(),a=g.node(4),b=g.node(13);
  g.link(a,b);g.link(b,a);g.updateSolved(a);g.updateSolved(b);
  assert.equal(a.solved,null);assert.equal(b.solved,null);
  const parent=g.node(22),first=g.node(31),second=g.node(33);
  g.link(parent,first);g.link(parent,second);g.solved(first,1,2);
  assert.equal(parent.solved,null);
  g.solved(second,1,4);assert.equal(parent.solved,-1);assert.equal(parent.mate,5);
  const winner=g.node(40),loser=g.node(49),unknown=g.node(51);
  g.link(winner,loser);g.link(winner,unknown);g.solved(loser,-1,2);
  assert.equal(winner.solved,1);assert.equal(winner.mate,3);assert.equal(unknown.solved,null);
});

const trap=()=>({pawns:[40,51],walls:[8,10,12,28,31,38,44,46,77,84,93,100,117],remaining:[0,7],turn:1,winner:null,variant:'classic'});
function wallPlanEngine(){
 const context={WallzRules:R,performance:{now:()=>0},setTimeout,clearTimeout};
 const source=fs.readFileSync(require.resolve('../extension/engine.js'),'utf8');
 assert.ok(source.includes('const api={proveWalls,'));
 vm.runInNewContext(source.replace('const api={proveWalls,','const api={cached:s=>{load(s);return cachedWallProof();},proveWalls,'),context);
 return {E:context.WallzEngine,context};
}
const tables=new Map();
function race(s){
 const key=s.walls.join(',');if(tables.has(key))return tables.get(key);
 const n=13122,out=new Int8Array(n),degree=new Uint8Array(n),dtm=new Uint16Array(n),longest=new Uint16Array(n),parents=Array.from({length:n},()=>[]),queue=[];
 for(let t=0;t<2;t++)for(let b=0;b<81;b++)for(let a=0;a<81;a++){
  if(a===b)continue;const id=a+b*81+t*6561,wa=(a/9|0)===8,wb=(b/9|0)===0;
  if(wa||wb){if(wa&&wb)continue;out[id]=((wa?0:1)===t)?1:-1;queue.push(id);continue;}
  const moves=R.pawnMoves({...s,pawns:[a,b],turn:t,winner:null});degree[id]=moves.length;
  for(const m of moves)parents[t===0?m.to+b*81+6561:a+m.to*81].push(id);
 }
 for(let h=0;h<queue.length;h++)for(const p of parents[queue[h]]){
  if(out[p])continue;
  if(out[queue[h]]===-1){out[p]=1;dtm[p]=dtm[queue[h]]+1;queue.push(p);}
  else{longest[p]=Math.max(longest[p],dtm[queue[h]]+1);if(--degree[p]===0){out[p]=-1;dtm[p]=longest[p];queue.push(p);}}
 }
 const result={out,dtm};tables.set(key,result);return result;
}
function verify(E,state,player,plies){
 const memo=new Map();let replies=0;
 function visit(s,left){
  if(s.winner!=null)return s.winner===player;assert.ok(left>0);
  const key=R.stateKey(s)+':'+left;if(memo.has(key))return memo.get(key);
  if(s.remaining[1-player]===0){
   const table=race(s),index=s.pawns[0]+s.pawns[1]*81+s.turn*6561;
   if(table.out[index]===(s.turn===player?1:-1)){assert.ok(table.dtm[index]<=left);memo.set(key,true);return true;}
  }
  const children=R.successors(s);let result;
  if(s.turn===player){
   if(children.some(c=>c.state.winner===player))result=true;
   else{const proof=E.cached(s),choice=children.find(c=>proof?.move&&R.moveKey(c.move)===R.moveKey(proof.move));assert.ok(choice,'Missing legal certified move');result=visit(choice.state,left-1);}
  }else{assert.ok(children.length);result=children.every(c=>{replies++;return visit(c.state,left-1);});}
  memo.set(key,result);return result;
 }
 assert.equal(visit(state,plies),true);return replies;
}
test('a multiwall win survives every defensive pawn reply and independent race analysis',()=>{
 const {E}=wallPlanEngine(),s=trap(),before=JSON.stringify(s),answer=E.proveWalls(s,{budgetMs:1000});
 assert.ok(answer.proof);assert.equal(answer.proof.kind,'wall-sequence');assert.equal(answer.proof.value,1);
 assert.equal(answer.proof.move.type,'wall');assert.ok(verify(E,s,1,answer.proof.plies)>0);assert.equal(JSON.stringify(s),before);
 const child=R.apply(s,answer.proof.move);assert.equal(E.certify(child).value,-1);
 assert.equal(E.cached({...s,remaining:[2,5]}),null);
});
test('wall-sequence certificates respect mirrored boards and swapped player goals',()=>{
 const mirror=s=>({...s,pawns:s.pawns.map(p=>8-p%9+(p/9|0)*9),walls:s.walls.map(w=>(w<64?0:64)+7-(w&7)+((w&63)>>3)*8).sort((a,b)=>a-b)});
 const rotate=s=>({...s,pawns:[80-s.pawns[1],80-s.pawns[0]],walls:s.walls.map(w=>(w<64?0:64)+63-(w&63)).sort((a,b)=>a-b),remaining:s.remaining.slice().reverse(),turn:1-s.turn});
 const {E}=wallPlanEngine();for(const s of [mirror(trap()),rotate(trap())]){const answer=E.proveWalls(s,{budgetMs:1000});assert.equal(answer.proof?.value,1);verify(E,s,s.turn,answer.proof.plies);}
});
test('a wall-sequence certificate covers all legal defensive wall placements',()=>{
 const {E}=wallPlanEngine(),s={pawns:[61,29],walls:[12,14,47,49,53,62,68,72,77,79,93,94,104,106,118,124],remaining:[3,1],turn:0,winner:null,variant:'classic'};
 const answer=E.proveWalls(s,{budgetMs:1000});assert.equal(answer.proof?.value,1);assert.ok(verify(E,s,0,answer.proof.plies)>100);
});
test('cancelled and unsupported wall searches remain unknown and restore engine state',()=>{
 const {E,context}=wallPlanEngine(),s={...trap(),walls:trap().walls.filter(w=>w!==28),remaining:[1,7]},before=JSON.stringify(s);let calls=0;
 const result=E.proveWalls(s,{player:1,budgetMs:1000,shouldStop:()=>++calls>20});
 assert.equal(result.proof,null);assert.equal(result.complete,false);assert.equal(JSON.stringify(s),before);assert.equal(E.cached(s),null);
 for(const state of [{...s,variant:'race'},{...s,remaining:[2,6]}])assert.equal(E.proveWalls(state,{player:1}).proof,null);
 assert.equal(E.proveWalls(s,{player:2}).proof,null);
 context.performance=performance;assert.doesNotThrow(()=>E.evaluate(s));
});
test('completed wall proofs return a legal win without inference and never call a loss a win',async()=>{
 const {E,context}=wallPlanEngine(),s=trap(),proof=E.proveWalls(s,{budgetMs:1000}).proof;
 context.performance=performance;vm.runInNewContext(fs.readFileSync(require.resolve('../extension/neural.js'),'utf8'),context);
 let calls=0;const predictor=async()=>{calls++;throw Error('Inference must not be needed');};
 const win=await context.WallzNeural.analyse(s,{budgetMs:3000,maxBudgetMs:6000,predictor});
 assert.equal(win.engine,'exact-wall-sequence');assert.equal(win.provenWin,true);assert.doesNotThrow(()=>R.apply(s,win.candidates[0].move));
 const loss=await context.WallzNeural.analyse(R.apply(s,proof.move),{budgetMs:3000,maxBudgetMs:6000,predictor});
 assert.equal(loss.provenWin,false);assert.ok(loss.candidates.every(c=>c.bound==='proven'&&c.score<0));assert.equal(calls,0);
});
test('opponent-time wall planning preserves search visits and supplies a verified foreground move',async()=>{
 const {E,context}=wallPlanEngine(),s=trap(),before=JSON.stringify(s);let clock=0,plans=0;
 context.performance={now:()=>clock};
 context.WallzInference={init:async()=>{},evaluate:async()=>{clock+=10;return {logits:new Float32Array(136),value:.9};}};
 const prove=E.proveWalls;E.proveWalls=(s,o)=>{const answer=prove(s,o);clock+=o.budgetMs;plans++;return answer;};
 const source=fs.readFileSync(require.resolve('../extension/neural.js'),'utf8').replace('root.WallzNeural=api;','api.visits=s=>positions.get(R.stateKey(s))?.visits||0;root.WallzNeural=api;');
 vm.runInNewContext(source,context);const N=context.WallzNeural;
 const prepared=await N.prepare(s,{budgetMs:500});assert.ok(plans>0);assert.equal(N.visits(s),0);assert.ok(clock<=500);assert.equal(JSON.stringify(s),before);
 assert.equal(E.cached(s)?.value,1);assert.ok(prepared.visited>0);
 context.performance=performance;const result=await N.analyse(s,{budgetMs:3000,maxBudgetMs:6000,predictor:async()=>{throw Error('Unnecessary inference');}});
 assert.equal(result.provenWin,true);assert.equal(result.engine,'exact-wall-sequence');assert.doesNotThrow(()=>R.apply(s,result.candidates[0].move));
});
test('foreground cancellation interrupts and resumes opponent-time wall planning',async()=>{
 const {E,context}=wallPlanEngine(),s=trap(),before=JSON.stringify(s);let clock=0,cancelled=false,plans=0;
 context.performance={now:()=>clock};context.setTimeout=fn=>{clock++;fn();};
 context.WallzInference={init:async()=>{},evaluate:async()=>{clock+=10;return {logits:new Float32Array(136),value:.9};}};
 const prove=E.proveWalls;E.proveWalls=(s,o)=>{plans++;cancelled=true;return prove(s,o);};
 vm.runInNewContext(fs.readFileSync(require.resolve('../extension/neural.js'),'utf8'),context);
 const options={budgetMs:500,shouldStop:()=>cancelled},first=await context.WallzNeural.prepare(s,options);
 assert.ok(plans>0);assert.equal(first.stopped,true);assert.equal(first.done,false);assert.equal(E.cached(s),null);assert.equal(JSON.stringify(s),before);
 cancelled=false;const next=await context.WallzNeural.prepare(s,options);assert.ok(next.visited>=first.visited);assert.equal(next.stopped,true);assert.equal(JSON.stringify(s),before);
});
test('a learned preference for spending the last wall cannot override a proved multiwall refutation',async()=>{
 const {E,context}=wallPlanEngine(),child=trap(),wall=28,state={...child,walls:child.walls.filter(w=>w!==wall),remaining:[1,7],turn:0};
 assert.deepEqual(R.apply(state,{type:'wall',wall}),child);
 assert.equal(E.proveWalls(child,{budgetMs:1000}).proof?.value,1);
 context.performance=performance;vm.runInNewContext(fs.readFileSync(require.resolve('../extension/neural.js'),'utf8'),context);
 const N=context.WallzNeural,result=await N.analyse(state,{budgetMs:400,predictor:async s=>{
  const logits=new Float32Array(136).fill(-100);logits[N.policyIndex(s,{type:'wall',wall})]=100;return {logits,value:.9};
 }});
 assert.equal(result.engine,'neural-puct');assert.notEqual(R.moveKey(result.candidates[0].move),'w'+wall);assert.equal(result.provenWin,false);
 assert.doesNotThrow(()=>R.apply(state,result.candidates[0].move));
});
