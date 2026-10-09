# Research and design decision

Investigated 9 October 2026. This project implements a manually operated position adviser for computer practice and private friend games. Automated joining and move submission are outside the requested scope.

## Rules and site integration

Wallz uses a 9×9 grid. On each turn a player moves or spends one of ten two-segment walls. Walls cannot overlap, cross, or remove either player's path to the opposite edge. Adjacent pawns support straight jumps; a blocked landing or board edge permits an open lateral jump. These rules are implemented independently and covered by tests. [Wallz rules](https://www.wallz.gg/how-to-play)

An inspected private room exposed `source: friend-code` and `ranked: false`. The current board component receives pawn coordinates, placed walls, remaining inventory, turn, winner, `bottomPlayer`, and `controllable`. The SVG uses a 72-unit cell pitch and 60-unit tiles. Player one sees a 180-degree board rotation in classic mode; race mode uses a shared goal row. These observations came from the delivered page and public client assets, including `0la4n-np3uu.i.js` and `0w08j44k48jaa.js`. Asset names are evidence for this inspection, not hard-coded dependencies.

Read the committed React root: the fiber attached to a DOM element can point to an outdated alternate after a move. Copy a small whitelist of game data, validate it, and discard advice immediately when the position or game mode changes. React internals are not a stable API, so a future site change can require an adapter update.

## Delivery format

An extension can read page data and draw directly over the board with little setup. A desktop app would need a browser bridge or screen recognition plus window and scaling handling. Those additions do not improve the first adviser's core task.

Manifest V3 separates a small page-world reader from an isolated content-script interface. Search runs in the extension service worker, keeping the website's UI thread responsive. This is supported by Chrome's content-script architecture. [Chrome documentation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)

## Search strategy

Use shortest paths for evaluation and wall legality, then search adversarial replies with iterative-deepening alpha-beta. The evaluator considers both routes, immediate jump opportunities, wall reserves, and side to move. A transposition table reuses previously searched positions. Limited wall selection trades completeness for useful depth within the thinking budget.

MCTS is a credible alternative: published Quoridor research reports competitive results, but also reports oscillation in some self-play games. Its results do not establish a universally winning engine. Our choice of alpha-beta is an engineering starting point, not a finding that it dominates MCTS. [Respall, Brown and Aslam, 2018, author-uploaded paper](https://www.researchgate.net/publication/327679826_Monte_Carlo_Tree_Search_for_Quoridor), [independent MCTS implementation](https://github.com/minhprg/mcts_in_quoridor)

The initial unpruned engine reached roughly 2–3 plies under the tested budgets. Selecting promising walls increased this to roughly 4–5 in the opening on this machine. In eight local matches, switching starting sides, the updated engine beat a pawn-only shortest-route baseline 8–0 with 100 ms per move. This is a small smoke benchmark, not a strength rating. Hardware load changes time-limited outcomes. The raw measurements are in `benchmark.json`.

To compare engines properly next, add an MCTS implementation behind the same rules API and run paired matches with equal time budgets, varied legal openings, and reproducible seeds. Track tactical errors, repetitions, completed plies, latency, and wins. A neural self-play engine or endgame solver could follow evidence from those comparisons; neither is necessary to make the current adviser usable.

## Site scope

Advice is disabled for ranked games and public matchmaking. No protocol forging, move calls, or websocket interception is used. The private game is joined manually. These choices match the user's requested workflow and the site's ranked-engine restriction. [Wallz terms](https://www.wallz.gg/terms)
