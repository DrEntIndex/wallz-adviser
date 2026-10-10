const R=require('../extension/rules.js');
const E=require('../extension/engine.js');
const initial=()=>R.normalize({pawns:{p1:{x:4,y:0},p2:{x:4,y:8}},walls:[],wallsRemaining:{p1:10,p2:10},turn:'p1'});
const results=[];
const opening=E.analyse(initial());
results.push({scenario:'opening',budgetMs:3000,depth:opening.depth,nodes:opening.nodes,elapsedMs:opening.elapsedMs,recommendation:opening.candidates[0].move});
const defence={...initial(),pawns:[40,10]};
const tactical=E.analyse(defence,{budgetMs:350});
results.push({scenario:'opponent one step from winning',depth:tactical.depth,recommendation:tactical.candidates[0].move,blocksImmediateWin:!R.pawnMoves(R.apply(defence,tactical.candidates[0].move)).some(m=>m.to<9)});
let wins=0,losses=0,unfinished=0;
for(let game=0;game<8;game++) {
  let state=initial(); const enginePlayer=game%2;
   
  if(game>=2) {state=R.apply(state,{type:'pawn',to:game%4<2?3:5});state=R.apply(state,{type:'pawn',to:game%4<2?75:77});}
  for(let ply=0;ply<160 && state.winner==null;ply++) {
    let move;
    if(state.turn===enginePlayer) move=E.analyse(state,{budgetMs:100,maxDepth:4}).candidates[0].move;
    else {
      const map=R.graph(state).maps[state.turn];
      move=R.pawnMoves(state).sort((a,b)=>map[a.to]-map[b.to] || a.to-b.to)[0];
    }
    state=R.apply(state,move);
  }
  if(state.winner==null) unfinished++;
  else if(state.winner===enginePlayer) wins++;
  else losses++;
}
console.log(JSON.stringify({timestamp:new Date().toISOString(),engine:'Classical tactical fallback; neural search runs in the extension',results,baselineMatch:{baseline:'Shortest-route pawn mover (never places walls)',games:8,engineBudgetMs:100,wins,losses,unfinished},limitations:'Small local sanity benchmark. This is not an Elo estimate or evidence of perfect play.'},null,2));
