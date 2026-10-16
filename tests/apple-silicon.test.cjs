const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const C=require('../scripts/apple-silicon-common.cjs');
const {strengthSummary,assertMove}=require('../scripts/apple-silicon-compare.cjs');
test('snapshot verification detects changes, additions and deletions in the entire runtime',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wallz-snapshot-'));
 try{
  fs.mkdirSync(path.join(directory,'extension/models'),{recursive:true});
  fs.writeFileSync(path.join(directory,'extension/inference.js'),'baseline');
  fs.writeFileSync(path.join(directory,'extension/models/model.onnx'),'weights');
  fs.writeFileSync(path.join(directory,'snapshot.json'),JSON.stringify({files:C.manifest(directory)}));
  assert.equal(Object.keys(C.verify(directory)).length,2);
  fs.writeFileSync(path.join(directory,'extension/inference.js'),'candidate');assert.throws(()=>C.verify(directory),/integrity/);
  fs.writeFileSync(path.join(directory,'extension/inference.js'),'baseline');
  fs.writeFileSync(path.join(directory,'extension/extra.js'),'new');assert.throws(()=>C.verify(directory),/integrity/);
  fs.unlinkSync(path.join(directory,'extension/extra.js'));fs.unlinkSync(path.join(directory,'extension/models/model.onnx'));assert.throws(()=>C.verify(directory),/integrity/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
const pair=(id,a,b)=>[a,b].map((winner,i)=>({pair:id,scenario:'s'+id,initial:C.initial(),candidatePlayer:i,winner}));
test('strength reporting uses complete side-swapped pairs and never calls unfinished games draws',()=>{
 const s=strengthSummary([...pair(0,'candidate','baseline'),...pair(1,null,'candidate')]);
 assert.equal(s.wins,2);assert.equal(s.losses,1);assert.equal(s.unresolved,1);assert.equal(s.completedPairs,2);
 assert.deepEqual(s.scoreRange,[.5,.75]);assert.equal(s.nonRegressionEstablished,false);
 assert.ok(s.conditional95ScoreInterval[0]<.45);assert.ok(s.conditional95ScoreInterval[1]>.5);
 assert.throws(()=>strengthSummary(pair(0,'candidate','baseline').slice(0,1)),/Incomplete/);
 const bad=pair(0,'candidate','baseline');bad[1].candidatePlayer=0;assert.throws(()=>strengthSummary(bad),/invalid/);
 bad[1].candidatePlayer=1;bad[1].initial={...C.initial(),turn:1};assert.throws(()=>strengthSummary(bad),/invalid/);
});
test('move validation rejects illegal actions, model fallback and excessive time overruns',()=>{
 const result={engine:'neural-puct',wallMs:100,candidates:[{move:{type:'pawn',to:13}}]};
 assert.doesNotThrow(()=>assertMove(C.initial(),result,100));
 assert.throws(()=>assertMove(C.initial(),{...result,candidates:[{move:{type:'pawn',to:80}}]},100),/Illegal/);
 assert.throws(()=>assertMove(C.initial(),{...result,engine:'classical-fallback'},100),/fell back/);
 assert.throws(()=>assertMove(C.initial(),{...result,modelError:'lost model'},100),/lost model/);
 assert.throws(()=>assertMove(C.initial(),{...result,wallMs:351},100),/overrun/);
});
