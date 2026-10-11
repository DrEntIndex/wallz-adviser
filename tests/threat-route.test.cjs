const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../extension/rules.js'),E=require('../extension/engine.js');
const finish=()=>({pawns:[25,35],walls:[1,3,8,10,14,27,37,44,71,76,82,92,94,98,109,114,115],remaining:[3,0],turn:1,winner:null,variant:'classic'});

test('a protected finish accounts for close pawns and every legal defensive reply',()=>{
 const state=finish(),before=JSON.stringify(state),proof=E.proveThreat(state,{budgetMs:200}),player=state.turn,memo=new Map();
 assert.equal(proof.value,1);assert.equal(proof.plies,5);assert.deepEqual(proof.move,{type:'pawn',to:26});
 function forced(s,left){
  if(s.winner!=null)return s.winner===player;if(!left)return false;
  if(s.turn===player&&R.pawnMoves(s).some(move=>R.apply(s,move).winner===player))return true;
  const key=R.stateKey(s)+':'+left;if(memo.has(key))return memo.get(key);
  const moves=s.turn===player?R.pawnMoves(s):R.moves(s);
  const result=s.turn===player?moves.some(move=>forced(R.apply(s,move),left-1)):moves.every(move=>forced(R.apply(s,move),left-1));
  memo.set(key,result);return result;
 }
 assert.equal(forced(R.apply(state,proof.move),proof.plies-1),true);assert.equal(JSON.stringify(state),before);
});

test('route protection holds for every pawn location along the finish',()=>{
 const state=finish(),route=[35,26,17,8];
 for(let prefix=0;prefix<route.length-1;prefix++)for(let opponent=0;opponent<81;opponent++){
  if(opponent===route[prefix]||(opponent/9|0)===8)continue;
  const s={...state,pawns:[opponent,route[prefix]],turn:0};
  for(const child of R.successors(s))if(child.move.type==='wall'){
   const edges=R.graph(child.state).edges;
   for(let i=prefix;i<route.length-1;i++)assert.ok(edges.subarray(route[i]*4,route[i]*4+4).includes(route[i+1]));
  }
 }
});

test('proofs remain correct when mirrored or played from the other side',()=>{
 const mirror=s=>({...s,pawns:s.pawns.map(p=>8-p%9+(p/9|0)*9),walls:s.walls.map(w=>(w<64?0:64)+7-(w&7)+((w&63)>>3)*8).sort((a,b)=>a-b)});
 const rotate=s=>({...s,pawns:[80-s.pawns[1],80-s.pawns[0]],walls:s.walls.map(w=>(w<64?0:64)+63-(w&63)).sort((a,b)=>a-b),remaining:s.remaining.slice().reverse(),turn:1-s.turn});
 const state=finish();for(const s of [mirror(state),rotate(state),mirror(rotate(state))]){
  const proof=E.proveThreat(s,{budgetMs:200});assert.equal(proof.value,1);assert.equal(proof.plies,5);assert.doesNotThrow(()=>R.apply(s,proof.move));
 }
});

test('an available blocker or an occupied finish prevents certification',()=>{
 const state=finish();
 assert.equal(E.proveThreat({...state,walls:state.walls.filter(w=>w!==71),remaining:[3,1]},{budgetMs:200}),null);
 assert.equal(E.proveThreat({...state,pawns:[8,35]},{budgetMs:200}),null);
 assert.equal(E.proveThreat(state,{shouldStop:()=>true}),null);
});

test('a proved loss never advertises a winning position',async()=>{
 const state={...finish(),pawns:[24,35],turn:0},context={WallzRules:R,WallzEngine:E,performance,setTimeout,clearTimeout};
 assert.equal(E.proveThreat(state,{budgetMs:200}).value,-1);
 vm.runInNewContext(fs.readFileSync(require.resolve('../extension/neural.js'),'utf8'),context);
 let calls=0;const result=await context.WallzNeural.analyse(state,{budgetMs:500,predictor:async()=>{calls++;throw Error('Inference must not be needed');}});
 assert.equal(result.engine,'exact-tactical-route');assert.equal(result.provenWin,false);assert.equal(calls,0);
 assert.ok(result.candidates.every(candidate=>candidate.bound==='proven'&&candidate.score<0));
});

test('a protective wall can be proved without consulting hostile neural priors',async()=>{
 const state={...finish(),pawns:[24,35],walls:finish().walls.filter(w=>w!==71),remaining:[3,1]},context={WallzRules:R,WallzEngine:E,performance,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(require.resolve('../extension/neural.js'),'utf8'),context);
 let calls=0;const result=await context.WallzNeural.analyse(state,{budgetMs:500,predictor:async()=>{calls++;throw Error('Inference must not be needed');}});
 assert.equal(result.provenWin,true);assert.equal(result.candidates[0].move.type,'wall');assert.equal(calls,0);
 const child=R.apply(state,result.candidates[0].move);assert.equal(E.proveThreat(child,{budgetMs:200}).value,-1);
});

