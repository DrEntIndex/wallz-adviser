const {test} = require('node:test');
const assert = require('node:assert/strict');
const R = require('../extension/rules.js');
const E = require('../extension/engine.js');

function start() {
  return R.normalize({pawns:{p1:{x:4,y:0},p2:{x:4,y:8}},walls:[],wallsRemaining:{p1:10,p2:10},turn:'p1',winner:null});
}

test('opening has three pawn moves and all 128 wall placements', () => {
  const s=start();
  assert.deepEqual(R.pawnMoves(s).map(m=>m.to).sort((a,b)=>a-b),[3,5,13]);
  assert.equal(R.moves(s).length,131);
  assert.deepEqual(R.distances(s),[8,8]);
});

test('wall placement spends one wall and a turn, and blocks both segments', () => {
  const s=R.apply(start(),{type:'wall',wall:4});  
  assert.equal(s.turn,1);
  assert.deepEqual(s.remaining,[9,10]);
  assert.equal(R.pawnMoves({...s,turn:0}).some(m=>m.to===13),false);
  assert.deepEqual(R.distances(s),[9,9]);
});

test('overlap and crossing are illegal; end-to-end walls are legal', () => {
  const s=R.apply(start(),{type:'wall',wall:3});
  const walls=R.moves(s).filter(m=>m.type==='wall').map(m=>m.wall);
  for(const w of [3,2,4,67]) assert.equal(walls.includes(w),false,`illegal wall ${w}`);
  assert.equal(walls.includes(5),true);
});

test('an adjacent opponent permits a straight jump', () => {
  const s={...start(),pawns:[31,40]};
  const moves=R.pawnMoves(s).map(m=>m.to);
  assert.equal(moves.includes(49),true);
  assert.equal(moves.includes(40),false);
  assert.equal(moves.includes(39),false);
});

test('blocked straight jump permits only open lateral jumps', () => {
  const s={...start(),pawns:[31,40],walls:[36,92]};  
  const moves=R.pawnMoves(s).map(m=>m.to);
  assert.equal(moves.includes(49),false);
  assert.equal(moves.includes(39),true);
  assert.equal(moves.includes(41),false);
});

test('the board edge also permits lateral jumps', () => {
  const s={...start(),pawns:[67,76]};
  assert.equal(R.pawnMoves(s).some(m=>m.to===75),true);
  assert.equal(R.pawnMoves(s).some(m=>m.to===77),true);
});

test('a wall may not seal either player away from the goal', () => {
  const s={...start(),pawns:[0,76],walls:[64]};  
  assert.equal(R.moves(s).some(m=>m.type==='wall'&&m.wall===0),false);
});

test('zero walls remaining produces only pawn moves', () => {
  const s={...start(),remaining:[0,10]};
  assert.equal(R.moves(s).every(m=>m.type==='pawn'),true);
});

test('a winning pawn move is chosen before any wall', () => {
  const s={...start(),pawns:[67,40]};
  const result=E.analyse(s,{budgetMs:100,maxDepth:3});
  assert.deepEqual(result.candidates[0].move,{type:'pawn',to:76});
  assert.equal(result.candidates[0].winNow,true);
});

test('search blocks an opponent threatening to win next turn', () => {
  const s={...start(),pawns:[13,13+9],turn:0};
   
  s.pawns=[40,10];
  const result=E.analyse(s,{budgetMs:400,maxDepth:2});
  const best=result.candidates[0].move;
  assert.equal(best.type,'wall');
  const child=R.apply(s,best);
  assert.equal(R.pawnMoves(child).some(m=>Math.floor(m.to/9)===0),false);
});

test('recommendations are legal and have a coherent shared search depth', () => {
  const s=start(), legal=R.moves(s).map(R.moveKey);
  const result=E.analyse(s,{budgetMs:100,maxDepth:2});
  assert.ok(result.candidates.length>=3);
  for(const c of result.candidates) assert.ok(legal.includes(R.moveKey(c.move)));
  assert.ok(result.depth>=1);
  assert.equal(result.legalCount,131);
  assert.equal(result.searchedCount,131);
  assert.ok(result.candidates.every(c=>Number.isFinite(c.score)));
});

test('race variant has a shared goal row; reaching it ends the game', () => {
  const raw={pawns:{p1:{x:3,y:1},p2:{x:5,y:8}},walls:[],wallsRemaining:{p1:0,p2:0},turn:'p1',variant:'race'};
  const s=R.normalize(raw);
  assert.deepEqual(R.distances(s),[1,8]);
  assert.equal(R.apply(s,{type:'pawn',to:3}).winner,0);
});

test('invalid page state is rejected rather than silently misread', () => {
  assert.throws(()=>R.normalize({}));
  const raw={pawns:{p1:{x:4,y:0},p2:{x:4,y:8}},walls:[{x:8,y:0,o:'h'}],wallsRemaining:{p1:10,p2:10},turn:'p1'};
  assert.throws(()=>R.normalize(raw));
});

test('analysis never mutates the captured game position', () => {
  const s=start(),before=JSON.stringify(s);
  E.analyse(s,{budgetMs:40,maxDepth:1});
  assert.equal(JSON.stringify(s),before);
});


