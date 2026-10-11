const {test}=require('node:test');
const assert=require('node:assert/strict');
const R=require('../extension/rules.js');
const E=require('../extension/engine.js');
const N=require('../extension/neural.js');

test('cheap route proofs respect wall conflicts and pawn interference',()=>{
  const state={pawns:[49,36],walls:[91,92,107,108,123,124,35],remaining:[2,3],turn:1,winner:null,variant:'classic'};
  const before=JSON.stringify(state);
  assert.deepEqual(E.certify(state,{protectedOnly:true}),{value:-1,plies:6});
  for(const move of R.moves(state).filter(move=>move.type==='wall'))assert.equal(R.distances(R.apply(state,move))[0],3);
  assert.equal(E.certify({...state,pawns:[49,58]},{protectedOnly:true}),null);
  const frozen={pawns:[4,76],walls:[],remaining:[0,1],turn:0,winner:null,variant:'classic'};
  assert.equal(E.certify(frozen,{protectedOnly:true}),null);
  assert.equal(E.certify(frozen,{budgetMs:150}).value,-1);
  assert.equal(JSON.stringify(state),before);
});

test('late wall traps are proved despite an optimistic model and concentrated policy',async()=>{
  N.clear();
  const state={pawns:[66,25],walls:[7,16,18,20,22,31,50,53,55,56,59,91,92,107,108],remaining:[1,4],turn:1,winner:null,variant:'classic'};
  const key=R.stateKey(state),before=JSON.stringify(state);
  const result=await N.analyse(state,{budgetMs:2000,predictor:async s=>{
    const move=R.stateKey(s)===key?{type:'wall',wall:122}:R.pawnMoves(s).sort((a,b)=>R.turnDistance(R.apply(s,a),s.turn)-R.turnDistance(R.apply(s,b),s.turn))[0];
    const logits=new Float32Array(136);logits[N.policyIndex(s,move)]=1000;
    return {logits,value:.9};
  }});
  assert.equal(result.legalCount,R.moves(state).length);
  assert.ok(result.candidates.every(candidate=>candidate.bound==='proven'&&candidate.score===-999));
  assert.equal(JSON.stringify(state),before);
  N.clear();
});
