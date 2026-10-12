const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const R = require('../extension/rules.js');
const E = require('../extension/engine.js');

const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const source = name => fs.readFileSync(require.resolve('../extension/' + name), 'utf8');

function openingRoom(starter = 0, ply = 0) {
  const turns = [0, 0];
  for (let i = 0; i < ply; i++) turns[(starter + i) % 2]++;
  return {
    matchId: 'fixture', code: 'fixture', moves: Array.from({ length: ply }, () => ({})),
    game: { pawns: { p1: { x: 4, y: turns[0] }, p2: { x: 4, y: 8 - turns[1] } },
      walls: [], wallsRemaining: { p1: 10, p2: 10 },
      turn: (starter + ply) % 2 === 0 ? 'p1' : 'p2', winner: null, variant: 'classic' }
  };
}

function bridgeHarness() {
  let board = null, failRead = false;
  const listeners = [], posted = [];
  const context = { window: { addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); }, postMessage: message => posted.push(message) }, location: { origin: 'https://www.wallz.gg' },
    document: { querySelector: () => { if (failRead) throw new Error('unreadable board'); return board; } }, setTimeout: () => 1, setInterval() {},
    MutationObserver: class { observe() {} disconnect() {} } };
  const code = source('bridge.js').replace('  watchBoard();publish();',
    '  globalThis.openingTest={trackOpening,snapshot,publish};watchBoard();publish();');
  vm.runInNewContext(code, context);
  return { ...context.openingTest, posted, failRead(value) { failRead = value; },
    message(data) { for (const fn of listeners) fn({ source: context.window, origin: context.location.origin, data }); },
    hide() { board = null; }, show(room, online = true) {
    board = {};
    const root = { memoizedProps: online ? { snapshot: room, onSendChat() {}, socketConnected: true } : {} };
    const fiber = { stateNode: board, return: root, memoizedProps: { state: room.game, controllable: true, bottomPlayer: 'p1' } };
    root.child = fiber; root.stateNode = { current: root }; board.__reactFiber$fixture = fiber;
  } };
}

function neuralHarness() {
  const context = { WallzRules: R, WallzEngine: E };
  vm.runInNewContext(source('neural.js').replace('root.WallzNeural=api;',
    'api.openingTest={openingMove,openingSettled,searchChoice};root.WallzNeural=api;'), context);
  return context.WallzNeural.openingTest;
}

function searchHarness({ stable = true, inferenceDelay = 10, failStartup = false, starter = 0, ply = 0 } = {}) {
  let clock = 0;
  const fallbacks = [];
  const state = { ...R.normalize(openingRoom(starter, ply).game), id: 'root' };
  const forward = { type: 'pawn', to: state.pawns[state.turn] + (state.turn === 0 ? 9 : -9) };
  const apply = (s, move) => ({ ...s, id: s.id + '/' + R.moveKey(move), turn: 1 - s.turn });
  const rules = {
    stateKey: s => s.id, moveKey: R.moveKey, apply, distances: () => [8, 8], path: () => [], goal: () => 8,
    pawnMoves: () => [forward], successors: s => (s.id === 'root' ? [forward, { type: 'wall', wall: 0 }, { type: 'wall', wall: 1 }] : [forward])
      .map(move => ({ move, state: apply(s, move) }))
  };
  const context = {
    WallzRules: rules,
    WallzEngine: { certify: () => null, proveThreat: () => null, analyse: (s, options) => {
      fallbacks.push(options); return { candidates: [{ move: forward, score: 0 }], nodes: 0 };
    } },
    WallzInference: { init: async () => { if (failStartup) throw new Error('model unavailable'); } },
    performance: { now: () => ++clock },
    setTimeout: fn => { clock++; if (!failStartup) fn(); return 1; }, clearTimeout() {}
  };
  vm.runInNewContext(source('neural.js'), context);
  const predictor = async () => {
    clock += inferenceDelay;
    const logits = new Float32Array(136);
    if (stable) logits[0] = 12;
    return { logits, value: 0 };
  };
  return { api: context.WallzNeural, state, predictor, fallbacks, time: () => clock };
}

