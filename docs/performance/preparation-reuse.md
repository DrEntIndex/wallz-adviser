# Opponent-turn preparation and reuse

Preparation is a neural-evaluation cache warmer. It does not choose your next
move, add speculative Monte Carlo visits, or reduce your normal thinking time.
Its benefit is that the next search can obtain a position's learned policy and
value from memory instead of running the model again. The saved model work can
leave more of the same turn budget for search.

## Runtime path

1. The overlay sends `WALLZ_PREPARE` when the board is valid, the game is still
   running, and it is the opponent's turn. It clears playable advice.
2. The background scheduler runs preparation in 500 ms slices while no own-turn
   analysis is waiting or running. Unfinished work resumes, with tabs scheduled
   in rotation. A new board, pause, closed tab, or foreground search cancels the
   relevant work. Dedicated workers use a shared cancellation flag where available.
3. Preparation evaluates the current opponent position to get move probabilities,
   then schedules every legal opponent reply in probability order. Four reply
   picks alternate with one likely deeper continuation while both queues have work.
   Once the reply queue empties, all picks go to deeper continuations. This keeps
   reply coverage progressing while warming positions useful after short waits.
4. Deeper branches retain the existing top-sixteen policy candidates, a ten-percent
   uniform probability mixture, and the depth penalty. The continuation heap ranks
   their accumulated negative log probabilities. Duplicate and terminal states
   are skipped. Each job stops after 8192 evaluated or already-cached positions.
5. Up to four recent position jobs retain their queues and progress. Returning to
   a job refreshes its recency; a fifth job evicts the least recently used one.
   This fixes restarting preparation whenever the scheduler alternates two tabs.
6. When your turn begins, the search looks up the exact resulting board. Cache keys
   include ruleset, side to move, both pawns, both wall inventories, and wall layout.
   A prepared hit moves into the normal search evaluation cache. Each evaluation
   cache is separately capped at 8192 entries. A miss runs the model normally.

Preparation and search run serially in the same selected worker, so they share
evaluation caches. Race rules and pawn-only endgames use classical/exact logic;
preparation skips them. The selected worker can use CPU or WebGPU inference.
Startup calibration tries available CPU thread configurations and retains its
measured winner; these changes do not alter that selection.

## What the counters mean

`prepared` counts positions visited in the preparation job, including positions
already cached. It is not a guarantee that every position will be used next turn.
`explored` counts simulations completed during the current own-turn search.

Hover over `explored` after a neural search to see how many prepared evaluations
that search actually consumed and how many fresh model evaluations it requested.
The result also exposes `evaluationStats.preparedHits`, `searchHits`, and `fresh`.
Exact/classical results omit those statistics. Previously expanded search-tree
nodes can be reused without another prediction, so these counts measure model
requests rather than all forms of search reuse. Prepared hits are promoted once;
later reads count as ordinary search-cache hits.

## Confirmed problems and changes

The previous scheduler gave every immediate opponent reply absolute priority
over all deeper work. With 131 legal opening replies, short waits warmed only
possible next roots. The next search typically reused just its root evaluation.
Preparation now interleaves reply coverage with likely continuations. Existing
full reply-coverage, legality, cancellation, and zero-speculative-visit tests pass.

The previous single global preparation job also reset when switching positions,
despite the background scheduler explicitly rotating tabs. A regression test
reproduced its progress dropping from eight visits to zero. Bounded per-position
jobs now resume the previous queue and counter.

## Bundled-model comparison

Reference: `82ca9f0eb7b6c0e59ebbc8834658ba559e4ed7a8`. Headless Chrome, warm bundled
`quoridor.onnx`, one CPU thread, four legal opponent replies, three repetitions
per implementation. Both implementations receive 500 ms preparation and a fixed
1000 ms search budget; fresh rules, classical, and neural caches per measurement.
Order alternates between repetitions. Figures below are per-scenario medians.

- Opening forward reply: prepared hits **1 → 4**, search simulations **24 → 27**.
- Opening wall reply: prepared hits **1 → 1**, search simulations **25 → 25**.
- Middlegame forward reply: prepared hits **1 → 2**, search simulations **22 → 28**.
- Middlegame wall reply: prepared hits **0 → 0**, search simulations **20 → 21**.

All 24 results were legal and left the captured position unchanged. Reuse improved
in the tested forward lines; the unexpected middlegame wall remained a cache miss.
Timing and simulation counts varied substantially, including a faster first
sample, so the direct cache-hit evidence is stronger than the throughput evidence.
This small CPU comparison does not establish GPU speed, playing strength, win rate,
or an optimal scheduling ratio. Broad reply coverage takes more picks than before,
and unlikely replies can still arrive before their evaluations are ready.

Reproduce locally with the existing bundled Playwright runtime or a local install:

```sh
node scripts/preparation-benchmark.cjs --samples 3 --output outputs/preparation-comparison.json
```

Use `--prepare-ms`, `--search-ms`, and `--reference` for other waits, equal search
budgets, or immutable revisions. The benchmark instruments predictor requests
without changing model outputs. JSON measurements live under ignored `outputs/`.

Validation: all 112 Node tests; syntax, manifest, permissions, and bundled runtime
integrity checks; browser fixtures covering the counter tooltip/accessibility,
stale advice, pause, opponent preparation, and own-turn transitions. Live human
matches and the installed extension's selected GPU backend were not measured.
