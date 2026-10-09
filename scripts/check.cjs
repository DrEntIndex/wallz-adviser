const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
for(const name of ['rules.js','engine.js','bridge.js','background.js','overlay.js']) {
  execFileSync(process.execPath,['--check',path.join(root,'extension',name)],{stdio:'inherit'});
}
for(const script of [...manifest.content_scripts.flatMap(s=>s.js),manifest.background.service_worker]) {
  if(!fs.existsSync(path.join(root,'extension',script))) throw new Error('Missing manifest resource: '+script);
}
if(manifest.permissions?.length || manifest.host_permissions?.length) throw new Error('Unexpected broad extension permissions');
console.log('Syntax, manifest resources and minimal permissions: PASS');
