// Compare opponent-turn preparation with an immutable revision using the bundled model.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
const {createRequire}=require('node:module');
const R=require('../extension/rules.js');
const root=path.resolve(__dirname,'..'),extension=path.join(root,'extension');
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const reference=arg('--reference','82ca9f0eb7b6c0e59ebbc8834658ba559e4ed7a8'),output=arg('--output',null);
const samples=Number(arg('--samples','2')),prepareMs=Number(arg('--prepare-ms','500')),searchMs=Number(arg('--search-ms','1000'));
if(![samples,prepareMs,searchMs].every(n=>Number.isFinite(n)&&n>0)||!Number.isInteger(samples))throw new Error('Budgets and samples must be positive numbers');
let playwright;
try{playwright=require('playwright');}catch{playwright=createRequire(path.join(process.env.PLAYWRIGHT_MODULE_DIR||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'_preparation.cjs'))('playwright');}
const baseline=execFileSync('git',['show',reference+':extension/neural.js'],{cwd:root,encoding:'utf8'});
// Observe actual predictor requests, including cache hits, without changing their results.
const instrument=source=>source.replace('if(cached){',`if(root.preparationMetrics){const m=root.preparationMetrics;m.requests++;if(cached){m.cacheHits++;if(preparedEvaluations.has(key))m.preparedHits++;}else m.fresh++;}\n    if(cached){`);
const initial={pawns:[4,76],walls:[],remaining:[10,10],turn:1,winner:null,variant:'classic'};
let middle={...initial,turn:0};
for(const move of [{type:'pawn',to:13},{type:'pawn',to:67},{type:'wall',wall:19},{type:'wall',wall:43},{type:'pawn',to:22}])middle=R.apply(middle,move);
const fixtures=[{id:'opening-forward',state:initial,reply:{type:'pawn',to:67}},{id:'opening-wall',state:initial,reply:{type:'wall',wall:3}},{id:'middlegame-forward',state:middle,reply:{type:'pawn',to:58}},{id:'middlegame-wall',state:middle,reply:{type:'wall',wall:4}}];
for(const fixture of fixtures)R.apply(fixture.state,fixture.reply);
const server=http.createServer((req,res)=>{
  const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'};
  if(req.url==='/'){res.writeHead(200,{...headers,'Content-Type':'text/html'});res.end('<!doctype html><title>Preparation benchmark</title><script src="/vendor/ort.webgpu.min.js"></script><script src="/rules.js"></script><script src="/engine.js"></script><script src="/inference.js"></script>');return;}
  if(req.url==='/baseline.js'||req.url==='/current.js'){res.writeHead(200,{...headers,'Content-Type':'text/javascript'});res.end(instrument(req.url==='/baseline.js'?baseline:fs.readFileSync(path.join(extension,'neural.js'),'utf8')));return;}
  let target;
  try{target=path.resolve(extension,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));}catch{res.writeHead(400);res.end();return;}
  if(!target.startsWith(extension+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(target,(error,bytes)=>{if(error){res.writeHead(404);res.end();return;}res.writeHead(200,{...headers,'Content-Type':target.endsWith('.wasm')?'application/wasm':target.endsWith('.js')?'text/javascript':'application/octet-stream'});res.end(bytes);});
});
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    browser=await playwright.chromium.launch({headless:true,channel:'chrome'});
    const page=await browser.newPage();
    await page.addInitScript(()=>{window.WallzThreads=1;Object.defineProperty(navigator,'gpu',{value:undefined});});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addScriptTag({url:`http://127.0.0.1:${server.address().port}/baseline.js`});
    const startup=await page.evaluate(async()=>{await WallzInference.init();return WallzInference.info();});
    const rows=[];
    for(let sample=0;sample<samples;sample++)for(const fixture of fixtures)for(const variant of sample%2?['current','baseline']:['baseline','current']){
      // Reset both classical and neural caches, preserving only the loaded inference session.
      await page.addScriptTag({path:path.join(extension,'rules.js')});
      await page.addScriptTag({path:path.join(extension,'engine.js')});
      await page.addScriptTag({url:`http://127.0.0.1:${server.address().port}/${variant}.js`});
      const measured=await page.evaluate(async({fixture,prepareMs,searchMs})=>{
        const before=JSON.stringify(fixture.state),inputs=[],original=WallzInference.evaluate;
        const signature=input=>Array.from(input).join(',');
        WallzInference.evaluate=async input=>{inputs.push(signature(input));return original(input);};
        let preparation;
        try{preparation=await WallzNeural.prepare(fixture.state,{budgetMs:prepareMs});}finally{WallzInference.evaluate=original;}
        const next=WallzRules.apply(fixture.state,fixture.reply),replyPrepared=inputs.includes(signature(WallzNeural.encode(next)));
        window.preparationMetrics={requests:0,cacheHits:0,preparedHits:0,fresh:0};
        const result=await WallzNeural.analyse(next,{budgetMs:searchMs,maxBudgetMs:searchMs});
        const metrics=window.preparationMetrics;delete window.preparationMetrics;
        return {preparation,replyPrepared,metrics,nodes:result.nodes,elapsedMs:result.elapsedMs,engine:result.engine,choice:result.candidates[0]?.move,unchanged:JSON.stringify(fixture.state)===before,modelError:result.modelError};
      },{fixture,prepareMs,searchMs});
      const next=R.apply(fixture.state,fixture.reply);let legal=false;
      if(measured.choice){try{R.apply(next,measured.choice);legal=true;}catch{}}
      rows.push({id:fixture.id,variant,sample,...measured,legal});
      process.stderr.write(`${variant} ${fixture.id}: ${measured.preparation.visited} prepared, ${measured.metrics.preparedHits} reused, ${measured.nodes} search visits\n`);
    }
    const report={reference,samples,prepareMs,searchMs,startup,rows,limitations:['Headless Chrome, one CPU thread, warm bundled model; this does not predict the selected extension GPU backend.','Four legal reply fixtures measure cache use and search work, not strength, win rate, or optimal play.','Variant order alternates by sample; all search caches reset for each measurement.']};
    const json=JSON.stringify(report,null,2)+'\n';if(output){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,json);}process.stdout.write(json);
    if(rows.some(row=>!row.legal||!row.unchanged||row.modelError))process.exitCode=1;
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;server.close();});
