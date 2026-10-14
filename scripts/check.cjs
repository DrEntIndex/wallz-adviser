const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
for(const name of ['rules.js','engine.js','inference.js','neural.js','bridge.js','background.js','overlay.js','compute.js','compute-host.js','compute-worker.js']) {
  execFileSync(process.execPath,['--check',path.join(root,'extension',name)],{stdio:'inherit'});
}
for(const script of [...manifest.content_scripts.flatMap(s=>s.js),manifest.background.service_worker]) {
  if(!fs.existsSync(path.join(root,'extension',script))) throw new Error('Missing manifest resource: '+script);
}
if(JSON.stringify(manifest.permissions)!==JSON.stringify(['offscreen','storage']) || manifest.host_permissions?.length) throw new Error('Unexpected extension permissions');
for(const script of ['compute.js','compute-worker.js','compute-host.js','compute-host.html'])if(!fs.existsSync(path.join(root,'extension',script)))throw new Error('Missing compute resource: '+script);
const resources={
  'distance.wasm':'75d2db9bb17248d8b53ddc4e2e41626607782b8d060878ba1b472fbdeb9f7dcf',
  'vendor/ort.webgpu.worker.min.js':'916a2187a9f6db02fde93de3ac83d463e379eea97ba29152544e3c9701e3c8e7',
  'vendor/ort-wasm-simd-threaded.jsep.js':'12a93fdabc2a97bb67895291ba45011f752a275afa973c89ad596a3fa54daacc',
  'vendor/ort-wasm-simd-threaded.jsep.worker.js':'f3409639351a936786e949c0f99762ad35228d4a63176893ec3511604c3ef2cf',
  'vendor/ort-wasm-simd-threaded.jsep.wasm':'0b47636210089367dc219ea498059e3f821527f7e9daca4a8f553e3ec54b0bdf',
  'models/quoridor.onnx':'d790dac68389f7602ff8a887a2385417d3c925fe22da7164c86e9226f943908d',
  'vendor/ort.webgpu.min.js':'46b4a580cb55be97736469358c1da8b5b6d8ffe4206f6b26dfb4e091d2ac21e2',
  'vendor/ort-wasm-simd.jsep.wasm':'d4052bde30200dcb268684067ccb748adb62c64a219b270021f26f12c24dcefe'
};
for(const [name,hash] of Object.entries(resources)){
  const actual=createHash('sha256').update(fs.readFileSync(path.join(root,'extension',name))).digest('hex');
  if(actual!==hash)throw new Error('Model/runtime integrity mismatch: '+name);
}
console.log('Syntax, manifest resources and minimal permissions: PASS');
