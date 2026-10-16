# Apple Silicon optimization and offline comparisons

The extension uses ONNX Runtime WebGPU, which reaches Apple GPUs through Metal.
MLX provides native APIs and would require a companion process and a different
installation model. The current optimization preserves the browser extension.
See [ONNX Runtime WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
and [Apple's MLX project](https://github.com/ml-explore/mlx).

## Runtime changes

The ka model now has an optional eight-position graph in addition to the original
four-position graph. Only the static batch shapes change; learned tensors, input
features, policy decoding and values retain their definitions and float32 precision.
Initialization verifies file hashes and compares every lane against two CPU
evaluations in several orders, using the existing 0.002 tolerance. It selects
eight positions only when measured time per position drops by at least 15%
relative to four positions. A missing, corrupt, slower or numerically inconsistent optional graph
retains the validated smaller batch. CPU and Sigma fallbacks remain available.

Search and opponent-turn preparation both use the selected batch capacity. Larger
batches alter the number of simultaneous PUCT leaf requests, so identical weights
do **not** prove identical decisions or strength. Foreground timing, tactical
proofs, legal actions and the six-second production maximum remain unchanged.
Partial batches use microtask coalescing to avoid nested browser timer delays.

`info()` reports batch throughput separately from single-evaluation latency and
adds `singleBackend`: a retained GPU batch can coexist with a CPU scalar path.
Small workloads can have different performance from full batches. Selection
measures inference throughput, not whole-game strength or every possible workload.

To regenerate the larger graph with Python and `onnx==1.17.0`:

```sh
python scripts/build-ka-batch.py
```

This reads `ka-batch.onnx`, checks its metadata hash, adjusts the known batch
dimension, checks ONNX shapes and updates `ka.json`. The original single and
four-position models are retained. After recreating the models from a TensorFlow
checkpoint with `convert-ka.py`, rerun this step to restore the optional larger
graph. No Python environment is needed to use the extension.

## Preserve a baseline before editing

```sh
npm run snapshot:apple
```

The snapshot is stored in `work/apple-silicon/baseline` and will never be silently
overwritten. `snapshot.json` records SHA-256 hashes of **every extension file**,
including model weights, ONNX Runtime assets, rules, inference, workers and search.
Every comparison verifies the baseline and freezes both versions' served bytes
at launch. It verifies that candidate files have not changed when the run finishes.
Git history is not required. Keep this ignored directory or copy it separately
when archiving the project; Git will not preserve it.

This checkout's existing baseline was taken from the original extracted 0.8.1
version before the optimization. To restore its bot, copy its `extension/` back
to the project's `extension/` and remove candidate-only model files if desired.

## Run the comparisons

Node 20+, Playwright and a Chromium browser with hardware WebGPU are required.
The script discovers Chrome or Brave on macOS. Use `--browser /absolute/path`
or `WALLZ_BROWSER_EXECUTABLE` for another binary. If Playwright is outside the
project, set `PLAYWRIGHT_MODULE_DIR` to the directory containing its package.
The Codex desktop bundled module directory is discovered automatically.

```sh
npm run benchmark:apple -- --backend gpu --samples 6 --rounds 80 --budget-ms 1000
npm run matches:apple -- --backend gpu --pairs 12 --budget-ms 400 --idle-ms 200
```

`--backend auto` (the default) leaves WebGPU available and lets each complete
runtime calibrate its own CPU/GPU choice. `gpu` requires a hardware adapter and
selected WebGPU, and fails if search falls back. `cpu` explicitly disables WebGPU
inside each worker. No software GPU adapter is accepted by `gpu`. The launch
enables WebGPU but does not force SwiftShader. All browser traffic is restricted
to localhost, so these tools never join or play an online game.

The default thread setting runs each version's real 1/4/all-core calibration.
For controlled diagnostic comparisons, use `--threads 1` (or another fixed count).
The report records all calibration profiles, selected counts, actual backends,
adapter, browser version, architecture, CPU model and file hashes. Initialization
is outside the equal thinking budgets and reported separately. Profile timing is
subject to warm caches, power state and browser fingerprinting (Brave can vary
reported hardware concurrency between contexts).

Speed measurements alternate version order, warm inference, measure scalar,
four-position and eight-position requests, then run four fresh-cache search
fixtures per sample with fixed wall-clock budgets. Each sample checks batched
policy/value results on 96 positions against both the other GPU runtime and an
independent CPU-only baseline. Speed ratios include all samples and their range;
they are not a population confidence interval.

Matches run serially with separate persistent workers for both players. Each
starting position is used twice, with sides swapped; side order and launch order
also alternate. Both actors get the same foreground maximum and preparation
allowance, with preparation on the actual opponent-to-move position before its
eventual move is known. Model startup is excluded. Opening fast-path metadata is
omitted for both players. Legal moves, errors, actual elapsed time, search work,
preparation and evaluation-cache reuse are recorded per ply. A model fallback or
foreground overrun beyond the 250 ms diagnostic tolerance fails the run.

Set `--idle-ms 0` to isolate foreground search. A longer-budget check is useful
because quick diagnostic games do not represent normal 3–6 second play. Use
`--max-plies` to bound games; six repetitions or that limit produce an **unresolved**
game, never an inferred draw or win. Interrupted/failed reports remain marked as
such and include completed games. Only fully side-swapped pairs enter the summary.

## Interpret results conservatively

Generated JSON lives under `outputs/apple-silicon/`, which is ignored by Git.
Choose separate `--output outputs/...json` paths to retain multiple runs. The
snapshot and output paths must remain beneath `work/` or `outputs/`.

Faster inference is not evidence of stronger play. Compare W/L/unresolved counts,
pair outcomes and actual budgets separately from throughput. Unresolved games
produce a score **range**, from counting all as losses to counting all as wins.
The report also gives a conservative 95% Hoeffding interval using each pair as one
bounded observation. Its generalization assumes independent representative
scenario pairs; a fixed synthetic fixture suite does not establish that
assumption. The `nonRegressionEstablished` field tests whether its lower bound
exceeds 45%, a five-percentage-point noninferiority margin against 50%. Small
suites will usually be inconclusive. Do not interpret a favorable point result,
unchanged weights, passing unit tests or a lack of observed regression as proof
that the bot cannot be weaker in other positions. These are not Elo measurements.
