# Verification record

Verified on 9 October 2026 with bundled Node and an isolated Chromium test browser.

- **18 unit tests passed:** pawn jumps, walls and path legality, tactical wins and defence, race goals, input validation, immutability, and per-tab search request handling.
- **Syntax and manifest checks passed:** all extension resources exist; no broad browser permissions were added.
- **10 live-browser checks passed:** installed Manifest V3 service worker, computer practice, three recommendations, hover selection without a move, pause/resume, committed pawn and wall updates, mobile overflow, private friend room, second-player orientation, and clearing advice at game end. See `browser-smoke.json`.
- **8 deterministic browser checks passed:** both terminal-score signs, stale result rejection, ranked-mode transition, invalid positions, pausing in-flight results, worker errors, and excluding ranked/public positions from the reader. See `browser-fixtures.json`.
- **Code review completed:** `ce-code-review`, run `review-20261009`, full local review. Verdict: Ready to merge; no actionable findings remain. The complete receipt is `review.json`.

Review prompted fixes to losing-line labels and waiting-search coalescing, plus stronger hover and delayed-response checks. A separate native worker-message reproduction confirmed that a burst received during a synchronous search runs only the active request and the latest waiting request; intermediate requests are superseded.

The running search still finishes before newer messages are processed. New advice can wait for its remaining thinking budget plus the next search. Real Deep-search latency under rapid changes has not been separately measured in Chromium. Live checks cover computer practice and private rooms; hot-seat turn switching and Edge have not been separately tested.

The reader depends on Wallz's React metadata and can need updates after site changes. Deeper wall search is selective and can miss plans. The 8–0 result against a pawn-only baseline is a small sanity benchmark, not a rating or a guarantee of winning.

Project creation and development in Downloads are complete. Moving the chat into that folder remains a manual Codex sidebar action.
