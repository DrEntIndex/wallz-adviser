const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const R=require('../extension/rules.js');

test('normal extension startup loads only the dedicated compute bridge',()=>{
  function boot(modern){
    const imports=[],initialized=[];
    const context={URL,setTimeout,clearTimeout,console,
      chrome:{offscreen:modern?{}:undefined,runtime:{getContexts:modern?()=>{}:undefined,onMessage:{addListener:()=>{}}},tabs:{},action:{onClicked:{addListener:()=>{}}}},
      importScripts:(...files)=>{
        imports.push(files);
        if(files.includes('compute.js'))context.WallzCompute={init:async()=>{initialized.push('compute');}};
        if(files.includes('neural.js'))context.WallzNeural={init:async()=>{initialized.push('legacy');}};
      }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../extension/background.js'),'utf8'),context);
    return {imports,initialized};
  }
  assert.deepEqual(boot(true),{imports:[['rules.js','engine.js'],['compute.js']],initialized:['compute']});
  assert.deepEqual(boot(false),{imports:[['rules.js','engine.js'],['vendor/ort.webgpu.min.js','inference.js','neural.js']],initialized:['legacy']});
});

test('board layouts own their edges and cannot modify the empty-board template',()=>{
  R.clearCache();const state={pawns:[4,76],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'};
  const empty=R.graph(state),walled=R.graph({...state,walls:[0]});
  assert.equal(empty.edges[1],9);assert.equal(walled.edges[1],-1);
  assert.notEqual(empty.edges.buffer,walled.edges.buffer);
  empty.edges[1]=-1;R.clearCache();assert.equal(R.graph(state).edges[1],9);
});

test('a pawn can win in one move only within two rows of its goal',()=>{
  for(const variant of ['classic','race'])for(let player=0;player<2;player++)for(let pawn=0;pawn<81;pawn++)for(let enemy=0;enemy<81;enemy++){
    if(pawn===enemy)continue;
    const s={pawns:player===0?[pawn,enemy]:[enemy,pawn],walls:[],remaining:[10,10],turn:player,winner:null,variant};
    if(Math.abs(Math.floor(pawn/9)-R.goal(s,player))<=2)continue;
    assert.equal(R.pawnMoves(s).some(m=>Math.floor(m.to/9)===R.goal(s,player)),false);
  }
  const jump={pawns:[58,67],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'};
  assert.ok(R.pawnMoves(jump).some(m=>m.to===76));
});
