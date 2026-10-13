const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
// Reproduce the archived experiment sources; none of these replaces the extension.
const root=path.resolve(__dirname,'..'),output=path.join(root,'work/preparation-design');
fs.mkdirSync(output,{recursive:true});
// The recorded cache snapshot was a Windows checkout. Preserve its line endings
// so the source hashes in the experiment records can be verified on any platform.
const source=execFileSync('git',['show','78cad90:extension/neural.js'],{cwd:root,encoding:'utf8'}).replace(/\r?\n/g,'\r\n');
const write=(name,text)=>fs.writeFileSync(path.join(output,name+'.js'),text);
write('main',execFileSync('git',['show','82ca9f0:extension/neural.js'],{cwd:root,encoding:'utf8'}));write('cache',source);
const probe=source.replace('enqueuePreparation(job,{state:entry.state,choices:choices.slice(0,16),index:0,depth,score:choices[0].score,priority:choices[0].score});',`const mandatory=entry.depth===1?[...choices.slice(0,8).map(c=>c.move),...defensiveMoves(entry.state),...forcingMoves(entry.state,children)]:[];
      const keys=new Set(mandatory.map(R.moveKey));
      const retained=choices.filter((choice,i)=>i<16||keys.has(R.moveKey(choice.move)));
      for(const choice of retained)if(keys.has(R.moveKey(choice.move)))choice.score=Math.min(choice.score,entry.score+.35);
      retained.sort((a,b)=>a.score-b.score);
      enqueuePreparation(job,{state:entry.state,choices:retained,index:0,depth,score:retained[0].score,priority:retained[0].score});`);
