(() => {
  'use strict';
  if (window.__wallzAdviserBridgeActive) return;
  window.__wallzAdviserBridgeActive = true;
  const CHANNEL = 'wallz-adviser-position-v1';
  let previous = '', lastSent = 0;
  let autoplayEnabled = false, playGeneration = 0, lastPressGeneration = 0, lastPlayed = '';

  function currentAncestors(board) {
    const key = Object.keys(board).find(k => k.startsWith('__reactFiber$'));
    let attached = key && board[key];
    if (!attached) return null;
    while (attached.return) attached = attached.return;
    const current = attached.stateNode?.current;
    if (!current) return null;

    const stack = [{ fiber: current, path: [] }];
    let visited = 0;
    while (stack.length && ++visited < 30000) {
      const { fiber, path } = stack.pop();
      if (fiber.stateNode === board) return [...path, fiber];
      if (fiber.sibling) stack.push({ fiber: fiber.sibling, path });
      if (fiber.child) stack.push({ fiber: fiber.child, path: [...path, fiber] });
    }
    return null;
  }

  function snapshot() {
    const board = document.querySelector('svg[aria-label="Wallz board"]');
    if (!board) return { mode: 'none', reason: 'Open a practice or private game.' };
    const ancestors = currentAncestors(board);
    if (!ancestors) return { mode: 'unknown', reason: 'Board reader needs an update for this version of Wallz.' };
    const props = ancestors.map(f => f.memoizedProps).filter(p => p && typeof p === 'object');

    const boardProps = props.slice().reverse().find(p => p.state?.pawns && typeof p.controllable === 'boolean' && p.bottomPlayer);

    if (!boardProps) return { mode: 'unknown', reason: 'Could not read the current board.' };

    const s = boardProps.state;
    const copy = p => ({ x: p.x, y: p.y });

    return {
      mode: 'any',
      player: boardProps.bottomPlayer,
      controllable: boardProps.controllable,
      flipped: s.variant !== 'race' && boardProps.bottomPlayer === 'p1',
      state: {
        pawns: { p1: copy(s.pawns.p1), p2: copy(s.pawns.p2) },
        walls: s.walls.map(w => ({ x: w.x, y: w.y, o: w.o })),
        wallsRemaining: { p1: s.wallsRemaining.p1, p2: s.wallsRemaining.p2 },
        turn: s.turn,
        winner: s.winner ?? null,
        variant: s.variant || 'classic'
      }
    };
  }

  function publish() {
    try {
      const data = snapshot(), signature = JSON.stringify(data), now = Date.now();
      if (!data.state) lastPlayed = '';
      if (signature !== previous || now - lastSent > 1000) {
        previous = signature;
        lastSent = now;
        window.postMessage({ channel: CHANNEL, data }, location.origin);
      }
    } catch {
      window.postMessage({
        channel: CHANNEL,
        data: { mode: 'unknown', reason: 'Could not read this position. Refresh the page.' }
      }, location.origin);
    }
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'wallz-adviser-autoplay-v1') return;
    const request = event.data;
    if (request.type === 'enable') {
      autoplayEnabled = request.enabled === true;
      playGeneration++;
      return;
    }
    if (request.type !== 'play' || !autoplayEnabled) return;
    const generation = ++playGeneration;
    const respond = error => window.postMessage({channel:'wallz-adviser-autoplay-result-v1',id:request.id,error}, location.origin);
    try {
      const current = snapshot(), expected = JSON.stringify(request.position);
      if (!current.state || !current.controllable || current.state.winner != null || JSON.stringify(current) !== expected) throw new Error('Position changed.');
      const signature = JSON.stringify(current.state);
      if (signature === lastPlayed) throw new Error('This position was already played.');
      const move = request.move;
      let x, y;
      if (move?.type === 'pawn' && Number.isInteger(move.to) && move.to >= 0 && move.to < 81) {
        x = (move.to % 9) * 72 + 30;
        y = Math.floor(move.to / 9) * 72 + 30;
      } else if (move?.type === 'wall' && Number.isInteger(move.wall) && move.wall >= 0 && move.wall < 128) {
        const horizontal = move.wall < 64;
        x = (move.wall % 8) * 72 + 66;
        y = Math.floor((move.wall % 64) / 8) * 72 + 66;
        if (horizontal) x -= 18;
        else y -= 18;
      } else throw new Error('Invalid recommended move.');
      if (current.flipped) { x = 636 - x; y = 636 - y; }
      const board = document.querySelector('svg[aria-label="Wallz board"]');
      const matrix = board?.getScreenCTM();
      if (!matrix) throw new Error('Board is unavailable.');
      const point = board.createSVGPoint();point.x = x;point.y = y;
      const screen = point.matrixTransform(matrix);
      const target = document.elementFromPoint(screen.x, screen.y);
      if (!target || !board.contains(target)) throw new Error('Board is covered.');
      const options = {bubbles:true,cancelable:true,view:window,clientX:screen.x,clientY:screen.y,button:0};
      target.dispatchEvent(new PointerEvent('pointermove', {...options,pointerId:1,pointerType:'mouse',isPrimary:true}));
      target.dispatchEvent(new MouseEvent('mousemove', options));
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!autoplayEnabled || generation !== playGeneration) return;
        try {
          if (JSON.stringify(snapshot()) !== expected) throw new Error('Position changed.');
          const hit = document.elementFromPoint(screen.x, screen.y);
          if (!board.isConnected || !hit || !board.contains(hit)) throw new Error('Board is unavailable.');
          lastPlayed = signature;lastPressGeneration = generation;
          const pointer = {...options,pointerId:1,pointerType:'mouse',isPrimary:true};
          hit.dispatchEvent(new PointerEvent('pointerdown', {...pointer,buttons:1,pressure:0.5}));
          hit.dispatchEvent(new PointerEvent('pointerup', {...pointer,buttons:0,pressure:0}));
          setTimeout(() => {
            if (lastPressGeneration !== generation) return;
            const active = autoplayEnabled && generation === playGeneration;
            try {
              const after = snapshot();
              if (JSON.stringify(after.state) === signature) {
                lastPlayed = '';
                if (active) respond('Move was not accepted.');
              } else if (active) respond(null);
            } catch { if (active) respond('Could not confirm the move.'); }
          }, 1000);
        } catch (error) { respond(error.message); }
      }));
    } catch (error) { respond(error.message); }
  });

  let observedBoard=null,publishTimer=null;
  const boardObserver=new MutationObserver(()=>{
    if(publishTimer!==null)return;
    publishTimer=setTimeout(()=>{publishTimer=null;publish();},0);
  });
  function watchBoard(){
    const board=document.querySelector('svg[aria-label="Wallz board"]');
    if(board===observedBoard)return;
    boardObserver.disconnect();observedBoard=board;
    if(board)boardObserver.observe(board,{attributes:true,childList:true,subtree:true});
  }
  setInterval(()=>{watchBoard();publish();},250);
  watchBoard();publish();
})();
