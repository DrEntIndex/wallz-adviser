'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createRequire}=require('node:module'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function manifest(directory){
  const files={};
  function walk(relative){for(const entry of fs.readdirSync(path.join(directory,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const name=path.posix.join(relative,entry.name);if(entry.isDirectory())walk(name);else if(entry.isFile())files[name]=sha(fs.readFileSync(path.join(directory,name)));else throw Error('Snapshot must not contain symlinks');}}
  walk('extension');return files;
}
function verify(directory){
  const expected=JSON.parse(fs.readFileSync(path.join(directory,'snapshot.json'))).files,actual=manifest(directory);
  if(JSON.stringify(Object.entries(expected).sort())!==JSON.stringify(Object.entries(actual).sort()))throw Error('Baseline snapshot integrity mismatch');
  return actual;
}
function snapshot(directory){
  if(fs.existsSync(directory))throw Error('Refusing to overwrite the baseline: '+directory);
  fs.mkdirSync(directory,{recursive:true});
  for(const name of ['extension','scripts','tests','package.json','README.md','.gitignore'])fs.cpSync(path.join(root,name),path.join(directory,name),{recursive:true});
  const files=manifest(directory);fs.writeFileSync(path.join(directory,'snapshot.json'),JSON.stringify({createdAt:new Date().toISOString(),files},null,2)+'\n');return files;
}
function playwright(){
  try{return require('playwright');}catch(error){
    const directory=process.env.PLAYWRIGHT_MODULE_DIR||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
    return createRequire(path.join(directory,'_wallz.cjs'))('playwright');
  }
}
const initial=()=>({pawns:[4,76],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'});
function seedPosition(R,seed,plies){
  let state=initial(),value=seed;const random=()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};
  for(let ply=0;ply<plies&&state.winner==null;ply++){
    const pawns=R.pawnMoves(state),distances=pawns.map(m=>R.distances(R.apply(state,m))[state.turn]),best=Math.min(...distances);
    const forward=pawns.filter((m,i)=>distances[i]===best),walls=R.moves(state).filter(m=>m.type==='wall'),choices=random()<.55&&walls.length?walls:forward;
    state=R.apply(state,choices[Math.floor(random()*choices.length)]);
  }
  return state;
}
const median=values=>{const a=values.slice().sort((x,y)=>x-y),n=a.length;return n?n%2?a[n>>1]:(a[n/2-1]+a[n/2])/2:null;};
function save(output,report){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.tmp',JSON.stringify(report,null,2)+'\n');fs.renameSync(output+'.tmp',output);}
// Instrument only the worker message boundary. Production init/analyse/prepare
// and each variant's complete runtime, model, rules and calibration run unchanged.
const workerHarness=`
const productionReceive=self.onmessage;
self.onmessage=async event=>{
  const q=event.data;if(!['measure','outputs','search-fixture'].includes(q.action))return productionReceive(event);
  try{
    await WallzNeural.init();
    if(q.action==='search-fixture'){
      WallzRules.clearCache();importScripts('engine.js','neural.js');await WallzNeural.init();
      const before=JSON.stringify(q.state),start=performance.now(),r=await WallzNeural.analyse(q.state,{budgetMs:q.budgetMs,maxBudgetMs:q.budgetMs});
      if(before!==JSON.stringify(q.state))throw Error('Search mutated input');
      postMessage({id:q.id,result:{...r,wallMs:performance.now()-start}});return;
    }
    if(q.action==='outputs'){
      const answers=q.batched?await Promise.all(q.states.map(state=>WallzInference.evaluateStateBatched(state))):await (async()=>{const a=[];for(const state of q.states)a.push(await WallzInference.evaluateState(state));return a;})();
      const results=answers.map(a=>({logits:Array.from(a.logits),value:a.value}));
      postMessage({id:q.id,result:{outputs:results,info:WallzInference.info()}});return;
    }
    const times=[];let evaluations=0;
    for(let i=0;i<q.rounds+4;i++){
      const start=performance.now();
      const states=Array.from({length:q.width},(_,j)=>q.states[(i*q.width+j)%q.states.length]);
      if(q.width===1)await WallzInference.evaluateState(states[0]);
      else await Promise.all(states.map(s=>WallzInference.evaluateStateBatched(s)));
      if(i>=4){times.push(performance.now()-start);evaluations+=q.width;}
    }
    postMessage({id:q.id,result:{times,evaluations,info:WallzInference.info()}});
  }catch(error){postMessage({id:q.id,error:String(error.stack||error)});}
};`;
async function environment({baseline,candidate=root,backend='auto',threads=null,browserPath,headless=true}){
  if(!['auto','cpu','gpu'].includes(backend))throw Error('backend must be auto, cpu or gpu');
  const snapshots={baseline:verify(baseline),candidate:candidate===root?manifest(root):verify(candidate)},directories={baseline,candidate};
  // Freeze all served bytes at launch so edits during a run cannot mix versions.
  const bytes=Object.fromEntries(Object.entries(directories).map(([kind,directory])=>[kind,Object.fromEntries(Object.keys(snapshots[kind]).map(name=>[name.slice(10),fs.readFileSync(path.join(directory,name))]))]));
  const server=http.createServer((request,response)=>{
    const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'};
    const match=new URL(request.url,'http://localhost').pathname.match(/^\/(baseline|candidate)\/(.*)$/);
    if(!match){response.writeHead(404);response.end();return;}
    const [ ,kind,file]=match;
    if(!file){response.writeHead(200,{...headers,'Content-Type':'text/html'});response.end('<!doctype html><title>Offline Apple Silicon comparison</title>');return;}
    let body=bytes[kind][file];if(!body){response.writeHead(404);response.end();return;}
    if(file==='compute-worker.js')body=Buffer.concat([Buffer.from(backend==='cpu'||new URL(request.url,'http://localhost').searchParams.get('backend')==='cpu'?"Object.defineProperty(navigator,'gpu',{value:undefined});\n":''),body,Buffer.from(workerHarness)]);
    response.writeHead(200,{...headers,'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.wasm')?'application/wasm':'application/octet-stream'});response.end(body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    const {chromium}=playwright();
    const executablePath=browserPath||process.env.WALLZ_BROWSER_EXECUTABLE|| (fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':fs.existsSync('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')?'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser':undefined);
    browser=await chromium.launch({headless,...(executablePath?{executablePath}:{}),args:['--enable-unsafe-webgpu'],ignoreDefaultArgs:['--enable-unsafe-swiftshader']});
    async function actor(kind,{cpuOnly=false}={}){
      const context=await browser.newContext();
      // Fail closed on accidental external traffic: every model and script is local.
      await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
      const page=await context.newPage();
      try{
        await page.addInitScript(({cpuOnly})=>{if(cpuOnly){Object.defineProperty(navigator,'gpu',{value:undefined});const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(url,options){const target=new URL(url,location.href);target.searchParams.set('backend','cpu');super(target,options);}};}},{cpuOnly:cpuOnly||backend==='cpu'});
        await page.goto(`http://127.0.0.1:${server.address().port}/${kind}/`);
        const adapter=await page.evaluate(async()=>{const a=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});return a?{vendor:a.info?.vendor,architecture:a.info?.architecture,device:a.info?.device,description:a.info?.description,fallback:a.info?.isFallbackAdapter||a.isFallbackAdapter||false}:null;});
        if(backend==='gpu'&&!cpuOnly&&(!adapter||adapter.fallback))throw Error('Hardware GPU required; adapter unavailable');
        await page.evaluate(()=>{window.chrome={runtime:{id:'offline',onMessage:{addListener:listener=>window.receiveCompute=listener},sendMessage:()=>Promise.resolve()}};});
        const started=Date.now();
        await page.addScriptTag({url:'compute-host.js'});
        const info=await page.evaluate(async threads=>{
          if(threads!==null){await ready;selected.terminate();selected=makeWorker(threads);selectedThreads=threads;return call(selected,{action:'init'});}
          return ready;
        },threads);
        if(backend==='gpu'&&!cpuOnly&&info.backend!=='webgpu')throw Error('Hardware WebGPU required, got '+JSON.stringify(info));
        if((backend==='cpu'||cpuOnly)&&info.backend!=='wasm')throw Error('CPU-only worker unexpectedly selected a GPU');
        let sequence=0;
        return {kind,context,page,adapter,info,startupMs:Date.now()-started,async call(action,payload={}){
          const result=await page.evaluate(({action,payload,id})=>call(selected,{action,...payload},id),{action,payload,id:kind+':'+(++sequence)});
          const info=result.inference||result.info;
          if(backend==='gpu'&&!cpuOnly&&info&&info.backend!=='webgpu')throw Error('Required GPU fell back during work');
          return result;
        },close:()=>context.close()};
      }catch(error){await context.close();throw error;}
    }
    return {actor,snapshots,metadata:{platform:os.platform(),arch:os.arch(),cpus:os.cpus()[0]?.model,browser:browser.version(),browserExecutable:executablePath||chromium.executablePath(),backend,threads,headless},async close(){await browser.close();await new Promise(resolve=>server.close(resolve));}};
  }catch(error){await browser?.close();await new Promise(resolve=>server.close(resolve));throw error;}
}
module.exports={root,sha,manifest,verify,snapshot,initial,seedPosition,median,save,environment};