write('probes',probe);
const primitive=`  async function ponderSimulation(rootNode,deadline,stop){
    const predictor=state=>predict(state,true);
    if(stop()||performance.now()>=deadline||positions.size>=11864||graphEdges>=249864)return null;
    if(!rootNode.edges&&rootNode.solved===null)await expand(rootNode,predictor,stop);
    if(stop()||performance.now()>=deadline)return null;
    if(rootNode.edges&&!rootNode.ponderProbes){
      const moves=[...rootNode.edges.slice().sort((a,b)=>b.prior-a.prior).slice(0,8).map(e=>e.move),...defensiveMoves(rootNode.state),...(rootNode.probes||[]).map(e=>e.move)];
      rootNode.ponderProbes=[...new Set(moves.map(move=>rootNode.edges.find(e=>R.moveKey(e.move)===R.moveKey(move))))].filter(Boolean);
    }
    let node=rootNode,value=0,cycle=false;const path=[],seen=new Set([rootNode.key]);
    while(node.edges&&node.solved===null&&path.length<100){
      if(stop()||performance.now()>=deadline)return null;
      let edge;
      if(node===rootNode&&node.ponderProbes?.length){do{edge=node.ponderProbes.shift();}while(edge&&edge.visits>0&&node.ponderProbes.length);}
      edge||=select(node,path.length<=2);if(!edge)break;
      if(!edge.child)connect(node,edge,R.apply(node.state,edge.move));
      path.push({node,edge});node=edge.child;
      if(seen.has(node.key)){cycle=true;break;}seen.add(node.key);
    }
    if(cycle)value=0;
    else if(!node.edges&&node.solved===null){if(positions.size>=11864||graphEdges>=249864)return null;value=await expand(node,predictor,stop);}
    else value=node.solved===null?node.value:node.solved;
    if(stop()||performance.now()>=deadline)return null;
    node.visits++;node.preparedVisits=(node.preparedVisits||0)+1;
    for(let i=path.length-1;i>=0;i--){value=-value;const entry=path[i];entry.edge.visits++;entry.edge.total+=value;entry.node.visits++;entry.node.preparedVisits=(entry.node.preparedVisits||0)+1;updateSolved(entry.node);}
    return value;
  }
  async function prepare(state,options={}){
    const start=performance.now(),deadline=start+Math.min(4000,Math.max(40,options.budgetMs||500)),stop=()=>!!options.shouldStop?.();
    if(state.variant!=='classic'||state.winner!=null||state.remaining.every(n=>n===0)||stop())return {prepared:0,visited:0,stopped:stop(),done:true};
    await init();if(stop()||performance.now()>=deadline)return {prepared:0,visited:0,stopped:stop(),done:false};
    const key=R.stateKey(state);let job=preparations.get(key);
    if(!job||job.epoch!==graphEpoch){
      const output=await predict(state,true);if(stop())return {prepared:0,visited:0,stopped:true,done:false};
      const children=R.successors(state),logits=children.map(c=>output.logits[policyIndex(state,c.move)]),max=Math.max(...logits),weights=logits.map(v=>Math.exp(v-max)),sum=weights.reduce((a,b)=>a+b,0);
      const forced=new Set(forcingMoves(state,children).map(R.moveKey));
      job={epoch:graphEpoch,visited:0,root:{visits:0,value:output.value,edges:children.map((child,i)=>({move:child.move,key:R.stateKey(child.state),terminal:child.state.winner!=null,prior:.9*weights[i]/sum+.1/children.length,visits:0,total:0,forced:forced.has(R.moveKey(child.move))})).filter(edge=>!edge.terminal).sort((a,b)=>b.prior-a.prior)},coverage:0};
      if(preparations.size>=4)preparations.delete(preparations.keys().next().value);
    }
    preparations.delete(key);preparations.set(key,job);let lastYield=performance.now(),lastProgress=lastYield;
    options.onProgress?.({nodes:job.visited,phase:'prepare'});
    try{
      while(!stop()&&performance.now()<deadline&&job.visited<8192&&positions.size<11864&&graphEdges<249864){
        for(const edge of job.root.edges)edge.child=positions.get(edge.key)||null;
        const unresolved=job.root.edges.filter(e=>e.child?.solved==null);if(!unresolved.length)break;
        const forced=unresolved.find(e=>e.forced&&!e.visits);
        const coverage=unresolved.find(e=>!e.visits)||unresolved.slice().sort((a,b)=>a.visits-b.visits||b.prior-a.prior)[0];
        const edge=forced||((job.visited%5===4)?coverage:select({...job.root,edges:unresolved}));
        if(!edge)break;
        if(!edge.child)edge.child=position(R.apply(state,edge.move));
        const value=await ponderSimulation(edge.child,deadline,stop);if(value===null)break;
        edge.visits++;edge.total-=value;job.root.visits++;job.visited++;
        if(performance.now()-lastProgress>=250){lastProgress=performance.now();options.onProgress?.({nodes:job.visited,phase:'prepare'});}
        if(performance.now()-lastYield>=16){await new Promise(resolve=>setTimeout(resolve,0));lastYield=performance.now();}
      }
      return {prepared:job.visited,visited:job.visited,stopped:stop(),done:job.visited>=8192||positions.size>=11864||graphEdges>=249864||job.root.edges.every(e=>e.child?.solved!=null),elapsedMs:Math.round(performance.now()-start)};
    }finally{for(const edge of job.root.edges)delete edge.child;}
  }
`;
let ponder=source.slice(0,source.indexOf('  async function prepare('))+primitive+source.slice(source.indexOf('  const api='));
ponder=ponder.replace('const preparations=new Map();','const preparations=new Map();let graphEdges=0,graphEpoch=0;');
ponder=ponder.replace('async function expand(node,predictor){','async function expand(node,predictor,shouldStop=()=>false){\n    if(shouldStop())return null;');
ponder=ponder.replace('node.edges=moves.map(move=>','graphEdges+=moves.length;\n    node.edges=moves.map(move=>');
ponder=ponder.replace('const output=await predictor(state),safe=', 'const output=await predictor(state);if(shouldStop()){node.edges=null;return null;}\n    const safe=');
ponder=ponder.replace('if(positions.size>12000)positions.clear();','if(positions.size>=11864||graphEdges>=249864){positions.clear();graphEdges=0;graphEpoch++;preparations.clear();}');
ponder=ponder.replace('const rootNode=position(state);','const rootNode=position(state),preparedVisits=rootNode.preparedVisits||0;rootNode.preparedVisits=0;');
ponder=ponder.replace('inference:root.WallzInference.info(),evaluationStats','inference:root.WallzInference.info(),evaluationStats,preparedVisits');
ponder=ponder.replace('positions.clear();preparedEvaluations.clear();preparations.clear();','positions.clear();graphEdges=0;graphEpoch++;preparedEvaluations.clear();preparations.clear();');
write('ponder',ponder);
// Root-isolation ablation of B, omitting C's additional scheduler so the result
// attributes the loss/benefit of context isolation rather than several changes.
let isolated=ponder.replace('const evaluations=new Map(),positions=new Map(),preparedEvaluations=new Map();','const evaluations=new Map(),preparedEvaluations=new Map();let positions=new Map();');
isolated=isolated.replace('let graphEdges=0,graphEpoch=0;','let graphEdges=0,graphEpoch=0;const contexts=new Map();let contextKey=null;\n  function activateContext(key){if(contextKey===key)return;if(contextKey&&contexts.has(contextKey))contexts.get(contextKey).edges=graphEdges;let context=contexts.get(key);if(!context){if(contexts.size>=16)contexts.delete(contexts.keys().next().value);context={positions:new Map(),edges:0};}contexts.delete(key);contexts.set(key,context);contextKey=key;positions=context.positions;graphEdges=context.edges;}');
isolated=isolated.replace('const start=performance.now(),{normal:budget,maximum}=thinkingBudget(options),hardDeadline=start+maximum-30;','activateContext(R.stateKey(state));\n    const start=performance.now(),{normal:budget,maximum}=thinkingBudget(options),hardDeadline=start+maximum-30;');
isolated=isolated.replace('for(const edge of job.root.edges)edge.child=positions.get(edge.key)||null;','for(const edge of job.root.edges)edge.child=contexts.get(edge.key)?.positions.get(edge.key)||null;');
isolated=isolated.replace('if(!edge.child)edge.child=position(R.apply(state,edge.move));','activateContext(edge.key);\n        if(!edge.child)edge.child=position(R.apply(state,edge.move));');
isolated=isolated.replace('graphEdges+=moves.length;','graphEdges+=moves.length;if(contextKey&&contexts.has(contextKey))contexts.get(contextKey).edges=graphEdges;');
write('isolated',isolated);
let bounded=ponder;
bounded=bounded.replace('graphEdges+=moves.length;\n    node.edges=moves.map(move=>','node.edges=moves.map(move=>');
bounded=bounded.replace('if(node.solved!==null){node.value=node.solved;return node.value;}','if(node.solved!==null){graphEdges+=node.edges.length;node.value=node.solved;return node.value;}');
bounded=bounded.replace('const output=await predictor(state);if(shouldStop()){node.edges=null;return null;}',`const discard=()=>{for(const edge of edges)edge.child?.parents.delete(node);};
    let output;try{output=await predictor(state);}catch(error){discard();throw error;}
    if(shouldStop()){discard();return null;}`);
