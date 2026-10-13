# Opponent-turn preparation: mechanism and game comparison

The selected strategy remains **immediate-reply-first evaluation caching**.
We tested alternative schedulers and background Monte Carlo search. Corrected
pondering finished **4 wins–4 losses in quick mode and 4–4 in normal mode**
against the original extension. It did not demonstrate a strength gain that
justifies replacing the simpler mechanism.

The shipped changes fix lost preparation progress when tabs alternate, expose
actual cache reuse, and preserve reproducible comparison tools. This is a
conservative selection among tested approaches, not proof of global optimality.

## What preparing actually does

1. The overlay requests preparation on the opponent's turn and clears playable
   advice. The scheduler runs 500 ms slices while own-turn analysis has priority.
2. Preparation evaluates the opponent position's neural policy/value, then every
   legal immediate reply in policy order, before deeper work. An opening has 131
   legal replies, including 128 walls.
3. A heap then visits likely continuations: top sixteen policy choices per
   expanded position, a ten-percent uniform probability mix and a depth penalty.
   Duplicate and terminal positions are skipped. Jobs stop after 8192 evaluated
   or already-cached positions.
4. Foreground search reuses evaluations matching the exact resulting board.
   Keys include ruleset, side to move, both pawns, inventories and walls. Misses
   evaluate normally. It also retains graph nodes and visits from earlier
   own-turn searches.
5. Preparation and analysis run serially in the selected worker. Changed boards,
   pause, closed tabs or foreground requests cancel background work. Quick
   timing remains 2–4 seconds and normal timing 3–6 seconds; verified opening
   shortcuts and exact tactical results still apply.

Preparation precomputes policy/value evaluations; it does not choose your next
move or add speculative search visits. Avoided model calls leave more of the same
thinking allowance for other work. Race rules and pawn-only endgames use
classical/exact logic and skip preparation. CPU/WebGPU calibration is unchanged.

## Confirmed improvements and counters

The previous single global job restarted whenever the scheduler rotated tabs.
Four recent exact-position jobs now retain their heap, current evaluation and
progress. Returning refreshes recency; a fifth evicts the least recent job.
Both evaluation caches remain independently bounded at 8192 entries. Tests cover
resumption, eviction, cancellation, full immediate reply coverage, deeper work
and zero speculative search visits.

Completed jobs release their pending heap, duplicate set and current entry while
keeping progress counters and cached evaluations. In a uniform-predictor Node
fixture with four jobs at 8192 visits each, GC-retained JavaScript heap fell from
80.97 to 15.17 MiB. All four queues became empty and the 8192-entry evaluation
cache remained intact. [Before](preparation-memory-before.json) and
[after](preparation-memory-after.json) records include all samples. These figures
cover that fixture process and rules/evaluation caches, excluding model/runtime
and GPU allocations; RSS and ArrayBuffer changes are not treated as a saving.
Repeat with `node --expose-gc scripts/preparation-memory.cjs ca87945` and
`node --expose-gc scripts/preparation-memory.cjs` for the current source.

A deterministic single-position comparison produced the identical sequence and
counts across 200 model evaluations. The initial four-replies/one-continuation
experimental ordering was reverted after its game result showed no improvement.

Hover over **explored** after a neural decision to see prepared evaluations
actually consumed and fresh model evaluations requested. Results expose
`evaluationStats.preparedHits`, `searchHits` and `fresh`. Prepared outputs are
promoted once; later reads count as ordinary search-cache hits. Already expanded
graph nodes need no prediction, so these counters measure model requests rather
than all retained search work. Exact/classical results omit them. **Prepared**
means job progress, including already-cached positions; it does not guarantee
that all that work will be used next turn.

## Alternatives and game outcomes

Reference: immutable main `82ca9f0eb7b6c0e59ebbc8834658ba559e4ed7a8`.
Short screens used 300 ms foreground and 300 ms opponent time, eight games each,
four starting positions with colors swapped:

- Interleaved cache: **3 wins, 5 losses** against main.
- Probe-aware cache, targeting foreground policy/defensive/forcing probes:
  **3 wins, 4 losses, 1 unfinished** against main.
- Conditional PUCT pondering, searching our response from possible opponent
  replies and retaining visits: **5 wins, 3 losses** against main.
- Exact-root isolation ablation: **2 wins, 6 losses against pondering**, not main.
  The tested ablation underperformed; this alone does not establish the cause.
- Bounded pondering draft: **6 wins, 1 loss, 1 unfinished** against main, before
  the final proof-retention correction.

