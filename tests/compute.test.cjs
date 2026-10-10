const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const assert=require('node:assert/strict');
function harness(isolated=true){
 let receive;const workers=[];
 class Worker{
  constructor(url){this.threads=Number(url.split('=')[1]);workers.push(this);}
  postMessage(message){
   if(message.action==='init')setImmediate(()=>this.onmessage({data:{id:message.id,result:{backend:'wasm',threads:this.threads,inferenceMs:{1:10,4:5,16:8}[this.threads]}}}));
   else if(message.action!=='cancel'){this.control=message.control;this.searched=true;setImmediate(()=>this.onmessage({data:{id:message.id,result:{nodes:10}}}));}
  }
  terminate(){this.terminated=true;}
 }
 const context={navigator:{hardwareConcurrency:16},crossOriginIsolated:isolated,SharedArrayBuffer,Worker,setTimeout,clearTimeout,
  chrome:{runtime:{id:'fixture',onMessage:{addListener:fn=>{receive=fn;}},sendMessage:()=>Promise.resolve()}}
 };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/compute-host.js'),'utf8'),context);
 return {workers,send:request=>new Promise(resolve=>receive(request,{id:'fixture'},resolve)),cancel:id=>receive({type:'WALLZ_COMPUTE_CANCEL',id},{id:'fixture'},()=>{})};
}
test('hardware calibration tries one, four and all available cores and keeps the measured winner',async()=>{
 const h=harness(),response=await h.send({type:'WALLZ_COMPUTE',action:'init',id:'init'});
 assert.equal(response.result.threads,4);
 assert.deepEqual(h.workers.map(worker=>worker.threads),[1,4,16]);
 assert.deepEqual(h.workers.map(worker=>!!worker.terminated),[true,false,true]);
});
test('unavailable shared-memory support keeps a functional single-thread worker',async()=>{
 const h=harness(false),response=await h.send({type:'WALLZ_COMPUTE',action:'init',id:'init'});
 assert.equal(response.result.threads,1);assert.equal(h.workers.length,1);
});
test('a position cancelled during calibration never starts a stale search',async()=>{
 const h=harness(),pending=h.send({type:'WALLZ_COMPUTE',action:'analyse',id:'old'});
 h.cancel('old');const response=await pending;
 assert.match(response.error,/Superseded/);assert.equal(h.workers.some(worker=>worker.searched),false);
 const fresh=await h.send({type:'WALLZ_COMPUTE',action:'analyse',id:'new'});
 assert.equal(fresh.result.nodes,10);
});
test('active cancellation sets a shared flag that synchronous CPU work can observe',async()=>{
 const h=harness();await h.send({type:'WALLZ_COMPUTE',action:'init',id:'init'});
 const pending=h.send({type:'WALLZ_COMPUTE',action:'analyse',id:'active'});
 await Promise.resolve();h.cancel('active');
 const worker=h.workers.find(worker=>worker.searched);
 assert.equal(Atomics.load(new Int32Array(worker.control),0),1);await pending;
});
