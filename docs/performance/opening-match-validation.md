# Three-move opening cutoff and regression comparison

The opening speedup is capped at **three moves per player: six total turns**. Before each move, the played-move count can be 0 through 5. At count 6, the history tracker permanently removes eligibility for that game, and the neural engine independently rejects the token. Both players' fourth moves use ordinary timing: normal 3–6 seconds or quick 2–4 seconds, with existing exact-proof shortcuts preserved.

The runtime change from the previously shipped two-move version is only three limit comparisons: two in the bridge's history tracker and one in neural eligibility. All confidence, wall/deviation, cancellation, model failure, and uncertainty safeguards remain intact.

## Real bundled-model checks

The reference search is commit b66890067e17aafa45b07e7490c5db5499b6923f, immediately before the opening speedup. The current search includes the verified opening logic and six-turn cutoff. Both use the exact same neural model, rules, classical engine, inference runtime, and vendor assets. The model's Git blob is f23802a83dc9054b5227da74b3771698854535f0; model file SHA-256 is d790dac68389f7602ff8a887a2385417d3c925fe22da7164c86e9226f943908d.

Sixteen fresh-search positions were checked using the real model and normal 3–6 second budgets: all first six turns with either color starting, plus both players' fourth-move controls. **All sixteen moves agreed** between the old and current search. The old search chose forward for all twelve quiet-opening positions, including both third moves. Ten current searches exited early; the starting player's less certain second move retained full search in both orientations.

The median warm-model search time for the first six turns decreased from **2,961.5 ms to 537.4 ms** in this run. Third-move comparisons all agreed, with current search times of approximately 325–591 ms versus approximately 2,961–2,980 ms for the old search. Every fourth-move control had the opening shortcut disabled and used the original full thinking behavior. Startup was separate.

## Full local games

Twelve games were played with six starting scenarios and both current-engine color assignments: ordinary p1 start, ordinary p2 start, left sidesteps, right sidesteps, an immediate blocking wall, and six forced forward moves. Each engine used four CPU threads, a separate fresh browser context for each game, and the ordinary quick 2–4 second budget outside a permitted early exit. Search trees and evaluations were reused across turns within each game. Opponent-turn preparation was disabled for both versions to isolate search.

The result was **6 current wins, 5 reference wins, and 1 unfinished game**. Every counted win reached the actual goal square. The unfinished immediate-wall game stopped after a position repeated six times; it was not counted as a draw or awarded to either engine. Its current engine never used the opening speedup.

The engines chose and legally played **734 moves**, excluding the forced setup moves. There were **zero illegal moves, zero model errors, and zero opening early exits after turn six**. Sideways, immediate-wall, and already-completed-opening scenarios never used the shortcut. The combined opening audit and match run took about 8.6 minutes on this machine; game concurrency was three.

Per-scenario outcomes, current wins/reference wins/unfinished:

- Ordinary p1 start: 1 / 1 / 0.
- Ordinary p2 start: 1 / 1 / 0.
- Left sidesteps: 2 / 0 / 0.
- Right sidesteps: 1 / 1 / 0.
- Immediate wall: 0 / 1 / 1.
- Six forced forward moves: 1 / 1 / 0.

This small paired sample showed no playing-strength regression. It does not establish an Elo difference, exact equality of win rates, or a 100% strength guarantee. Real-time search can vary with scheduling, including in scenarios where the opening feature is entirely disabled.

## Ordinary-search equivalence and cutoff tests

The separate deterministic regression harness compared **26 old/current searches** under both normal and quick budgets. It used independent fresh VMs, identical deterministic evaluator outputs, and an operation clock to remove wall-clock variation. Whole search results, candidate scores/bounds, paths, nodes, search budgets, evaluator-call counts, legal moves, and input immutability matched exactly.

Those checks cover unknown history, both fourth-move positions, later pawn contact/jumps, early walls by either side, sideways moves, a backward loop returning to the starting board, immediate wins, and pawn-only proof endgames. This is a program-behavior equivalence check using a controlled evaluator; the real-model strength checks are the games above.

The updated opening unit suite passes 28 tests, and the full suite passes **109 tests**. Syntax, manifest-resource, permission, and whitespace checks also pass. The boundary test explicitly allows both third moves when search is confidently settled, then requires both fourth moves to retain the complete normal/quick budgets even with an artificially dominant forward predictor. History tracking covers every legal early wall at each of six turns with either starter: **1,536 cases**, with the same range checked in neural eligibility. Unknown, skipped, missing, changed, and malformed observations keep the usual fail-closed behavior.

An independent replay of all twelve saved game traces re-applied all 734 engine-selected moves, checked each recorded state key, actor, turn, final state, and winner, and confirmed that neither walls nor turn counts at or beyond six ever had an opening early-exit flag.

## Reproduce and evidence

Run node scripts/opening-matches.cjs --mode all --threads 4 --concurrency 3 --output outputs/opening-matches/three-move.json for the real-model audit and twelve games. Its local loopback server never contacts Wallz or plays online. Use --smoke for a short harness check; smoke games are excluded from the results above. Its --max-plies limit bounds searched moves after each forced prefix, and repetitions are reported separately.

Run node scripts/opening-regression.cjs for the controlled ordinary-search comparison. The reference commit must exist locally. Both scripts can use the bundled desktop Playwright/runtime without new project dependencies.

Raw evidence is in ignored outputs/opening-matches/three-move.json and outputs/opening-matches/differential.json. The measured current neural SHA-256 is 29878fe7b9b13eb16b17eb14dbf16caf3857af1ca62ebef5ccb072db61281b20; bridge SHA-256 is bf74bbf6967614e26d453ca3349cf6ff17b573d843d982deaf670a19016581b9. The previous four-turn measurement report remains historical evidence in opening-speed.md.

Reload the unpacked extension and refresh Wallz before the next game to use the new three-move cutoff.