test('third moves can qualify but every fourth move keeps the complete normal or quick budget', async () => {
  for (const starter of [0, 1]) for (const budgetMs of [2000, 3000]) {
    for (const ply of [4, 5]) {
      const h = searchHarness({ starter, ply });
      const result = await h.api.analyse(h.state, { budgetMs, maxBudgetMs: budgetMs, predictor: h.predictor, opening: { starter, ply } });
      assert.equal(result.openingFastPath, true, `starter=${starter} ply=${ply}`);
      assert.ok(result.elapsedMs < 750);
    }
    for (const ply of [6, 7]) {
      const h = searchHarness({ starter, ply });
      const result = await h.api.analyse(h.state, { budgetMs, maxBudgetMs: budgetMs, predictor: h.predictor, opening: { starter, ply } });
      assert.equal(result.openingFastPath, undefined, `starter=${starter} ply=${ply}`);
      assert.equal(result.searchBudgetMs, budgetMs);
      assert.ok(result.elapsedMs >= budgetMs - 50);
    }
  }
});

test('overlay forwards observed opening tokens and leaves untagged requests untagged', async () => {
  const code = source('overlay.js');
  const start = code.indexOf('  function analyse() {');
  const end = code.indexOf("\n  window.addEventListener('message'", start);
  assert.ok(start >= 0 && end > start);
  for (const opening of [undefined, { starter: 0, ply: 1 }, { starter: 1, ply: 2 }]) {
    const messages = [], timers = [];
    const context = {
      settingsReady: true, enabled: true, timer: null, requestId: 0,
      captured: { state: openingRoom().game, controllable: true, ...(opening ? { opening } : {}) },
      position: { winner: null }, $: () => ({ checked: false }),
      clearTimeout() {}, clearAdvice() {}, searchCounter() {}, status() {}, stopSearch() {},
      draw() {}, autoGG() {}, autoplay() {}, setTimeout: fn => { timers.push(fn); return fn; },
      chrome: { runtime: { sendMessage: async message => { messages.push(message); return { result: { nodes: 1 } }; } } }
    };
    vm.runInNewContext(code.slice(start, end), context);
    context.analyse(); await timers.shift()();
    assert.equal(messages[0].type, 'WALLZ_ANALYSE');
    assert.deepEqual(plain(messages[0].opening), opening);
    if (!opening) assert.equal(Object.hasOwn(messages[0], 'opening'), false);
  }
});

test('a tagged stable opening can stop early without forcing or proving its selected move', async () => {
  for (const [budgetMs, maxBudgetMs] of [[3000, 6000], [2000, 4000]]) {
    const h = searchHarness();
    const result = await h.api.analyse(h.state, { budgetMs, maxBudgetMs, predictor: h.predictor, opening: { starter: 0, ply: 0 } });
    assert.equal(result.engine, 'neural-puct');
    assert.equal(result.openingFastPath, true);
    assert.ok(result.elapsedMs >= 250 && result.elapsedMs < 1000, String(result.elapsedMs));
    assert.deepEqual(plain(result.candidates[0].move), { type: 'pawn', to: 13 });
    assert.equal(result.candidates[0].bound, 'estimate');
    assert.equal(result.provenWin, false);
    assert.equal(result.legalCount, 3);
  }
});

test('untagged, altered and uncertain openings retain their normal or quick search limits', async () => {
  for (const budgetMs of [2000, 3000]) for (const scenario of ['untagged', 'malformed', 'uncertain', 'deviation', 'slow']) {
    const h = searchHarness({ stable: scenario !== 'uncertain', inferenceDelay: scenario === 'slow' ? 200 : 10 });
    if (scenario === 'deviation') h.state.pawns[0] = 3;
    const opening = scenario === 'untagged' ? undefined : scenario === 'malformed' ? { starter: 0, ply: 6 } : { starter: 0, ply: 0 };
    const result = await h.api.analyse(h.state, { budgetMs, maxBudgetMs: budgetMs, predictor: h.predictor, opening });
    assert.equal(result.engine, 'neural-puct', scenario);
    assert.equal(result.openingFastPath, undefined, scenario);
    assert.equal(result.searchBudgetMs, budgetMs, scenario);
    assert.ok(result.elapsedMs >= budgetMs - 50, scenario + ': ' + result.elapsedMs);
  }
});