The corrected pondering snapshot was frozen for two production-budget
comparisons on four previously unused seeded starts, with both colors:

- Quick: **4–4**, 2000–4000 ms foreground, 1000 ms opponent time; 422 moves.
- Normal: **4–4**, 3000–6000 ms foreground, 2000 ms opponent time; 406 moves.

Both reported zero illegal moves, model failures, input changes and timing
failures. Every quick-mode pair split 1–1; normal-mode gains on one start were
offset by losses on another. These finite results support keeping the incumbent,
not an Elo estimate or proof of statistical equivalence. Scores from different
versions, opponents and timings are separate. The two unfinished screens are
unresolved rather than draws.

Early cache-hit measurements improved in some forward lines without producing
a winning game result. Retained background visits also demonstrated reuse
without stronger play at real budgets. Neither counter substitutes for strength.

### Problems found in experimental pondering

The first production-budget run stopped after 2 wins and 4 losses when a real
turn discarded 112 prepared root visits at a storage reset. A cancelled leaf
also counted 263 edges with only 131 live. Bounded graph retention and counting
only published edge arrays corrected these problems.

A second run stopped after 1 win and 1 loss when an independent fixture reproduced
pruning away a winning move's witness while retaining a root proof flag.
The corrected prototype clears solved internal nodes' old edges, probes and
visits at retention and re-expands them; certified edge-less leaves remain valid.
Both interrupted records preserve completed outcomes and are excluded from final
holdout scores. These experimental changes are not installed in the extension.

Prototype checks cover signs, exact-root adoption, cancellation at root/child/leaf
inference, recovery, failed inference cleanup, exact live-edge counts, retention
and proof witnesses, cycles, alternative-reply coverage, job resumption/eviction,
and worker prepare→cancel→analyse serialization.

## Reproduce and inspect

[Game records](preparation-games.json) preserve source/model hashes, settings,
initial/final boards, outcomes, diagnostics and move traces, including abandoned
comparisons. Trace `pN` moves a pawn to square N; `wN` places encoded wall N.
Replay with `extension/rules.js` from each initial board. Full per-turn telemetry
remains under ignored local `outputs/preparation-games/`.

Use Node, the existing bundled Playwright runtime or a local Playwright install,
and installed Chrome. The scripts use local assets and no live games:

```sh
node scripts/preparation-variants.cjs
node scripts/preparation-prototype-check.cjs
node scripts/preparation-matches.cjs --candidate bounded --reference main --games 8 --holdout --budget-ms 2000 --max-budget-ms 4000 --idle-ms 1000 --output outputs/preparation-games/quick-repeat.json
node scripts/preparation-matches.cjs --candidate bounded --reference main --games 8 --holdout --budget-ms 3000 --max-budget-ms 6000 --idle-ms 2000 --output outputs/preparation-games/normal-repeat.json
```

The generator reconstructs archived experiment sources from fixed Git revisions
into ignored `work/preparation-design/`; it does not replace extension files.
`bounded` is corrected, `bounded-preproof` is its earlier draft, and `ponder`
the original experimental version. These are research candidates rather than
installation targets. Use `--candidate current` to test the installed extension,
or a commit SHA to freeze it. `--games 16` adds four more holdout starts. Repeats
are new samples: timing-dependent search can produce different games.

The earlier cache-request microbenchmark remains available:
`node scripts/preparation-benchmark.cjs --samples 3`. It measures reuse, not strength.

## Evidence limits and validation

Headless Chrome used bundled `quoridor.onnx`, CPU inference with four threads,
and persistent independent engine/model sessions per player. The waiting actor
prepared the exact opponent-to-move state before the opponent's analysis, without
knowing its eventual action. Serial phases remove local opponent-model contention;
both players receive the same simulated idle allowance and foreground budgets.
Opening fast-path history is omitted symmetrically to isolate preparation.
Sixfold repetition and ply limits remain unfinished.

These games cover selected starts, simulated waits and CPU inference. They do not
establish universal optimality, live human performance or strength on the selected
GPU backend. Tree reuse and opponent-time search are established techniques
([AlphaGo paper, Methods](https://storage.googleapis.com/deepmind-media/alphago/AlphaGoNaturePaper.pdf));
this makes pondering a reasonable experiment rather than proof it wins here.

All **114 Node tests**, syntax/manifest/permission/runtime integrity checks, and
browser fixtures for reuse tooltip/accessibility, stale advice, pause, opponent
preparation and own-turn transitions passed. The shipped extension retains the
original reply-first policy and thinking budgets.
