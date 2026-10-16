(function(root){
  'use strict';
  let ready=null,cpu=null,gpu=null,backend='wasm',failure=null,timingMs=20,cpuMs=20,gpuMs=null,threads=1;
  const asset=path=>root.chrome?.runtime?.getURL?root.chrome.runtime.getURL(path):new URL(path,root.location.href).href;
  const R=root.WallzRules;
  const bundled={name:'sigma',count:136,input:'input',policy:'policy_logits',value:'value',dims:[1,8,9,9],valueDims:[1,1],encode:s=>root.WallzNeural.encode(s)};
  let model=bundled,metadata=null,batchGpu=null,batchMs=null,batchSize=1,batchBusy=false,batchScheduled=false;
  const pendingBatch=[];let singleQueue=Promise.resolve(),gpuQueue=Promise.resolve();
 function encodeKa(state){
   const out=new Float32Array(1215),{edges}=R.graph(state),d=R.distances(state),directions=[1,3,0,2];
   for(let p=0;p<81;p++){const x=p%9,y=8-(p/9|0),i=(x*9+y)*15;out[i]=p===state.pawns[0]?1:0;out[i+1]=p===state.pawns[1]?1:0;out[i+2]=state.remaining[0]/10;out[i+3]=state.remaining[1]/10;out[i+4]=state.turn;for(let k=0;k<4;k++)out[i+5+k]=edges[p*4+directions[k]]>=0?1:0;out[i+9]=d[0]/20;out[i+10]=d[1]/20;}
   for(const w of state.walls){const i=((w&7)*9+7-((w&63)>>3))*15;out[i+(w<64?11:12)]=1;}
   const geometry={...state,remaining:[1,1]};for(const m of R.moves(geometry)){if(m.type!=='wall')continue;const i=((m.wall&7)*9+7-((m.wall&63)>>3))*15;out[i+(m.wall<64?13:14)]=1;}
   return out;
 }
 function kaIndex(s,m){if(m.type==='wall')return (m.wall<64?0:64)+(m.wall&7)*8+7-((m.wall&63)>>3);const p=s.pawns[s.turn],dx=Math.sign(m.to%9-p%9),dy=-Math.sign((m.to/9|0)-(p/9|0));return 128+(dx<0?2:dx)*3+(dy<0?2:dy);}

  async function modelBytes(){let found=false;
    try{
      const response=await fetch(asset('models/ka.json'));
      if(response.ok){found=true;
        metadata=await response.json();
        if(metadata.format!=='ka15-v1'||!['input','policy','value'].every(key=>typeof metadata[key]==='string')||!/^[a-f0-9]{64}$/.test(metadata.sha256))throw new Error('Invalid local model metadata');
        const weights=await fetch(asset('models/ka.onnx'));if(!weights.ok)throw new Error('Local model could not be loaded');
        const bytes=new Uint8Array(await weights.arrayBuffer());
        const digest=Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
        if(digest!==metadata.sha256)throw new Error('Local model integrity mismatch');
        model={name:'ka',count:137,input:metadata.input,policy:metadata.policy,value:metadata.value,dims:[1,9,9,15],valueDims:[1],encode:encodeKa};
        return bytes;
      }
    }catch(error){if(model!==bundled)model=bundled;if(found)failure=String(error.message||error);}
    const response=await fetch(asset('models/quoridor.onnx'));if(!response.ok)throw new Error('Model could not be loaded');return new Uint8Array(await response.arrayBuffer());
  }
  const median=values=>values.slice().sort((a,b)=>a-b)[values.length>>1];
  function validate(answer){
    if(answer.logits.length!==model.count||!Number.isFinite(answer.value)||Math.abs(answer.value)>1.001||answer.logits.some(value=>!Number.isFinite(value)))throw new Error('Invalid neural evaluation');
    answer.value=Math.max(-1,Math.min(1,answer.value));return answer;
  }
  async function runCpu(data){
    const tensor=new root.ort.Tensor('float32',data,model.dims);let result;
    try{result=await cpu.run({[model.input]:tensor});return validate({logits:Float32Array.from(result[model.policy].data),value:result[model.value].data[0]});}
    finally{tensor.dispose?.();if(result)for(const value of Object.values(result))value.dispose?.();}
  }
  async function makeGpu(bytes,batch=1){
    const dims=[batch,...model.dims.slice(1)],count=model.count*batch;
    const session=await root.ort.InferenceSession.create(bytes,{executionProviders:['webgpu'],graphOptimizationLevel:'all',enableGraphCapture:true});
    const device=root.ort.env.webgpu.device,buffers=[];
    try{
      const storage=root.GPUBufferUsage.STORAGE|root.GPUBufferUsage.COPY_DST|root.GPUBufferUsage.COPY_SRC;
      const input=device.createBuffer({size:dims.reduce((a,b)=>a*b,4),usage:storage});buffers.push(input);
      const policy=device.createBuffer({size:Math.ceil(count/4)*16,usage:storage});buffers.push(policy);
      const value=device.createBuffer({size:Math.max(16,batch*4),usage:storage});buffers.push(value);
      const staging=device.createBuffer({size:(count+batch)*4,usage:root.GPUBufferUsage.COPY_DST|root.GPUBufferUsage.MAP_READ});buffers.push(staging);
      const feeds={[model.input]:root.ort.Tensor.fromGpuBuffer(input,{dataType:'float32',dims})};
      const fetches={[model.policy]:root.ort.Tensor.fromGpuBuffer(policy,{dataType:'float32',dims:[batch,model.count]}),[model.value]:root.ort.Tensor.fromGpuBuffer(value,{dataType:'float32',dims:model===bundled?[batch,1]:[batch]})};
      let lost=null;device.lost.then(info=>{lost=info.message||'GPU device lost';});
      return {
        device,
        async run(data){
          if(lost)throw new Error(lost);
          device.queue.writeBuffer(input,0,data);const outputs=await session.run(feeds,fetches);
          const commands=device.createCommandEncoder();commands.copyBufferToBuffer(outputs[model.policy].gpuBuffer,0,staging,0,count*4);commands.copyBufferToBuffer(outputs[model.value].gpuBuffer,0,staging,count*4,batch*4);device.queue.submit([commands.finish()]);
          try{
            await staging.mapAsync(root.GPUMapMode.READ);
            const out=new Float32Array(staging.getMappedRange()),answers=Array.from({length:batch},(_,i)=>validate({logits:Float32Array.from(out.subarray(i*model.count,(i+1)*model.count)),value:out[count+i]}));return batch===1?answers[0]:answers;
          }finally{if(staging.mapState==='mapped')staging.unmap();}
        },
        async release(){try{await session.release();}finally{for(const buffer of buffers)buffer.destroy();}}
      };
    }catch(error){for(const buffer of buffers)buffer.destroy();await session.release();throw error;}
  }

  function runBatch(data){const work=gpuQueue.then(()=>{if(!batchGpu)throw new Error('Batch GPU unavailable');return batchGpu.run(data);});gpuQueue=work.catch(()=>{});return work;}
  function packBatch(inputs,size=batchSize){const length=inputs[0].length,out=new Float32Array(length*size);for(let i=0;i<size;i++)out.set(inputs[i%inputs.length],i*length);return out;}
  async function initBatch(inputs,references){
    if(model.name!=='ka'||!metadata?.batch||!root.ort.env.webgpu.adapter)return;
    const configurations=[{...metadata.batch,file:'ka-batch.onnx'},...(Array.isArray(metadata.gpuBatches)?metadata.gpuBatches:[])];
    for(const configuration of configurations)await tryBatch(configuration,inputs,references);
  }
  async function tryBatch(configuration,inputs,references){
    let candidate=null;
    try{
      const {size,file,sha256}=configuration;
      if(![4,8,16].includes(size)||!/^ka-batch(?:8|16)?\.onnx$/.test(file)||!/^[a-f0-9]{64}$/.test(sha256))throw new Error('Invalid batch model metadata');
      const response=await fetch(asset('models/'+file));if(!response.ok)return;
      const bytes=new Uint8Array(await response.arrayBuffer()),digest=Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      if(digest!==sha256)throw new Error('Batch model integrity mismatch');
      candidate=await makeGpu(bytes,size);const times=[];
      for(let i=0;i<7;i++){
        const order=Array.from({length:size},(_,j)=>(j^(j>>1)^i)&1),start=performance.now(),answers=await candidate.run(packBatch(order.map(index=>inputs[index]),size));
        if(i>=3)times.push(performance.now()-start);
        for(let j=0;j<size;j++){const answer=answers[j],reference=references[order[j]];if(Math.abs(answer.value-reference.value)>.002||answer.logits.some((v,k)=>Math.abs(v-reference.logits[k])>.002))throw new Error('Batch evaluation disagrees with CPU '+JSON.stringify({i,j,value:answer.value,referenceValue:reference.value,policyError:Math.max(...answer.logits.map((v,k)=>Math.abs(v-reference.logits[k])))}));}
      }
      const measured=median(times);
      const threshold=batchGpu?batchMs/batchSize*.85:cpuMs*.8;
      if(measured/size<threshold){
        const previous=batchGpu;batchGpu=candidate;batchMs=measured;batchSize=size;gpuMs=measured;
        backend=measured<cpuMs*.85?'webgpu':'wasm';timingMs=backend==='webgpu'?measured:cpuMs;candidate=null;
        if(previous)await previous.release().catch(()=>{});
      }
    }catch(error){failure=String(error.message||error);}
    finally{if(candidate)await candidate.release().catch(()=>{});}
  }

  function init(){
    if(ready)return ready;
    ready=(async()=>{
      threads=root.crossOriginIsolated&&typeof root.SharedArrayBuffer!=='undefined'&&typeof root.Worker==='function'?Math.max(1,Math.floor(root.WallzThreads||root.navigator?.hardwareConcurrency||1)):1;
      root.ort.env.wasm.numThreads=threads;root.ort.env.wasm.proxy=false;root.ort.env.wasm.simd=true;
      root.ort.env.wasm.wasmPaths=asset('vendor/');
      const bytes=await modelBytes();
      cpu=await root.ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
      const state={pawns:[4,76],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'};
      const inputs=[model.encode(state),model.encode({...state,pawns:[22,58],walls:[24,80],remaining:[9,9],turn:1})];
      const references=[],cpuTimes=[];
      for(let i=0;i<4;i++){const start=performance.now();const answer=await runCpu(inputs[i&1]);if(i>=2)cpuTimes.push(performance.now()-start);if(i<2)references.push(answer);}
      cpuMs=timingMs=median(cpuTimes);
      let scoped=false;
      try{
        const adapter=await root.navigator?.gpu?.requestAdapter({powerPreference:'high-performance'});
        if(!adapter||adapter.info?.isFallbackAdapter||adapter.isFallbackAdapter)return;
        if(typeof adapter.requestAdapterInfo!=='function')adapter.requestAdapterInfo=async()=>adapter.info;
        if(!root.ort.env.webgpu.adapter)root.ort.env.webgpu.adapter=adapter;await initBatch(inputs,references);if(batchGpu)return;gpu=await makeGpu(bytes);
        gpu.device.pushErrorScope('validation');scoped=true;
        const times=[];
        for(let i=0;i<5;i++){
          const start=performance.now(),answer=await gpu.run(inputs[i&1]);if(i>=2)times.push(performance.now()-start);
          const reference=references[i&1];
          if(Math.abs(answer.value-reference.value)>.002||answer.logits.some((value,j)=>Math.abs(value-reference.logits[j])>.002))throw new Error('GPU evaluation disagrees with CPU');
        }
        const error=await gpu.device.popErrorScope();scoped=false;if(error)throw new Error(error.message);
        gpuMs=median(times);
        if(gpuMs<timingMs*.85){backend='webgpu';timingMs=gpuMs;}
        else{await gpu.release();gpu=null;}
      }catch(error){
        failure=String(error.message||error);
        if(scoped)await gpu.device.popErrorScope().catch(()=>{});
        if(gpu)await gpu.release().catch(()=>{});gpu=null;
      }
    })();
    ready.catch(()=>{});return ready;
  }
  async function evaluateNow(data){
    await init();const started=performance.now();let answer;
    if(batchGpu&&backend==='webgpu'){try{answer=(await runBatch(packBatch([data])))[0];}catch(error){failure=String(error.message||error);const failed=batchGpu;batchGpu=null;batchSize=1;backend='wasm';if(failed)await failed.release().catch(()=>{});}}
    if(!answer&&gpu){try{answer=await gpu.run(data);}catch(error){failure=String(error.message||error);const failed=gpu;gpu=null;backend='wasm';await failed.release().catch(()=>{});}}
    answer||=await runCpu(data);timingMs=timingMs*.9+(performance.now()-started)*.1;return answer;
  }
  function evaluate(data){const work=singleQueue.then(()=>evaluateNow(data));singleQueue=work.catch(()=>{});return work;}
  function decode(state,answer){
    if(model===bundled)return answer;
    const moves=R.moves(state),probabilities=moves.map(move=>answer.logits[kaIndex(state,move)]+1e-7),pawns=moves.map((move,index)=>({move,index})).filter(c=>c.move.type==='pawn');
    const map=R.graph(state).maps[state.turn],short=pawns.filter(c=>map[c.move.to]<map[state.pawns[state.turn]]),mass=pawns.reduce((sum,c)=>sum+probabilities[c.index],0);
    if(short.length){for(const c of pawns)probabilities[c.index]*=.85;for(const c of short)probabilities[c.index]+=.15*mass/short.length;}
    const logits=new Float32Array(136).fill(-100);for(let i=0;i<moves.length;i++)logits[root.WallzNeural.policyIndex(state,moves[i])]=Math.log(probabilities[i]);
    return {logits,value:answer.value*(state.turn===0?1:-1)};
  }
  function scheduleBatch(){
    if(batchScheduled||batchBusy||!pendingBatch.length)return;
    batchScheduled=true;
    // Sibling leaf evaluations reach the queue in the same microtask turn.
    // A timer here acquires the browser's nested-timer delay on partial batches,
    // leaving Metal idle for longer than the inference itself takes.
    Promise.resolve().then(()=>{batchScheduled=false;return drainBatch();});
  }
  async function drainBatch(){
    if(batchBusy)return;
    const work=pendingBatch.splice(0,batchSize);if(!work.length)return;batchBusy=true;
    try{
      let answers;
      if(batchGpu){try{const start=performance.now();answers=await runBatch(packBatch(work.map(w=>model.encode(w.state))));batchMs=batchMs*.9+(performance.now()-start)*.1;}catch(error){failure=String(error.message||error);const failed=batchGpu;batchGpu=null;batchSize=1;if(!gpu)backend='wasm';if(failed)await failed.release().catch(()=>{});}}
      if(answers)work.forEach((w,i)=>w.resolve(decode(w.state,answers[i])));
      else for(const item of work)item.resolve(await evaluateState(item.state));
    }catch(error){for(const item of work)item.reject(error);}
    finally{batchBusy=false;scheduleBatch();}
  }
  async function evaluateStateBatched(state){
    await init();if(!batchGpu)return evaluateState(state);
    return new Promise((resolve,reject)=>{pendingBatch.push({state,resolve,reject});if(pendingBatch.length>=batchSize&&!batchBusy)drainBatch();else scheduleBatch();});
  }
  async function evaluateState(state){
    await init();const answer=await evaluate(model.encode(state));
    return decode(state,answer);
  }
  root.WallzInference={init,evaluate,evaluateState,evaluateStateBatched,info:()=>({model:model.name,backend:batchGpu?'webgpu':backend,singleBackend:backend,inferenceMs:batchGpu?batchMs/batchSize:timingMs,singleInferenceMs:timingMs,batchSize,batchMs,cpuMs,gpuMs,threads,cores:root.navigator?.hardwareConcurrency||1,failure})};
})(globalThis);
