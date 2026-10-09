(() => {
  'use strict';
  if (window.__wallzAdviserBridgeActive) return;
  window.__wallzAdviserBridgeActive=true;
  const CHANNEL='wallz-adviser-position-v1';
  let previous='',lastSent=0;

  function currentAncestors(board) {
    const key=Object.keys(board).find(k=>k.startsWith('__reactFiber$'));
    let attached=key && board[key];
    if(!attached) return null;
    while(attached.return) attached=attached.return;
    const current=attached.stateNode?.current;
    if(!current) return null;
    // Read the committed tree, not the DOM's potentially stale alternate fiber.
    const stack=[{fiber:current,path:[]}];
    let visited=0;
    while(stack.length && ++visited<30000) {
      const {fiber,path}=stack.pop();
      if(fiber.stateNode===board) return [...path,fiber];
      if(fiber.sibling) stack.push({fiber:fiber.sibling,path});
      if(fiber.child) stack.push({fiber:fiber.child,path:[...path,fiber]});
    }
    return null;
  }

  function snapshot() {
    const board=document.querySelector('svg[aria-label="Wallz board"]');
    if(!board) return {mode:'none',reason:'Open a practice or private game.'};
    const ancestors=currentAncestors(board);
    if(!ancestors) return {mode:'unknown',reason:'Board reader needs an update for this version of Wallz.'};
    const props=ancestors.map(f=>f.memoizedProps).filter(p=>p && typeof p==='object');
    const boardProps=props.slice().reverse().find(p=>p.state?.pawns && typeof p.controllable==='boolean' && p.bottomPlayer);
    const online=props.find(p=>p.snapshot?.game)?.snapshot;
    const local=props.find(p=>['vs-ai','hot-seat'].includes(p.mode));
    let mode;
    if(online) {
      if(online.ranked) return {mode:'ranked',reason:'Advice is disabled in ranked games.'};
      if(online.source!=='friend-code') return {mode:'unsupported',reason:'Advice is available in practice and private friend games.'};
      if(online.status!=='playing') return {mode:'ended',reason:'Game finished.'};
      mode='private';
    } else if(local) mode=local.mode==='hot-seat'?'hot-seat':'practice';
    else return {mode:'unknown',reason:'This game mode is not recognised.'};
    if(!boardProps) return {mode:'unknown',reason:'Could not read the current board.'};
    const s=boardProps.state;
    const copy=p=>({x:p.x,y:p.y});
    return {
      mode,
      player:boardProps.bottomPlayer,
      controllable:boardProps.controllable,
      flipped:s.variant!=='race' && boardProps.bottomPlayer==='p1',
      state:{
        pawns:{p1:copy(s.pawns.p1),p2:copy(s.pawns.p2)},
        walls:s.walls.map(w=>({x:w.x,y:w.y,o:w.o})),
        wallsRemaining:{p1:s.wallsRemaining.p1,p2:s.wallsRemaining.p2},
        turn:s.turn,winner:s.winner ?? null,variant:s.variant || 'classic'
      }
    };
  }

  function publish() {
    try {
      const data=snapshot(),signature=JSON.stringify(data),now=Date.now();
      if(signature!==previous || now-lastSent>1000) {
        previous=signature;lastSent=now;
        window.postMessage({channel:CHANNEL,data},location.origin);
      }
    } catch {
      window.postMessage({channel:CHANNEL,data:{mode:'unknown',reason:'Could not read this position. Refresh the page.'}},location.origin);
    }
  }
  // Poll committed positions; avoid observing SVG animations and the adviser's own UI.
  setInterval(publish,250);
  publish();
})();
