(function(root){
  'use strict';
  const R=typeof module!=='undefined'?require('./rules.js'):root.WallzRules;
  const E=typeof module!=='undefined'?require('./engine.js'):root.WallzEngine;
  const directions=[[0,1],[0,-1],[-1,0],[1,0],[-1,1],[1,1],[-1,-1],[1,-1]];
  const evaluations=new Map(),positions=new Map(),preparedEvaluations=new Map();
  let preparation=null;
  function encode(state){
    const out=new Float32Array(648),us=state.turn,them=1-us,flip=us===1;
    const index=p=>p%9+(flip?8-(p/9|0):p/9|0)*9;
    out[index(state.pawns[us])]=1;out[81+index(state.pawns[them])]=1;
    for(const w of state.walls){const x=w&7,y=(w&63)>>3;
      if(w<64){const p=x+(flip?7-y:y)*9;out[162+p]=1;out[162+p+1]=1;}
      else{const p=x+(flip?7-y:y)*9;out[243+p]=1;out[243+p+9]=1;}
    }
    const maps=R.graph(state).maps;
    for(let p=0;p<81;p++){const q=index(p);out[324+q]=state.remaining[us]/10;out[405+q]=state.remaining[them]/10;
      out[486+q]=maps[us][p]<0?1:maps[us][p]/80;out[567+q]=maps[them][p]<0?1:maps[them][p]/80;
    }
    return out;
  }
  function policyIndex(state,move){
    const flip=state.turn===1;
    if(move.type==='wall'){const w=move.wall,x=w&7,y=(w&63)>>3;return 8+(w>=64?64:0)+(flip?7-y:y)*8+x;}
    const p=state.pawns[state.turn],dx=Math.sign(move.to%9-p%9),dy=Math.sign((move.to/9|0)-(p/9|0))*(flip?-1:1);
    return directions.findIndex(d=>d[0]===dx&&d[1]===dy);
  }
  function init(){
    return root.WallzInference.init();
  }
  async function predict(state,preparing=false){
    const key=R.stateKey(state),cached=evaluations.get(key)||preparedEvaluations.get(key);
    if(cached){
      if(!preparing){
        if(evaluations.size>=8192&&!evaluations.has(key))evaluations.delete(evaluations.keys().next().value);
        evaluations.delete(key);evaluations.set(key,cached);preparedEvaluations.delete(key);
      }
      return cached;
    }
    const answer=await root.WallzInference.evaluate(encode(state)),cache=preparing?preparedEvaluations:evaluations;
    if(cache.size>=8192)cache.delete(cache.keys().next().value);cache.set(key,answer);return answer;
  }
  function position(state){
    const key=R.stateKey(state);let node=positions.get(key);
    if(!node){node={key,state,edges:null,visits:0,solved:null,mate:null,value:0,parents:new Set()};positions.set(key,node);}
    return node;
  }
  const proofQueue=[];let resolving=false;
  function solved(node,value,mate){
    if(node.solved!==null)return;
    node.solved=value;node.mate=mate;node.value=value;proofQueue.push(node);
    if(resolving)return;resolving=true;
    try{while(proofQueue.length){const child=proofQueue.pop();for(const parent of child.parents)updateSolved(parent);}}
    finally{resolving=false;}
  }
  function connect(node,edge,state){
    if(!edge.child){edge.child=position(state);edge.child.parents.add(node);}
    return edge.child;
  }
  function updateSolved(node){
    if(!node.edges?.length||node.solved!==null)return;
    let win=Infinity,hasWin=false,all=true,draw=false,loss=-Infinity;
    for(const edge of node.edges){
      const child=edge.child;
      if(!child||child.solved===null){all=false;continue;}
      if(child.solved===-1){hasWin=true;win=Math.min(win,child.mate);}
      if(child.solved===0)draw=true;
      loss=Math.max(loss,child.mate);
    }
    if(hasWin){solved(node,1,1+win);return;}
    if(all){solved(node,draw?0:-1,draw?null:1+loss);}
  }
  function tacticalProof(state,until,shouldStop){
    if(performance.now()>=until||shouldStop?.())return null;
    const proof=E.proveThreat(state,{budgetMs:Math.min(2,until-performance.now()),shouldStop});
    if(proof)return proof;
    const us=state.turn,them=1-us,base=R.distances(state);
    if(base[us]>3||!state.remaining[us]||!state.remaining[them]||state.remaining[0]+state.remaining[1]>6)return null;
    const children=R.successors(state),walls=new Map(),scores=new Map();
    for(const child of children)if(child.move.type==='wall')walls.set(child.move.wall,{...child,distances:R.distances(child.state)});
    for(const [wall,entry] of walls){
      const hurt=entry.distances[us]-base[us]-(entry.distances[them]-base[them])-1;if(hurt<1)continue;
      const guards=[wall^64];
      if(wall<64){if((wall&7)>0)guards.push(wall-1);if((wall&7)<7)guards.push(wall+1);}
      else{if((wall&63)>7)guards.push(wall-8);if((wall&63)<56)guards.push(wall+8);}
      for(const guard of guards){
        const choice=walls.get(guard);if(!choice)continue;
        const cost=choice.distances[us]-base[us]-(choice.distances[them]-base[them]),score=hurt-Math.max(0,cost);
        if(score>0)scores.set(guard,Math.max(scores.get(guard)||0,score));
      }
    }
    for(const [wall] of [...scores].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,2)){
      if(performance.now()>=until||shouldStop?.())break;
      const entry=walls.get(wall),answer=E.proveThreat(entry.state,{budgetMs:Math.min(2,until-performance.now()),shouldStop});
      if(answer?.value===-1)return {value:1,plies:1+answer.plies,move:entry.move,kind:'tactical-route'};
    }
    return null;
  }

  function forcingMoves(state,children){
    if(!state.remaining[state.turn])return [];
    const us=state.turn,them=1-us,base=R.distances(state),mobility=R.pawnMoves(state,them).length,ranked=[];
    for(const entry of children){
      if(entry.move.type!=='wall')continue;
      const after=R.distances(entry.state),gain=after[them]-base[them]-(after[us]-base[us])-1;
      const restricted=mobility-R.pawnMoves(entry.state,them).length;
      if(gain>=3||(restricted>0&&state.remaining[0]+state.remaining[1]<=6))ranked.push({move:entry.move,score:Math.max(0,gain)+restricted*2});
    }
    return ranked.sort((a,b)=>b.score-a.score||a.move.wall-b.move.wall).slice(0,3).map(entry=>entry.move);
  }

  async function expand(node,predictor){
    const state=node.state,certificate=E.certify(state,{budgetMs:12});
    if(certificate){solved(node,certificate.value,certificate.plies);return node.value;}
    const children=R.successors(state),moves=children.map(entry=>entry.move);
    if(!moves.length){solved(node,0,null);return 0;}
    node.edges=moves.map(move=>({move,prior:0,visits:0,total:0,child:null}));
    const tactical=state.remaining[0]+state.remaining[1]<=6&&R.distances(state).some(distance=>distance<=5),proofDeadline=performance.now()+4;
    for(let i=0;i<node.edges.length;i++){const edge=node.edges[i],child=children[i].state;
      const proof=tactical&&performance.now()<proofDeadline?E.certify(child,{budgetMs:2,protectedOnly:true}):null;
      if(proof){solved(connect(node,edge,child),proof.value,proof.plies);continue;}
      if(Math.abs((child.pawns[child.turn]/9|0)-R.goal(child,child.turn))<=2&&R.pawnMoves(child).some(move=>Math.floor(move.to/9)===R.goal(child,child.turn))){solved(connect(node,edge,child),1,1);}
    }
    updateSolved(node);
    if(node.solved!==null){node.value=node.solved;return node.value;}
    const edges=node.edges;node.edges=null;
    const output=await predictor(state),safe=edges.filter(edge=>edge.child?.solved!==1);
    const logits=safe.map(edge=>output.logits[policyIndex(state,edge.move)]),max=Math.max(...logits);
    const probabilities=logits.map(value=>Math.exp(value-max)),sum=probabilities.reduce((a,b)=>a+b,0);
    for(let i=0;i<safe.length;i++)safe[i].prior=probabilities[i]/sum;
    node.edges=edges;node.value=output.value;node.probes=forcingMoves(state,children).map(move=>edges.find(edge=>R.moveKey(edge.move)===R.moveKey(move))).filter(edge=>edge&&edge.child?.solved!==1);return node.value;
  }
  function select(node,forcing=false){
    if(forcing&&node.probes?.length){while(node.probes.length){const edge=node.probes.shift();if(edge.visits===0&&edge.child?.solved!==1)return edge;}}
    const scale=Math.sqrt(Math.max(1,node.visits)),exploration=1.25+Math.log((node.visits+19653)/19652);
    let total=0,visits=0,prior=0;
    for(const edge of node.edges)if(edge.visits){total+=edge.total;visits+=edge.visits;prior+=edge.prior;}
    const firstPlay=(visits?total/visits:node.value)-.2*Math.sqrt(prior);
    let best=null,score=-Infinity;
    for(const edge of node.edges){const solved=edge.child?.solved;
      const q=edge.visits?edge.total/edge.visits:firstPlay;
      const value=solved===-1?10000-(edge.child.mate??1000):solved===1?-10000+(edge.child.mate??0):q+exploration*edge.prior*scale/(1+edge.visits);
      if(value>score){score=value;best=edge;}
    }
    return best;
  }
  function thinkingBudget(options){
    const normal=Math.min(3000,Math.max(40,Number(options.budgetMs)||3000));
    return {normal,maximum:Math.min(6000,Math.max(normal,Number(options.maxBudgetMs)||normal))};
  }
  function searchChoice(node){
    let first=null,second=null;
    const ahead=(a,b)=>!b||a.visits>b.visits||(a.visits===b.visits&&a.prior>b.prior);
    for(const edge of node.edges){
      if(edge.child?.solved===1)continue;
      if(ahead(edge,first)){second=first;first=edge;}else if(ahead(edge,second))second=edge;
    }
    if(!first)return null;
    const value=edge=>edge.child?.solved===0?0:edge.visits?edge.total/edge.visits:node.value;
    return {move:R.moveKey(first.move),value:value(first),visits:first.visits,challengerValue:second?value(second):null,challengerVisits:second?.visits||0};
  }
  function unsettled(samples){
    if(samples.length<2)return true;
    const latest=samples.at(-1);if(!latest)return false;
    if(samples.some(sample=>sample.move!==latest.move||Math.abs(sample.value-latest.value)>=.08))return true;
    if(latest.challengerValue===null)return false;
    const close=latest.challengerVisits>=Math.max(8,latest.visits*.75)&&Math.abs(latest.challengerValue-latest.value)<=.08;
    const promising=latest.challengerVisits>=Math.max(8,latest.visits*.2)&&latest.challengerValue>latest.value+.05;
    return close||promising;
  }

  function defensiveMoves(state){
    const us=state.turn,them=1-us,base=R.distances(state),choices=R.successors(state),walls=new Map(choices.filter(c=>c.move.type==='wall').map(c=>[c.move.wall,c])),scores=new Map();
    if(!state.remaining[us]||!state.remaining[them])return [];
    const before=R.pawnMoves(state,us).length;
    for(const threat of R.successors({...state,turn:them})){
      if(threat.move.type!=='wall')continue;
      const after=R.distances(threat.state),hurt=after[us]-base[us]-(after[them]-base[them])-1;
      const mobility=before-R.pawnMoves(threat.state,us).length;
      if(hurt<2&&mobility<1)continue;
      const wall=threat.move.wall,guards=[wall^64];
      if(wall<64){if((wall&7)>0)guards.push(wall-1);if((wall&7)<7)guards.push(wall+1);}
      else{if((wall&63)>7)guards.push(wall-8);if((wall&63)<56)guards.push(wall+8);}
      for(const guard of guards){const choice=walls.get(guard);if(!choice)continue;
        const next=R.distances(choice.state),cost=next[us]-base[us]-(next[them]-base[them])+1;
        const score=Math.max(hurt,mobility)-Math.max(0,cost);
        if(score>=3)scores.set(guard,Math.max(scores.get(guard)||0,score));
      }
    }
    return [...scores].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,4).map(([wall])=>({type:'wall',wall}));
  }

  function openingMove(state,opening){
    if(!opening||![0,1].includes(opening.starter)||!Number.isInteger(opening.ply)||opening.ply<0||opening.ply>5||state.variant!=='classic'||state.winner!=null||state.walls.length||state.remaining[0]!==10||state.remaining[1]!==10)return null;
    const {starter,ply}=opening,a=Math.floor((ply+(starter===0?1:0))/2),b=Math.floor((ply+(starter===1?1:0))/2);
    if(state.turn!==(ply%2?1-starter:starter)||state.pawns[0]!==4+a*9||state.pawns[1]!==76-b*9)return null;
    const to=state.pawns[state.turn]+(state.turn===0?9:-9);
    return R.pawnMoves(state).find(move=>move.to===to)||null;
  }
  function openingSettled(node,move,samples){
    const key=R.moveKey(move);
    if(samples.length<3||samples.some(sample=>sample.move!==key||!Number.isFinite(sample.value)))return false;
    const forward=node.edges.find(edge=>R.moveKey(edge.move)===key);
    if(!forward||!Number.isFinite(forward.visits)||!Number.isFinite(forward.prior)||!Number.isFinite(forward.total)||forward.visits<16||forward.prior<.6||forward.child?.solved!=null)return false;
    const current=searchChoice(node);
    if(!current||current.move!==key||unsettled([...samples,current]))return false;
    const value=forward.total/forward.visits;
    return node.edges.every(edge=>edge===forward||(edge.child?.solved!==-1&&edge.visits<=forward.visits*.25&&(edge.visits<4||edge.total/edge.visits<=value+.02)));
  }

  async function search(state,options={}){
    const start=performance.now(),{normal:budget,maximum}=thinkingBudget(options),hardDeadline=start+maximum-30;
    let deadline=start+budget-30;
    const predictor=options.predictor||predict,opening=budget>=1000?openingMove(state,options.opening):null;
    if(state.variant==='race')return {...E.analyse(state,{budgetMs:budget,onProgress:options.onProgress,shouldStop:options.shouldStop}),engine:'race-search'};
    const proof=E.certify(state,{budgetMs:Math.min(45,budget/8)})||tacticalProof(state,performance.now()+Math.min(10,budget/10),options.shouldStop);
    if(proof?.move){
      const baseline=R.distances(state),child=R.apply(state,proof.move),after=R.distances(child),us=state.turn;
      return {candidates:[{move:proof.move,score:999,bound:'proven',winNow:child.winner===us,reply:null,ownDistance:after[us],opponentDistance:after[1-us],ownDelay:after[us]-baseline[us],opponentDelay:after[1-us]-baseline[1-us],route:R.path(child,us)}],provenWin:true,engine:proof.kind==='tactical-route'?'exact-tactical-route':proof.kind==='protected-route'?'exact-protected-route':'exact-race-bound',depth:proof.plies,nodes:0,elapsedMs:Math.round(performance.now()-start),paths:baseline};
    }
    const fallback=E.analyse(state,{budgetMs:Math.min(180,budget/4),maxDepth:3,shouldStop:options.shouldStop});
    if(proof?.value===-1)return {...fallback,candidates:fallback.candidates.map(candidate=>({...candidate,score:-999,bound:'proven'})),engine:'exact-tactical-route',provenWin:false,elapsedMs:Math.round(performance.now()-start)};
    const best=fallback.candidates[0],certificate=best&&best.score>900?E.certify(R.apply(state,best.move)):null;
    if(state.winner!=null||certificate?.value===-1||state.remaining.every(n=>n===0))return {...fallback,engine:'exact-tactics',provenWin:certificate?.value===-1||best?.winNow===true};
    if(!options.predictor){
      let timeout;
      try{await Promise.race([init(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Model startup timed out')),Math.max(1,deadline-performance.now()));})]);}
      catch(error){const result=E.analyse(state,{budgetMs:Math.max(25,deadline-performance.now()),onProgress:options.onProgress,shouldStop:options.shouldStop});return {...result,engine:'classical-fallback',modelError:String(error.message||error),elapsedMs:Math.round(performance.now()-start)};}
      finally{clearTimeout(timeout);}
    }
    if(positions.size>12000)positions.clear();
    const rootNode=position(state);
    if(!rootNode.edges&&rootNode.solved===null)await expand(rootNode,predictor);
    if(!rootNode.edges)return {...fallback,engine:'exact-tactics',provenWin:rootNode.solved===1||best?.winNow===true,elapsedMs:Math.round(performance.now()-start)};
    const probes=rootNode.edges.filter(edge=>edge.visits===0&&edge.child?.solved!==1).sort((a,b)=>b.prior-a.prior).slice(0,8);
    for(const candidate of fallback.candidates){
      const edge=rootNode.edges.find(edge=>R.moveKey(edge.move)===R.moveKey(candidate.move));
      if(edge&&edge.visits===0&&edge.child?.solved!==1&&!probes.includes(edge))probes.push(edge);
    }
    const guards=defensiveMoves(state).map(move=>rootNode.edges.find(edge=>R.moveKey(edge.move)===R.moveKey(move))).filter(Boolean);
    for(const edge of guards)if(!edge.visits&&!probes.includes(edge)&&edge.child?.solved!==1)probes.push(edge);
    let simulations=0,maxDepth=0,lastYield=performance.now(),lastProgress=lastYield-250,lastSample=lastYield;
    const samples=[],openingSamples=[];let openingFastPath=false,lastOpeningSample=lastYield;
    const sample=()=>{const choice=searchChoice(rootNode);if(choice){samples.push(choice);if(samples.length>4)samples.shift();}};
    options.onProgress?.({nodes:0,phase:'search'});
    while(!options.shouldStop?.()&&rootNode.solved===null){
      const now=performance.now(),reserve=Math.max(4,(options.predictor?1:root.WallzInference.info().inferenceMs)*1.5);
      // Uncertainty keeps the original deadline; never force an opening move.
      if(opening&&now-start>=250&&now-start<=750&&!probes.length&&!guards.some(edge=>edge.child?.solved==null&&edge.visits<8)&&openingSettled(rootNode,opening,openingSamples)){
        deadline=now;openingFastPath=true;break;
      }
      if(now+reserve>=deadline){
        if(maximum>budget){sample();lastSample=now;}
        if(deadline>=hardDeadline||(!unsettled(samples)&&!guards.some(edge=>edge.child?.solved==null&&edge.visits<8)))break;
        deadline=Math.min(hardDeadline,deadline+500);
        if(now+reserve>=deadline)break;
      }
      let node=rootNode,value=0,cycle=false;const path=[],seen=new Set([node.key]);
      while(node.edges&&node.solved===null&&path.length<100){
        const edge=node===rootNode&&probes.length?probes.shift():select(node,path.length<=2);if(!edge)break;
        if(!edge.child)connect(node,edge,R.apply(node.state,edge.move));
        path.push({node,edge});node=edge.child;
        if(seen.has(node.key)){cycle=true;break;}seen.add(node.key);
        if(performance.now()>=deadline)break;
      }
      if(cycle)value=0;
      else if(!node.edges&&node.solved===null&&performance.now()<deadline)value=await expand(node,predictor);
      else if(node.solved!==null)value=node.solved;
      else if(node.edges)value=node.value;
      node.visits++;
      for(let i=path.length-1;i>=0;i--){value=-value;const entry=path[i];entry.edge.visits++;entry.edge.total+=value;entry.node.visits++;updateSolved(entry.node);}
      simulations++;maxDepth=Math.max(maxDepth,path.length);
      const completedAt=performance.now();
      if(opening&&completedAt-start<=750&&completedAt-lastOpeningSample>=50){
        lastOpeningSample=completedAt;const choice=searchChoice(rootNode);if(choice){openingSamples.push(choice);if(openingSamples.length>3)openingSamples.shift();}
      }
      if(maximum>budget&&completedAt-lastSample>=250){lastSample=completedAt;sample();}
      if(options.onProgress&&completedAt-lastProgress>=250){lastProgress=completedAt;options.onProgress({nodes:simulations,phase:'search'});}
      if(completedAt-lastYield>=16){await new Promise(resolve=>setTimeout(resolve,0));lastYield=performance.now();}
    }
    const compare=(a,b)=>{
      const av=a.child?.solved===-1?2:a.child?.solved===1?-2:0,bv=b.child?.solved===-1?2:b.child?.solved===1?-2:0;
      const mate=av===2&&bv===2?(a.child.mate??Infinity)-(b.child.mate??Infinity):av===-2&&bv===-2?(b.child.mate??0)-(a.child.mate??0):0;
      return bv-av||mate||b.visits-a.visits||b.prior-a.prior;
    };
    const edges=rootNode.edges.slice().sort(compare),auditDeadline=Math.min(start+maximum-5,deadline+20);
    for(const edge of edges.slice(0,8)){
      if(rootNode.solved!==null||performance.now()>=auditDeadline||options.shouldStop?.())break;
      if(edge.child?.solved!=null)continue;
      const child=edge.child?.state||R.apply(state,edge.move),answer=tacticalProof(child,auditDeadline,options.shouldStop);
      if(answer)solved(connect(rootNode,edge,child),answer.value,answer.plies);
    }
    edges.sort(compare);
    const baseline=R.distances(state),us=state.turn;
    const candidates=edges.slice(0,3).map(edge=>{
      const child=R.apply(state,edge.move),distances=R.distances(child),solved=edge.child?.solved;
      return {move:edge.move,score:solved===-1?999:solved===1?-999:(edge.visits?edge.total/edge.visits:rootNode.value)*10,bound:solved==null?'estimate':'proven',winNow:child.winner===us,reply:null,ownDistance:distances[us],opponentDistance:distances[1-us],ownDelay:distances[us]-baseline[us],opponentDelay:distances[1-us]-baseline[1-us],route:R.path(child,us),visits:edge.visits,prior:edge.prior};
    });
    return {candidates,...(openingFastPath?{openingFastPath:true}:{}),engine:'neural-puct',provenWin:rootNode.solved===1,depth:maxDepth,nodes:simulations,simulations,searchBudgetMs:Math.round(deadline-start+30),elapsedMs:Math.round(performance.now()-start),legalCount:rootNode.edges.length,searchedCount:rootNode.edges.filter(e=>e.visits).length,wallWidth:rootNode.edges.filter(e=>e.move.type==='wall').length,paths:baseline,...(!options.predictor?{inference:root.WallzInference.info()}: {})};
  }
  async function analyse(state,options={}){
    const start=performance.now();
    try{return await search(state,options);}catch(error){
      const budget=Math.min(3000,options.budgetMs||3000),result=E.analyse(state,{budgetMs:Math.max(25,budget-(performance.now()-start)),onProgress:options.onProgress,shouldStop:options.shouldStop});
      return {...result,engine:'classical-fallback',modelError:String(error.message||error),elapsedMs:Math.round(performance.now()-start)};
    }
  }
  function preparationOrder(a,b){return a.priority-b.priority||a.score-b.score||a.sequence-b.sequence;}
  function enqueuePreparation(job,entry){
    entry.sequence=job.sequence++;
    const queue=job.queue;let index=queue.length;queue.push(entry);
    while(index>0){
      const parent=(index-1)>>1;if(preparationOrder(queue[parent],entry)<=0)break;
      queue[index]=queue[parent];index=parent;
    }
    queue[index]=entry;
  }
  function takePreparation(job){
    const queue=job.queue,entry=queue[0],last=queue.pop();
    if(queue.length){
      let index=0;
      while(index*2+1<queue.length){
        let child=index*2+1;if(child+1<queue.length&&preparationOrder(queue[child+1],queue[child])<0)child++;
        if(preparationOrder(last,queue[child])<=0)break;
        queue[index]=queue[child];index=child;
      }
      queue[index]=last;
    }
    return entry;
  }
  function schedulePreparation(job,entry){
    const children=R.successors(entry.state);
    if(!children.length)return;
    const logits=children.map(child=>entry.answer.logits[policyIndex(entry.state,child.move)]),max=Math.max(...logits);
    const weights=logits.map(value=>Math.exp(value-max)),sum=weights.reduce((a,b)=>a+b,0),depth=entry.depth+1;
    const choices=children.map((child,index)=>({move:child.move,score:entry.score-Math.log(.9*weights[index]/sum+.1/children.length)+.35})).sort((a,b)=>a.score-b.score);
    if(entry.depth===0){
      for(const choice of choices)enqueuePreparation(job,{state:R.apply(entry.state,choice.move),depth,score:choice.score,priority:-1});
    }else{
      enqueuePreparation(job,{state:entry.state,choices:choices.slice(0,16),index:0,depth,score:choices[0].score,priority:choices[0].score});
    }
  }
  async function prepare(state,options={}){
    const start=performance.now(),deadline=start+Math.min(4000,Math.max(40,options.budgetMs||500));
    const cancelled=()=>!!options.shouldStop?.(),expired=()=>performance.now()>=deadline||cancelled();
    if(state.variant!=='classic'||state.winner!=null||state.remaining.every(n=>n===0)||cancelled())return {prepared:0,visited:0,stopped:cancelled(),done:true};
    const key=R.stateKey(state);
    if(preparation?.key!==key){
      preparation={key,queue:[],seen:new Set(),current:null,prepared:0,visited:0,sequence:0};
      enqueuePreparation(preparation,{state,depth:0,score:0,priority:-2});
    }
    const job=preparation;
    let lastYield=start,lastProgress=start;options.onProgress?.({nodes:job.visited,phase:'prepare'});
    await init();
    while(!expired()&&job.visited<8192&&(job.current||job.queue.length)){
      if(performance.now()-lastYield>=16){await new Promise(resolve=>setTimeout(resolve,0));lastYield=performance.now();if(expired())break;}
      if(!job.current){
        const entry=takePreparation(job);
        if(entry.choices){
          const choice=entry.choices[entry.index++];
          job.current={state:R.apply(entry.state,choice.move),depth:entry.depth,score:choice.score};
          if(entry.index<entry.choices.length){
            entry.score=entry.choices[entry.index].score;entry.priority=entry.score;enqueuePreparation(job,entry);
          }
        }else job.current=entry;
      }
      const entry=job.current,entryKey=R.stateKey(entry.state);
      if(!entry.answer){
        if(job.seen.has(entryKey)||entry.state.winner!=null){job.current=null;continue;}
        const cached=evaluations.has(entryKey)||preparedEvaluations.has(entryKey);
        entry.answer=await predict(entry.state,true);job.seen.add(entryKey);
        job.visited++;if(!cached)job.prepared++;
      }
      if(expired())break;
      schedulePreparation(job,entry);
      job.current=null;
      const now=performance.now();
      if(options.onProgress&&now-lastProgress>=250){lastProgress=now;options.onProgress({nodes:job.visited,phase:'prepare'});}
    }
    return {prepared:job.prepared,visited:job.visited,stopped:cancelled(),done:job.visited>=8192||(!job.current&&!job.queue.length),elapsedMs:Math.round(performance.now()-start)};
  }
  const api={analyse,prepare,encode,policyIndex,init,clear:()=>{evaluations.clear();positions.clear();preparedEvaluations.clear();preparation=null;}};
  root.WallzNeural=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
