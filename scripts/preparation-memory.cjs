// Isolated JS-retention fixture; run with node --expose-gc. No bundled model.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const R=require('../extension/rules.js'),E=require('../extension/engine.js'),root=path.resolve(__dirname,'..'),reference=process.argv[2]||null;
if(reference&&!/^[0-9a-f]{7,40}$/.test(reference))throw Error('Reference must be a commit SHA');
if(typeof global.gc!=='function')throw Error('Run node --expose-gc scripts/preparation-memory.cjs [commit-SHA]');
const context={WallzRules:R,WallzEngine:E,performance:{now:()=>0},setTimeout,clearTimeout,Float32Array,WallzInference:{init:async()=>{},evaluate:async()=>({logits:new Float32Array(136),value:0})}};
let source=reference?execFileSync('git',['show',reference+':extension/neural.js'],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,'extension/neural.js'),'utf8');
const sourceSha256=createHash('sha256').update(source).digest('hex');
source=source.replace('root.WallzNeural=api;','api.jobs=()=>[...preparations.values()].map(j=>({visited:j.visited,seen:j.seen.size,queued:j.queue.length,current:!!j.current}));api.caches=()=>({prepared:preparedEvaluations.size,search:evaluations.size});root.WallzNeural=api;');
vm.runInNewContext(source,context);
function memory(){global.gc();const m=process.memoryUsage();return {heapMiB:m.heapUsed/1048576,arrayBuffersMiB:m.arrayBuffers/1048576,rssMiB:m.rss/1048576};}
(async()=>{
 const base={pawns:[4,76],walls:[],remaining:[10,10],turn:0,winner:null,variant:'classic'},pawns=[[4,76],[13,67],[22,58],[31,49]],samples=[{jobs:0,memory:memory()}];
 for(const p of pawns){await context.WallzNeural.prepare({...base,pawns:p},{budgetMs:4000});samples.push({jobs:context.WallzNeural.jobs(),caches:context.WallzNeural.caches(),memory:memory()});}
 const report={status:'complete',reference:reference||'current',sourceSha256,pawns,checkedAt:new Date().toISOString(),description:'Four capped reply-first preparation jobs with a uniform fixture predictor and frozen clock. GC measurements cover this Node JS process and rules/evaluation caches; bundled model/runtime/GPU allocations are excluded. Difference is not attributable solely to job queues.',samples};
 const output=path.join(root,'outputs/preparation-memory');fs.mkdirSync(output,{recursive:true});
 fs.writeFileSync(path.join(output,(reference||'current')+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
