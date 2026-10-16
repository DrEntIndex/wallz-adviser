const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),{test}=require('node:test'),{createHash,webcrypto}=require('node:crypto');
const R=require('../extension/rules.js'),N=require('../extension/neural.js');
const source=fs.readFileSync(require.resolve('../extension/inference.js'),'utf8');
const initial=()=>({pawns:[4,76],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'});
function harness(local=false,corrupt=false){const weights=Uint8Array.from([1,2,3]),hash=createHash('sha256').update(weights).digest('hex'),inputs=[],requests=[];let active=0,maxActive=0,timerCalls=0;class Tensor{constructor(type,data,dims){this.data=data;this.dims=dims;}dispose(){}}
 const metadata={format:'ka15-v1',input:'x:0',policy:'Softmax_5:0',value:'Tanh:0',sha256:corrupt?'0'.repeat(64):hash};
 const context={WallzRules:R,WallzNeural:N,performance,setTimeout:(...args)=>{timerCalls++;return setTimeout(...args);},clearTimeout,crypto:webcrypto,navigator:{hardwareConcurrency:8},chrome:{runtime:{getURL:p=>p}},fetch:async p=>{requests.push(p);return p.endsWith('ka.json')?{ok:local,json:async()=>metadata}:{ok:true,arrayBuffer:async()=>weights.buffer};},ort:{env:{wasm:{},webgpu:{}},Tensor,InferenceSession:{create:async()=>({run:async feeds=>{active++;maxActive=Math.max(maxActive,active);try{const input=Object.values(feeds)[0];inputs.push({data:Array.from(input.data),dims:Array.from(input.dims)});await new Promise(resolve=>setTimeout(resolve,1));const ka=input.dims[3]===15,policy=new Float32Array(ka?137:136);if(ka)policy[130]=1;const output={data:policy,dispose(){}};return ka?{'Softmax_5:0':output,'Tanh:0':{data:new Float32Array([.25]),dispose(){}}}:{policy_logits:output,value:{data:new Float32Array([.25]),dispose(){}}};}finally{active--;}}})}}};vm.runInNewContext(source.replace('root.WallzInference={','root.injectBatch=target=>{batchGpu=target;batchSize=4;backend=\'webgpu\';batchMs=1;};root.WallzInference={'),context);return {api:context.WallzInference,inputs,requests,maxActive:()=>maxActive,setBatch:context.injectBatch,timerCalls:()=>timerCalls};}
test('no optional model preserves bundled inference',async()=>{const h=harness(),a=await h.api.evaluateState(initial());assert.equal(h.api.info().model,'sigma');assert.equal(h.api.info().failure,null);assert.equal(a.logits.length,136);assert.equal(a.value,.25);assert.deepEqual(h.inputs.at(-1).dims,[1,8,9,9]);});
test('corrupt local weights fall back to the bundled model',async()=>{const h=harness(true,true);await h.api.init();assert.equal(h.api.info().model,'sigma');assert.match(h.api.info().failure,/integrity mismatch/);assert.equal(h.inputs.at(-1).data.length,648);});
test('ka features preserve both players, wall anchors and walkability',async()=>{const h=harness(true),s={...initial(),pawns:[31,40],walls:[3,84],remaining:[8,9]};const a=await h.api.evaluateState(s),data=h.inputs.at(-1).data;assert.equal(h.api.info().model,'ka');assert.deepEqual(h.inputs.at(-1).dims,[1,9,9,15]);assert.equal(data[(4*9+5)*15],1);assert.equal(data[(4*9+4)*15+1],1);assert.equal(data[(3*9+7)*15+11],1);assert.equal(data[(4*9+5)*15+12],1);assert.equal(data[(4*9+5)*15+6],0);assert.equal(data[(4*9+5)*15+5],1);assert.equal(a.value,.25);assert.ok(a.logits[0]>a.logits[1]);});
test('ka values change sign with the side to move',async()=>{const h=harness(true);assert.equal((await h.api.evaluateState({...initial(),turn:1})).value,-.25);});
test('geometric placement features remain valid when no walls remain',async()=>{const h=harness(true),s={...initial(),remaining:[0,0]};await h.api.evaluateState(s);const data=h.inputs.at(-1).data;assert.equal(data[2],0);assert.equal(data[3],0);assert.equal(data[13],1);assert.equal(data[14],1);});
test('overlapping inference requests are serialized',async()=>{const h=harness(true);await h.api.init();const states=Array.from({length:8},(_,i)=>({...initial(),turn:i%2}));const answers=await Promise.all(states.map(s=>h.api.evaluateState(s)));assert.equal(h.maxActive(),1);for(let i=0;i<answers.length;i++)assert.equal(answers[i].value,i%2?-.25:.25);});
test('a lost batch GPU preserves model results and reports CPU fallback',async()=>{const h=harness(true);await h.api.init();let releases=0;h.setBatch({run:async()=>{throw Error('fixture device lost');},release:async()=>{releases++;}});const states=Array.from({length:4},(_,i)=>({...initial(),turn:i%2})),answers=await Promise.all(states.map(s=>h.api.evaluateStateBatched(s)));for(let i=0;i<answers.length;i++)assert.equal(answers[i].value,i%2?-.25:.25);assert.equal(releases,1);assert.equal(h.api.info().batchSize,1);assert.equal(h.api.info().backend,'wasm');assert.match(h.api.info().failure,/device lost/);assert.equal(h.maxActive(),1);});
test('batched API remains functional without a GPU',async()=>{const h=harness(true);const a=await h.api.evaluateStateBatched(initial());assert.equal(a.value,.25);assert.equal(h.api.info().batchSize,1);assert.equal(h.maxActive(),1);assert.ok(h.requests.every(p=>p.startsWith('models/')));});
test('partial and overflowing GPU batches preserve request order without timer delays',async()=>{
 for(const count of [1,3,4,5,9]){
  const h=harness(true);await h.api.init();let active=0,maxActive=0,runs=0;
  h.setBatch({run:async data=>{runs++;active++;maxActive=Math.max(maxActive,active);try{
   await new Promise(resolve=>setImmediate(resolve));
   return Array.from({length:4},(_,i)=>({logits:new Float32Array(137),value:data[i*1215+4]? .5:.25}));
  }finally{active--;}}});
  const states=Array.from({length:count},(_,i)=>({...initial(),turn:i%2}));
  const answers=await Promise.all(states.map(state=>h.api.evaluateStateBatched(state)));
  assert.equal(answers.length,count);answers.forEach((answer,i)=>assert.equal(answer.value,i%2?-.5:.25));
  assert.equal(runs,Math.ceil(count/4));assert.equal(maxActive,1);assert.equal(h.timerCalls(),0);
 }
});
test('queued partial GPU batches finish on CPU after a device failure',async()=>{
 const h=harness(true);await h.api.init();let releases=0;
 h.setBatch({run:async()=>{await new Promise(resolve=>setImmediate(resolve));throw Error('lost during queue');},release:async()=>{releases++;}});
 const answers=await Promise.all(Array.from({length:9},(_,i)=>h.api.evaluateStateBatched({...initial(),turn:i%2})));
 answers.forEach((answer,i)=>assert.equal(answer.value,i%2?-.25:.25));
 assert.equal(releases,1);assert.equal(h.api.info().backend,'wasm');assert.equal(h.maxActive(),1);
});

function calibratedHarness({rejectEight=false,corruptEight=false}={}){
 const weights=Uint8Array.from([1,2,3]),hash=createHash('sha256').update(weights).digest('hex'),released=[],created=[];
 const metadata={format:'ka15-v1',input:'x:0',policy:'Softmax_5:0',value:'Tanh:0',sha256:hash,batch:{size:4,sha256:hash},gpuBatches:[{size:8,file:'ka-batch8.onnx',sha256:corruptEight?'0'.repeat(64):hash}]};
 let clock=0;
 class Tensor{constructor(type,data,dims){this.data=data;this.dims=dims;}dispose(){}}
 const answer=()=>{const logits=new Float32Array(137);logits[130]=1;return {logits,value:.25};};
 const context={WallzRules:R,WallzNeural:N,performance:{now:()=>++clock},setTimeout,clearTimeout,crypto:webcrypto,
  navigator:{hardwareConcurrency:8,gpu:{requestAdapter:async()=>({info:{vendor:'apple'}})}},chrome:{runtime:{getURL:p=>p}},
  fetch:async p=>p.endsWith('ka.json')?{ok:true,json:async()=>metadata}:{ok:true,arrayBuffer:async()=>weights.buffer},
  ort:{env:{wasm:{},webgpu:{}},Tensor,InferenceSession:{create:async()=>({run:async()=>({'Softmax_5:0':{data:answer().logits},'Tanh:0':{data:new Float32Array([.25])}})})}},
  makeTestGpu:async(bytes,size)=>{created.push(size);return {run:async()=>{const a=Array.from({length:size},answer);if(rejectEight&&size===8)a[3].value=-.9;return a;},release:async()=>{released.push(size);}};}
 };
 const start=source.indexOf('  async function makeGpu('),end=source.indexOf('  function runBatch(');
 vm.runInNewContext(source.slice(0,start)+'  const makeGpu=root.makeTestGpu;\n'+source.slice(end),context);
 return {api:context.WallzInference,created,released};
}
test('calibration selects a faster eight-position model and disposes the four-position session',async()=>{
 const h=calibratedHarness();await h.api.init();assert.deepEqual(h.created,[4,8]);assert.deepEqual(h.released,[4]);
 assert.equal(h.api.info().batchSize,8);assert.equal(h.api.info().backend,'webgpu');assert.equal(h.api.info().failure,null);
 const answers=await Promise.all(Array.from({length:9},(_,i)=>h.api.evaluateStateBatched({...initial(),turn:i%2})));
 answers.forEach((answer,i)=>assert.equal(answer.value,i%2?-.25:.25));
});
test('an eight-position numerical mismatch retains the validated four-position GPU',async()=>{
 const h=calibratedHarness({rejectEight:true});await h.api.init();assert.equal(h.api.info().batchSize,4);
 assert.equal(h.api.info().backend,'webgpu');assert.deepEqual(h.released,[8]);assert.match(h.api.info().failure,/disagrees with CPU/);
});
test('an eight-position integrity failure retains the original GPU batch',async()=>{
 const h=calibratedHarness({corruptEight:true});await h.api.init();assert.equal(h.api.info().batchSize,4);
 assert.deepEqual(h.created,[4]);assert.match(h.api.info().failure,/integrity mismatch/);
});
