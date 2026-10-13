# Wallz Adviser: Wallz.gg Bot and Chrome Extension

Wallz Adviser is a local **Wallz bot and Chrome extension for [wallz.gg](https://www.wallz.gg/)**. Get move and wall suggestions directly on the board, a faint path to the goal, and optional autoplay. Neural evaluation and lookahead search run on your computer, with GPU acceleration when available.

**Chrome 116+ · Windows / macOS · Local CPU / GPU analysis · MIT license**

**[Download ZIP](https://github.com/slimfeet674/wallz-adviser/archive/refs/heads/main.zip)** · [Installation](#install) · [Report a bug](https://github.com/slimfeet674/wallz-adviser/issues/new/choose) · [Contribute](CONTRIBUTING.md)

## Install

1. [Download the project ZIP](https://github.com/slimfeet674/wallz-adviser/archive/refs/heads/main.zip) and extract it.
2. Open **Chrome** and go to `chrome://extensions`.
3. Turn on **Developer mode**, then click **Load unpacked**.
4. Select the **extension** folder inside the extracted project. This is the folder containing `manifest.json`.
5. Open or refresh [wallz.gg](https://www.wallz.gg/) and start a game. Suggestions appear directly on the board.

Keep the extracted folder where it is after installing. You don't need Node, Python, an API key, or a build step.

## Browsers

Use an up-to-date **desktop Google Chrome** on Windows or macOS. The extension has worked on Windows and has been confirmed working on a Mac. Its manifest requires Chrome 116 or newer.

The extension activates on `wallz.gg` and `www.wallz.gg`.

Brave and Edge use Chromium and may also work, but haven't been separately verified. Use their extensions page to load the same folder. **Safari, Firefox, and mobile browsers aren't supported by this package.**

GPU acceleration uses WebGPU when available. The extension falls back to CPU processing and automatically compares available configurations to choose a faster setup.

## Use

The highlighted square or wall is the suggested next action. The faint line shows a route toward the goal.

Open the gear in the bottom right to pause analysis or enable **Autoplay best move**. You join games yourself; autoplay plays suggested actions once you're in a game.

**Quick mode** starts with 2 seconds of thinking and adds 0.5-second steps when the decision is unsettled, up to 4 seconds total. With quick mode off, the normal timing remains 3 seconds, extending up to 6 seconds. Autoplay, Auto GG, quick mode, and pause settings are saved locally by the extension across page refreshes and browser restarts.

When the adviser observes the game from the start and both players only move straight forward, it can finish thinking early during each player's first three moves (six total turns) if its search settles clearly on forward. Any wall, sideways or backward move, uncertain opening history, or unsettled decision uses the usual thinking time. After the opening ends or deviates, the rest of that game uses the usual timing.

The counter beside the gear shows search work: **explored** while choosing a move and **prepared** while thinking ahead during the opponent's turn. It isn't a count of unique board positions or moves played. After a neural search, hover over **explored** to see how many prepared evaluations it reused and how many new model evaluations it needed.

To update, download a fresh copy, replace the extension files, click **Reload** on the extensions page, and refresh Wallz.

## How it works

The extension reads the current board, checks legal moves and walls, and looks ahead at possible replies. A pretrained neural model helps evaluate positions and guide the search. During the opponent's turn it caches model evaluations for possible replies and likely continuations. When your turn begins, matching evaluations are reused within the normal thinking budget. See the [preparation audit](docs/performance/preparation-reuse.md) for the runtime path, measurements, and limits.

The model is bundled with the extension. Analysis runs locally, without sending positions to an analysis server. There is no extension telemetry.

Suggestions are estimates, not guaranteed wins. Wallz updates can change how the board is read; if the extension stops recognizing it, the reader may need an update.

## Common questions

**Is this the bot for Walls.gg?**

If you searched for a "Walls.gg bot" or "Walls bot," the game this extension supports is **Wallz**, spelled with a **z**, at `wallz.gg`.

**Can the Wallz bot play automatically?**

Yes. Enable **Autoplay best move** in the gear menu. You still open and join games yourself.

## License and credits

Original project code is available under the [MIT license](LICENSE). The bundled model and inference runtime have their own MIT notices. See [credits](CREDITS.md) for their sources and details.

This is an independent project and isn't affiliated with Wallz.

## Development

Node 20 or newer is needed only for development checks:

```sh
npm test
npm run check
```

Browser-check scripts additionally require Playwright and an installed Chromium browser.

## Help and contributions

Found a problem or have an idea? [Open an issue](https://github.com/slimfeet674/wallz-adviser/issues/new/choose). Include your browser, operating system, and steps to reproduce a bug. Pull requests are welcome; see the [contribution guide](CONTRIBUTING.md).

If Wallz Adviser is useful to you, consider [starring the repository](https://github.com/slimfeet674/wallz-adviser).
