const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const R=require('../extension/rules.js');
const initial=()=>({pawns:[4,76],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'});
function fixture(evaluate){
  const context=vm.createContext({WallzRules:R,WallzEngine:{},console,performance,setTimeout,clearTimeout});
  context.WallzInference={init:async()=>{},info:()=>({model:'ka',batchSize:4}),evaluateState:()=>{throw new Error('Scalar inference used during batch preparation');},evaluateStateBatched:evaluate};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/neural.js'),'utf8'),context);
  return context.WallzNeural;
}
const answer=()=>({logits:new Float32Array(136),value:0});
test('preparation batches distinct positions and awaits all active evaluations on cancellation',async()=>{
  let calls=0,active=0,peak=0,stop=false;
  const seen=new Set();
  const N=fixture(async state=>{
    const key=R.stateKey(state);assert.ok(!seen.has(key),'duplicate evaluation');seen.add(key);
    calls++;active++;peak=Math.max(peak,active);
    if(calls>=17)stop=true;
    await new Promise(resolve=>setTimeout(resolve,2));
    active--;return answer();
  });
  const result=await N.prepare(initial(),{budgetMs:1000,shouldStop:()=>stop});
  assert.equal(peak,4);assert.equal(active,0);assert.equal(result.visited,calls);assert.equal(result.prepared,calls);
  assert.equal(result.stopped,true);assert.equal(result.done,false);
});
test('cancelled preparation resumes answered batch entries without evaluating them twice',async()=>{
  let stop=false,limit=5,calls=0;
  const counts=new Map();
  const N=fixture(async state=>{
    const key=R.stateKey(state);counts.set(key,(counts.get(key)||0)+1);calls++;
    if(calls>=limit)stop=true;
    await new Promise(resolve=>setTimeout(resolve,1));return answer();
  });
  const first=await N.prepare(initial(),{budgetMs:1000,shouldStop:()=>stop});
  assert.equal(first.visited,5);
  stop=false;limit=13;
  const resumed=await N.prepare(initial(),{budgetMs:1000,shouldStop:()=>stop});
  assert.equal(resumed.visited,13);assert.equal(resumed.prepared,13);
  assert.equal(calls,13);assert.ok([...counts.values()].every(value=>value===1));
});
test('a failed preparation batch settles its siblings and retries only the failed position',async()=>{
  let calls=0,active=0,stop=false,failedKey;
  const counts=new Map();
  const N=fixture(async state=>{
    const key=R.stateKey(state),call=++calls;counts.set(key,(counts.get(key)||0)+1);active++;
    try{
      if(call===2){failedKey=key;throw new Error('Inference failed');}
      await new Promise(resolve=>setTimeout(resolve,3));
      if(calls>=9)stop=true;
      return answer();
    }finally{active--;}
  });
  await assert.rejects(N.prepare(initial(),{budgetMs:1000,shouldStop:()=>stop}),/Inference failed/);
  assert.equal(active,0);assert.equal(calls,5);
  const result=await N.prepare(initial(),{budgetMs:1000,shouldStop:()=>stop});
  assert.equal(active,0);assert.equal(counts.get(failedKey),2);
  assert.ok([...counts].every(([key,count])=>key===failedKey||count===1));
  assert.equal(result.visited,calls-1);assert.equal(result.prepared,calls-1);
});

test('cancellation while collecting a batch preserves queued work without starting inference',async()=>{
  let stop=false,keys=0,calls=0,collecting=true;
  const rules={...R,stateKey(state){const key=R.stateKey(state);if(collecting&&++keys===2)stop=true;return key;}};
  const context=vm.createContext({WallzRules:rules,WallzEngine:{},console,performance,setTimeout,clearTimeout});
  context.WallzInference={init:async()=>{},info:()=>({batchSize:4}),evaluateStateBatched:async()=>{calls++;stop=true;return answer();}};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/neural.js'),'utf8'),context);
  const first=await context.WallzNeural.prepare(initial(),{budgetMs:1000,shouldStop:()=>stop});
  assert.equal(calls,0);assert.equal(first.visited,0);assert.equal(first.stopped,true);assert.equal(first.done,false);
  collecting=false;stop=false;
  const resumed=await context.WallzNeural.prepare(initial(),{budgetMs:1000,shouldStop:()=>stop});
  assert.equal(calls,1);assert.equal(resumed.visited,1);
});
