// Compare the historical and current search with the identical bundled model.
// Uses local browser contexts only; never visits Wallz or plays an online game.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {createRequire}=require('node:module');
const {createHash}=require('node:crypto');
const R=require('../extension/rules.js');
const root=path.resolve(__dirname,'..'),extension=path.join(root,'extension');
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('node scripts/opening-matches.cjs [--mode audit|matches|all] [--threads 4] [--concurrency 3] [--max-plies 160] [--reference b668900] [--output outputs/opening-matches/report.json] [--smoke]');process.exit(0);}
const arg=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`${name} needs a value`);return args[i+1];};
const smoke=args.includes('--smoke'),mode=arg('--mode','all'),reference=arg('--reference','b668900');
const threads=Number(arg('--threads','4')),concurrency=Number(arg('--concurrency','3'));
const maxPlies=smoke?8:Number(arg('--max-plies','160'));
const output=path.resolve(root,arg('--output','outputs/opening-matches/report.json'));
if(!['audit','matches','all'].includes(mode))throw new Error('Mode must be audit, matches or all');
for(const [name,value,max]of [['threads',threads,64],['concurrency',concurrency,4],['max-plies',maxPlies,300]])if(!Number.isInteger(value)||value<1||value>max)throw new Error(`Invalid ${name}`);
if(!output.startsWith(root+path.sep))throw new Error('Keep match outputs within the project');
const revision=execFileSync('git',['rev-parse',reference],{cwd:root,encoding:'utf8'}).trim();
execFileSync('git',['diff','--quiet',revision,'--','extension/rules.js','extension/engine.js','extension/inference.js','extension/models/','extension/vendor/'],{cwd:root});
const legacySource=execFileSync('git',['show',`${revision}:extension/neural.js`],{cwd:root,maxBuffer:8*1024*1024});
const currentSource=fs.readFileSync(path.join(extension,'neural.js'));
const bridgeSource=fs.readFileSync(path.join(extension,'bridge.js'),'utf8');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let playwright;
try{playwright=require('playwright');}catch{
  const modules=process.env.PLAYWRIGHT_MODULE_DIR||path.join(process.env.USERPROFILE||'','.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules');
  playwright=createRequire(path.join(modules,'_matches.cjs'))('playwright');
}
const initial=turn=>({pawns:[4,76],walls:[],remaining:[10,10],turn,winner:null,variant:'classic'});
const raw=s=>({pawns:{p1:R.coords(s.pawns[0]),p2:R.coords(s.pawns[1])},walls:s.walls.map(R.wallCoords),wallsRemaining:{p1:s.remaining[0],p2:s.remaining[1]},turn:s.turn===0?'p1':'p2',winner:s.winner==null?null:s.winner===0?'p1':'p2',variant:s.variant});
function observer(){
  const start=bridgeSource.indexOf('  function trackOpening('),end=bridgeSource.indexOf('\n  function currentAncestors(',start);
  if(start<0||end<0)throw new Error('Opening tracker location changed');
  const context={};
  vm.runInNewContext('let trackedOpening=null;\n'+bridgeSource.slice(start,end)+'\nglobalThis.observe=trackOpening;',context);
  return (state,ply,id)=>context.observe({game:raw(state),moves:Array(ply).fill(null)},id);
}
const report={startedAt:new Date().toISOString(),status:'running',smoke,legacyRevision:revision,currentNeuralSha256:sha(currentSource),legacyNeuralSha256:sha(legacySource),currentBridgeSha256:sha(Buffer.from(bridgeSource)),modelSha256:sha(fs.readFileSync(path.join(extension,'models','quoridor.onnx'))),threads,concurrency,maxPlies,
  budgets:{audit:smoke?{budgetMs:250,maxBudgetMs:250}:{budgetMs:3000,maxBudgetMs:6000},matches:smoke?{budgetMs:100,maxBudgetMs:100}:{budgetMs:2000,maxBudgetMs:4000}},
  audit:[],games:[],active:{},limitations:['A finite matched sample cannot prove identical playing strength or win rates.','Both searches use exactly the same bundled neural model and game-rule assets.','Opponent-turn preparation is disabled for both engines to isolate search.','Wall-clock scheduling can cause search variation; colors and forced starting scenarios are paired.','Unfinished and repeated-position stops are not counted as wins or draws.','No online game or website is contacted.']};
