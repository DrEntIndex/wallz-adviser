(() => {
  'use strict';
  const R=globalThis.WallzRules;
  const SVG='http://www.w3.org/2000/svg';
  const colours=['#80f4c0','#82caff','#ffcb83'];
  const labels={practice:'Practice',private:'Private game','hot-seat':'Hot seat'};
  const host=document.createElement('div');
  host.id='wallz-adviser';
  host.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483646;max-width:calc(100vw - 24px)';
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML=`
    <style>
      :host {font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#edf4f0;font-size:13px;color-scheme:dark}
      *{box-sizing:border-box} button,select{font:inherit;color:inherit}button{cursor:pointer}
      .panel{width:304px;max-width:calc(100vw - 24px);background:#14211ff5;border:1px solid #395650;border-radius:18px;box-shadow:0 12px 48px #0008;overflow:hidden}
      header{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid #30443f}
      header strong{font-size:14px;flex:1} .dot{width:8px;height:8px;border-radius:50%;background:#80f4c0}
      .icon{border:0;background:transparent;color:#b1c8be;padding:4px 6px;border-radius:5px}
      .body{padding:14px 16px} .mode{font-size:10px;text-transform:uppercase;letter-spacing:1.4px;color:#9fb8ac;margin:0 0 7px}
      .status{font-size:15px;font-weight:600;margin:0 0 9px;line-height:1.4} .paths{font-size:12px;color:#bbcdc3;margin:0 0 12px;line-height:1.5}
      .list{display:grid;gap:7px}.candidate{width:100%;border:1px solid #354840;background:#1b3029;border-radius:10px;text-align:left;padding:10px;display:flex;gap:9px;align-items:flex-start}
      .candidate:hover,.candidate:focus-visible,.candidate.selected{background:#254535;border-color:#80f4c0}.rank{color:#80f4c0;font-weight:700;padding-top:1px}
      .title{font-weight:650;font-size:13px;display:block}.explain{font-size:11px;line-height:1.5;color:#c1d1c8;display:block;margin-top:4px}.score{display:block;color:#9cb3a5;font-size:10px;margin-top:5px}
      .meta{color:#94afa0;font-size:10px;line-height:1.5;margin:12px 0 0} .controls{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #30443f;align-items:center}
      select,.pause{background:#21332c;border:1px solid #41594c;border-radius:7px;padding:6px 8px}.pause{margin-left:auto;min-width:64px}
      .small{font-size:10px;color:#adc2b5}.collapsed{border-radius:24px;border:1px solid #48755c;background:#182a21;box-shadow:0 8px 24px #0008;padding:12px 17px;font-weight:650}
      [hidden]{display:none!important}button:focus-visible,select:focus-visible{outline:2px solid #80f4c0;outline-offset:3px}
      @media(max-width:700px){.panel{width:270px}.body{padding:11px 13px}.controls{padding:10px 13px}}
    </style>
    <section class="panel" aria-label="Wallz move adviser">
      <header><span class="dot"></span><strong>Wallz Adviser</strong><button class="icon minimise" title="Minimise" aria-label="Minimise adviser">−</button></header>
      <div class="body"><p class="mode">LOCAL ANALYSIS</p><p class="status" role="status" aria-live="polite">Reading the board…</p><p class="paths"></p><div class="list"></div><p class="meta">Suggested moves are estimates, not a guarantee.</p></div>
      <div class="controls"><label class="small" for="budget">Think</label><select id="budget" aria-label="Analysis time"><option value="350">Quick · 0.35s</option><option value="1200" selected>Standard · 1.2s</option><option value="3500">Deep · 3.5s</option></select><button class="pause">Pause</button></div>
    </section>
    <button class="collapsed" hidden>↗ Wallz Adviser</button>`;
  document.documentElement.append(host);
  const $=selector=>shadow.querySelector(selector);
  const overlay=document.createElementNS(SVG,'svg');
  overlay.setAttribute('viewBox','-44 -22 702 702');
  overlay.setAttribute('aria-hidden','true');
  overlay.style.cssText='position:fixed;pointer-events:none;z-index:2147483645;overflow:visible;display:none';
  document.documentElement.append(overlay);
  let captured=null,position=null,result=null,lastSignature='',requestId=0,timer=null,selected=0,enabled=true,collapsed=false;
  let observedBoard=null;
  const resize=new ResizeObserver(align);

  function node(tag,attributes,parent=overlay,text) {
    const el=document.createElementNS(SVG,tag);
    for(const [k,v] of Object.entries(attributes)) el.setAttribute(k,String(v));
    if(text!=null) el.textContent=text;
    parent.append(el);
    return el;
  }
  function align() {
    const board=document.querySelector('svg[aria-label="Wallz board"]');
    if(board!==observedBoard) { resize.disconnect();observedBoard=board;if(board) resize.observe(board); }
    if(!board || !board.isConnected || !enabled || !result) { overlay.style.display='none';return; }
    const rect=board.getBoundingClientRect();
    overlay.style.left=rect.left+'px';overlay.style.top=rect.top+'px';
    overlay.style.width=rect.width+'px';overlay.style.height=rect.height+'px';
    overlay.style.display='block';
  }
  const point=p=>{const a=R.coords(p);return {x:a.x*72+30,y:a.y*72+30};};
  const square=p=>{const a=R.coords(p);return String.fromCharCode(97+a.x)+(a.y+1);};
  function describe(move) {
    if(move.type==='pawn') return 'Move to '+square(move.to);
    const w=R.wallCoords(move.wall);
    return (w.o==='h'?'Horizontal':'Vertical')+' wall at '+String.fromCharCode(97+w.x)+(w.y+1);
  }
  function draw() {
    overlay.replaceChildren();
    if(!enabled || !result || !position) {align();return;}
    const g=node('g',{transform:captured.flipped?'rotate(180 318 318)':''});
    const ranked=result.candidates;
    // Draw the selected route first so alternatives remain easy to see.
    const choice=ranked[selected];
    if(choice?.route?.length>1) node('polyline',{points:choice.route.map(p=>{const a=point(p);return a.x+','+a.y;}).join(' '),fill:'none',stroke:colours[selected],'stroke-width':3,'stroke-dasharray':'7 9',opacity:.48},g);
    ranked.forEach((c,i)=>{
      const colour=colours[i],active=i===selected,stroke=active?5:2,opacity=active?1:.5;
      let anchor;
      if(c.move.type==='pawn') {
        const a=point(c.move.to),from=point(position.pawns[position.turn]);anchor=a;
        node('line',{x1:from.x,y1:from.y,x2:a.x,y2:a.y,stroke:colour,'stroke-width':stroke,opacity},g);
        node('circle',{cx:a.x,cy:a.y,r:24,fill:colour,'fill-opacity':active?.22:.08,stroke:colour,'stroke-width':stroke,opacity},g);
      } else {
        const w=R.wallCoords(c.move.wall),horizontal=w.o==='h';
        const x=w.x*72+(horizontal?0:60),y=w.y*72+(horizontal?60:0);
        node('rect',{x,y,width:horizontal?132:12,height:horizontal?12:132,rx:5,fill:colour,'fill-opacity':active?.65:.25,stroke:colour,'stroke-width':stroke,opacity},g);
        anchor={x:x+(horizontal?66:6),y:y+(horizontal?6:66)};
      }
      const badge=node('g',{transform:`translate(${anchor.x} ${anchor.y})${captured.flipped?' rotate(180)':''}`},g);
      node('circle',{cx:0,cy:0,r:11,fill:'#0a1911',stroke:colour,'stroke-width':2},badge);
      node('text',{x:0,y:4,fill:colour,'text-anchor':'middle','font-family':'system-ui','font-size':12,'font-weight':700},badge,String(i+1));
    });
    align();
  }

  function clearAdvice() {
    result=null;selected=0;$('.list').replaceChildren();overlay.replaceChildren();overlay.style.display='none';
  }
  function renderResult() {
    $('.status').textContent='Recommended move';
    $('.list').replaceChildren();
    result.candidates.forEach((c,i)=>{
      const button=document.createElement('button');button.className='candidate'+(i===selected?' selected':'');
      const rank=document.createElement('span');rank.className='rank';rank.textContent=String(i+1);
      const body=document.createElement('span');
      const title=document.createElement('span');title.className='title';title.textContent=describe(c.move);
      const explanation=document.createElement('span');explanation.className='explain';
      explanation.textContent=c.winNow?'Reaches your goal and wins immediately.':c.move.type==='wall'
        ?`Adds ${c.opponentDelay} route steps for them and ${c.ownDelay} for you. Uses this turn and one wall.`
        :`Your route: ${c.ownDistance} steps. Their route: ${c.opponentDistance} steps.`;
      const score=document.createElement('span');score.className='score';
      score.textContent=c.winNow?'Immediate win':c.score>=900?'Winning line found in selective search':c.score<=-900?'Losing line found in selective search':`Estimated advantage: ${c.score>0?'+':''}${c.score.toFixed(1)} · ${c.reply?'Reply: '+describe(c.reply):'One-move evaluation'}`;
      body.append(title,explanation,score);button.append(rank,body);$('.list').append(button);
      const choose=()=>{if(selected===i)return;selected=i;for(const [j,b] of Array.from($('.list').children).entries()) b.classList.toggle('selected',i===j);draw();};
      button.addEventListener('mouseenter',choose);button.addEventListener('focus',choose);button.addEventListener('click',choose);
    });
    $('.meta').textContent=`${result.depth} plies completed · ${result.nodes.toLocaleString()} positions · ${result.elapsedMs} ms. ${result.legalCount} first moves evaluated; ${result.searchedCount} selected for deeper search. Scores are estimates.`;
    draw();
  }

  function analyse() {
    clearTimeout(timer);clearAdvice();
    const id=++requestId;
    if(!enabled) { $('.status').textContent='Analysis paused';return; }
    if(!captured?.state || !position) return;
    if(position.winner!=null) { $('.status').textContent='Game finished';return; }
    if(!captured.controllable) { $('.status').textContent='Waiting for your turn';return; }
    $('.status').textContent='Considering moves and walls…';
    timer=setTimeout(async()=>{
      try {
        const response=await chrome.runtime.sendMessage({type:'WALLZ_ANALYSE',id,state:captured.state,budgetMs:Number($('#budget').value)});
        if(id!==requestId || !enabled) return;
        if(response?.error || !response?.result) throw new Error(response?.error || 'No analysis returned');
        result=response.result;renderResult();
      } catch(error) {
        if(id!==requestId) return;
        $('.status').textContent='Analysis unavailable';
        $('.meta').textContent=error.message+'. If you reloaded the extension, refresh this game page.';
      }
    },100);
  }

  window.addEventListener('message',event=>{
    if(event.source!==window || event.origin!==location.origin || event.data?.channel!=='wallz-adviser-position-v1') return;
    const data=event.data.data;
    if(!data || typeof data!=='object') return;
    const signature=JSON.stringify(data);
    if(signature===lastSignature) {align();return;}
    lastSignature=signature;captured=data;
    requestId++;clearTimeout(timer);clearAdvice();
    $('.mode').textContent=labels[data.mode]||'LOCAL ANALYSIS';
    $('.paths').textContent='';
    if(!['practice','private','hot-seat'].includes(data.mode) || !data.state) {
      position=null;$('.status').textContent=String(data.reason||'Waiting for a supported game.');return;
    }
    try {
      position=R.normalize(data.state);
      const distances=R.distances(position),us=data.player==='p1'?0:1;
      $('.paths').textContent=`Your route: ${distances[us]} steps · Opponent: ${distances[1-us]} steps. Walls: ${position.remaining[us]} / ${position.remaining[1-us]}.`;
      analyse();
    } catch(error) {position=null;$('.status').textContent='Position could not be read';$('.meta').textContent=error.message;}
  });

  function toggleCollapsed() {collapsed=!collapsed;$('.panel').hidden=collapsed;$('.collapsed').hidden=!collapsed;}
  $('.minimise').addEventListener('click',toggleCollapsed);$('.collapsed').addEventListener('click',toggleCollapsed);
  $('.pause').addEventListener('click',()=>{enabled=!enabled;$('.pause').textContent=enabled?'Pause':'Resume';analyse();});
  $('#budget').addEventListener('change',analyse);
  chrome.runtime.onMessage.addListener(message=>{if(message?.type==='WALLZ_TOGGLE') toggleCollapsed();});
  window.addEventListener('scroll',align,{passive:true});window.addEventListener('resize',align,{passive:true});
})();