test('failed opening inference falls back using the original remaining normal or quick budget', async () => {
  for (const budgetMs of [2000, 3000]) {
    const h = searchHarness();
    const result = await h.api.analyse(h.state, { budgetMs, maxBudgetMs: budgetMs * 2, opening: { starter: 0, ply: 0 },
      predictor: async () => { throw new Error('inference failed'); } });
    assert.equal(result.engine, 'classical-fallback');
    assert.equal(result.openingFastPath, undefined);
    assert.match(result.modelError, /inference failed/);
    assert.ok(h.fallbacks.at(-1).budgetMs >= budgetMs - 100);
  }
});

test('failed opening model startup retains the original remaining budget', async () => {
  for (const budgetMs of [2000, 3000]) {
    const h = searchHarness({ failStartup: true });
    const result = await h.api.analyse(h.state, { budgetMs, maxBudgetMs: budgetMs * 2, opening: { starter: 0, ply: 0 } });
    assert.equal(result.engine, 'classical-fallback');
    assert.equal(result.openingFastPath, undefined);
    assert.match(result.modelError, /model unavailable/);
    assert.ok(h.fallbacks.at(-1).budgetMs >= budgetMs - 100);
  }
});

function observeThrough(bridge, starter, ply, id = 'game') {
  for (let i = 0; i <= ply; i++) {
    assert.deepEqual(plain(bridge.trackOpening(openingRoom(starter, i), id)), { starter, ply: i });
  }
}

test('real game tracking re-arms count-zero resets and rejects reset observations in midgame', () => {
  const bridge = bridgeHarness();
  bridge.show(openingRoom(0, 0)); const first = bridge.snapshot();
  assert.deepEqual(plain(first.opening), { starter: 0, ply: 0 });
  for (let ply = 1; ply <= 6; ply++) {
    bridge.show(openingRoom(0, ply)); const next = bridge.snapshot();
    assert.equal(next.gameId, first.gameId);
    assert.deepEqual(plain(next.opening), ply < 6 ? { starter: 0, ply } : undefined);
  }
  bridge.show(openingRoom(1, 0)); const reset = bridge.snapshot();
  assert.notEqual(reset.gameId, first.gameId);
  assert.deepEqual(plain(reset.opening), { starter: 1, ply: 0 });
  bridge.show(openingRoom(1, 3)); assert.equal(bridge.snapshot().opening, undefined);
  bridge.show(openingRoom(1, 2)); const midgame = bridge.snapshot();
  assert.notEqual(midgame.gameId, reset.gameId); assert.equal(midgame.opening, undefined);
});

test('unexpected board-read exceptions invalidate opening eligibility before recovery', () => {
  const bridge = bridgeHarness();
  bridge.show(openingRoom(0, 0)); assert.ok(bridge.snapshot().opening);
  bridge.failRead(true); bridge.publish();
  assert.equal(bridge.posted.at(-1).data.mode, 'unknown');
  bridge.failRead(false);
  assert.equal(bridge.snapshot().opening, undefined);
});

test('autoplay rejects a stale expected position when only opening eligibility changed', () => {
  const bridge = bridgeHarness();
  bridge.show(openingRoom(0, 0)); const expected = plain(bridge.snapshot());
  assert.ok(expected.opening);
  bridge.message({ channel: 'wallz-adviser-autoplay-v1', type: 'enable', enabled: true });
  bridge.trackOpening(null, null);
  const current = plain(bridge.snapshot());
  assert.deepEqual(current.state, expected.state); assert.equal(current.opening, undefined);
  bridge.message({ channel: 'wallz-adviser-autoplay-v1', type: 'play', id: 42, position: expected, move: { type: 'pawn', to: 13 } });
  const reply = bridge.posted.at(-1);
  assert.equal(reply.channel, 'wallz-adviser-autoplay-result-v1');
  assert.equal(reply.id, 42); assert.equal(reply.error, 'Position changed.');
});

