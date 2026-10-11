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
