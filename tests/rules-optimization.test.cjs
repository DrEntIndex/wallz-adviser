const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../extension/rules.js');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('native distance maps initialize and retain independent BFS results',async()=>{
  assert.equal(await R.initDistanceMaps(fs.readFileSync(path.join(__dirname,'../extension/distance.wasm'))),true);
  R.clearCache();
  for(const state of positions().filter((_,index)=>index%4===0))for(const child of R.successors(state))assert.deepEqual(R.graph(child.state).maps,referenceGraph(child.state).maps);
});
test('unavailable or invalid WebAssembly preserves the JavaScript rules',async()=>{
  for(const available of [false,true]){
    const context=vm.createContext({WebAssembly:available?WebAssembly:undefined});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/rules.js'),'utf8'),context);
    const rules=context.WallzRules;
    assert.equal(await rules.initDistanceMaps(new Uint8Array([0])),false);
    for(const state of positions().filter((_,index)=>index%16===0)){
      assert.deepEqual(Array.from(rules.moves(state),move=>R.moveKey(move)),R.moves(state).map(R.moveKey));
      const expected=referenceGraph(state),actual=rules.graph(state);
      assert.deepEqual(Array.from(actual.edges),Array.from(expected.edges));
      for(let p=0;p<2;p++)assert.deepEqual(Array.from(actual.maps[p]),Array.from(expected.maps[p]));
    }
  }
});

function referenceGraph(state){
  const edges=new Int16Array(324).fill(-1);
  for(let p=0;p<81;p++){
    const x=p%9,y=p/9|0;
    if(y>0)edges[p*4]=p-9;if(y<8)edges[p*4+1]=p+9;
    if(x>0)edges[p*4+2]=p-1;if(x<8)edges[p*4+3]=p+1;
  }
  const block=(p,d,opposite)=>{const next=edges[p*4+d];edges[p*4+d]=-1;if(next>=0)edges[next*4+opposite]=-1;};
  for(const wall of state.walls){const p=((wall%64)/8|0)*9+wall%8;if(wall<64){block(p,1,0);block(p+1,1,0);}else{block(p,3,2);block(p+9,3,2);}}
  const maps=[0,1].map(player=>{
    const row=state.variant==='race'||player===1?0:8,distances=new Int16Array(81).fill(-1),queue=[];
    for(let x=0;x<9;x++){distances[row*9+x]=0;queue.push(row*9+x);}
    for(let head=0;head<queue.length;head++){const p=queue[head];for(let d=0;d<4;d++){const q=edges[p*4+d];if(q>=0&&distances[q]<0){distances[q]=distances[p]+1;queue.push(q);}}}
    return distances;
  });
  return {edges,maps};
}
function conflict(w,walls){
  const x=w%8,y=(w%64)/8|0,h=w<64;
  return walls.some(v=>{const a=v%8,b=(v%64)/8|0;return x===a&&y===b||h===(v<64)&&(h?y===b&&Math.abs(x-a)===1:x===a&&Math.abs(y-b)===1);});
}
function referenceWalls(state){
  const result=[];
  for(let w=0;w<128;w++){
    if(conflict(w,state.walls))continue;
    const graph=referenceGraph({...state,walls:[...state.walls,w]});
    if(graph.maps.every((map,player)=>map[state.pawns[player]]>=0))result.push(w);
  }
  return result;
}
function positions(){
  const result=[];let seed=104729;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(let game=0;game<8;game++){
    let state={pawns:[4,76],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'};
    for(let ply=0;ply<28&&state.winner==null;ply++){
      result.push(state);
      const moves=R.moves(state),walls=moves.filter(m=>m.type==='wall'),pawns=moves.filter(m=>m.type==='pawn'),choices=walls.length&&random()<.6?walls:pawns;
      state=R.apply(state,choices[Math.floor(random()*choices.length)]);
    }
  }
  return result;
}
test('wall graph updates match independent full BFS for every legal child',()=>{
  for(const state of positions()){
    for(const variant of ['classic','race']){
      const current={...state,variant};
      assert.deepEqual(R.graph(current).maps,referenceGraph(current).maps);
      const children=R.successors(current);
      assert.deepEqual(children.filter(c=>c.move.type==='wall').map(c=>c.move.wall),current.remaining[current.turn]>0?referenceWalls(current):[]);
      for(const child of children){const expected=referenceGraph(child.state),actual=R.graph(child.state);assert.deepEqual(actual.edges,expected.edges);assert.deepEqual(actual.maps,expected.maps);}
    }
  }
});
test('wall legality caching respects pawn locations, turn, inventory, and terminal states',()=>{
  for(const state of positions().filter((_,index)=>index%8===0)){
    const variants=[state,...R.pawnMoves(state).map(move=>R.apply(state,move))];
    for(const current of variants)for(const turn of [0,1]){
      const geometry={...current,turn,remaining:[10,10]},expected=referenceWalls(geometry);
      assert.deepEqual(R.moves(geometry).filter(m=>m.type==='wall').map(m=>m.wall),expected);
      assert.deepEqual(R.successors(geometry).filter(c=>c.move.type==='wall').map(c=>c.move.wall),expected);
      assert.deepEqual(R.moves({...geometry,remaining:[0,0]}),R.pawnMoves(geometry));
      assert.deepEqual(R.moves({...geometry,winner:turn}),[]);
    }
  }
});
test('callers cannot modify cached wall legality through returned moves',()=>{
  const state={pawns:[4,76],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'};
  const moves=R.moves(state);moves.find(m=>m.type==='wall').wall=999;moves.length=0;
  const children=R.successors(state);children.find(c=>c.move.type==='wall').move.wall=999;children.length=0;
  assert.deepEqual(R.moves(state).filter(m=>m.type==='wall').map(m=>m.wall),Array.from({length:128},(_,i)=>i));
  R.clearCache();
  assert.deepEqual(R.successors(state).filter(c=>c.move.type==='wall').map(c=>c.move.wall),Array.from({length:128},(_,i)=>i));
});