test('missing game identity permanently disables the same game after valid or invalid history', () => {
  for (const deviation of [false, true]) {
    const bridge = bridgeHarness(); observeThrough(bridge, 0, 0);
    if (deviation) {
      const changed = openingRoom(0, 1); changed.game.pawns.p1.x = 5;
      assert.equal(bridge.trackOpening(changed, 'game'), undefined);
    }
    assert.equal(bridge.trackOpening(null, null), undefined);
    assert.equal(bridge.trackOpening(openingRoom(0, 0), 'game'), undefined);
    assert.equal(bridge.trackOpening(openingRoom(0, 1), 'game'), undefined);
    observeThrough(bridge, 1, 0, 'next-game');
  }
});

test('an unreadable published board disables the same game until a new identity appears', () => {
  const bridge = bridgeHarness();
  bridge.show(openingRoom(0, 0)); assert.ok(bridge.snapshot().opening);
  bridge.hide(); assert.equal(bridge.snapshot().state, undefined);
  bridge.show(openingRoom(0, 0)); assert.equal(bridge.snapshot().opening, undefined);
});

test('both starter colors receive tokens only through their first three forward moves', () => {
  for (const starter of [0, 1]) {
    const bridge = bridgeHarness();
    observeThrough(bridge, starter, 5);
    assert.equal(bridge.trackOpening(openingRoom(starter, 6), 'game'), undefined);
    assert.equal(bridge.trackOpening(openingRoom(starter, 0), 'game'), undefined);
  }
});

test('every legal early wall immediately disables opening tracking for the entire game', () => {
  let checked = 0;
  for (const starter of [0, 1]) for (let ply = 0; ply < 6; ply++) {
    const raw = openingRoom(starter, ply), state = R.normalize(raw.game);
    for (let wall = 0; wall < 128; wall++) {
      const move = { type: 'wall', wall };
      assert.doesNotThrow(() => R.apply(state, move));
      const bridge = bridgeHarness(); observeThrough(bridge, starter, ply);
      const changed = openingRoom(starter, ply + 1);
      changed.game.pawns = raw.game.pawns;
      changed.game.walls.push({ x: wall & 7, y: (wall & 63) >> 3, o: wall < 64 ? 'h' : 'v' });
      changed.game.wallsRemaining[state.turn === 0 ? 'p1' : 'p2']--;
      assert.equal(bridge.trackOpening(changed, 'game'), undefined, `starter=${starter} ply=${ply} wall=${wall}`);
      assert.equal(bridge.trackOpening(openingRoom(starter, 0), 'game'), undefined);
      checked++;
    }
  }
  assert.equal(checked, 1536);
});

test('sideways, backwards and return-to-start histories cannot regain opening eligibility', () => {
  for (const starter of [0, 1]) for (let ply = 0; ply < 6; ply++) {
    const before = openingRoom(starter, ply), state = R.normalize(before.game);
    const forward = state.pawns[state.turn] + (state.turn === 0 ? 9 : -9);
    for (const move of R.pawnMoves(state).filter(move => move.to !== forward)) {
      const bridge = bridgeHarness(); observeThrough(bridge, starter, ply);
      const changed = openingRoom(starter, ply + 1);
      changed.game.pawns = plain(before.game.pawns);
      changed.game.pawns[state.turn === 0 ? 'p1' : 'p2'] = { x: move.to % 9, y: Math.floor(move.to / 9) };
      assert.equal(bridge.trackOpening(changed, 'game'), undefined);
      assert.equal(bridge.trackOpening(openingRoom(starter, 0), 'game'), undefined);
      assert.equal(bridge.trackOpening(openingRoom(starter, 1), 'game'), undefined);
    }
  }
});

