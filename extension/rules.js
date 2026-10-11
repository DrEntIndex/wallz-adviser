(function (root) {
  'use strict';
  const DIRECTIONS = [[0,-1],[0,1],[-1,0],[1,0]];
  const REVERSE = [1,0,3,2];
  const graphCache = new Map();
  const emptyEdges=new Int16Array(324).fill(-1);
  for(let p=0;p<81;p++){
    const x=p%9,y=p/9|0;
    if(y>0)emptyEdges[p*4]=p-9;if(y<8)emptyEdges[p*4+1]=p+9;
    if(x>0)emptyEdges[p*4+2]=p-1;if(x<8)emptyEdges[p*4+3]=p+1;
  }
  const position = p => p.y * 9 + p.x;
  const coords = p => ({x:p % 9, y:Math.floor(p / 9)});
  const wallCoords = w => ({x:w % 8, y:Math.floor((w % 64) / 8), o:w < 64 ? 'h' : 'v'});
  const goal = (s, p) => s.variant === 'race' ? 0 : p === 0 ? 8 : 0;
  const onGoal = (s, p) => Math.floor(s.pawns[p] / 9) === goal(s,p);

  function normalize(raw) {
    function check(ok) { if (!ok) throw new Error('Unrecognised or invalid Wallz position'); }
    function pawn(p) {
      check(p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x < 9 && p.y >= 0 && p.y < 9);
      return position(p);
    }
    check(raw && raw.pawns && Array.isArray(raw.walls) && raw.walls.length <= 20 && raw.wallsRemaining);
    check(raw.turn === 'p1' || raw.turn === 'p2');
    check(raw.variant == null || raw.variant === 'classic' || raw.variant === 'race');
    check(raw.winner == null || raw.winner === 'p1' || raw.winner === 'p2');
    const s = {
      pawns:[pawn(raw.pawns.p1),pawn(raw.pawns.p2)],
      walls:raw.walls.map(w => {
        check(w && Number.isInteger(w.x) && Number.isInteger(w.y) && w.x >= 0 && w.x < 8 && w.y >= 0 && w.y < 8 && (w.o === 'h' || w.o === 'v'));
        return w.y * 8 + w.x + (w.o === 'v' ? 64 : 0);
      }).sort((a,b)=>a-b),
      remaining:[raw.wallsRemaining.p1,raw.wallsRemaining.p2],
      turn:raw.turn === 'p1' ? 0 : 1,
      winner:raw.winner == null ? null : raw.winner === 'p1' ? 0 : 1,
      variant:raw.variant || 'classic'
    };
    check(s.pawns[0] !== s.pawns[1]);
    check(s.remaining.every(n=>Number.isInteger(n) && n >= 0 && n <= 10));
    check(s.walls.every((w,i)=>!conflicts(w,s.walls.slice(0,i))));
    check(distances(s).every(n=>n >= 0));
    return s;
  }

  function conflicts(w, walls) {
    const a = wallCoords(w);
    return walls.some(v => {
      const b = wallCoords(v);
      return a.x === b.x && a.y === b.y || a.o === b.o && (a.o === 'h' ? a.y === b.y && Math.abs(a.x-b.x) === 1 : a.x === b.x && Math.abs(a.y-b.y) === 1);
    });
  }

  function distanceMap(edges, row) {
    const distances = new Int16Array(81).fill(-1);
    const queue = new Uint8Array(81);
    let head = 0, tail = 0;
    for (let x=0;x<9;x++) { const p=row*9+x; distances[p]=0; queue[tail++]=p; }
    while (head < tail) {
      const p=queue[head++];
      for (let d=0;d<4;d++) {
        const n=edges[p*4+d];
        if (n >= 0 && distances[n] < 0) { distances[n]=distances[p]+1; queue[tail++]=n; }
      }
    }
    return distances;
  }

  function graph(s) {
    const key=s.variant + ':' + s.walls.join('.');
    const cached=graphCache.get(key);
    if (cached) return cached;
    const edges=emptyEdges.slice();
    function block(p,d) { const q=edges[p*4+d]; edges[p*4+d]=-1; if(q>=0) edges[q*4+REVERSE[d]]=-1; }
    for (const w of s.walls) {
      const a=wallCoords(w), p=a.y*9+a.x;
      if (a.o==='h') { block(p,1); block(p+1,1); }
      else { block(p,3); block(p+9,3); }
    }
    const maps=[distanceMap(edges,goal(s,0)),distanceMap(edges,goal(s,1))];
    const result={edges,maps};

    if (graphCache.size>=12000) graphCache.delete(graphCache.keys().next().value);
    graphCache.set(key,result);
    return result;
  }

  function pawnMoves(s, player=s.turn) {
    if (s.winner != null) return [];
    const {edges}=graph(s), p=s.pawns[player], enemy=s.pawns[1-player], targets=new Set();
    for (let d=0;d<4;d++) {
      const n=edges[p*4+d];
      if(n<0) continue;
      if(n!==enemy) { targets.add(n); continue; }
      const beyond=edges[n*4+d];
      if(beyond>=0) targets.add(beyond);
      else {
        const lateral=d<2?[2,3]:[0,1];
        for(const side of lateral) { const q=edges[n*4+side]; if(q>=0) targets.add(q); }
      }
    }
    return Array.from(targets,to=>({type:'pawn',to}));
  }

  function distances(s) { const {maps}=graph(s); return s.pawns.map((p,i)=>maps[i][p]); }

  function wallChild(s,w) {
    if (!Number.isInteger(w) || w<0 || w>=128 || s.remaining[s.turn]<=0 || conflicts(w,s.walls)) return null;
    const child={...s,turn:1-s.turn,walls:[...s.walls,w].sort((a,b)=>a-b),remaining:s.remaining.slice()};
    child.remaining[s.turn]--;
    return distances(child).every(n=>n>=0)?child:null;
  }

  function legalWall(s,w) { return wallChild(s,w)!==null; }

  function pawnChild(s,to) {
    const child={...s,turn:1-s.turn,pawns:s.pawns.slice()};child.pawns[s.turn]=to;
    child.winner=onGoal(child,s.turn)?s.turn:null;return child;
  }

  function successors(s) {
    if(s.winner!=null)return [];
    const result=pawnMoves(s).map(move=>({move,state:pawnChild(s,move.to)}));
    if(s.remaining[s.turn]>0)for(let w=0;w<128;w++){
      const child=wallChild(s,w);if(child)result.push({move:{type:'wall',wall:w},state:child});
    }
    return result;
  }

  function moves(s) {
    if (s.winner != null) return [];
    const result=pawnMoves(s);
    if(s.remaining[s.turn]>0) for(let w=0;w<128;w++) if(legalWall(s,w)) result.push({type:'wall',wall:w});
    return result;
  }

  function relevantWalls(s) {
    if(s.remaining[s.turn]<=0) return [];
    const {edges,maps}=graph(s),shortestEdges=new Set();
    for(let player=0;player<2;player++) {
      const stack=[s.pawns[player]],seen=new Set(stack),map=maps[player];
      while(stack.length) {
        const p=stack.pop();
        for(let d=0;d<4;d++) {
          const n=edges[p*4+d];
          if(n>=0 && map[n]===map[p]-1) {
            shortestEdges.add(Math.min(p,n)*81+Math.max(p,n));
            if(!seen.has(n)) {seen.add(n);stack.push(n);}
          }
        }
      }
    }
    const result=[];
    for(let w=0;w<128;w++) {
      const a=wallCoords(w),p=a.y*9+a.x;
      const pairs=a.o==='h'?[[p,p+9],[p+1,p+10]]:[[p,p+1],[p+9,p+10]];
      if(pairs.some(([u,v])=>shortestEdges.has(u*81+v)) && legalWall(s,w)) result.push({type:'wall',wall:w});
    }
    return result;
  }

  function apply(s,m) {
    if(s.winner != null) throw new Error('Game already ended');
    if(m.type==='pawn' && pawnMoves(s).some(v=>v.to===m.to))return pawnChild(s,m.to);
    if(m.type==='wall'){const child=wallChild(s,m.wall);if(child)return child;}
    throw new Error('Illegal move');
  }

  function path(s, player) {
    const {edges,maps}=graph(s), map=maps[player], route=[s.pawns[player]];
    while(map[route.at(-1)]>0) {
      const p=route.at(-1);
      const n=edges.subarray(p*4,p*4+4).find(n=>n>=0 && map[n]===map[p]-1);
      if(n==null) break;
      route.push(n);
    }
    return route;
  }

  function turnDistance(s, player) {
    if (onGoal(s,player)) return 0;
    const map=graph(s).maps[player];
    const legal=pawnMoves(s,player);
    return legal.length ? Math.min(...legal.map(m=>1+map[m.to])) : map[s.pawns[player]]+1;
  }

  const moveKey = m => m.type==='pawn' ? 'p'+m.to : 'w'+m.wall;
  const stateKey = s => [s.variant,s.turn,...s.pawns,...s.remaining,s.walls.join('.')].join(':');
  const api={normalize,coords,wallCoords,goal,graph,pawnMoves,moves,successors,relevantWalls,apply,distances,path,turnDistance,moveKey,stateKey,clearCache:()=>graphCache.clear()};
  root.WallzRules=api;
  if(typeof module!=='undefined') module.exports=api;
})(globalThis);
