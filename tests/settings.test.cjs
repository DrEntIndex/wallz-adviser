const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const rules=require('../extension/rules.js');

function harness(storage={},get=async()=>({wallzSettings:storage.wallzSettings})){
  const controls=new Map(),messages=[],requests=[],timers=[];
  const element=()=>({style:{},checked:false,disabled:false,hidden:true,textContent:'',listeners:{},
    setAttribute(){},append(){},replaceChildren(){},addEventListener(type,fn){this.listeners[type]=fn;}});
  for(const selector of ['#autoplay','#autogg','#quickmode','.pause','.panel','.trigger','.status','.counter'])controls.set(selector,element());
  const shadow={querySelector:selector=>controls.get(selector)};
  const document={documentElement:{append(){}},createElement:()=>({...element(),attachShadow:()=>shadow}),createElementNS:element,
    querySelector:()=>null,addEventListener(){}};
  const window={listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},postMessage:message=>messages.push(message)};
  const context={document,window,location:{origin:'https://www.wallz.gg'},WallzRules:rules,ResizeObserver:class{disconnect(){}observe(){}},
    setTimeout:fn=>{const timer={fn};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cancelled=true;},
    chrome:{storage:{local:{get,set:async data=>Object.assign(storage,JSON.parse(JSON.stringify(data)))}},runtime:{
      onMessage:{addListener(){}},sendMessage:async message=>{requests.push(message);return {result:{candidates:[],nodes:0}};}}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/overlay.js'),'utf8'),context);
  return {controls,messages,requests,
    change:(id,value)=>{const control=controls.get('#'+id);control.checked=value;control.listeners.change();},
    pause:()=>controls.get('.pause').listeners.click(),
    position:()=>window.listeners.message({source:window,origin:context.location.origin,data:{channel:'wallz-adviser-position-v1',data:{
      mode:'practice',player:'p1',controllable:true,state:{pawns:{p1:{x:4,y:0},p2:{x:4,y:8}},walls:[],wallsRemaining:{p1:10,p2:10},turn:'p1',winner:null,variant:'classic'}}}}),
    flush:()=>{for(const timer of timers.splice(0))if(!timer.cancelled)timer.fn();}};
}
const settle=()=>new Promise(setImmediate);

test('settings persist both on and off across fresh page sessions',async()=>{
  const storage={},h=harness(storage);await settle();
  for(const id of ['autoplay','autogg','quickmode'])h.change(id,true);
  h.pause();await settle();
  const reopened=harness(storage);await settle();
  for(const id of ['autoplay','autogg','quickmode'])assert.equal(reopened.controls.get('#'+id).checked,true);
  assert.equal(reopened.controls.get('.pause').textContent,'Resume');
  assert.equal(reopened.messages.findLast(m=>m.channel==='wallz-adviser-autoplay-v1').enabled,false);
  reopened.pause();
  assert.equal(reopened.messages.findLast(m=>m.channel==='wallz-adviser-autoplay-v1').enabled,true);
  assert.equal(reopened.messages.findLast(m=>m.channel==='wallz-adviser-chat-v1').enabled,true);
  for(const id of ['autoplay','autogg','quickmode'])reopened.change(id,false);
  const refreshed=harness(storage);await settle();
  for(const id of ['autoplay','autogg','quickmode'])assert.equal(refreshed.controls.get('#'+id).checked,false);
  assert.equal(refreshed.controls.get('.pause').textContent,'Pause');
});

test('startup waits for saved settings before starting analysis',async()=>{
  let restore;
  const h=harness({},()=>new Promise(resolve=>{restore=resolve;}));
  h.position();h.flush();await settle();assert.equal(h.requests.some(m=>m.type==='WALLZ_ANALYSE'),false);
  restore({wallzSettings:{enabled:true,quickmode:true,autoplay:true,autogg:true}});await settle();h.flush();await settle();
  assert.equal(h.requests.find(m=>m.type==='WALLZ_ANALYSE').quickMode,true);
  assert.equal(h.messages.findLast(m=>m.channel==='wallz-adviser-chat-v1').enabled,true);
  h.change('quickmode',false);h.flush();await settle();
  assert.equal(h.requests.filter(m=>m.type==='WALLZ_ANALYSE').at(-1).quickMode,false);
  assert.ok(h.requests.some(m=>m.type==='WALLZ_STOP'));
});

test('unavailable or malformed saved settings retain usable defaults',async()=>{
  for(const get of [async()=>{throw new Error('Storage unavailable');},async()=>({wallzSettings:{enabled:'false',autoplay:'true',autogg:1,quickmode:null}})]){
    const h=harness({},get);await settle();h.position();h.flush();await settle();
    assert.equal(h.controls.get('.pause').textContent,'Pause');
    for(const id of ['autoplay','autogg','quickmode'])assert.equal(h.controls.get('#'+id).checked,false);
    assert.equal(h.requests.find(m=>m.type==='WALLZ_ANALYSE').quickMode,false);
  }
});
