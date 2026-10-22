'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { getGameState, RegionIndex, Scope, History } = require('../packages/core/index.js');
const {
  TerritorialControlModel,
  ControlStroke,
  decodeControlChunk,
  encodeControlChunk,
  controlChunkPixels,
} = require('../extensions/territorial-control-model.js');
function fixture(t, rows = ['1110111222', '1110111222', '1110111222']) {
  const width = rows[0].length,
    pixels = [...rows.join('')].map(Number),
    regions = [];
  for (const id of new Set(pixels.filter(Boolean))) {
    const positions = pixels.flatMap((p, i) => (p === id ? [i] : []));
    const xs = positions.map((p) => p % width),
      ys = positions.map((p) => Math.floor(p / width));
    regions.push({
      id,
      area: positions.length,
      bbox: [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs) - Math.min(...xs) + 1,
        Math.max(...ys) - Math.min(...ys) + 1,
      ],
      anchor: [xs[0], ys[0]],
    });
  }
  const index = new RegionIndex({ width, height: rows.length, regions, pixels });
  const state = getGameState();
  state.load(
    {
      schemaVersion: 2,
      map: {
        id: 'control-map',
        original: { dataURL: 'data:image/png;base64,AAAA', width, height: rows.length },
        indexImage: 'data:image/png;base64,AAAA',
      },
      meta: {
        nations: {
          items: {
            a: { id: 'a', name: 'A', color: '#ffcc00' },
            b: { id: 'b', name: 'B', color: '#0066ff' },
            c: { id: 'c', name: 'C', color: '#44aa33' },
          },
          owners: { 1: 'a', 2: 'c' },
          names: { 1: 'Original' },
        },
        tiles: {
          1: {
            entries: {
              factory: {
                id: 'factory',
                source: 'resources',
                kind: 'production',
                stats: { output: 10 },
              },
            },
          },
        },
        regions: { items: { home: { name: 'Home' } }, assignments: { 1: 'home' } },
      },
    },
    index,
  );
  const scope = new Scope(),
    model = new TerritorialControlModel(state);
  model.registerActions(scope.signal);
  t.after(() => scope.dispose());
  const at = (x, y) => {
    const key = Math.floor(x / 64) + ',' + Math.floor(y / 64);
    return decodeControlChunk(model.chunks[key])[(y % 64) * 64 + (x % 64)];
  };
  return { state, model, index, at, scope };
}
test('a one-pixel stroke changes control only and is one reversible history action', (t) => {
  const { state, model, index, at, scope } = fixture(t),
    before = structuredClone(state.meta);
  const stroke = model.begin('b', 0);
  stroke.move(1, 1);
  assert.equal(at(1, 1), null, 'preview must not mutate game state');
  model.commit(stroke);
  assert.equal(at(1, 1), 'b');
  assert.equal(at(2, 1), null);
  assert.deepEqual(state.meta.nations, before.nations);
  assert.deepEqual(state.meta.tiles, before.tiles);
  assert.deepEqual(state.meta.regions, before.regions);
  assert.equal(state.regionIndex, index);
  assert.equal(state.history.commits.length, 1);
  assert.equal(state.history.actions[0].type, 'territorial-control.stroke');
  state.history.undo();
  assert.equal(at(1, 1), null);
  state.history.redo();
  assert.equal(at(1, 1), 'b');
  const project = JSON.parse(JSON.stringify(state.toJSON()));
  scope.dispose();
  state.load(project, index);
  assert.equal(at(1, 1), 'b');
  state.history.undo();
  assert.equal(at(1, 1), null);
});
test('interpolated strokes have no mouse-event gaps and never color water or legal borders', (t) => {
  const { model, at } = fixture(t);
  const stroke = model.begin('b', 0);
  stroke.move(-5, 1);
  stroke.move(25, 1);
  model.commit(stroke);
  for (let x = 0; x < 10; x++) assert.equal(at(x, 1), x === 3 ? null : 'b');
  assert.equal(at(0, 0), null);
  assert.equal(at(9, 2), null);
});
test('circle clipping and chunk edges are exact, including the bottom and right map edges', (t) => {
  const { model, at } = fixture(t, Array(66).fill('1'.repeat(66)));
  const stroke = model.begin('b', 2);
  stroke.move(64, 64);
  model.commit(stroke);
  assert.equal(at(64, 64), 'b');
  assert.equal(at(63, 63), 'b');
  assert.equal(at(62, 62), null);
  assert.equal(at(65, 65), 'b');
  assert.equal(at(62, 64), 'b');
  assert.equal(Object.keys(model.chunks).length, 4);
});
test('painting the legal owner and the eraser remove overrides; unchanged paint creates no commit', (t) => {
  const { state, model, at } = fixture(t);
  const empty = model.begin('a', 0);
  empty.move(1, 1);
  model.commit(empty);
  assert.equal(state.history.commits.length, 0);
  let stroke = model.begin('b', 0);
  stroke.move(1, 1);
  model.commit(stroke);
  stroke = model.begin('a', 0);
  stroke.move(1, 1);
  model.commit(stroke);
  assert.equal(at(1, 1), null);
  assert.deepEqual(Object.keys(model.chunks), []);
  state.history.undo();
  assert.equal(at(1, 1), 'b');
  stroke = model.begin(null, 0);
  stroke.move(1, 1);
  model.commit(stroke);
  assert.equal(at(1, 1), null);
});
test('stale gestures and invalid raster payloads are rejected atomically', (t) => {
  const { state, model } = fixture(t);
  const stroke = model.begin('b', 0);
  stroke.move(1, 1);
  state.updateMeta(['note'], () => ({ value: 1 }));
  assert.throws(() => model.commit(stroke), /изменилась/);
  const before = state.history.toJSON();
  for (const payload of [
    { nationId: 'missing', chunks: [] },
    { nationId: 'constructor', chunks: [] },
    { nationId: 'b', chunks: [{ key: '0,0', runs: [[3, 1]] }] },
    { nationId: 'b', chunks: [{ key: '0,0', runs: [[4095, 2]] }] },
    { nationId: 'b', chunks: [{ key: '999,0', runs: [[0, 1]] }] },
    {
      nationId: 'b',
      chunks: [
        {
          key: '0,0',
          runs: [
            [2, 1],
            [1, 1],
          ],
        },
      ],
    },
  ])
    assert.throws(() => state.dispatch('territorial-control.stroke', payload));
  assert.deepEqual(state.history.toJSON(), before);
  assert.throws(() => model.begin('b', -1));
  assert.throws(() => model.begin('b', 65));
});
test('RLE is compact and rejects overlaps; raster output clips holes and deleted nations', (t) => {
  const { index, state } = fixture(t),
    values = Array(4096).fill(null);
  for (let x = 0; x < 10; x++) values[x] = 'b';
  const runs = encodeControlChunk(values);
  assert.deepEqual(runs, [[0, 10, 'b']]);
  assert.deepEqual(decodeControlChunk(runs), values);
  assert.throws(() =>
    decodeControlChunk([
      [0, 2, 'b'],
      [1, 2, 'b'],
    ]),
  );
  const rgba = controlChunkPixels(index, '0,0', values, state.meta.nations);
  assert.deepEqual([...rgba.slice(0, 4)], [0, 102, 255, 255]);
  assert.equal(rgba[3 * 4 + 3], 0);
  assert.equal(rgba[10 * 4 + 3], 0);
  const missing = controlChunkPixels(index, '0,0', values, { items: {}, owners: {} });
  assert.equal(missing.some(Boolean), false);
});
test('control survives branch exchange and merging without an installed editing extension', (t) => {
  const { state, model, at, scope } = fixture(t);
  state.history.createBranch('front');
  state.history.checkout('front');
  const stroke = model.begin('b', 0);
  stroke.move(1, 1);
  model.commit(stroke);
  const bundle = state.history.exportBranch();
  state.history.checkout('main');
  assert.equal(at(1, 1), null);
  const receiver = new History({ mapId: state.history.mapId, ...state.history.baseline });
  receiver.importBranch(bundle);
  receiver.merge('front');
  assert.equal(
    decodeControlChunk(receiver.snapshot().meta.territorialControl.chunks['0,0'])[65],
    'b',
  );
  scope.dispose();
  state.history.merge('front');
  assert.equal(at(1, 1), 'b');
});