bounded=bounded.replace('node.edges=edges;node.value=output.value;','node.edges=edges;graphEdges+=edges.length;node.value=output.value;');
const prune=`  function retainSearch(state){
    const rootNode=positions.get(R.stateKey(state)),kept=new Map();let edges=0;
    if(rootNode){const queue=[rootNode],seen=new Set([rootNode.key]);let index=0;
      while(index<queue.length&&kept.size<6000){const node=queue[index++],width=node.edges?.length||0;if(edges+width>125000)continue;kept.set(node.key,node);edges+=width;
        for(const edge of (node.edges||[]).slice().sort((a,b)=>b.visits-a.visits||b.prior-a.prior)){if(edge.child&&!seen.has(edge.child.key)){seen.add(edge.child.key);queue.push(edge.child);}}
      }
    }
    positions.clear();for(const [key,node]of kept)positions.set(key,node);
    for(const node of kept.values()){
      for(const parent of node.parents)if(kept.get(parent.key)!==parent)node.parents.delete(parent);
      for(const edge of node.edges||[])if(edge.child&&kept.get(edge.child.key)!==edge.child){edge.child.parents.delete(node);edge.child=null;}
    }
    // Solved internal nodes need their move witnesses. Re-expand them rather\n    // than preserving a proof flag after retention has removed its dependencies.\n    for(const node of kept.values())if(node.solved!==null&&node.edges){\n      edges-=node.edges.length;for(const edge of node.edges)edge.child?.parents.delete(node);\n      node.edges=null;node.solved=null;node.mate=null;node.visits=0;node.preparedVisits=0;delete node.probes;delete node.ponderProbes;\n    }\n    graphEdges=edges;graphEpoch++;preparations.clear();
  }
`;
bounded=bounded.replace('  async function search(state,options={}){',prune+'  async function search(state,options={}){');
bounded=bounded.replace('if(positions.size>=11864||graphEdges>=249864){positions.clear();graphEdges=0;graphEpoch++;preparations.clear();}','if(positions.size>=11800||graphEdges>=249800)retainSearch(state);');
bounded=bounded.replace('while(!options.shouldStop?.()&&rootNode.solved===null){','while(!options.shouldStop?.()&&rootNode.solved===null&&positions.size<11800&&graphEdges<249800){');
bounded=bounded.replaceAll('11864','11800').replaceAll('249864','249800');
write('bounded',bounded);
write('bounded-preproof',bounded.replace(/    \/\/ Solved internal nodes need their move witnesses\..*?    graphEdges=edges;graphEpoch\+\+;preparations\.clear\(\);/s,'    graphEdges=edges;graphEpoch++;preparations.clear();'));
for(const name of ['main','cache','probes','ponder','isolated','bounded','bounded-preproof']){execFileSync(process.execPath,['--check',path.join(output,name+'.js')]);}
console.log('Archived experiment variants built in work/preparation-design; extension unchanged.');