test('unchanged duplicate snapshots are accepted while same-count position changes latch disabled', () => {
  for (const starter of [0, 1]) for (let ply = 0; ply < 6; ply++) {
    const bridge = bridgeHarness(); observeThrough(bridge, starter, ply);
    assert.deepEqual(plain(bridge.trackOpening(openingRoom(starter, ply), 'game')), { starter, ply });
    const changed = openingRoom(starter, ply); changed.game.turn = changed.game.turn === 'p1' ? 'p2' : 'p1';
    assert.equal(bridge.trackOpening(changed, 'game'), undefined);
    assert.equal(bridge.trackOpening(openingRoom(starter, ply), 'game'), undefined);
  }
});

test('skipped, missing, malformed and decreasing move counts disable tracking', () => {
  for (const alter of [room => { room.moves = undefined; }, room => { room.moves = {}; },
    room => { room.moves = { length: 1 }; }, room => { room.moves = Array(3); },
    room => { room.moves = []; }]) {
    const bridge = bridgeHarness(); observeThrough(bridge, 0, 1);
    const changed = openingRoom(0, 2); alter(changed);
    assert.equal(bridge.trackOpening(changed, 'game'), undefined);
    assert.equal(bridge.trackOpening(openingRoom(0, 2), 'game'), undefined);
  }
});

test('joining a game after its initial snapshot never enables an opening token', () => {
  for (let ply = 1; ply < 7; ply++) {
    const bridge = bridgeHarness();
    assert.equal(bridge.trackOpening(openingRoom(0, ply), 'game'), undefined);
    assert.equal(bridge.trackOpening(openingRoom(0, 0), 'game'), undefined);
  }
});

test('race, ended games, spent hands and malformed boards disable opening tracking', () => {
  const changes = [game => { game.variant = 'race'; }, game => { game.winner = 'p1'; },
    game => { game.wallsRemaining.p1 = 9; }, game => { game.wallsRemaining.p2 = 9; },
    game => { game.pawns.p1.x = 3; }, game => { game.turn = 'invalid'; },
    game => { game.walls = undefined; }, game => { game.pawns = undefined; },
    game => { game.wallsRemaining.p1 = '10'; }];
  for (const change of changes) {
    const bridge = bridgeHarness(); observeThrough(bridge, 0, 0);
    const room = openingRoom(0, 1); change(room.game);
    assert.equal(bridge.trackOpening(room, 'game'), undefined);
    assert.equal(bridge.trackOpening(openingRoom(0, 1), 'game'), undefined);
  }
});

test('only a new game identity permits tracking to restart after a deviation', () => {
  const bridge = bridgeHarness(); observeThrough(bridge, 0, 0, 'first');
  const room = openingRoom(0, 1); room.game.pawns.p1.x = 5;
  assert.equal(bridge.trackOpening(room, 'first'), undefined);
  assert.equal(bridge.trackOpening(openingRoom(0, 0), 'first'), undefined);
  observeThrough(bridge, 1, 3, 'second');
  assert.equal(bridge.trackOpening(openingRoom(0, 1), 'third'), undefined);
  assert.equal(bridge.trackOpening(openingRoom(0, 0), 'third'), undefined);
});

test('published snapshots attach opening tokens only for observed online openings', () => {
  const bridge = bridgeHarness();
  bridge.show(openingRoom(0, 0));
  assert.deepEqual(plain(bridge.snapshot().opening), { starter: 0, ply: 0 });
  bridge.show(openingRoom(0, 1));
  assert.deepEqual(plain(bridge.snapshot().opening), { starter: 0, ply: 1 });
  const changed = openingRoom(0, 2); changed.game.pawns.p2.x = 3;
  bridge.show(changed); assert.equal(bridge.snapshot().opening, undefined);
  bridge.show(openingRoom(0, 2)); assert.equal(bridge.snapshot().opening, undefined);
  const local = bridgeHarness(); local.show(openingRoom(0, 0), false);
  assert.equal(local.snapshot().opening, undefined);
});

