(function(root){
  'use strict';
  let ready=null,cpu=null,gpu=null,backend='wasm',failure=null,timingMs=20;
  const median=values=>values.slice().sort((a,b)=>a-b)[values.length>>1];
  function validate(answer){
    if(answer.logits.length!==136||!Number.isFinite(answer.value)||Math.abs(answer.value)>1.001||answer.logits.some(value=>!Number.isFinite(value)))throw new Error('Invalid neural evaluation');
    answer.value=Math.max(-1,Math.min(1,answer.value));return answer;
  }
  async function runCpu(data){
    const tensor=new root.ort.Tensor('float32',data,[1,8,9,9]);let result;
    try{result=await cpu.run({input:tensor});return validate({logits:Float32Array.from(result.policy_logits.data),value:result.value.data[0]});}
    finally{tensor.dispose?.();if(result)for(const value of Object.values(result))value.dispose?.();}
  }
  async function makeGpu(bytes){
    const session=await root.ort.InferenceSession.create(bytes,{executionProviders:['webgpu'],graphOptimizationLevel:'all',enableGraphCapture:true});
    const device=root.ort.env.webgpu.device,buffers=[];
    try{
      const storage=root.GPUBufferUsage.STORAGE|root.GPUBufferUsage.COPY_DST|root.GPUBufferUsage.COPY_SRC;
      const input=device.createBuffer({size:2592,usage:storage});buffers.push(input);
      const policy=device.createBuffer({size:544,usage:storage});buffers.push(policy);
      const value=device.createBuffer({size:16,usage:storage});buffers.push(value);
      const staging=device.createBuffer({size:548,usage:root.GPUBufferUsage.COPY_DST|root.GPUBufferUsage.MAP_READ});buffers.push(staging);
      const feeds={input:root.ort.Tensor.fromGpuBuffer(input,{dataType:'float32',dims:[1,8,9,9]})};
      const fetches={policy_logits:root.ort.Tensor.fromGpuBuffer(policy,{dataType:'float32',dims:[1,136]}),value:root.ort.Tensor.fromGpuBuffer(value,{dataType:'float32',dims:[1,1]})};
      let lost=null;device.lost.then(info=>{lost=info.message||'GPU device lost';});
      return {
        device,
        async run(data){
          if(lost)throw new Error(lost);
          device.queue.writeBuffer(input,0,data);await session.run(feeds,fetches);
          const commands=device.createCommandEncoder();commands.copyBufferToBuffer(policy,0,staging,0,544);commands.copyBufferToBuffer(value,0,staging,544,4);device.queue.submit([commands.finish()]);
          try{
            await staging.mapAsync(root.GPUMapMode.READ);
            const out=new Float32Array(staging.getMappedRange());return validate({logits:Float32Array.from(out.subarray(0,136)),value:out[136]});
          }finally{if(staging.mapState==='mapped')staging.unmap();}
        },
        async release(){try{await session.release();}finally{for(const buffer of buffers)buffer.destroy();}}
      };
    }catch(error){for(const buffer of buffers)buffer.destroy();await session.release();throw error;}
  }
  function init(){
    if(ready)return ready;
    ready=(async()=>{
      root.ort.env.wasm.numThreads=1;root.ort.env.wasm.proxy=false;root.ort.env.wasm.simd=true;
      root.ort.env.wasm.wasmPaths=root.chrome.runtime.getURL('vendor/');
      const response=await fetch(root.chrome.runtime.getURL('models/quoridor.onnx'));
      if(!response.ok)throw new Error('Model could not be loaded');
      const bytes=new Uint8Array(await response.arrayBuffer());
      cpu=await root.ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
      const state={pawns:[4,76],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'};
      const inputs=[root.WallzNeural.encode(state),root.WallzNeural.encode({...state,pawns:[22,58],walls:[24,80],remaining:[9,9],turn:1})];
      const references=[],cpuTimes=[];
      for(let i=0;i<4;i++){const start=performance.now();const answer=await runCpu(inputs[i&1]);if(i>=2)cpuTimes.push(performance.now()-start);if(i<2)references.push(answer);}
      timingMs=median(cpuTimes);
      let scoped=false;
      try{
        const adapter=await root.navigator?.gpu?.requestAdapter({powerPreference:'high-performance'});
        if(!adapter||adapter.info?.isFallbackAdapter||adapter.isFallbackAdapter)return;
        if(typeof adapter.requestAdapterInfo!=='function')adapter.requestAdapterInfo=async()=>adapter.info;
        root.ort.env.webgpu.adapter=adapter;gpu=await makeGpu(bytes);
        gpu.device.pushErrorScope('validation');scoped=true;
        const times=[];
        for(let i=0;i<5;i++){
          const start=performance.now(),answer=await gpu.run(inputs[i&1]);if(i>=2)times.push(performance.now()-start);
          const reference=references[i&1];
          if(Math.abs(answer.value-reference.value)>.002||answer.logits.some((value,j)=>Math.abs(value-reference.logits[j])>.002))throw new Error('GPU evaluation disagrees with CPU');
        }
        const error=await gpu.device.popErrorScope();scoped=false;if(error)throw new Error(error.message);
        const gpuMs=median(times);
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
  async function evaluate(data){
    await init();const started=performance.now();let answer;
    if(gpu){try{answer=await gpu.run(data);}catch(error){failure=String(error.message||error);const failed=gpu;gpu=null;backend='wasm';await failed.release().catch(()=>{});}}
    answer||=await runCpu(data);timingMs=timingMs*.9+(performance.now()-started)*.1;return answer;
  }
  root.WallzInference={init,evaluate,info:()=>({backend,inferenceMs:timingMs,failure})};
})(globalThis);