function checkpoint(){fs.mkdirSync(path.dirname(output),{recursive:true});const temp=output+'.tmp';fs.writeFileSync(temp,JSON.stringify(report,null,2)+'\n');fs.renameSync(temp,output);}
const server=http.createServer((req,res)=>{
  const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'};
  const pathname=new URL(req.url,'http://localhost').pathname,match=pathname.match(/^\/(legacy|current)\/(.*)$/);
  if(!match){res.writeHead(404);res.end();return;}
  const [,,relative]=match;
  if(!relative){res.writeHead(200,{...headers,'Content-Type':'text/html'});res.end('<!doctype html><title>Local engine comparison</title>'+['vendor/ort.webgpu.min.js','rules.js','engine.js','inference.js','neural.js'].map(p=>`<script src="${p}"></script>`).join(''));return;}
  if(relative==='neural.js'){res.writeHead(200,{...headers,'Content-Type':'text/javascript'});res.end(match[1]==='legacy'?legacySource:currentSource);return;}
  let target;try{target=path.resolve(extension,decodeURIComponent(relative));}catch{res.writeHead(400);res.end();return;}
  if(!target.startsWith(extension+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(target,(error,bytes)=>{if(error){res.writeHead(404);res.end();return;}res.writeHead(200,{...headers,'Content-Type':target.endsWith('.wasm')?'application/wasm':target.endsWith('.js')?'text/javascript':'application/octet-stream'});res.end(bytes);});
});
let browser;
async function engine(kind){
  const context=await browser.newContext();
  await context.addInitScript(count=>{window.WallzThreads=count;Object.defineProperty(navigator,'gpu',{value:undefined});},threads);
  const page=await context.newPage();page.setDefaultTimeout(30000);
  await page.goto(`http://127.0.0.1:${server.address().port}/${kind}/`);
  const info=await page.evaluate(async()=>{await WallzNeural.init();return WallzInference.info();});
  assert.equal(info.threads,threads,'Both engines need the declared CPU configuration');
  return {context,page,info,kind};
}
async function analyse(actor,state,options){
  const result=await actor.page.evaluate(async({state,options})=>{
    const before=JSON.stringify(state),start=performance.now(),answer=await WallzNeural.analyse(state,options);
    if(JSON.stringify(state)!==before)throw new Error('Search mutated input');
    return {move:answer.candidates[0]?.move,elapsedMs:performance.now()-start,engine:answer.engine,fast:answer.openingFastPath===true,searchBudgetMs:answer.searchBudgetMs,nodes:answer.nodes,provenWin:answer.provenWin===true,modelError:answer.modelError,candidates:answer.candidates.map(c=>({move:c.move,visits:c.visits,prior:c.prior,score:c.score,bound:c.bound}))};
  },{state,options});
  if(!result.move)throw new Error('Search returned no playable move');
  R.apply(state,result.move);
  if(result.modelError)throw new Error(`${actor.kind} model failed: ${result.modelError}`);
  if(result.fast&&(actor.kind!=='current'||!options.opening||options.opening.ply>=6))throw new Error('Opening fast path escaped its eligibility boundary');
  return result;
}
async function reset(actor){await actor.page.addScriptTag({url:`http://127.0.0.1:${server.address().port}/${actor.kind}/engine.js`});await actor.page.addScriptTag({content:(actor.kind==='legacy'?legacySource:currentSource).toString('utf8')});}
async function audit(){
  const legacy=await engine('legacy'),current=await engine('current');
  try{
    report.auditBackends={legacy:legacy.info,current:current.info};
    for(const starter of (smoke?[0]:[0,1])){
      let state=initial(starter);const observe=observer();
      for(let ply=0;ply<(smoke?1:8);ply++){
        const opening=observe(state,ply,'audit-'+starter);
        if(ply>=6)assert.equal(opening,undefined);
        await reset(legacy);await reset(current);
        const before=await analyse(legacy,state,report.budgets.audit);
        const after=await analyse(current,state,{...report.budgets.audit,...(opening?{opening}:{})});
        const row={starter,ply,state,opening:opening||null,legacy:before,current:after,agree:R.moveKey(before.move)===R.moveKey(after.move)};
        report.audit.push(row);checkpoint();
        console.error(`audit starter=${starter} ply=${ply}: legacy=${R.moveKey(before.move)} ${Math.round(before.elapsedMs)}ms current=${R.moveKey(after.move)} ${Math.round(after.elapsedMs)}ms fast=${after.fast} agree=${row.agree}`);
        if(ply<7){const forward={type:'pawn',to:state.pawns[state.turn]+(state.turn===0?9:-9)};
          const legal=R.pawnMoves(state).find(move=>move.to===forward.to)||R.pawnMoves(state).find(move=>move.to===state.pawns[state.turn]+(state.turn===0?18:-18));
          if(!legal)throw new Error('Expected forward/jump control is not legal');state=R.apply(state,legal);}
      }
    }
  }finally{await legacy.context.close();await current.context.close();}
}
const scenarios=[
  {id:'standard-p1-start',starter:0,prefix:[]},
  {id:'standard-p2-start',starter:1,prefix:[]},
  {id:'left-opening',starter:0,prefix:[{type:'pawn',to:3},{type:'pawn',to:75}]},
  {id:'right-opening',starter:0,prefix:[{type:'pawn',to:5},{type:'pawn',to:77}]},
  {id:'instant-wall',starter:0,prefix:[{type:'wall',wall:3},{type:'pawn',to:67}]},
  {id:'forced-six-forward',starter:0,prefix:[13,67,22,58,31,49].map(to=>({type:'pawn',to}))}
];
async function game(job){
  const legacy=await engine('legacy'),current=await engine('current'),observe=observer();
  let state=initial(job.scenario.starter),ply=0;observe(state,ply,job.id);
  const record={id:job.id,scenario:job.scenario.id,currentPlayer:job.currentPlayer,starter:job.scenario.starter,prefix:job.scenario.prefix,backends:{legacy:legacy.info,current:current.info},startedAt:new Date().toISOString(),moves:[]};
  try{
    for(const move of job.scenario.prefix){state=R.apply(state,move);ply++;observe(state,ply,job.id);}
    const repetitions=new Map([[R.stateKey(state),1]]);let reason='ply-limit';
    while(state.winner==null&&record.moves.length<maxPlies){
      const opening=observe(state,ply,job.id),actor=state.turn===job.currentPlayer?current:legacy;
      if(ply>=6)assert.equal(opening,undefined);
      if(state.walls.length)assert.equal(opening,undefined);
      const answer=await analyse(actor,state,{...report.budgets.matches,...(actor===current&&opening?{opening}:{})});
      record.moves.push({ply,player:state.turn,actor:actor.kind,stateKey:R.stateKey(state),opening:actor===current&&opening?opening:null,...answer});
      state=R.apply(state,answer.move);ply++;
      report.active[job.id]={scenario:job.scenario.id,currentPlayer:job.currentPlayer,ply,playedMoves:record.moves.length,lastActor:actor.kind,lastMove:answer.move,walls:state.walls.length,earlyExits:record.moves.filter(m=>m.fast).length};checkpoint();
      if(record.moves.length%4===0)console.error(`${job.id}: ply=${ply}, walls=${state.walls.length}, last=${actor.kind}:${R.moveKey(answer.move)}, fast=${answer.fast}`);
      const key=R.stateKey(state),count=(repetitions.get(key)||0)+1;repetitions.set(key,count);
      if(count>=6&&state.winner==null){reason='repeated-position';break;}
    }
    record.finishedAt=new Date().toISOString();record.finalState=state;record.totalPly=ply;record.winnerPlayer=state.winner;
    record.winner=state.winner==null?null:state.winner===job.currentPlayer?'current':'legacy';record.reason=state.winner==null?reason:'goal-reached';
    report.games.push(record);delete report.active[job.id];checkpoint();
    console.error(`FINISHED ${job.id}: ${record.winner||'unfinished'} (${record.reason}), ${record.moves.length} played moves`);
  }finally{await legacy.context.close();await current.context.close();}
}
async function matches(){
  const jobs=(smoke?scenarios.slice(0,1):scenarios).flatMap(scenario=>[0,1].map(currentPlayer=>({id:`${scenario.id}-current-p${currentPlayer+1}`,scenario,currentPlayer})));
  let next=0;
  async function lane(){while(next<jobs.length){const job=jobs[next++];await game(job);}}
  await Promise.all(Array.from({length:Math.min(concurrency,jobs.length)},lane));
}
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));checkpoint();
  try{
    browser=await playwright.chromium.launch({headless:true,...(process.env.OPENING_BROWSER_PATH?{executablePath:process.env.OPENING_BROWSER_PATH}:{channel:'chrome'})});
    if(mode==='audit'||mode==='all')await audit();
    if(mode==='matches'||mode==='all')await matches();
    const currentWins=report.games.filter(g=>g.winner==='current').length,legacyWins=report.games.filter(g=>g.winner==='legacy').length;
    report.summary={games:report.games.length,currentWins,legacyWins,unfinished:report.games.filter(g=>g.winner==null).length,auditCases:report.audit.length,auditAgreements:report.audit.filter(a=>a.agree).length,auditEarlyExits:report.audit.filter(a=>a.current.fast).length,playedMoves:report.games.reduce((n,g)=>n+g.moves.length,0),matchEarlyExits:report.games.reduce((n,g)=>n+g.moves.filter(m=>m.fast).length,0),illegalMoves:0,fastPathAfterCutoff:0};
    report.status='complete';report.finishedAt=new Date().toISOString();checkpoint();console.log(JSON.stringify({output,status:report.status,summary:report.summary},null,2));
  }catch(error){report.status='error';report.error=String(error.stack||error);checkpoint();throw error;}
  finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