test('neural opening eligibility validates exact state and token for both starter colors', () => {
  const { openingMove } = neuralHarness();
  for (const starter of [0, 1]) for (let ply = 0; ply < 6; ply++) {
    const state = R.normalize(openingRoom(starter, ply).game), token = { starter, ply };
    const expected = { type: 'pawn', to: state.pawns[state.turn] + (state.turn === 0 ? 9 : -9) };
    assert.deepEqual(plain(openingMove(state, token)), expected);
    for (const move of R.pawnMoves(state).filter(move => move.to !== expected.to)) {
      assert.equal(openingMove(R.apply(state, move), { starter, ply: ply + 1 }), null);
    }
    for (let wall = 0; wall < 128; wall++) {
      assert.equal(openingMove(R.apply(state, { type: 'wall', wall }), { starter, ply: ply + 1 }), null);
    }
    for (const change of [s => { s.turn = 1 - s.turn; }, s => { s.variant = 'race'; },
      s => { s.winner = s.turn; }, s => { s.remaining[0] = 9; }, s => { s.remaining[1] = 9; },
      s => { s.pawns[0]++; }, s => { s.pawns[1]--; }]) {
      const changed = plain(state); change(changed); assert.equal(openingMove(changed, token), null);
    }
  }
});

test('untagged, malformed and expired opening tokens never qualify for shortened thinking', () => {
  const { openingMove } = neuralHarness(), state = R.normalize(openingRoom().game);
  for (const token of [undefined, null, {}, 0, [], { starter: -1, ply: 0 }, { starter: 2, ply: 0 },
    { starter: '0', ply: 0 }, { starter: 0, ply: '0' }, { starter: 0, ply: -1 },
    { starter: 0, ply: 6 }, { starter: 0, ply: 0.5 }, { starter: 0, ply: NaN }, { starter: false, ply: 0 }]) {
    assert.equal(openingMove(state, token), null);
  }
});

function settledFixture() {
  const move = { type: 'pawn', to: 13 };
  const forward = { move, visits: 40, total: 0, prior: .8, child: { solved: null } };
  const wall = { move: { type: 'wall', wall: 0 }, visits: 8, total: 0, prior: .2, child: { solved: null } };
  const node = { edges: [forward, wall], value: 0 };
  const samples = Array.from({ length: 3 }, () => ({ move: 'p13', value: 0, visits: 40, challengerValue: 0, challengerVisits: 8 }));
  return { node, move, samples, forward, wall };
}

test('opening early exit checks the current value against historical stable samples', () => {
  const { openingSettled } = neuralHarness(), f = settledFixture();
  f.samples.forEach(sample => { sample.value = .2; });
  f.forward.total = f.forward.visits * .2;
  assert.equal(openingSettled(f.node, f.move, f.samples), true);
  f.forward.total = f.forward.visits * .29;
  assert.equal(openingSettled(f.node, f.move, f.samples), false);
});

test('non-finite model confidence and sampled values cannot qualify for an early exit', () => {
  const { openingSettled } = neuralHarness();
  for (const number of [NaN, Infinity, -Infinity]) {
    for (const change of [f => { f.forward.prior = number; }, f => { f.forward.total = number; },
      f => { f.samples[0].value = number; }, f => { f.samples.forEach(sample => { sample.value = number; }); }]) {
      const f = settledFixture(); change(f);
      assert.equal(openingSettled(f.node, f.move, f.samples), false);
    }
  }
});

