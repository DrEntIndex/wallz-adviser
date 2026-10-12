(() => {
  'use strict';
  const R=globalThis.WallzRules,SVG='http://www.w3.org/2000/svg',colour='#80f4c0';
  const host=document.createElement('div');
  host.id='wallz-adviser';
  host.style.cssText='position:fixed;right:14px;bottom:14px;z-index:2147483646';
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML=`
    <style>
      :host{font-family:system-ui,sans-serif;color:#edf4f0;font-size:12px;color-scheme:dark}
      *{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer}
      .trigger{width:36px;height:36px;border:1px solid #395650;border-radius:50%;background:#14211ff2;font-size:20px;display:block}
      .toolbar{display:flex;justify-content:flex-end;align-items:center;gap:9px}.counter{font-size:11px;color:#adc2b5;font-variant-numeric:tabular-nums;white-space:nowrap}
      .panel{width:196px;max-width:calc(100vw - 28px);margin-bottom:8px;padding:12px;background:#14211ff5;border:1px solid #395650;border-radius:12px;box-shadow:0 8px 24px #0005}
      label{color:#bbcdc3}
      .autoplay{display:flex;align-items:center;gap:8px;cursor:pointer}.autoplay+.autoplay{margin-top:10px}.autoplay input{accent-color:#80f4c0}
      .pause{background:#21332c;border:1px solid #41594c;border-radius:6px;padding:6px 8px;width:100%;margin-top:10px}
      .status{font-size:11px;line-height:1.4;color:#adc2b5;margin:10px 0 0;overflow-wrap:anywhere}
      [hidden]{display:none!important}button:focus-visible{outline:2px solid #80f4c0;outline-offset:3px}
    </style>
    <section class="panel" aria-label="Adviser settings" hidden>
      <label class="autoplay"><input id="autoplay" type="checkbox" disabled>Autoplay best move</label>
      <label class="autoplay" title="Send GG once when your win is proven"><input id="autogg" type="checkbox" disabled>Auto GG</label>
      <label class="autoplay" title="Think for 2 seconds, extending in 0.5-second steps up to 4 seconds"><input id="quickmode" type="checkbox" disabled>Quick mode</label>
      <button class="pause" disabled>Pause</button><p class="status" role="status" aria-live="polite">Reading board…</p>
    </section>
    <div class="toolbar"><span class="counter" title="Positions explored in the current search" aria-label="0 positions explored">0 explored</span><button class="trigger" aria-label="Adviser controls" aria-expanded="false" title="Adviser controls">⚙︎</button></div>`;
  document.documentElement.append(host);
  const $=selector=>shadow.querySelector(selector);
  const overlay=document.createElementNS(SVG,'svg');
  overlay.id='wallz-adviser-overlay';
  overlay.setAttribute('viewBox','-44 -22 702 702');
  overlay.setAttribute('aria-hidden','true');
  overlay.style.cssText='position:fixed;pointer-events:none;z-index:2147483645;overflow:visible;display:none';
  document.documentElement.append(overlay);
  let captured=null,position=null,result=null,lastSignature='',requestId=0,timer=null,enabled=true;
  let observedBoard=null,settingsReady=false;
  const settingIds=['autoplay','autogg','quickmode'];
  function saveSettings(){
    const wallzSettings={enabled};
    for(const id of settingIds)wallzSettings[id]=$('#'+id).checked;
    chrome.storage?.local?.set({wallzSettings}).catch(()=>status('Could not save settings.'));
  }
  async function restoreSettings(){
    try{
      const saved=(await chrome.storage?.local?.get('wallzSettings'))?.wallzSettings;
      if(typeof saved?.enabled==='boolean')enabled=saved.enabled;
      for(const id of settingIds)if(typeof saved?.[id]==='boolean')$('#'+id).checked=saved[id];
    }catch{}
    settingsReady=true;
    for(const id of settingIds)$('#'+id).disabled=false;
    $('.pause').disabled=false;$('.pause').textContent=enabled?'Pause':'Resume';
    syncAutoplay();syncAutoGG();analyse();
  }
  window.addEventListener('pagehide',()=>{cancelAutoplay();stopSearch();});
  let lastAutoPosition='',playId=0,pendingPlay=null,playTimer=null,retryTimer=null,playFailures=0;
  let ggId=0,pendingGG=null;
  const ggAttempts=new Set();
  const resize=new ResizeObserver(align);

  function syncAutoGG(){
    window.postMessage({channel:'wallz-adviser-chat-v1',type:'enable',enabled:enabled&&$('#autogg').checked},location.origin);
  }
  function autoGG(){
    const choice=result?.candidates?.[0],us=captured?.player==='p1'?0:captured?.player==='p2'?1:-1;
    const proven=result?.provenWin===true||choice?.winNow===true||(choice?.bound==='proven'&&choice.score>0);
    if(!enabled||!$('#autogg').checked||!captured?.controllable||!captured.chatAvailable||!captured.gameId||!position||position.winner!=null||position.turn!==us||!proven)return;
    if(ggAttempts.has(captured.gameId))return;
    if(ggAttempts.size>=64)ggAttempts.delete(ggAttempts.values().next().value);
    ggAttempts.add(captured.gameId);pendingGG={id:++ggId,gameId:captured.gameId};
    window.postMessage({channel:'wallz-adviser-chat-v1',type:'gg',id:pendingGG.id,position:captured},location.origin);
  }

  function syncAutoplay() {
    window.postMessage({channel:'wallz-adviser-autoplay-v1',type:'enable',enabled:enabled && $('#autoplay').checked},location.origin);
  }
  function cancelAutoplay() {
    clearTimeout(playTimer);clearTimeout(retryTimer);pendingPlay=null;
  }
  function retryAutoplay(message) {
    cancelAutoplay();syncAutoplay();
    if(!enabled || !$('#autoplay').checked)return;
    status('Autoplay on: '+message);
    const id=requestId,signature=lastSignature;
    const delay=Math.min(4000,500*2**Math.min(playFailures++,3));
    retryTimer=setTimeout(()=>{
      if(id!==requestId || signature!==lastSignature)return;
      lastAutoPosition='';autoplay();
    },delay);
  }
  function autoplay() {
    const move=result?.candidates?.[0]?.move;
    if(!enabled || !$('#autoplay').checked || !captured?.controllable || !move || !position || position.winner!=null)return;
    const signature=JSON.stringify(captured.state);
    if(signature===lastAutoPosition || pendingPlay!=null)return;
    lastAutoPosition=signature;pendingPlay=++playId;
    status('Autoplay: playing best move…');
    window.postMessage({channel:'wallz-adviser-autoplay-v1',type:'play',id:pendingPlay,position:captured,move},location.origin);
    playTimer=setTimeout(()=>retryAutoplay('Waiting for the board to respond; retrying…'),2500);
  }

  const counterFormat=new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1});
  function searchCounter(nodes=0,phase='search',inference=null) {
    nodes=Number.isFinite(nodes)?Math.max(0,Math.floor(nodes)):0;
    const label=phase==='prepare'?'prepared':'explored',counter=$('.counter');
    counter.textContent=counterFormat.format(nodes)+' '+label;
    const description=phase==='prepare'?'Positions visited while preparing opponent replies':'Search lines explored this turn';
    counter.title=description+(inference?' · '+(inference.backend==='webgpu'?'GPU':inference.threads+' CPU threads'):'');
    counter.setAttribute('aria-label',nodes+' '+description.toLowerCase());
  }
  function status(message) {
    $('.status').textContent=message;$('.status').hidden=!message;
    $('.trigger').title=message || 'Adviser controls';
  }
  function node(tag,attributes,parent) {
    const el=document.createElementNS(SVG,tag);
    for(const [k,v] of Object.entries(attributes))el.setAttribute(k,String(v));
    parent.append(el);return el;
  }
  function align() {
    const board=document.querySelector('svg[aria-label="Wallz board"]');
    if(board!==observedBoard){resize.disconnect();observedBoard=board;if(board)resize.observe(board);}
    if(!board || !board.isConnected || !enabled || !result){overlay.style.display='none';return;}
    const rect=board.getBoundingClientRect();
    overlay.style.left=rect.left+'px';overlay.style.top=rect.top+'px';
    overlay.style.width=rect.width+'px';overlay.style.height=rect.height+'px';overlay.style.display='block';
  }
  const point=p=>{const a=R.coords(p);return {x:a.x*72+30,y:a.y*72+30};};
  function draw() {
    overlay.replaceChildren();
    const choice=result?.candidates?.[0];
    if(!enabled || !choice || !position){align();return;}
    const g=node('g',{transform:captured.flipped?'rotate(180 318 318)':''},overlay);
    const route=choice.route ? [...choice.route] : [];
    const current=position.pawns[position.turn];
    if(route.length && route[0]!==current)route.unshift(current);
    if(route.length>1)node('polyline',{points:route.map(p=>{const a=point(p);return a.x+','+a.y;}).join(' '),fill:'none',stroke:colour,'stroke-width':3,'stroke-dasharray':'7 9',opacity:.4},g);
    if(choice.move.type==='pawn') {
      const p=R.coords(choice.move.to);
      node('rect',{'data-action':'pawn',x:p.x*72+3,y:p.y*72+3,width:54,height:54,rx:8,fill:colour,'fill-opacity':.12,stroke:colour,'stroke-width':4},g);
    } else {
      const w=R.wallCoords(choice.move.wall),horizontal=w.o==='h';
      node('rect',{'data-action':'wall',x:w.x*72+(horizontal?0:60),y:w.y*72+(horizontal?60:0),width:horizontal?132:12,height:horizontal?12:132,rx:4,fill:colour,'fill-opacity':.65,stroke:colour,'stroke-width':3},g);
    }
    align();
  }
  function clearAdvice(){result=null;overlay.replaceChildren();overlay.style.display='none';}
  function stopSearch(){return chrome.runtime.sendMessage({type:'WALLZ_STOP',id:requestId}).catch(()=>{});}
  function analyse() {
    if(!settingsReady)return;
    clearTimeout(timer);clearAdvice();
    const id=++requestId;searchCounter();
    if(!enabled){stopSearch();status('Paused');return;}
    if(!captured?.state || !position){stopSearch();return;}
    if(position.winner!=null){stopSearch();status('Game finished');return;}
    if(!captured.controllable){
      chrome.runtime.sendMessage({type:'WALLZ_PREPARE',id,state:captured.state}).catch(()=>{});
      status('Waiting for your turn');return;
    }
    status('Thinking…');
    timer=setTimeout(async()=>{
      try {
        if(id!==requestId||!enabled)return;
        const response=await chrome.runtime.sendMessage({type:'WALLZ_ANALYSE',id,state:captured.state,quickMode:$('#quickmode').checked});
        if(id!==requestId || !enabled)return;
        if(response?.error || !response?.result)throw new Error(response?.error || 'No analysis returned');
        result=response.result;searchCounter(result.nodes, 'search',result.inference);status('');draw();autoGG();autoplay();
      } catch(error) {
        if(id!==requestId)return;
        status('Analysis unavailable. Refresh Wallz if you reloaded the extension.');
      }
    },0);
  }
  window.addEventListener('message',event=>{
    if(event.source===window&&event.origin===location.origin&&event.data?.channel==='wallz-adviser-chat-result-v1'){
      if(event.data.id!==pendingGG?.id)return;
      const gameId=pendingGG.gameId;pendingGG=null;
      if(event.data.error&&enabled&&$('#autogg').checked&&captured?.gameId===gameId)status('Auto GG: '+String(event.data.error));
      return;
    }
    if(event.source===window && event.origin===location.origin && event.data?.channel==='wallz-adviser-autoplay-result-v1') {
      if(event.data.id!==pendingPlay)return;
      clearTimeout(playTimer);pendingPlay=null;
      if(event.data.error)retryAutoplay(event.data.error);
      else {playFailures=0;status('Autoplay on');}
      return;
    }
    if(event.source!==window || event.origin!==location.origin || event.data?.channel!=='wallz-adviser-position-v1')return;
    const data=event.data.data;
    if(!data || typeof data!=='object')return;
    const signature=JSON.stringify(data);
    if(signature===lastSignature){align();return;}
    cancelAutoplay();playFailures=0;syncAutoplay();
    if(!data.state)lastAutoPosition='';
    lastSignature=signature;captured=data;searchCounter();
    requestId++;clearTimeout(timer);clearAdvice();
    if(!['any','practice','private','unranked','hot-seat'].includes(data.mode) || !data.state){
      position=null;stopSearch();status(String(data.reason || 'Open a practice or private game.'));return;
    }
    try{position=R.normalize(data.state);analyse();}
    catch{position=null;stopSearch();status('Position could not be read');}
  });
  function setMenu(open){$('.panel').hidden=!open;$('.trigger').setAttribute('aria-expanded',String(open));}
  function toggleMenu(){setMenu($('.panel').hidden);}
  $('.trigger').addEventListener('click',toggleMenu);
  $('.pause').addEventListener('click',()=>{enabled=!enabled;saveSettings();$('.pause').textContent=enabled?'Pause':'Resume';cancelAutoplay();playFailures=0;lastAutoPosition='';syncAutoplay();syncAutoGG();analyse();});
  $('#autoplay').addEventListener('change',()=>{saveSettings();cancelAutoplay();playFailures=0;lastAutoPosition='';syncAutoplay();if($('#autoplay').checked)autoplay();else status(enabled?'':'Paused');});
  $('#autogg').addEventListener('change',()=>{saveSettings();syncAutoGG();if($('#autogg').checked)autoGG();});
  $('#quickmode').addEventListener('change',()=>{saveSettings();cancelAutoplay();playFailures=0;lastAutoPosition='';stopSearch();analyse();});
  chrome.runtime.onMessage.addListener(message=>{
    if(message?.type==='WALLZ_TOGGLE')toggleMenu();
    if(message?.type==='WALLZ_PROGRESS'&&message.id===requestId&&enabled&&position?.winner==null)searchCounter(message.nodes,message.phase);
  });
  document.addEventListener('click',event=>{if(!event.composedPath().includes(host))setMenu(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && !$('.panel').hidden){setMenu(false);$('.trigger').focus();}});
  window.addEventListener('scroll',align,{passive:true});window.addEventListener('resize',align,{passive:true});
  restoreSettings();
})();
