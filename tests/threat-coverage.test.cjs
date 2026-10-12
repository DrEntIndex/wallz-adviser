const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../extension/rules.js'),E=require('../extension/engine.js');
const move=t=>t.length===2?{type:'pawn',to:t.charCodeAt(0)-97+(Number(t[1])-1)*9}:{type:'wall',wall:t.charCodeAt(0)-97+(Number(t[1])-1)*8+(t[2]==='v'?64:0)};
const sequence='e2 e8 e3 e7 e4 e6 a2h e6h c2h e2v d4h e4v f5h d3v h1h d5v g6v f7v d1v f6 e3 g6 e2 g7 e1 g8 f1 h8 f2 h7 f3 h6 g3 g3h f2h f3v h3 i6 i3 i5';
function fixture(plies){
 let state={pawns:[4,76],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'};
 for(const token of sequence.split(' ').slice(0,plies))state=R.apply(state,move(token));
 return state;
}
function engine(){
 const context={WallzRules:R,WallzEngine:E,performance,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(require.resolve('../extension/neural.js'),'utf8'),context);
 return context.WallzNeural;
}
test('a wall reply removing a pawn escape is searched despite a negligible learned prior',async()=>{
 const N=engine(),state=fixture(40),guard=move('g8v').wall,trap=move('h3v').wall,seen=[];
 const result=await N.analyse(state,{budgetMs:1500,shouldStop:()=>seen.length>=45,predictor:async s=>{
  seen.push(s);
  const logits=new Float32Array(136).fill(-100);
  logits[N.policyIndex(s,s.turn===0&&!s.walls.includes(guard)?move('g8v'):R.pawnMoves(s)[0])]=100;
  return {logits,value:.1};
 }});
 assert.ok(seen.some(s=>s.walls.includes(guard)&&s.walls.includes(trap)));
 assert.equal(result.provenWin,false);
 assert.ok(result.candidates.every(c=>c.bound==='estimate'));
 assert.doesNotThrow(()=>R.apply(state,result.candidates[0].move));
});
test('zero-distance guard walls are searched despite concentrated learned priors',async()=>{
 const N=engine(),state=fixture(12),seen=[];
 const result=await N.analyse(state,{budgetMs:1000,shouldStop:()=>seen.length>=35,predictor:async s=>{
  seen.push(s);const logits=new Float32Array(136).fill(-100);logits[N.policyIndex(s,move('f5h'))]=100;
  return {logits,value:0};
 }});
 assert.ok(seen.some(s=>s.walls.includes(move('d3h').wall)||s.walls.includes(move('d2v').wall)));
 assert.equal(result.provenWin,false);
 const guard=R.apply(state,move('d3h'));
 assert.deepEqual(R.distances(guard),R.distances(state));
 assert.ok(!R.moves(guard).some(m=>R.moveKey(m)===R.moveKey(move('d3v'))));
});
test('wall-threat coverage also works from the opposite player perspective',async()=>{
 const original=fixture(40),rotateWall=w=>(w<64?0:64)+63-(w&63);
 const state={...original,pawns:[80-original.pawns[1],80-original.pawns[0]],walls:original.walls.map(rotateWall).sort((a,b)=>a-b),remaining:original.remaining.slice().reverse(),turn:1-original.turn};
 const guard=rotateWall(move('g8v').wall),trap=rotateWall(move('h3v').wall),N=engine(),seen=[];
 const result=await N.analyse(state,{budgetMs:1500,shouldStop:()=>seen.length>=45,predictor:async s=>{
  seen.push(s);const logits=new Float32Array(136).fill(-100);
  const action=s.turn===state.turn&&!s.walls.includes(guard)?{type:'wall',wall:guard}:R.pawnMoves(s)[0];
  logits[N.policyIndex(s,action)]=100;return {logits,value:.1};
 }});
 assert.ok(seen.some(s=>s.walls.includes(guard)&&s.walls.includes(trap)));
 assert.equal(result.provenWin,false);assert.doesNotThrow(()=>R.apply(state,result.candidates[0].move));
});
