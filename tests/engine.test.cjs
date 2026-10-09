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
  const s=R.apply(start(),{type:'wall',wall:4}); // horizontal (4,0)
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
  const s={...start(),pawns:[31,40],walls:[36,92]}; // h(4,4), v(4,3)
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
  const s={...start(),pawns:[0,76],walls:[64]}; // vertical (0,0) traps p1 if h(0,0) added
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
  // Opponent is two rows from their goal; put them one row away without adjacency.
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
