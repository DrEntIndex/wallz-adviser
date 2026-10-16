'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const C=require('./apple-silicon-common.cjs');
const directory=path.join(C.root,'outputs/apple-silicon');
const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const benchmark=read('benchmark.json'),matches=read('gpu-matches.json');
for(const report of [benchmark,matches])assert.equal(report.status,'complete','Only completed runs can enter the report');
assert.deepEqual(benchmark.snapshots,matches.snapshots,'Speed and matches must test the same versions');
const pct=n=>(n*100).toFixed(1)+'%',fixed=n=>n.toFixed(2),s=matches.strength;
const neural=matches.games.flatMap(game=>game.moves).filter(move=>move.engine==='neural-puct');
const summaries=['baseline','candidate'].map(kind=>{
 const rows=neural.filter(row=>row.actor===kind);
 return {kind,moves:rows.length,medianMs:C.median(rows.map(row=>row.wallMs)),medianNodes:C.median(rows.map(row=>row.nodes)),totalNodes:rows.reduce((sum,row)=>sum+row.nodes,0),fresh:rows.reduce((sum,row)=>sum+(row.evaluationStats?.fresh||0),0),preparedHits:rows.reduce((sum,row)=>sum+(row.evaluationStats?.preparedHits||0),0),maxMs:Math.max(...rows.map(row=>row.wallMs))};
});
const maximum=(field,reference)=>Math.max(...benchmark.parity.filter(row=>row.reference===reference).map(row=>row[field]));
const score=s.scoreRange[0]===s.scoreRange[1]?pct(s.scoreRange[0]):s.scoreRange.map(pct).join('–');
const rows=benchmark.speed.map(row=>`| ${row.category==='search'?'Fixed-budget search':row.category+' simultaneous evaluations'} | ${fixed(row.medianSpeedup)}× | ${fixed(row.minSpeedup)}–${fixed(row.maxSpeedup)}× |`).join('\n');
let markdown=`# Apple Silicon optimization results

Generated ${new Date().toISOString()}. Measured locally on ${benchmark.environment.cpus}, ${benchmark.environment.arch}, ${benchmark.environment.platform}; browser ${benchmark.environment.browser}. See the raw [speed data](benchmark.json) and [paired games](gpu-matches.json), including complete file hashes and per-move records.

## Measured performance

${benchmark.samples} samples, ${benchmark.rounds} measured inference rounds per request width per version per sample, alternating version order. Four fresh-cache search fixtures per sample at ${benchmark.budgetMs} ms per move. Each version uses its own complete runtime and automatic backend/thread selection. Startup is outside these timings.

| Workload | Median candidate / baseline speed | Range across paired samples |
| --- | ---: | ---: |
${rows}

Ratios above one favor the candidate. These ranges describe observed timing variability, not population confidence intervals. Full batches benefit most; scalar and partially filled requests may be slower. The runtime's batch calibration optimizes full-batch throughput, so this is not a claim that every call is faster.

Median worker/model initialization including thread and backend calibration: baseline ${C.median(benchmark.startups.filter(row=>row.kind==='baseline').map(row=>row.elapsedMs))} ms; candidate ${C.median(benchmark.startups.filter(row=>row.kind==='candidate').map(row=>row.elapsedMs))} ms. These measurements use fresh workers but may share browser code/file caches; they are not a guarantee about first-ever startup.

The original four-position and new eight-position graphs retain identical learned tensors and operators; only the explicit batch shape differs. Every sample compared batched outputs on 96 positions with an independent CPU-only baseline. Maximum candidate-versus-CPU value error: ${maximum('maxValueError','cpu-vs-candidate').toExponential(3)}; decoded policy logit error: ${maximum('maxPolicyError','cpu-vs-candidate').toExponential(3)} (threshold 0.002). Numerical agreement does not imply identical timed PUCT decisions.

Additional local validation is recorded in [the unit-test log](test-results.txt) and [the ONNX graph/weight check](model-check.json). The latter checks every serialized initializer and graph operator against the preserved four-position source.

## Playing strength

Candidate **${s.wins} wins, ${s.losses} losses, ${s.unresolved} unresolved** in ${matches.games.length} games / ${s.completedPairs} complete side-swapped pairs. Both bots received ${matches.budgetMs} ms foreground maximum and ${matches.idleMs} ms preparation per move. Games ran serially, using the same initial state within each pair and independent persistent workers. GPU mode required a hardware adapter and selected WebGPU. No failed or incomplete runs enter these counts.

Candidate score: ${score}. Conservative conditional 95% score interval: **${s.conditional95ScoreInterval.map(pct).join('–')}**. Noninferiority against 45%: **${s.nonRegressionEstablished?'met under the stated statistical assumptions':'not established'}**.

${s.uncertainty}

| Starting position | Candidate wins | Baseline wins | Unresolved |
| --- | ---: | ---: | ---: |
${s.pairs.map(pair=>`| ${pair.scenario} | ${pair.wins} | ${pair.losses} | ${pair.unresolved} |`).join('\n')}

| Candidate's player index | Wins | Losses | Unresolved |
| --- | ---: | ---: | ---: |
${[0,1].map(side=>{const games=matches.games.filter(game=>game.candidatePlayer===side);return `| ${side} | ${games.filter(game=>game.winner==='candidate').length} | ${games.filter(game=>game.winner==='baseline').length} | ${games.filter(game=>game.winner===null).length} |`;}).join('\n')}

Side/position advantage can dominate a small suite, which is why both versions play each side of every fixture.

Actual timed neural moves (proof returns excluded):

| Version | Neural moves | Median wall time | Median search visits | Total fresh evaluations | Prepared evaluations reused | Max wall time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${summaries.map(row=>`| ${row.kind} | ${row.moves} | ${row.medianMs} ms | ${row.medianNodes} | ${row.fresh} | ${row.preparedHits} | ${row.maxMs} ms |`).join('\n')}

The move distributions differ once the bots choose different actions, so these match-time node totals are descriptive; the fixed-position benchmark supplies the speed comparison. The harness aborts on illegal moves, model fallbacks and overruns beyond the 250 ms diagnostic tolerance. Repetition and ply-limit stops are unresolved, not assumed draws.

## Reproduce and restore

The original extracted 0.8.1 baseline is preserved in <code>work/apple-silicon/baseline</code>; its <code>snapshot.json</code> hashes all 25 original extension files. There was no Git repository/history in the supplied download. Both <code>work/</code> and <code>outputs/</code> are ignored by Git; preserve the baseline separately when copying only source-controlled files.

Run <code>node scripts/apple-silicon-compare.cjs benchmark --backend gpu --samples ${benchmark.samples} --rounds ${benchmark.rounds} --budget-ms ${benchmark.budgetMs}</code> and <code>node scripts/apple-silicon-compare.cjs matches --backend gpu --pairs ${s.completedPairs} --budget-ms ${matches.budgetMs} --idle-ms ${matches.idleMs} --output outputs/apple-silicon/gpu-matches.json</code>. Then regenerate this report with <code>node scripts/apple-silicon-report.cjs</code>. Browser, power state and background activity can affect reproducibility. See [the comparison guide](../../docs/performance/apple-silicon.md).
`;
for(const [name,title]of [['cpu-benchmark.json','CPU fallback diagnostic'],['long-games.json','Longer-budget GPU games']]){
 const file=path.join(directory,name);if(!fs.existsSync(file))continue;
 const report=read(name);assert.equal(report.status,'complete');assert.deepEqual(report.snapshots,benchmark.snapshots);
 markdown+=`\n## ${title}\n\n[Raw report](${name}). `;
 if(report.strength)markdown+=`${report.games.length} games, ${report.budgetMs} ms foreground and ${report.idleMs} ms preparation: candidate ${report.strength.wins} wins, ${report.strength.losses} losses, ${report.strength.unresolved} unresolved. Conditional 95% interval: ${report.strength.conditional95ScoreInterval.map(pct).join('–')}. This small check does not establish playing-strength noninferiority.\n`;
 else markdown+=`Median fixed-position search speed ratio: ${fixed(report.speed.find(row=>row.category==='search').medianSpeedup)}×. Both workers explicitly disabled WebGPU; all generated files and measurements are retained locally.\n`;
}
fs.writeFileSync(path.join(directory,'report.md'),markdown);console.log(path.join(directory,'report.md'));
