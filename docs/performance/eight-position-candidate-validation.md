# Eight-position Apple Silicon candidate: recorded validation

This candidate performs about **39% more actual search work** on the measured Mac.
Playing strength remains **unproven**: only **four games finished, with three
candidate wins and one loss** under the requested normal timing rules. The
original should remain the baseline; these results do not establish non-regression
or justify replacing it on strength grounds. No further games were run for this
publication step.

## Candidate and baseline

The candidate is the frozen `always-eight` runtime tested locally, with optional
eight-position ONNX inference through WebGPU/Metal. The runtime selects eight
only after hash, numerical-parity and speed checks; existing four-position and CPU
fallbacks remain available. Learned weights are unchanged. Larger simultaneous
search batches can still change decisions, so numerical agreement alone does not
establish playing strength.

The original extracted 0.8.1 extension is preserved separately in
`work/apple-silicon/baseline`, with every extension file hash-verified. The local
source archive had no Git history; its preservation commit is an archive baseline,
not a claim about the private repository's main commit. Remote main must remain
unchanged. The unbenchmarked adaptive four/eight implementation and its development
tools are preserved separately under `work/apple-silicon/` and excluded from this
candidate commit.

After Git authentication, the archived original source tree was verified identical
to GitHub main at `9d1ae5f40f56374395fbf6d521b222ebb66c56e1`. The candidate commit
is based on that actual repository commit; publication changes only the separate
`apple-silicon/eight-position-candidate` branch.

Model SHA-256 identifiers:

| Graph | SHA-256 |
| --- | --- |
| Original scalar | `7652c5209f82aad039e53f49ced29819f8b3b29c35a4df367b4ccd891bb5a4cd` |
| Original four-position | `41472e3efe0573a90a2855727d6292bb4742bfebd140709619fd4617d304a611` |
| Candidate eight-position | `3c17211ebbd207911a0b5be29da28f8226186591adf67fb4e697d0642ac0dee2` |

## Recorded speed measurements

Hardware: Apple M5 Pro, macOS arm64; Brave Chromium `155.0.8059.80`, real hardware
WebGPU through Apple Metal-3. Six order-alternated samples used 80 measured
inference rounds per request width and four fresh-cache search fixtures per
sample, each with a fixed 1,000 ms search budget. Initialization was outside the
search budget. Each complete runtime used its own thread calibration.

| Measurement | Candidate versus original |
| --- | --- |
| Actual search visit throughput | Median **1.39048×**, approximately **39% more search work**; sample range 1.38498–1.39518× |
| Full eight-position model throughput | Median **1.80430×**, approximately 80% higher throughput |
| Small scalar/four-position inference requests | Approximately **0.91× throughput**, or roughly 10% longer, from padding small requests to eight |
| Initialization | Median original 953 ms, candidate 1,159.5 ms, about 0.2 seconds longer |

The 1.80× number describes full-batch model execution; the 1.39× number measures
actual search. Neither means every move finishes sooner: equal-budget search
uses the extra speed to explore more positions. Sample ranges describe this run,
not population confidence intervals. CPU-only diagnostics were approximately
unchanged (search median 0.987× in two samples).

Per sample, 96 positions were checked against an independent CPU-only baseline.
The two GPU runtimes agreed exactly; maximum CPU/GPU absolute value error was
0.00002560 and policy-logit error 0.0001006, within the 0.002 tolerance.

The tested candidate passed **153 unit tests** plus syntax and model/runtime
integrity checks. These checks do not measure playing strength. The adaptive
four-for-small/eight-for-large prototype has no completed actual GPU search
benchmark, so there is no evidence yet that it outperforms this candidate.

## Interrupted normal-budget match series

Both bots received **3,000 ms per move**, extending with the existing half-second
timing rules up to **6,000 ms**, plus the same **2,000 ms of opponent-turn
preparation**. Games were offline and sequential. Each starting position was
played with sides swapped.

| Starting position | Candidate wins | Candidate losses |
| --- | ---: | ---: |
| Opening, both sides | 2 | 0 |
| Seed 211, both sides | 1 | 1 |
| **Completed total** | **3** | **1** |

Of the requested minimum 20 games, only four completed before the user stopped
the run. A fifth game was interrupted after 18 recorded plies. There were zero
completed games adjudicated unfinished by the move/repetition limits; the one
interrupted game has no result. Unstarted slots are not games played.

| Timing in the four completed games | Original | Candidate |
| --- | ---: | ---: |
| Foreground moves | 121 | 122 |
| Maximum thinking time | 5,970.98 ms | 5,972.06 ms |
| Thinking over selected allowance or 6,000 ms hard maximum | 0 | 0 |
| Preparation calls | 122 | 121 |
| Preparation calls with any positive excess over 2,000 ms | 103 | 105 |
| Maximum preparation time | 2,005.19 ms | 2,009.55 ms |
| Preparation excess over 25 ms | 0 | 0 |

There were **zero bot/model/runtime errors before cancellation**. Stopping the
browser produced expected browser-closed errors; these are retained separately
in the local shutdown artifacts and excluded from match outcomes. Preparation
overruns above include every positive scheduling excess, up to 9.55 ms.

Four games across two starting positions are too few to demonstrate stronger
play or rule out a strength regression. A conservative paired 95% Hoeffding
interval spans 0–100%; the five-percentage-point noninferiority criterion is not
established. More varied, side-swapped games would be needed to support replacing
the original, but none are requested in this publication step.

## Evidence and reproduction

Generated evidence remains local and excluded from Git:

- `outputs/apple-silicon/benchmark.json`: completed controlled speed run.
- `outputs/normal-budget/always-eight-vs-original.json` and `.ndjson`: interrupted
  normal-budget series and per-ply journal.
- `outputs/normal-budget/shutdown-artifacts.json`: cancellation artifacts.
- `work/apple-silicon/always-eight/snapshot.json` and
  `work/apple-silicon/baseline/snapshot.json`: frozen extension hashes.

This Markdown note records the results without committing generated reports.
See [comparison procedures](apple-silicon.md) for the included fixed-budget
benchmark tools; their fixed-budget matches are distinct from the interrupted
normal-budget experiment reported above.
