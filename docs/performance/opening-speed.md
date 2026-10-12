# Guarded opening speedup

The adviser now allows its search to finish early during the first three pawn moves per side (six total turns), only after verifying an uninterrupted straight-forward opening from the actual start of the game. It still searches pawn moves and walls; it does not force forward or label opening estimates as proven wins.

The user-requested three-move follow-up is recorded in [opening-match-validation.md](opening-match-validation.md). It includes real old-versus-current games, the additional third moves, and fourth-move cutoff checks. The timing results below describe the original two-move implementation.

## Final implementation and measurements

On the same eight opening cases, the mean of two per-run median search times decreased from **2,956.8 ms to 502.4 ms**, saving **2,454.4 ms (83.0%)** on one CPU thread. Final run medians were 501.93 and 502.80 ms. Each run stopped early in six positions and kept full search in two; all sixteen choices matched the original full search. Every result was legal and no input position changed.

A separate four-thread CPU check returned a median of **325.7 ms**, again with six early exits, two full-budget searches, and all eight moves matching the reference. It is additional evidence, not pooled into the one-thread result. Startup was timed separately at about 319 ms in the final one-thread runs. These are warm-model search timings, not total first-turn extension response times.

Any wall, sideways or backward move, missing/skipped observation, unreadable board, or uncertain game identity disables the shortcut for the remainder of that game. A new verified game can enable it again. The shortcut now ends after six plies. Joining or reloading after the start, and practice games without online move history, keep ordinary thinking time.

Early exit requires three recent samples and the current root choice to agree on forward, finite confidence values, the existing settled-decision check, at least sixteen forward visits, a strong learned prior, and at least four times every alternative's visits. A sufficiently explored alternative with better value rejects early exit. Root probes and unresolved defensive guards must be explored first. The exit window is 250–750 ms; if its conditions never pass, the original normal/quick budget and extension logic remain intact. Inference or startup failures retain the original remaining fallback budget.

The less certain second move by the starting player deliberately kept full search in every final run. The 300 ms initial target was not reached; the run stopped at its two-candidate limit. The first candidate's additional value tolerance was too sampling-sensitive to confirm improvement. The retained candidate reuses the bot's ordinary uncertainty rule, including the freshest root value, plus the stronger opening dominance and history checks.

All **108 tests** passed, including **27 new opening tests**. Those cover all 128 legal walls at each of four opening plies for both starter colors (1,024 cases in history tracking and 1,024 in neural eligibility), sideways/backward loops, missing/skipped/duplicate observations, reader errors, reloads, resets, malformed tokens/confidence, current-value uncertainty, normal/quick fallback, transport, and stale autoplay. Syntax, manifest-resource, permission, and whitespace checks passed, along with mocked browser, autoplay, and Auto GG fixtures.

All 24 final real-model choices matched their full-search references. These checks establish the tested fallback behavior and move agreement; they do not mathematically guarantee unchanged playing strength or identical win rates. No live game was played.

## Initial investigation baseline

Using the bundled neural model in local headless Chrome, the existing full search chose forward on all eight generated opening positions, including both starting colors. Two independent one-thread CPU runs reproduced this: 16 out of 16 full-search choices were forward. Fixed 250 ms search calls matched all 16 choices.

The mean of the two per-run median search times was 2,956.8 ms for the normal 3,000–6,000 ms budget and 193.8 ms for the fixed 250 ms diagnostic budget, a 93.4% reduction. Model startup was measured separately at about 321 ms; these are warm-model search times, not total first-turn extension response times.

A four-thread CPU check ran the same eight positions. All eight full searches chose forward, and all eight short searches agreed. Median times were 2,961.0 ms and 217.6 ms respectively, with about 338 ms of separate model startup. Four-thread searches explored substantially more lines, without changing the opening choices in these cases.

Every measured result was legal and every input position stayed unchanged. Raw results are local files in `outputs/opening-speed/`; the repeatable measurement script is `scripts/opening-benchmark.cjs`.

At the initial investigation stage, the existing suite passed all 81 tests, and syntax, manifest-resource, and permission checks passed. The extension was unchanged at that stage. The implementation above followed the user's approval.

These samples establish decision agreement for eight specific positions, not the frequency of this opening in real games, optimal play, unchanged win rate, or GPU behavior. They are generated legal opening sequences, not recorded online matches or full-game strength simulations.

## Why a board-only opening check would be unsafe

`WallzRules.normalize` and `stateKey` retain the current board, turn, variant, and remaining walls, but no move history. The bridge can access the online room's move count for game identity, but does not currently pass it into analysis.

For example, starting from `[4,76]`, the legal pawn sequence `13,67,4,76` is forward, forward, backward, backward. It returns to the exact initial board and state key after four turns. A check based only on empty walls and starting squares would wrongly reactivate an opening shortcut.

## Implementation constraints

Use a much shorter search only during the first three moves by each side, after verifying the uninterrupted forward opening from the actual start of this game. Continue generating legal moves and using the existing neural engine; any wall, sideways or backward move, unexpected position, missing or skipped observation, fourth pawn move, race variant, or pawn contact must use the ordinary normal/quick timing. Once the sequence deviates, disable the shortcut for the remainder of that game, even if the pawns later return to familiar squares. A new game resets eligibility.

The implementation shortens search only after validating the exact opening positions and history. An unsettled decision keeps the existing full budget. In particular, the second move by the starter has a forward model prior of about 0.44 with competitive wall alternatives; matching the measured choices is not a mathematical proof that forward is best.

Keep result fields, legal-move checks, cancellation, stale-position protection, opponent-turn preparation, and proof semantics intact. Opening choices must remain estimates rather than being labeled proven wins. Explicitly test deviations by either color, backward loops returning to the start, mid-game reloads, new-game resets, early walls at every opening turn, quick mode, and the fourth move boundary. Compare ordinary full-search results on those deviations before keeping a change.

The run used two serial implementation candidates and one verification sub-agent. No dependencies or paid judging services were added. Delegated model billing is unavailable from the host, so the dollar total is unverified. The verified implementation is retained locally; no PR or push was requested.

## Reproduce

Run `node scripts/opening-benchmark.cjs --output outputs/opening-speed/baseline.json` with Node 20+, Playwright, and desktop Chrome available. The script can use the desktop app's bundled Playwright without adding a project dependency. `PLAYWRIGHT_MODULE_DIR` can specify another installed package directory, `OPENING_BROWSER_PATH` can select a browser executable, and `OPENING_THREADS` can select the CPU thread count (default 1).

The script serves only the local extension assets on an ephemeral loopback port, warms the bundled model, and resets search caches for every case. It does not visit Wallz or play a live game. Progress goes to stderr and the complete JSON report goes to stdout and the optional output file.

The immutable script above makes untagged calls that retain ordinary timing. The local scratch adapter `.context/compound-engineering/ce-optimize/opening-speed/candidate-benchmark.cjs` invokes the same workload with verified opening metadata and records actual early exits. Run `node .context/compound-engineering/ce-optimize/opening-speed/candidate-benchmark.cjs --output outputs/opening-speed/candidate.json` to measure the guarded path.

Final raw evidence is in ignored `outputs/opening-speed/`: `variant-2-1.json`, `variant-2-2.json`, `variant-2-cpu-4.json`, and `variant-2-identity.json`. Runtime tree SHA-256: `6870831969d3a502a3595bb54e90168471cdc5d694d283949ada389bc84143ae`. Workflow logs are in ignored `.context/compound-engineering/ce-optimize/opening-speed/`. These ignored files remain on this machine; this report, harness, code, and tests are durable review material.

Reload the unpacked extension and refresh Wallz to use the change.
