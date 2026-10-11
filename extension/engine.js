(function(root) {
  'use strict';
  const R=typeof module!=='undefined'?require('./rules.js'):root.WallzRules;
  const WIN=100000,INF=1000000,SIZE=1<<18,MASK=SIZE-1,MAX=64,TIMEOUT=Symbol();
  const edges=new Int16Array(324),occupied=new Uint8Array(128),bits=new Int32Array(4);
  const queue=new Uint8Array(81),undoEdges=new Int16Array(4096),reverse=[1,0,3,2];
  const pawn=[0,0],hand=[0,0],goals=[8,0],frames=Array.from({length:MAX},()=>({}));
  const lists=Array.from({length:MAX},()=>new Int16Array(140));
  const scores=Array.from({length:MAX},()=>new Int32Array(140));
  const pawnLists=Array.from({length:MAX},()=>new Int16Array(8));
  const history=new Int32Array(512),killers=new Int16Array(MAX*2);
  const tLo=new Uint32Array(SIZE),tHi=new Uint32Array(SIZE),tScore=new Int32Array(SIZE);
  const tDepth=new Int8Array(SIZE),tMove=new Int16Array(SIZE),tFlag=new Uint8Array(SIZE),tAge=new Uint16Array(SIZE);
  const boardCache=new Map(),endgames=new Map(),evalCache=new Map(),proofCache=new Map();
  const cover=new Int16Array(128),guards=new Int16Array(128),ids=new Int16Array(128),seen=new Uint8Array(81),reach=new Int16Array(81);
  let seed=0x913abcde;
  function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;}
  const zLo=Uint32Array.from({length:313},random),zHi=Uint32Array.from({length:313},random);
  let lo=0,hi=0,turn=0,winner=-1,variant=0,sp=0,ep=0,info=null,nodes=0,deadline=0,age=0;
  let report=null,lastReported=0,stop=null;
  function check(){const now=performance.now();if(report&&(nodes&255)===0&&now-lastReported>=250){lastReported=now;report({nodes,phase:'search'});}if(now>=deadline||stop?.())throw TIMEOUT;}
  function xor(index){lo=(lo^zLo[index])>>>0;hi=(hi^zHi[index])>>>0;}
  function boardKey(){return variant+':'+bits.join('.');}
  function mapFor(row) {
    const distance=new Int16Array(81).fill(-1),ways=new Int32Array(81);
    let h=0,t=0;
    for(let x=0;x<9;x++){const p=row*9+x;distance[p]=0;ways[p]=1;queue[t++]=p;}
    while(h<t){const p=queue[h++],d=distance[p]+1;for(let k=0;k<4;k++){
      const q=edges[p*4+k];if(q<0)continue;
      if(distance[q]<0){distance[q]=d;ways[q]=ways[p];queue[t++]=q;}
      else if(distance[q]===d)ways[q]=Math.min(1000000,ways[q]+ways[p]);
    }}
    return {distance,ways};
  }
  function boardInfo() {
    const key=boardKey();let value=boardCache.get(key);
    if(!value){const a=mapFor(goals[0]),b=goals[0]===goals[1]?a:mapFor(goals[1]);value={maps:[a.distance,b.distance],ways:[a.ways,b.ways]};
      if(boardCache.size>=12000)boardCache.delete(boardCache.keys().next().value);boardCache.set(key,value);}
    return value;
  }
  function blocked(w) {
    if(occupied[w]||occupied[w^64])return true;
    return w<64?((w&7)>0&&occupied[w-1])||((w&7)<7&&occupied[w+1]):((w&63)>7&&occupied[w-8])||((w&63)<56&&occupied[w+8]);
  }
  function cut(p,d) {
    const i=p*4+d,q=edges[i];undoEdges[ep++]=i;undoEdges[ep++]=q;edges[i]=-1;
    if(q>=0){const j=q*4+reverse[d];undoEdges[ep++]=j;undoEdges[ep++]=edges[j];edges[j]=-1;}
  }
  function wallEdges(w){const p=(w&7)+((w&63)>>3)*9;if(w<64){cut(p,1);cut(p+1,1);}else{cut(p,3);cut(p+9,3);}}
  function restore(mark){while(ep>mark){const value=undoEdges[--ep],index=undoEdges[--ep];edges[index]=value;}}
  function probeWall(w) {
    if(blocked(w))return null;
    const mark=ep;wallEdges(w);bits[w>>5]^=1<<(w&31);
    let next;try{next=boardInfo();}finally{bits[w>>5]^=1<<(w&31);restore(mark);}
    return next.maps[0][pawn[0]]>=0&&next.maps[1][pawn[1]]>=0?next:null;
  }
  function movesFor(player,out) {
    const p=pawn[player],enemy=pawn[1-player];let n=0;
    function add(to){for(let i=0;i<n;i++)if(out[i]===to)return;out[n++]=to;}
    for(let d=0;d<4;d++){const q=edges[p*4+d];if(q<0)continue;
      if(q!==enemy)add(q);else{const beyond=edges[q*4+d];if(beyond>=0)add(beyond);
        else{const side=d<2?2:0;for(let k=0;k<2;k++){const to=edges[q*4+side+k];if(to>=0)add(to);}}}}
    return n;
  }
  function distance(player) {
    const p=pawn[player],map=info.maps[player];if((p/9|0)===goals[player])return 0;
    const out=pawnLists[sp],n=movesFor(player,out);let best=99;
    for(let i=0;i<n;i++)if(map[out[i]]>=0)best=Math.min(best,1+map[out[i]]);
    return best;
  }
  function make(mv) {
    const f=frames[sp];f.p0=pawn[0];f.p1=pawn[1];f.r0=hand[0];f.r1=hand[1];f.turn=turn;f.winner=winner;f.lo=lo;f.hi=hi;f.ep=ep;f.info=info;f.mv=mv;
    if(mv>=128){const w=mv-128;if(hand[turn]<=0||blocked(w))return false;
      wallEdges(w);bits[w>>5]^=1<<(w&31);const next=boardInfo();
      if(next.maps[0][pawn[0]]<0||next.maps[1][pawn[1]]<0){bits[w>>5]^=1<<(w&31);restore(f.ep);return false;}
      occupied[w]=1;info=next;xor(162+turn*11+hand[turn]);hand[turn]--;xor(162+turn*11+hand[turn]);xor(184+w);
    }else{xor(turn*81+pawn[turn]);pawn[turn]=mv;xor(turn*81+mv);if((mv/9|0)===goals[turn])winner=turn;}
    turn^=1;xor(312);sp++;return true;
  }
  function undo() {
    const f=frames[--sp];if(f.mv>=128){const w=f.mv-128;occupied[w]=0;bits[w>>5]^=1<<(w&31);restore(f.ep);}
    pawn[0]=f.p0;pawn[1]=f.p1;hand[0]=f.r0;hand[1]=f.r1;turn=f.turn;winner=f.winner;lo=f.lo;hi=f.hi;info=f.info;
  }
  function load(state) {
    edges.set(R.graph(state).edges);occupied.fill(0);bits.fill(0);variant=state.variant==='race'?1:0;goals[0]=variant?0:8;goals[1]=0;
    for(const w of state.walls){occupied[w]=1;bits[w>>5]|=1<<(w&31);}
    pawn[0]=state.pawns[0];pawn[1]=state.pawns[1];hand[0]=state.remaining[0];hand[1]=state.remaining[1];turn=state.turn;winner=state.winner??-1;sp=0;ep=0;
    lo=0;hi=0;xor(pawn[0]);xor(81+pawn[1]);xor(162+hand[0]);xor(173+hand[1]);if(turn)xor(312);
    for(const w of state.walls)xor(184+w);
    if(variant){lo=(lo^0x71c409ab)>>>0;hi=(hi^0xc734e021)>>>0;}
    info=boardInfo();
  }
  function reserves(n){return n?55+n*18:0;}
  function basic() {
    if(winner>=0)return winner===turn?WIN-sp:-WIN+sp;
    const us=turn,them=1-us,a=distance(us),b=distance(them);
    const flexibility=Math.log2(1+info.ways[us][pawn[us]])-Math.log2(1+info.ways[them][pawn[them]]);
    return Math.round((b-a)*100+reserves(hand[us])-reserves(hand[them])+45+flexibility*3);
  }
  function note(p,d,weight) {
    const x=p%9,y=p/9|0;
    if(d<2){const row=d===1?y:y-1;if(row<0||row>7)return;if(x<8)cover[row*8+x]+=weight;if(x>0)cover[row*8+x-1]+=weight;}
    else{const col=d===3?x:x-1;if(col<0||col>7)return;if(y<8)cover[64+y*8+col]+=weight;if(y>0)cover[64+(y-1)*8+col]+=weight;}
  }
  function markPaths(player) {
    const map=info.maps[player],start=pawn[player],startD=map[start];seen.fill(0);let h=0,t=0;queue[t++]=start;seen[start]=1;
    while(h<t){const p=queue[h++],d=map[p];for(let k=0;k<4;k++){const q=edges[p*4+k];if(q<0||map[q]!==d-1)continue;
      note(p,k,2+Math.max(0,5-(startD-d)));if(!seen[q]){seen[q]=1;queue[t++]=q;}}}
    if(startD<=5){reach.fill(-1);h=0;t=0;queue[t++]=start;reach[start]=0;
      while(h<t){const p=queue[h++];for(let k=0;k<4;k++){const q=edges[p*4+k];if(q<0)continue;
        if(map[q]>=0&&reach[p]+1+map[q]<=startD+2)note(p,k,1);
        if(reach[q]<0&&reach[p]<startD+2){reach[q]=reach[p]+1;queue[t++]=q;}}}
    }
  }
  function wallCandidates() {
    cover.fill(0);markPaths(0);markPaths(1);let n=0;
    for(let w=0;w<128;w++)if(cover[w]>0&&!blocked(w))ids[n++]=w;
    for(let i=1;i<n;i++){const w=ids[i];let j=i-1;while(j>=0&&cover[ids[j]]<cover[w]){ids[j+1]=ids[j];j--;}ids[j+1]=w;}
    return n;
  }
  function markGuards(n) {
    guards.fill(0);if(!hand[turn]||!hand[1-turn])return;
    const a=info.maps[turn][pawn[turn]],b=info.maps[1-turn][pawn[1-turn]];
    function add(w,value){if(w>=0&&w<128&&!blocked(w))guards[w]=Math.max(guards[w],value);}
    for(let i=0;i<Math.min(n,16);i++){if((i&7)===0)check();const w=ids[i],next=probeWall(w);if(!next)continue;
      const hurt=next.maps[turn][pawn[turn]]-a-(next.maps[1-turn][pawn[1-turn]]-b);if(hurt<=0)continue;
      add(w^64,hurt);
      if(w<64){if((w&7)>0)add(w-1,hurt);if((w&7)<7)add(w+1,hurt);}
      else{if((w&63)>7)add(w-8,hurt);if((w&63)<56)add(w+8,hurt);}
    }
  }
  function resilient() {
    const key=lo+':'+hi,cached=evalCache.get(key);if(cached!==undefined)return cached;
    const a=info.maps[0][pawn[0]],b=info.maps[1][pawn[1]],n=wallCandidates(),count=Math.min(n,24);
    let hurt0=0,hurt1=0;
    for(let i=0;i<count;i++){if((i&7)===0)check();const after=probeWall(ids[i]);if(!after)continue;
      const d0=after.maps[0][pawn[0]]-a,d1=after.maps[1][pawn[1]]-b;
      if(hand[1])hurt0=Math.max(hurt0,d0-d1-1);
      if(hand[0])hurt1=Math.max(hurt1,d1-d0-1);
    }
    const danger=turn===0?hurt1-hurt0:hurt0-hurt1;
    const value=basic()+danger*55;
    if(evalCache.size>=24000)evalCache.clear();evalCache.set(key,value);return value;
  }
  function protectedRace() {
    const key=lo+':'+hi;
    function score(mate){return mate===0?null:mate>0?WIN-sp-mate:-WIN+sp-mate;}
    if(proofCache.has(key))return score(proofCache.get(key));
    let mate=0;
    for(let player=0;player<2;player++){
      const enemy=1-player,map=info.maps[player],d=map[pawn[player]],b=info.maps[enemy][pawn[enemy]];
      if(d<=0||d>5||(player===turn?d>b:d>=b))continue;
      const route=[pawn[player]];let protectedPath=true;
      while(map[route.at(-1)]>0&&protectedPath){check();const p=route.at(-1);let direction=-1;
        for(let k=0;k<4;k++){const q=edges[p*4+k];if(q>=0&&map[q]===map[p]-1){direction=k;route.push(q);break;}}
        if(direction<0){protectedPath=false;break;}
        if(!hand[enemy])continue;
        const x=p%9,y=p/9|0,walls=[];
        if(direction<2){const row=direction===1?y:y-1;if(x<8)walls.push(row*8+x);if(x>0)walls.push(row*8+x-1);}
        else{const col=direction===3?x:x-1;if(y<8)walls.push(64+y*8+col);if(y>0)walls.push(64+(y-1)*8+col);}
        for(const w of walls){if(blocked(w))continue;const mark=ep;wallEdges(w);bits[w>>5]^=1<<(w&31);
          try{if(boardInfo().maps[player][pawn[player]]>=0)protectedPath=false;}finally{bits[w>>5]^=1<<(w&31);restore(mark);}
          if(!protectedPath)break;
        }
      }
      if(!protectedPath)continue;
      reach.fill(-1);let h=0,t=0;queue[t++]=pawn[enemy];reach[pawn[enemy]]=0;
      while(h<t){const p=queue[h++];for(let k=0;k<4;k++){const q=edges[p*4+k];if(q>=0&&reach[q]<0){reach[q]=reach[p]+1;queue[t++]=q;}}}
      if(route.some(p=>reach[p]>=0&&reach[p]<=d+1))continue;
      const plies=d*2-(player===turn?1:0);mate=player===turn?plies:-plies;break;
    }
    if(proofCache.size>=24000)proofCache.delete(proofCache.keys().next().value);proofCache.set(key,mate);return score(mate);
  }
  function endgame() {
    const key=boardKey(),cached=endgames.get(key);if(cached)return cached;
    const count=13122,degree=new Uint8Array(count),incoming=new Uint16Array(count),outcome=new Int8Array(count),dtm=new Uint16Array(count);
    const from=new Uint16Array(count*6),to=new Uint16Array(count*6),terminal=new Uint8Array(count);
    const out=new Int16Array(8),saved0=pawn[0],saved1=pawn[1];let used=0;
    try{for(let t=0;t<2;t++)for(let b=0;b<81;b++)for(let a=0;a<81;a++){
      const index=a+b*81+t*6561;if((index&255)===0)check();if(a===b){terminal[index]=1;continue;}
      const won0=(a/9|0)===goals[0],won1=(b/9|0)===goals[1];
      if(won0||won1){terminal[index]=1;if(won0&&won1)continue;outcome[index]=(won0?t===0:t===1)?1:-1;continue;}
      pawn[0]=a;pawn[1]=b;const n=movesFor(t,out);degree[index]=n;
      for(let i=0;i<n;i++){const child=t===0?out[i]+b*81+6561:a+out[i]*81;from[used]=index;to[used++]=child;incoming[child]++;}
    }}finally{pawn[0]=saved0;pawn[1]=saved1;}
    const offsets=new Uint32Array(count+1);for(let i=0;i<count;i++)offsets[i+1]=offsets[i]+incoming[i];
    const predecessors=new Uint16Array(used),cursor=offsets.slice(0,count),todo=new Uint16Array(count),longest=new Uint16Array(count);
    for(let i=0;i<used;i++)predecessors[cursor[to[i]]++]=from[i];
    let h=0,t=0;for(let i=0;i<count;i++)if(outcome[i])todo[t++]=i;
    while(h<t){if((h&255)===0)check();const child=todo[h++];
      for(let j=offsets[child];j<offsets[child+1];j++){const parent=predecessors[j];if(outcome[parent]||terminal[parent])continue;
        if(outcome[child]===-1){outcome[parent]=1;dtm[parent]=dtm[child]+1;todo[t++]=parent;}
        else{longest[parent]=Math.max(longest[parent],dtm[child]+1);if(--degree[parent]===0){outcome[parent]=-1;dtm[parent]=longest[parent];todo[t++]=parent;}}
      }
    }
    const table={outcome,dtm};if(endgames.size>=32)endgames.delete(endgames.keys().next().value);endgames.set(key,table);return table;
  }
  function raceScore() {
    const table=endgame(),index=pawn[0]+pawn[1]*81+turn*6561,out=table.outcome[index];
    return out>0?WIN-sp-table.dtm[index]:out<0?-WIN+sp+table.dtm[index]:0;
  }
  function raceProof() {
    if(!hand[0]&&!hand[1])return raceScore();
    if(hand[0]&&hand[1])return null;
    const value=raceScore();
    return !hand[1-turn]&&value>90000||!hand[turn]&&value< -90000?value:null;
  }
  function raceWinningMove() {
    const out=new Int16Array(8),n=movesFor(turn,out);let best=-INF,move=null;
    for(let i=0;i<n;i++){
      const mv=out[i];make(mv);let value;try{value=-raceScore();}finally{undo();}
      if(value>best){best=value;move={type:'pawn',to:mv};}
    }
    return best>90000?move:null;
  }
  function generate(ply,full,bestMove,forcing) {
    const list=lists[ply],order=scores[ply],out=pawnLists[ply],pn=movesFor(turn,out);let n=0;
    for(let i=0;i<pn;i++){const mv=out[i];make(mv);let value;try{value=-basic();}finally{undo();}
      list[n]=mv;order[n++]=value*100+history[turn*256+mv];}
    if(hand[turn]){
      const count=wallCandidates();markGuards(count);
      for(let w=0;w<128;w++){if((w&7)===0)check();if(!full&&cover[w]===0&&guards[w]===0&&w+128!==bestMove&&killers[ply*2]!==w+128&&killers[ply*2+1]!==w+128)continue;
        if(!make(128+w))continue;let value;try{value=-basic();}finally{undo();}
        list[n]=128+w;order[n++]=value*100+history[turn*256+128+w]+cover[w]*4+Math.min(3,guards[w])*7500;
      }
    }
    for(let i=0;i<n;i++){const mv=list[i];if(mv===bestMove)order[i]+=200000000;else if(mv===killers[ply*2]||mv===killers[ply*2+1])order[i]+=1000000;}
    for(let i=1;i<n;i++){const mv=list[i],s=order[i];let j=i-1;while(j>=0&&order[j]<s){list[j+1]=list[j];order[j+1]=order[j];j--;}list[j+1]=mv;order[j+1]=s;}
    if(!full){let count=0,walls=0,protectedWalls=0;for(let i=0;i<n;i++){
      const mv=list[i],guard=mv>=128&&guards[mv-128]>0;
      if(mv<128||walls++<(forcing?24:14)||guard&&protectedWalls<2){list[count]=mv;order[count++]=order[i];if(guard)protectedWalls++;}
    }n=count;}
    return n;
  }
  function immediate(player) {
    const out=pawnLists[sp],n=movesFor(player,out);for(let i=0;i<n;i++)if((out[i]/9|0)===goals[player])return true;return false;
  }
  function quiet(alpha,beta,left) {
    nodes++;check();if(winner>=0)return winner===turn?WIN-sp:-WIN+sp;
    if(immediate(turn))return WIN-sp-1;
    const proof=raceProof()??protectedRace();if(proof!==null)return proof;
    if(left<=0||sp>=MAX-2||!immediate(1-turn))return resilient();
    const n=generate(sp,true,-1,true),list=lists[sp];let best=-INF;
    for(let i=0;i<n;i++){const mv=list[i];if(!make(mv))continue;let score;
      try{score=-quiet(-beta,-alpha,left-1);}finally{undo();}
      if(score>best)best=score;if(score>alpha)alpha=score;if(alpha>=beta)break;
    }
    return best;
  }
  function storedScore(score){return score>90000?score+sp:score< -90000?score-sp:score;}
  function readScore(score){return score>90000?score-sp:score< -90000?score+sp:score;}
  function search(depth,alpha,beta) {
    nodes++;check();if(winner>=0)return winner===turn?WIN-sp:-WIN+sp;
    if(immediate(turn))return WIN-sp-1;
    const proof=raceProof()??protectedRace();if(proof!==null)return proof;
    if(depth<=0||sp>=MAX-2)return quiet(alpha,beta,4);
    const d0=distance(0),d1=distance(1),full=sp<2||Math.min(d0,d1)<=2;
    const index=lo&MASK,hit=tAge[index]&&tLo[index]===lo&&tHi[index]===hi;
    const ttBest=hit?tMove[index]:-1,original=alpha;
    if(hit&&tDepth[index]>=depth&&(!full||(tFlag[index]&4))){const value=readScore(tScore[index]),flag=tFlag[index]&3;
      if(flag===0||flag===1&&value>=beta||flag===2&&value<=alpha)return value;}
    const n=generate(sp,full,ttBest,Math.min(d0,d1)<=4),list=lists[sp];let best=-INF,bestMove=-1,searched=0;
    for(let i=0;i<n;i++){const mv=list[i];if(!make(mv))continue;let value;
      try{if(!searched)value=-search(depth-1,-beta,-alpha);else{value=-search(depth-1,-alpha-1,-alpha);if(value>alpha&&value<beta)value=-search(depth-1,-beta,-alpha);}}finally{undo();}
      searched++;if(value>best){best=value;bestMove=mv;}if(value>alpha)alpha=value;
      if(alpha>=beta){history[turn*256+mv]=Math.min(20000,history[turn*256+mv]+depth*depth*8);if(killers[sp*2]!==mv){killers[sp*2+1]=killers[sp*2];killers[sp*2]=mv;}break;}
    }
    if(bestMove>=0&&(!hit||depth>=tDepth[index]||tAge[index]!==age||full&&!(tFlag[index]&4))){tLo[index]=lo;tHi[index]=hi;tScore[index]=storedScore(best);tMove[index]=bestMove;tDepth[index]=depth;tFlag[index]=(best<=original?2:best>=beta?1:0)|(full?4:0);tAge[index]=age;}
    return best;
  }
  function external(mv){return mv<128?{type:'pawn',to:mv}:{type:'wall',wall:mv-128};}
  function analyse(state,options={}) {
    const start=performance.now(),budget=Math.min(3000,Math.max(25,Number(options.budgetMs)||3000));deadline=start+Math.max(10,budget-20);
    report=options.onProgress||null;stop=options.shouldStop||null;lastReported=start;nodes=0;age=(age+1)&65535;if(!age){tAge.fill(0);age=1;}history.fill(0);killers.fill(-1);evalCache.clear();load(state);
    if(winner>=0){report=null;stop=null;return {candidates:[],depth:0,nodes:0,elapsedMs:Math.round(performance.now()-start),legalCount:0,searchedCount:0,paths:R.distances(state)};}
    let roots=[],completed=null,depthDone=0,legalCount=0;
    try{const n=generate(0,true,-1,false);legalCount=n;
      for(let i=0;i<n;i++){const mv=lists[0][i];make(mv);let value;try{value=-basic();}finally{undo();}roots.push({mv,score:value,exact:true});}
      completed=roots.slice().sort((a,b)=>b.score-a.score);
      const winning=roots.find(r=>r.mv<128&&(r.mv/9|0)===goals[turn]);
      if(winning){completed=[{...winning,score:WIN-1,exact:true},...roots.filter(r=>r!==winning)];depthDone=1;}
      else{const maxDepth=Math.min(30,Math.max(1,options.maxDepth||20));
        for(let depth=1;depth<=maxDepth;depth++){check();const iteration=[];let alpha=-INF,best=null;
          for(const rootMove of roots){check();const mv=rootMove.mv;make(mv);let score,exact=false;
            try{if(!iteration.length){score=-search(depth-1,-INF,INF);exact=true;}
              else{score=-search(depth-1,-alpha-1,-alpha);if(score>alpha){score=-search(depth-1,-INF,-alpha);exact=true;}}}finally{undo();}
            const row={mv,score,exact};iteration.push(row);if(!best||score>alpha){alpha=score;best=row;}
          }
          completed=[best,...iteration.filter(r=>r!==best).sort((a,b)=>b.score-a.score)];roots=completed;depthDone=depth;
          if(!hand[0]&&!hand[1])break;
        }
      }
    }catch(error){if(error!==TIMEOUT)throw error;}finally{report=null;stop=null;}
    if(!completed?.length){const moves=R.pawnMoves(state);completed=moves.map(m=>({mv:m.to,score:-R.turnDistance(R.apply(state,m),state.turn)*100,exact:false})).sort((a,b)=>b.score-a.score);}
    if(sp!==0||ep!==0)throw new Error('Search state was not restored');
    const baseline=R.distances(state),us=state.turn,candidates=[];
    for(const row of completed.slice(0,3)){
      const move=external(row.mv),child=R.apply(state,move),after=R.distances(child);let reply=null;
      make(row.mv);try{const index=lo&MASK;if(winner<0&&tAge[index]&&tLo[index]===lo&&tHi[index]===hi){const m=external(tMove[index]);try{R.apply(child,m);reply=m;}catch{}}}finally{undo();}
      candidates.push({move,score:row.score/100,bound:row.exact?'exact':'upper',winNow:child.winner===us,reply,ownDistance:after[us],opponentDistance:after[1-us],ownDelay:after[us]-baseline[us],opponentDelay:after[1-us]-baseline[1-us],route:R.path(child,us)});
    }
    return {candidates,depth:depthDone,nodes,elapsedMs:Math.round(performance.now()-start),legalCount,searchedCount:roots.length,wallWidth:roots.filter(r=>r.mv>=128).length,paths:baseline};
  }
  function evaluate(state){load(state);return basic();}
  function certify(state,options={}) {
    report=null;stop=null;deadline=performance.now()+(options.budgetMs||15);load(state);
    try{
      if(winner>=0)return {value:winner===turn?1:-1,plies:0};
      if(immediate(turn))return {value:1,plies:1};
      const race=options.protectedOnly?null:raceProof(),value=race??protectedRace();
      if(value===null)return null;
      const move=race>90000&&!hand[1-turn]?raceWinningMove():null;
      return {value:Math.sign(value),plies:value===0?null:WIN-Math.abs(value),...(move?{move,kind:'race-bound'}:{})};
    }catch(error){if(error!==TIMEOUT)throw error;return null;}
  }
  const api={analyse,evaluate,certify};root.WallzEngine=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