test('pawn-only endgames choose the shortest forced win including lateral jumps', () => {
  const s={...start(),pawns:[49,58],walls:[52],remaining:[0,0]};
  const memo=new Map();
  function forcedWin(state,plies) {
    if(state.winner!=null)return state.winner===0;
    if(!plies)return false;
    const key=R.stateKey(state)+':'+plies;
    if(memo.has(key))return memo.get(key);
    const children=R.pawnMoves(state).map(m=>R.apply(state,m));
    const wins=state.turn===0?children.some(child=>forcedWin(child,plies-1)):children.every(child=>forcedWin(child,plies-1));
    memo.set(key,wins);return wins;
  }
  const winningMoves=R.pawnMoves(s).filter(m=>forcedWin(R.apply(s,m),4));
  assert.deepEqual(winningMoves,[{type:'pawn',to:57}]);
  assert.equal(forcedWin(s,3),false);
  const result=E.analyse(s,{budgetMs:150,maxDepth:1});
  assert.deepEqual(result.candidates[0].move,winningMoves[0]);
  assert.equal(result.candidates[0].score,999.95);
});

test('a last wall delays the finish and is included in the best opponent reply', () => {
  const s={...start(),pawns:[58,40],remaining:[0,1]};
  const result=E.analyse(s,{budgetMs:300,maxDepth:2});
  const best=result.candidates[0],child=R.apply(s,best.move);
  assert.deepEqual(best.move,{type:'pawn',to:67});
  assert.equal(best.reply.type,'wall');
  const blocked=R.apply(child,best.reply);
  assert.equal(R.pawnMoves(blocked).some(m=>Math.floor(m.to/9)===8),false);
  const race=E.analyse({...s,remaining:[0,0]},{budgetMs:150,maxDepth:1});
  assert.equal(race.candidates[0].score,999.97);
  assert.equal(best.score,999.95);
});

test('oversized time requests stay within the three-second search budget', () => {
  const s=start(),before=JSON.stringify(s),started=performance.now();
  const result=E.analyse(s,{budgetMs:10000,maxDepth:30});
  assert.ok(performance.now()-started<3200);
  assert.ok(result.elapsedMs<3200);
  assert.equal(result.searchedCount,131);
  assert.equal(JSON.stringify(s),before);
  assert.ok(R.moves(s).some(m=>R.moveKey(m)===R.moveKey(result.candidates[0].move)));
});

test('closing a corridor protects its exit from every legal blocking wall', () => {
  const s={...start(),pawns:[49,36],walls:[91,92,107,108,123,124],remaining:[7,7]};
  const threat={type:'wall',wall:51};
  assert.ok(R.moves({...s,turn:1}).some(m=>R.moveKey(m)===R.moveKey(threat)));
  assert.ok(R.distances(R.apply({...s,turn:1},threat))[0]>3);
  const result=E.analyse(s,{budgetMs:300,maxDepth:1}),best=result.candidates[0];
  assert.equal(best.move.type,'wall');
  assert.equal(best.ownDelay,0);
  assert.equal(best.opponentDelay,0);
  assert.equal(best.score,999.93);
  const guarded=R.apply(s,best.move);
  assert.equal(R.moves(guarded).some(m=>m.type==='wall'&&m.wall===51),false);
  for(const move of R.moves(guarded).filter(m=>m.type==='wall')){
    assert.equal(R.distances(R.apply(guarded,move))[0],3);
  }
});

test('an opponent can occupy the corridor exit instead of placing a wall', () => {
  const s={...start(),pawns:[49,58],walls:[91,92,107,108,123,124],remaining:[7,7]};
  const result=E.analyse(s,{budgetMs:200,maxDepth:2});
  assert.deepEqual(result.candidates[0].move,{type:'pawn',to:67});
  assert.ok(result.candidates[0].score<900);
  const child=R.apply(s,result.candidates[0].move);
  const occupied=R.apply(child,{type:'pawn',to:76});
  assert.equal(R.pawnMoves(occupied).some(m=>Math.floor(m.to/9)===8),false);
});

test('one-sided wall exhaustion proves only the sound direction of the frozen race', () => {
  const losing={...start(),remaining:[0,1]};
  assert.equal(E.certify(losing,{budgetMs:150}).value,-1);
  assert.equal(E.certify({...losing,remaining:[1,0]},{budgetMs:150}),null);
  const threatened={...start(),pawns:[58,40],remaining:[0,1]};
  assert.equal(E.certify(threatened,{budgetMs:150}),null);
  const winning=E.certify({...threatened,remaining:[1,0]},{budgetMs:150});
  assert.equal(winning.value,1);
  assert.deepEqual(winning.move,{type:'pawn',to:67});
});

test('generated successors match validated application including jumps, walls and terminal states', () => {
  const states=[start(),{...start(),pawns:[31,40],walls:[36,92],remaining:[8,10]},
    {...start(),pawns:[0,76],walls:[64],remaining:[9,10]},
    {...start(),pawns:[67,40],remaining:[0,1]},
    {...start(),pawns:[12,77],variant:'race'},
    {...start(),winner:0}];
  for(const state of states){
    const before=JSON.stringify(state),expected=R.moves(state).map(move=>({move,state:R.apply(state,move)}));
    assert.deepEqual(R.successors(state),expected);assert.equal(JSON.stringify(state),before);
  }
});
