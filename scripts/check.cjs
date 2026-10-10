const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
for(const name of ['rules.js','engine.js','inference.js','neural.js','bridge.js','background.js','overlay.js']) {
  execFileSync(process.execPath,['--check',path.join(root,'extension',name)],{stdio:'inherit'});
}
for(const script of [...manifest.content_scripts.flatMap(s=>s.js),manifest.background.service_worker]) {
  if(!fs.existsSync(path.join(root,'extension',script))) throw new Error('Missing manifest resource: '+script);
}
if(manifest.permissions?.length || manifest.host_permissions?.length) throw new Error('Unexpected broad extension permissions');
const resources={
  'models/quoridor.onnx':'d790dac68389f7602ff8a887a2385417d3c925fe22da7164c86e9226f943908d',
  'vendor/ort.wasm.min.js':'654435ead2d823e56d5893ec53be49f6ddb7e827096561aae63501071470cf23',
  'vendor/ort-wasm-simd.wasm':'6783fcd6647ce1b426a527c31412a9c40894552faa609e9c931b3239a3438071',
  'vendor/ort.webgpu.min.js':'46b4a580cb55be97736469358c1da8b5b6d8ffe4206f6b26dfb4e091d2ac21e2',
  'vendor/ort-wasm-simd.jsep.wasm':'d4052bde30200dcb268684067ccb748adb62c64a219b270021f26f12c24dcefe'
};
for(const [name,hash] of Object.entries(resources)){
  const actual=createHash('sha256').update(fs.readFileSync(path.join(root,'extension',name))).digest('hex');
  if(actual!==hash)throw new Error('Model/runtime integrity mismatch: '+name);
}
console.log('Syntax, manifest resources and minimal permissions: PASS');
