'use strict';
const path=require('node:path'),assert=require('node:assert/strict');
const C=require('./apple-silicon-common.cjs'),R=require('../extension/rules.js');
const args=process.argv.slice(2),command=args.shift()||'benchmark';
function arg(name,fallback){const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw Error(name+' requires a value');return args[i+1];}
function integer(name,fallback,min,max){const n=Number(arg(name,String(fallback)));if(!Number.isInteger(n)||n<min||n>max)throw Error('Invalid '+name);return n;}
const baseline=path.resolve(C.root,arg('--baseline','work/apple-silicon/baseline'));
const output=path.resolve(C.root,arg('--output',`outputs/apple-silicon/${command}.json`));
// All generated snapshots and results belong under directories already ignored by Git.
for(const directory of [baseline,output])if(!['work','outputs'].some(name=>directory.startsWith(path.join(C.root,name)+path.sep)))throw Error('Keep generated files under work/ or outputs/');
const budgetMs=integer('--budget-ms',400,100,6000),backend=arg('--backend','auto');
const threads=arg('--threads',null)===null?null:integer('--threads',1,1,64);
const scenarios=[{id:'opening',state:C.initial()},...[211,619,2039,4177,8111,104729,130363,155921,196613,262147,524287].map((seed,i)=>({id:'seed-'+seed,state:C.seedPosition(R,seed,6+i%3*4)}))];
function strengthSummary(games){
  const wins=games.filter(g=>g.winner==='candidate').length,losses=games.filter(g=>g.winner==='baseline').length,unresolved=games.length-wins-losses;
  const pairs=[];
  for(let i=0;i<games.length;i+=2){const a=games[i],b=games[i+1];if(!b||a.pair!==b.pair||a.candidatePlayer===b.candidatePlayer||JSON.stringify(a.initial)!==JSON.stringify(b.initial))throw Error('Incomplete or invalid side-swapped pair');
    pairs.push({pair:a.pair,scenario:a.scenario,wins:[a,b].filter(g=>g.winner==='candidate').length,losses:[a,b].filter(g=>g.winner==='baseline').length,unresolved:[a,b].filter(g=>g.winner===null).length});}
  const epsilon=pairs.length?Math.sqrt(Math.log(40)/(2*pairs.length)):1;
  const interval=[Math.max(0,wins/games.length-epsilon)||0,Math.min(1,(wins+unresolved)/games.length+epsilon)||1];
  return {wins,losses,unresolved,completedPairs:pairs.length,pairs,scoreRange:games.length?[wins/games.length,(wins+unresolved)/games.length]:[0,1],conditional95ScoreInterval:interval,nonInferiorityMargin:.05,nonRegressionEstablished:interval[0]>.45,
    uncertainty:'Conservative Hoeffding bound treating each scenario pair as one independent bounded observation; unresolved games span loss to win. Generalization requires independent representative scenarios, which this fixed fixture suite cannot establish. No Elo claim. A small match suite cannot prove absence of strength regression.'};
}
async function benchmark(env,report){
  const samples=integer('--samples',4,1,40),rounds=integer('--rounds',40,4,500),states=scenarios.map(s=>s.state);
  const parityStates=[...states,...Array.from({length:84},(_,i)=>C.seedPosition(R,32452843+i*7919,4+i%10*4))];
  report.samples=samples;report.rounds=rounds;report.budgetMs=budgetMs;report.rows=[];report.parity=[];report.startups=[];
  const cpu=await env.actor('baseline',{cpuOnly:true});let cpuOutputs;
  try{const result=await cpu.call('outputs',{states:parityStates});cpuOutputs=result.outputs;report.cpuReference={info:result.info,positions:parityStates.length};}finally{await cpu.close();}
  for(let sample=0;sample<samples;sample++){
    const actors={};
    try{
      for(const kind of sample%2?['candidate','baseline']:['baseline','candidate']){
        const actor=actors[kind]=await env.actor(kind);report.startups.push({sample,kind,elapsedMs:actor.startupMs,info:actor.info,adapter:actor.adapter});
        const outputs=await actor.call('outputs',{states:parityStates,batched:true});actor.outputs=outputs.outputs;
        for(const width of [1,4,8]){
          const result=await actor.call('measure',{states,width,rounds});
          report.rows.push({sample,kind,width,...result,medianMs:C.median(result.times),evaluationsPerSecond:result.evaluations/(result.times.reduce((a,b)=>a+b,0)/1000)});save();
        }
        for(const fixture of scenarios.slice(0,4)){
          const result=await actor.call('search-fixture',{state:fixture.state,budgetMs});assertMove(fixture.state,result,budgetMs);
          report.rows.push({sample,kind,scenario:fixture.id,search:true,nodes:result.nodes,wallMs:result.wallMs,nodesPerSecond:result.nodes/(result.wallMs/1000),move:result.candidates[0].move,engine:result.engine,evaluationStats:result.evaluationStats,inference:result.inference});save();
        }
      }
      for(const [reference,expected,actual] of [['baseline-vs-candidate',actors.baseline.outputs,actors.candidate.outputs],['cpu-vs-baseline',cpuOutputs,actors.baseline.outputs],['cpu-vs-candidate',cpuOutputs,actors.candidate.outputs]]){
        let maxValueError=0,maxPolicyError=0;
        for(let i=0;i<parityStates.length;i++){const a=expected[i],b=actual[i];assert.equal(a.logits.length,b.logits.length);assert.ok(Number.isFinite(b.value)&&b.logits.every(Number.isFinite));maxValueError=Math.max(maxValueError,Math.abs(a.value-b.value));for(let j=0;j<a.logits.length;j++)maxPolicyError=Math.max(maxPolicyError,Math.abs(a.logits[j]-b.logits[j]));}
        report.parity.push({sample,reference,positions:parityStates.length,maxValueError,maxPolicyError});assert.ok(maxValueError<=.002&&maxPolicyError<=.002,'Model outputs changed: '+reference);
      }
    }finally{for(const actor of Object.values(actors))await actor.close();}
  }
  const categories=[1,4,8,'search'];report.speed=categories.map(category=>{
    const ratios=Array.from({length:samples},(_,sample)=>{const values={};for(const kind of ['baseline','candidate'])values[kind]=C.median(report.rows.filter(r=>r.kind===kind&&r.sample===sample&&(category==='search'?r.search:r.width===category)).map(r=>category==='search'?r.nodesPerSecond:r.evaluationsPerSecond));return values.candidate/values.baseline;});
    return {category,pairedSpeedRatios:ratios,medianSpeedup:C.median(ratios),minSpeedup:Math.min(...ratios),maxSpeedup:Math.max(...ratios)};
  });
  function save(){C.save(output,report);}
}
function assertMove(state,result,limit){
  if(result.engine!=='neural-puct'&&result.engine!=='exact-race'&&result.engine!=='classical'){
    // Proofs can bypass neural search. A model failure must never pass silently.
    if(result.modelError||String(result.engine).includes('fallback'))throw Error('Neural search fell back: '+JSON.stringify(result));
  }
  if(result.modelError)throw Error(result.modelError);
  if(!result.candidates?.[0]?.move)throw Error('No move');R.apply(state,result.candidates[0].move);
  const elapsed=result.wallMs??result.elapsedMs;
  if(elapsed>limit+250)throw Error('Thinking budget overrun: '+elapsed+' ms');
}
async function matches(env,report){
  const pairs=integer('--pairs',8,1,scenarios.length),maxPlies=integer('--max-plies',180,20,400),idleMs=integer('--idle-ms',200,0,4000);
  report.budgetMs=report.maxBudgetMs=budgetMs;report.idleMs=idleMs;report.requestedPairs=pairs;report.maxPlies=maxPlies;report.games=[];
  for(let pair=0;pair<pairs;pair++)for(let side=0;side<2;side++){
    const actors={},scenario=scenarios[pair],candidatePlayer=(pair%2)^side;
    try{
      // Alternate launch order as well as side order. Games run serially to avoid GPU contention.
      for(const kind of (pair+side)%2?['candidate','baseline']:['baseline','candidate'])actors[kind]=await env.actor(kind);
      let state=structuredClone(scenario.state);const repetitions=new Map([[R.stateKey(state),1]]);
      const game={pair,scenario:scenario.id,candidatePlayer,initial:structuredClone(state),backends:Object.fromEntries(Object.entries(actors).map(([kind,a])=>[kind,{info:a.info,adapter:a.adapter,startupMs:a.startupMs}])),moves:[],winner:null,reason:'ply-limit'};
      report.active={pair,side,ply:0};C.save(output,report);
      while(state.winner===null&&game.moves.length<maxPlies){
        const kind=state.turn===candidatePlayer?'candidate':'baseline',waiting=kind==='candidate'?'baseline':'candidate';
        let preparation=null;if(idleMs){preparation=await actors[waiting].call('prepare',{state,budgetMs:idleMs});if(preparation.elapsedMs>idleMs+250)throw Error('Preparation budget overrun');}
        const start=Date.now(),result=await actors[kind].call('analyse',{state,budgetMs,maxBudgetMs:budgetMs}),wallMs=Date.now()-start;
        assertMove(state,{...result,wallMs},budgetMs);
        game.moves.push({actor:kind,player:state.turn,move:result.candidates[0].move,nodes:result.nodes,elapsedMs:result.elapsedMs,wallMs,engine:result.engine,modelError:result.modelError,inference:result.inference,evaluationStats:result.evaluationStats,preparation});
        state=R.apply(state,result.candidates[0].move);const key=R.stateKey(state),count=(repetitions.get(key)||0)+1;repetitions.set(key,count);
        report.active={pair,side,ply:game.moves.length};
        if(game.moves.length%16===0){C.save(output,report);process.stderr.write(`pair ${pair+1}/${pairs}, candidate side ${candidatePlayer}, ply ${game.moves.length}\n`);}
        if(count>=6&&state.winner===null){game.reason='repeated-position';break;}
      }
      game.final=state;game.finalBackends={};for(const [kind,actor]of Object.entries(actors))game.finalBackends[kind]=(await actor.call('outputs',{states:[]})).info;
      if(state.winner!==null){game.winner=state.winner===candidatePlayer?'candidate':'baseline';game.reason='goal-reached';}
      report.games.push(game);delete report.active;
      // Summarize only complete pairs; interrupted runs retain all individual game records.
      report.strength=strengthSummary(report.games.slice(0,report.games.length-report.games.length%2));C.save(output,report);
      process.stderr.write(`Finished pair ${pair+1}, candidate side ${candidatePlayer}: ${game.winner||'unresolved'} (${game.reason}, ${game.moves.length} plies)\n`);
    }finally{for(const actor of Object.values(actors))await actor.close();}
  }
}
async function main(){
  if(command==='snapshot'){const files=C.snapshot(baseline);console.log('Baseline preserved: '+Object.keys(files).length+' extension files');return;}
  if(!['benchmark','matches'].includes(command))throw Error('Use snapshot, benchmark or matches');
  const report={status:'running',startedAt:new Date().toISOString(),command,baseline,limitations:['Offline localhost only; separate persistent workers for each player; serial games avoid simultaneous model contention.','Both actors use their own complete frozen extension, including models, rules, inference, search, worker and thread calibration.','GPU remains available in auto/gpu modes. GPU mode requires a non-software adapter and selected WebGPU; CPU mode is explicit.','Same foreground and preparation allowances, same initial position per pair, swapped sides, no opening fast-path metadata for either actor.','Runtime initialization is outside the thinking budget. Cold startup and steady-state timings are recorded separately.','Hardware/browser power state and timing noise affect results; speed is not playing strength.']};
  let env;
  try{env=await C.environment({baseline,backend,threads,browserPath:arg('--browser',undefined),headless:!args.includes('--headed')});report.environment=env.metadata;report.snapshots=env.snapshots;
    await (command==='benchmark'?benchmark:matches)(env,report);
    assert.deepEqual(C.manifest(C.root),env.snapshots.candidate,'Candidate changed during run');C.verify(baseline);report.status='complete';report.finishedAt=new Date().toISOString();C.save(output,report);console.log(JSON.stringify({output,status:report.status,speed:report.speed,strength:report.strength},null,2));
  }catch(error){report.status='failed';report.error=String(error.stack||error);C.save(output,report);throw error;}finally{await env?.close();}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={strengthSummary,assertMove};
