// Deterministic equivalence checks outside the opening window.
// A fixed predictor and operation clock remove wall-clock scheduling variation.
// Real bundled-model playing-strength checks live in opening-matches.cjs.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'outputs/opening-matches/differential.json');
const reference='b668900';
const read=name=>fs.readFileSync(path.join(root,'extension',name),'utf8');
const legacy=execFileSync('git',['show',`${reference}:extension/neural.js`],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
const current=read('neural.js');
const R=require('../extension/rules.js');
const initial=turn=>({pawns:[4,76],walls:[],remaining:[10,10],turn,winner:null,variant:'classic'});
const forward=(starter,plies)=>{let state=initial(starter);for(let i=0;i<plies;i++)state=R.apply(state,{type:'pawn',to:state.pawns[state.turn]+(state.turn===0?9:-9)});return state;};
let loop=initial(0);for(const to of [13,67,4,76])loop=R.apply(loop,{type:'pawn',to});
const fixtures=[
  {id:'unknown-history-p1',state:initial(0)},
  {id:'unknown-history-p2',state:initial(1)},
  {id:'fourth-move-p1',state:forward(0,6),opening:{starter:0,ply:6}},
  {id:'fourth-move-p2',state:forward(1,6),opening:{starter:1,ply:6}},
  {id:'further-pawn-contact-p1',state:{...initial(0),pawns:[40,49]},opening:{starter:0,ply:7}},
  {id:'further-pawn-contact-p2',state:{...initial(1),pawns:[31,40]},opening:{starter:1,ply:7}},
  {id:'early-wall-p1',state:R.apply(initial(0),{type:'wall',wall:3}),opening:{starter:0,ply:1}},
  {id:'early-wall-p2',state:R.apply(initial(1),{type:'wall',wall:59}),opening:{starter:1,ply:1}},
  {id:'sideways-p1',state:R.apply(initial(0),{type:'pawn',to:3}),opening:{starter:0,ply:1}},
  {id:'sideways-p2',state:R.apply(initial(1),{type:'pawn',to:77}),opening:{starter:1,ply:1}},
  {id:'returned-to-start-after-backward-moves',state:loop},
  {id:'winning-move-preserves-existing-proof',state:{...initial(0),pawns:[67,31]},opening:{starter:0,ply:18}},
  {id:'pawn-endgame-preserves-existing-proof',state:{...forward(0,6),remaining:[0,0]},opening:{starter:0,ply:6}}
];
async function run(source,fixture,budgetMs){
  let clock=0,predictions=0;
  const context={performance:{now:()=>++clock},setTimeout:fn=>{clock++;fn();},clearTimeout:()=>{}};
  vm.createContext(context);
  vm.runInContext(read('rules.js'),context);vm.runInContext(read('engine.js'),context);vm.runInContext(source,context);
  const predictor=async state=>{
    clock+=7;predictions++;
    let seed=2166136261;for(const char of context.WallzRules.stateKey(state))seed=Math.imul(seed^char.charCodeAt(0),16777619)>>>0;
    const logits=new Float32Array(136);
    for(let i=0;i<logits.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;logits[i]=((seed>>>24)-128)/32;}
    return {logits,value:((seed%2001)-1000)/1000};
  };
  const state=JSON.parse(JSON.stringify(fixture.state)),before=JSON.stringify(state);
  const result=await context.WallzNeural.analyse(state,{budgetMs,maxBudgetMs:budgetMs*2,predictor,...(fixture.opening?{opening:fixture.opening}:{})});
  assert.equal(JSON.stringify(state),before);
  assert.equal(result.openingFastPath,undefined);
  assert.ok(result.candidates.length);R.apply(state,result.candidates[0].move);
  return {result:JSON.parse(JSON.stringify(result)),predictions};
}
async function main(){
  const rows=[];
  for(const fixture of fixtures)for(const budgetMs of [2000,3000]){
    const before=await run(legacy,fixture,budgetMs),after=await run(current,fixture,budgetMs);
    assert.deepEqual(after,before,`${fixture.id}, budget=${budgetMs}`);
    rows.push({id:fixture.id,budgetMs,predictions:after.predictions,nodes:after.result.nodes,engine:after.result.engine,searchBudgetMs:after.result.searchBudgetMs,move:after.result.candidates[0].move,identical:true});
    console.error(`${fixture.id} ${budgetMs}ms: identical, ${after.result.nodes} nodes`);
  }
  const report={checkedAt:new Date().toISOString(),reference,status:'PASS',cases:rows.length,rows,method:'Deterministic predictor and operation clock, identical assets, independent fresh VM per search. Entire results, predictions, legal moves and unmodified states compared.',limitations:'This verifies fallback search logic under controlled evaluation; it does not estimate real-model win rates or wall-clock speed.'};
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,status:report.status,cases:report.cases},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
