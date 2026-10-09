# Wallz Adviser

A local Chrome/Edge extension that reads your current Wallz board and overlays recommended pawn moves and walls. Join the game yourself, then use the suggestions. The extension never submits a move or joins a room.

## Install

1. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select:

   `C:\Users\delhu\Downloads\wallz-adviser\extension`

4. Refresh your Wallz tab. Start **Play Computer**, a private **Play a Friend** game, or hot seat.
5. On your turn, look for the green number **1** on the board. Blue **2** and amber **3** mark alternatives. Hover or focus a suggestion in the panel to highlight its route.

The `extension` directory contains the manifest. Do not select the parent project directory. Installation follows [Chrome's unpacked-extension instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Use

- **Quick / Standard / Deep** selects approximately 0.35, 1.2, or 3.5 seconds of thinking.
- **Pause** clears suggestions and stops analysis. **Resume** starts it again.
- **−** minimises the panel. The small adviser button restores it. The extension toolbar button also toggles the panel.
- A numbered wall is a preview: click the real board groove or drag a wall using Wallz's usual controls to place it yourself.
- Wall coordinates refer to the square at the anchor of the two-segment wall. Read the colour highlight for the exact placement.
- Route lengths count geometric steps through walls; pawn encounters and jumps can change actual turn counts.

Private play is intended for your own test opponent or participants who agree to assistance. Ranked and public matchmaking advice are disabled. [Wallz's terms](https://www.wallz.gg/terms) prohibit external engines in ranked play.

## How it works

The page reader copies only board state and game-mode metadata from the committed React tree. A Manifest V3 service worker runs iterative-deepening negamax with alpha-beta pruning, a transposition table, legal-move generation, and shortest-path evaluation. The overlay is separate from the game's SVG and passes mouse input through.

All legal first moves receive an initial evaluation. Deeper search keeps every pawn move and up to 24 promising first walls; later nodes examine walls intersecting a shortest route and keep up to 12. This improves lookahead but can miss long-term wall setups. Results are estimates. The adviser is not a solved or unbeatable Quoridor engine, and its scores are not win probabilities or Elo estimates.

No server, API key, account access, analytics, broad browser permissions, or remote model is required. The extension makes no network requests. It runs only on `wallz.gg` and `www.wallz.gg`. Chrome 111+ is required; Chromium was used for browser verification. Edge compatibility follows its Chromium extension support and has not been separately tested.

## Development

Node 20+ is needed for developer checks, but not for using the extension. No npm dependencies are required for unit tests or benchmarks.

```powershell
node --test tests/*.test.cjs
node scripts/check.cjs
node scripts/benchmark.cjs
```

`scripts/browser-smoke.cjs` requires Playwright. Set `WALLZ_PLAYWRIGHT` to its module path and optionally `WALLZ_BROWSER_EXECUTABLE` to a Chromium test executable. The test creates a practice game and a private room between two test browser sessions, then resigns the room. It blocks third-party ad requests only inside its test browser.

`scripts/browser-fixtures.cjs` uses the same Playwright settings and runs isolated deterministic checks of the actual overlay and reader. It verifies delayed-result rejection, pause, mode gates, invalid positions, runtime failures, and positive/negative terminal labels. No live room is used by these fixtures.

After changing extension files, reload the extension on the extensions page **and refresh Wallz**. A site update may change React or board metadata; an unrecognised board displays a reader error instead of stale advice.

If the board or thinking time changes during a search, its result is discarded. The running search finishes, and waiting requests are combined so only the latest position for each tab is searched. New advice can therefore wait for the remainder of the previous thinking budget.

See [research notes](docs/research.md), [measured benchmark output](docs/benchmark.json), and [verification and review](docs/validation.md). Temporary profiles and the test browser are under ignored `work/`.