test('only a stable dominant forward search can authorize an opening early exit', () => {
  const { openingSettled } = neuralHarness(), f = settledFixture();
  assert.equal(openingSettled(f.node, f.move, f.samples), true);
  f.samples[0].value = .03;
  assert.equal(openingSettled(f.node, f.move, f.samples), true);
  for (const change of [f => { f.samples.pop(); }, f => { f.samples[0].move = 'w0'; },
    f => { f.samples[0].value = .08; }, f => { f.forward.visits = 15; },
    f => { f.forward.prior = .599; }, f => { f.forward.child.solved = 1; },
    f => { f.forward.child.solved = -1; }, f => { f.wall.visits = 11; },
    f => { f.wall.child.solved = -1; }, f => { f.wall.total = f.wall.visits * .021; },
    f => { f.node.edges.shift(); }]) {
    const changed = settledFixture(); change(changed);
    assert.equal(openingSettled(changed.node, changed.move, changed.samples), false);
  }
});

test('dominant opening confidence still respects uncertainty from a competitive challenger', () => {
  const { openingSettled } = neuralHarness(), f = settledFixture();
  f.samples[2].challengerVisits = 32;
  f.wall.visits = 32;
  assert.equal(openingSettled(f.node, f.move, f.samples), false);
});

test('compute transport preserves opening token and existing normal and quick budgets', async () => {
  for (const [budgetMs, maxBudgetMs] of [[3000, 6000], [2000, 4000]]) {
    let sent, options;
    const token = { starter: 1, ply: 3 };
    const bridge = { crypto: { randomUUID: () => 'fixture' }, chrome: { runtime: {
      getURL: p => p, getContexts: async () => [{}], onMessage: { addListener() {} },
      sendMessage: async message => { sent = message; return { result: { nodes: 1 } }; }
    } } };
    vm.runInNewContext(source('compute.js'), bridge);
    await bridge.WallzCompute.analyse({}, { budgetMs, maxBudgetMs, opening: token });
    assert.deepEqual(plain(sent.opening), token);
    assert.equal(sent.budgetMs, budgetMs); assert.equal(sent.maxBudgetMs, maxBudgetMs);
    const worker = { URL, location: { href: 'https://fixture/compute-worker.js?threads=1' },
      importScripts() {}, self: {}, postMessage() {},
      WallzNeural: { analyse: async (s, o) => { options = o; return { nodes: 1 }; } } };
    vm.runInNewContext(source('compute-worker.js'), worker);
    worker.self.onmessage({ data: sent }); await new Promise(setImmediate);
    assert.deepEqual(plain(options.opening), token);
    assert.equal(options.budgetMs, budgetMs); assert.equal(options.maxBudgetMs, maxBudgetMs);
  }
});

test('background forwards opening eligibility without reducing budgets and keeps full classical fallback', async () => {
  for (const quickMode of [false, true]) {
    let receive, options, fallbackOptions; const timers = [], responses = [];
    const context = { URL, importScripts() {}, WallzRules: R,
      WallzEngine: { analyse: (s, o) => { fallbackOptions = o; return { candidates: [] }; } },
      WallzCompute: { init: async () => {}, analyse: async (s, o) => { options = o; throw new Error('model unavailable'); } },
      setTimeout: fn => { timers.push(fn); return fn; }, clearTimeout() {},
      chrome: { runtime: { onMessage: { addListener: fn => { receive = fn; } } },
        action: { onClicked: { addListener() {} } }, tabs: { sendMessage: async () => {} } } };
    vm.runInNewContext(source('background.js'), context);
    const opening = { starter: 0, ply: 0 };
    receive({ type: 'WALLZ_ANALYSE', id: 1, state: openingRoom().game, opening, quickMode },
      { url: 'https://www.wallz.gg/', tab: { id: 1 } }, response => responses.push(response));
    timers.shift()(); await new Promise(setImmediate);
    assert.deepEqual(plain(options.opening), opening);
    assert.equal(options.budgetMs, quickMode ? 2000 : 3000);
    assert.equal(options.maxBudgetMs, quickMode ? 4000 : 6000);
    assert.equal(fallbackOptions.budgetMs, quickMode ? 2000 : 3000);
    assert.equal(responses[0].result.engine, 'classical-fallback');
    assert.equal(responses[0].result.openingFastPath, undefined);
  }
});
