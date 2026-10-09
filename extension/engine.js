(function(root) {
  'use strict';
  const R = typeof module!=='undefined' ? require('./rules.js') : root.WallzRules;
  const WIN=100000;

  function evaluate(s) {
    if(s.winner!=null) return s.winner===s.turn?WIN:-WIN;
    const us=s.turn, them=1-us;
    const distance=(R.turnDistance(s,them)-R.turnDistance(s,us))*100;
    const reserves=(s.remaining[us]-s.remaining[them])*14;
    return distance+reserves+10;
  }

  function analyse(state, options={}) {
    R.clearCache();
    if(state.winner!=null) return {candidates:[],depth:0,nodes:0,elapsedMs:0,legalCount:0};
    const budgetMs=Math.min(10000,Math.max(20,options.budgetMs||1000));
    const maxDepth=Math.min(12,Math.max(1,options.maxDepth||8));
    const wallWidth=Math.max(4,Math.min(128,options.wallWidth||12));
    const rootWidth=Math.max(8,Math.min(128,options.rootWidth||24));
    const start=performance.now(),deadline=start+budgetMs,tt=new Map();
    const timeout=Symbol('search timeout');
    let nodes=0;
    function checkTime() { if(performance.now()>=deadline) throw timeout; }
    function ordered(s, allWalls=false) {
      const moves=allWalls?R.moves(s):[...R.pawnMoves(s),...R.relevantWalls(s)];
      const list=moves.map(move=>{
        const child=R.apply(s,move);
        return {move,child,order:-evaluate(child)};
      }).sort((a,b)=>b.order-a.order || R.moveKey(a.move).localeCompare(R.moveKey(b.move)));
      if(allWalls) return list;
      let walls=0;
      return list.filter(c=>c.move.type==='pawn' || walls++<wallWidth);
    }

    function search(s,depth,alpha,beta) {
      nodes++;
      checkTime();
      if(s.winner!=null || depth===0) return evaluate(s);
      const key=R.stateKey(s),cached=tt.get(key),originalAlpha=alpha,originalBeta=beta;
      if(cached && cached.depth>=depth) {
        if(cached.bound==='exact') return cached.score;
        if(cached.bound==='lower') alpha=Math.max(alpha,cached.score);
        else beta=Math.min(beta,cached.score);
        if(alpha>=beta) return cached.score;
      }
      const list=ordered(s);
      checkTime();
      if(cached) { const i=list.findIndex(c=>R.moveKey(c.move)===cached.best); if(i>0) list.unshift(...list.splice(i,1)); }
      let best=-Infinity, bestMove=null;
      for(const c of list) {
        const score=-search(c.child,depth-1,-beta,-alpha);
        if(score>best) { best=score; bestMove=R.moveKey(c.move); }
        alpha=Math.max(alpha,best);
        if(alpha>=beta) break;
      }
      if(tt.size>20000) tt.clear();
      tt.set(key,{depth,score:best,best:bestMove,bound:best<=originalAlpha?'upper':best>=originalBeta?'lower':'exact'});
      return best;
    }

    // Complete depth one for every legal root move, even with a very small budget.
    const roots=ordered(state,true);
    let completed=roots.map(c=>({...c,score:c.order})),depthDone=1;
    let rootWalls=0;
    // All root moves receive a static evaluation. Spend deeper search on the strongest walls and every pawn move.
    const shortlist=completed.filter(c=>c.move.type==='pawn' || rootWalls++<rootWidth);
    let searched=shortlist;
    for(let depth=2;depth<=maxDepth;depth++) {
      const iteration=[];
      try {
        checkTime();
        for(const c of searched) {
          // Full root windows make alternatives comparable; no bound is shown as an exact score.
          iteration.push({...c,score:-search(c.child,depth-1,-Infinity,Infinity)});
        }
      } catch(e) { if(e!==timeout) throw e; break; }
      completed=iteration.sort((a,b)=>b.score-a.score || b.order-a.order);
      searched=completed;
      depthDone=depth;
      if(completed[0]?.score>=WIN) break;
    }
    const baseline=R.distances(state),us=state.turn;
    const candidates=completed.slice(0,3).map(c=>{
      const after=R.distances(c.child);
      const cached=tt.get(R.stateKey(c.child));
      const reply=cached?.best ? R.moves(c.child).find(m=>R.moveKey(m)===cached.best) : null;
      return {
        move:c.move,score:c.score/100,winNow:c.child.winner===us,
        reply:reply||null,
        ownDistance:after[us],opponentDistance:after[1-us],
        ownDelay:after[us]-baseline[us],opponentDelay:after[1-us]-baseline[1-us],
        route:R.path(c.child,us)
      };
    });
    return {candidates,depth:depthDone,nodes,elapsedMs:Math.round(performance.now()-start),legalCount:roots.length,searchedCount:shortlist.length,wallWidth,paths:baseline};
  }

  const api={analyse,evaluate};
  root.WallzEngine=api;
  if(typeof module!=='undefined') module.exports=api;
})(globalThis);
