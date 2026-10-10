const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const vendor=path.resolve(__dirname,'../extension/vendor');
let source=fs.readFileSync(path.join(vendor,'ort.webgpu.min.js'),'utf8');
if(createHash('sha256').update(source).digest('hex')!=='46b4a580cb55be97736469358c1da8b5b6d8ffe4206f6b26dfb4e091d2ac21e2')throw new Error('Unexpected ONNX Runtime source');
const patches=[
 [/return URL\.createObjectURL\(new Blob\(\[(?:ji|Wo)\(\)\],\{type:"text\/javascript"\}\)\);/g,'return new URL("vendor/ort-wasm-simd-threaded.jsep.worker.js",globalThis.location.href).href;'],
 [/\$\.mainScriptUrlOrBlob=new Blob\(\[I\],\{type:"text\/javascript"\}\)/g,'$.mainScriptUrlOrBlob=new URL("vendor/ort-wasm-simd-threaded.jsep.js",globalThis.location.href).href']
];
for(const [pattern,replacement]of patches){
 if([...source.matchAll(pattern)].length!==2)throw new Error('Runtime loader patch did not match');
 source=source.replace(pattern,replacement);
}
fs.writeFileSync(path.join(vendor,'ort.webgpu.worker.min.js'),source);
console.log('Static worker runtime built');
