// Read-only opening measurements using the bundled model and existing search.
// Requires Playwright, either installed locally or from the desktop runtime.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {createRequire} = require('node:module');
const R = require('../extension/rules.js');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'extension');
const threads = Number(process.env.OPENING_THREADS || 1);
if (!Number.isInteger(threads) || threads < 1 || threads > 64) throw new Error('OPENING_THREADS must be an integer from 1 to 64');
const outputArg = process.argv.indexOf('--output');
const output = outputArg >= 0 ? process.argv[outputArg + 1] : null;
if (outputArg >= 0 && !output) throw new Error('--output needs a file path');
let playwright;
try { playwright = require('playwright'); }
catch {
  const modules = process.env.PLAYWRIGHT_MODULE_DIR || path.join(process.env.USERPROFILE || '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
  playwright = createRequire(path.join(modules, '_opening.cjs'))('playwright');
}
const initial = turn => ({pawns:[4,76], walls:[], remaining:[10,10], turn, winner:null, variant:'classic'});
const cases = [];
for (const starter of [0,1]) {
  let state = initial(starter);
  for (let ply = 0; ply < 4; ply++) {
    const expected = {type:'pawn', to:state.pawns[state.turn] + (state.turn === 0 ? 9 : -9)};
    cases.push({id:`starter-${starter}-ply-${ply}`, state, expected});
    state = R.apply(state, expected);
  }
}
const median = values => {
  const sorted = values.slice().sort((a,b) => a-b), n = sorted.length;
  return n % 2 ? sorted[n >> 1] : (sorted[n/2-1] + sorted[n/2])/2;
};
const server = http.createServer((req,res) => {
  const headers = {'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'};
  if (req.url === '/') {
    res.writeHead(200, {...headers,'Content-Type':'text/html'});
    res.end('<!doctype html><title>Local opening measurements</title><script src="/vendor/ort.webgpu.min.js"></script><script src="/rules.js"></script><script src="/engine.js"></script><script src="/inference.js"></script><script src="/neural.js"></script>');
    return;
  }
  let target;
  try { target = path.resolve(extension, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); }
  catch { res.writeHead(400); res.end(); return; }
  if (!target.startsWith(extension + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(target, (error, bytes) => {
    if (error) { res.writeHead(404); res.end(); return; }
    const type = target.endsWith('.wasm') ? 'application/wasm' : target.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, {...headers,'Content-Type':type}); res.end(bytes);
  });
});
async function main() {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({headless:true, ...(process.env.OPENING_BROWSER_PATH ? {executablePath:process.env.OPENING_BROWSER_PATH} : {channel:'chrome'})});
    const page = await browser.newPage();
    // A reproducible CPU benchmark; thread count is recorded in every result.
    await page.addInitScript(count => {window.WallzThreads=count; Object.defineProperty(navigator,'gpu',{value:undefined});}, threads);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const startup = await page.evaluate(async () => {
      const start=performance.now(); await WallzNeural.init();
      return {elapsedMs:performance.now()-start,info:WallzInference.info()};
    });
    const rows=[];
    for (const profile of [{id:'normal',budgetMs:3000,maxBudgetMs:6000},{id:'short-diagnostic',budgetMs:250,maxBudgetMs:250}]) {
      for (const fixture of cases) {
        // Fresh search caches for each case; the already loaded model is shared.
        await page.addScriptTag({path:path.join(extension,'engine.js')});
        await page.addScriptTag({path:path.join(extension,'neural.js')});
        const result = await page.evaluate(async ({state,options}) => {
          const before=JSON.stringify(state),start=performance.now();
          const result=await WallzNeural.analyse(state,options);
          return {result,wallMs:performance.now()-start,unchanged:JSON.stringify(state)===before};
        },{state:fixture.state,options:{budgetMs:profile.budgetMs,maxBudgetMs:profile.maxBudgetMs}});
        const best=result.result.candidates[0];
        let legal=false;
        if (best) { try {R.apply(fixture.state,best.move); legal=true;} catch {} }
        rows.push({id:fixture.id,profile:profile.id,state:fixture.state,expected:fixture.expected,choice:best?.move,forward:!!best&&R.moveKey(best.move)===R.moveKey(fixture.expected),legal,unchanged:result.unchanged,elapsedMs:result.wallMs,engine:result.result.engine,budgetMs:result.result.searchBudgetMs,nodes:result.result.nodes,candidates:result.result.candidates.map(c=>({move:c.move,visits:c.visits,prior:c.prior,score:c.score,bound:c.bound})),modelError:result.result.modelError});
        process.stderr.write(`${profile.id} ${fixture.id}: ${Math.round(result.wallMs)} ms, ${JSON.stringify(best?.move)}\n`);
      }
    }
    const normal=rows.filter(row=>row.profile==='normal'),short=rows.filter(row=>row.profile==='short-diagnostic');
    const report={timestamp:new Date().toISOString(),source:`Unmodified local engine, bundled quoridor.onnx, headless Chrome, ${threads} CPU thread(s), fresh search caches per case`,opening_elapsed_ms:median(normal.map(row=>row.elapsedMs)),legal_results:Number(rows.every(row=>row.legal)),unmodified_positions:Number(rows.every(row=>row.unchanged)),forward_choices:normal.filter(row=>row.forward).length,opening_cases:normal.length,inference_ms:startup.info.inferenceMs,startup,shortDiagnostic:{elapsedMs:median(short.map(row=>row.elapsedMs)),forwardChoices:short.filter(row=>row.forward).length,agreesWithNormal:short.filter((row,i)=>R.moveKey(row.choice)===R.moveKey(normal[i].choice)).length},rows,limitations:['Short-budget calls are measurements of the existing API, not a production shortcut.','Model startup is timed separately; search measurements use a loaded model.','Headless CPU results do not predict the selected extension GPU backend; CPU thread count is recorded in startup.info.','Both starting colors are covered by generated legal opening sequences.','These cases measure opening decisions, not real-player opening frequency, Elo, win rate, or proof of optimal play.']};
    const serialized=JSON.stringify(report,null,2)+'\n';
    if (output) {fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,serialized);}
    process.stdout.write(serialized);
    if (!report.legal_results || !report.unmodified_positions) process.exitCode=1;
  } finally {if (browser) await browser.close(); await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;server.close();});
