'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EventBus,
  Scope,
  RegionIndex,
  OverlayRegistry,
  freeze,
} = require('../packages/core/index.js');
const {
  buildSimpleOverlay,
  drawProvincePaints,
  SimpleOverlay,
} = require('../packages/ui/simple-overlay.js');
const { OverlayRenderer } = require('../packages/ui/overlays.js');
const { ExtensionHost } = require('../packages/ui/extensions.js');

function indexFixture() {
  const pixels = [1, 1, 1, 0, 2, 1, 0, 1, 0, 2, 1, 1, 1, 0, 2, 0, 0, 0, 0, 2];
  return new RegionIndex({
    width: 5,
    height: 4,
    pixels,
    regions: [
      { id: 1, area: 8, bbox: [0, 0, 3, 3], anchor: [0, 0] },
      { id: 2, area: 4, bbox: [4, 0, 1, 4], anchor: [4, 2] },
    ],
  });
}
const tile = (value) => ({ entries: { value: { stats: { amount: value } } } });
const sourceMeta = () => ({ tiles: { 1: tile(10), 2: tile(30) } });
const valueOf = (tile) => tile.entries.value?.stats.amount;
function numericDefinition(log = []) {
  return {
    createState: () => ({ sum: 0, ids: [] }),
    aggregate(meta, state, context) {
      log.push('aggregate:' + context.provinceId);
      state.sum += valueOf(meta) || 0;
      state.ids.push(context.provinceId);
    },
    paint(meta, state, context) {
      log.push('paint:' + context.provinceId);
      return valueOf(meta) / state.sum > 0.5 ? '#ff0000' : '#0000ff';
    },
  };
}

test('all aggregation finishes before any paint, using one read-only snapshot and a fresh accumulator', () => {
  const meta = sourceMeta(),
    index = indexFixture(),
    log = [];
  const definition = numericDefinition(log);
  const originalAggregate = definition.aggregate;
  definition.aggregate = (current, state, context) => {
    assert.ok(Object.isFrozen(current.entries.value.stats));
    assert.ok(Object.isFrozen(context));
    assert.throws(() => {
      current.entries.value.stats.amount = 500;
    }, TypeError);
    if (context.provinceId === 1) meta.tiles[2].entries.value.stats.amount = 999;
    originalAggregate(current, state, context);
  };
  const result = buildSimpleOverlay(meta, index, definition);
  assert.deepEqual(log, ['aggregate:1', 'aggregate:2', 'paint:1', 'paint:2']);
  assert.equal(result.state.sum, 40, 'external changes cannot alter an in-progress snapshot');
  assert.equal(result.paints.get(1).color, '#0000ff');
  assert.equal(result.paints.get(2).color, '#ff0000');
  assert.equal(result.paints.set, undefined);
  const next = buildSimpleOverlay(sourceMeta(), index, numericDefinition());
  assert.notEqual(result.state, next.state);
  assert.deepEqual(result.state.ids, [1, 2]);
});

test('the same explicit province pack restricts both passes; null, empty, duplicates and unknown IDs stay distinct', () => {
  const index = indexFixture(),
    log = [];
  const selected = buildSimpleOverlay(sourceMeta(), index, {
    ...numericDefinition(log),
    provinceIds: [2, 2, 999],
  });
  assert.deepEqual(log, ['aggregate:2', 'paint:2']);
  assert.deepEqual(selected.provinceIds, [2]);
  assert.equal(selected.state.sum, 30);
  assert.equal(selected.scopeSize, 1);
  assert.equal(selected.paints.has(1), false);
  const emptyLog = [];
  const empty = buildSimpleOverlay(sourceMeta(), index, {
    ...numericDefinition(emptyLog),
    provinceIds: [],
  });
  assert.deepEqual(emptyLog, []);
  assert.equal(empty.scopeSize, 0);
  assert.equal(empty.state.sum, 0);
  assert.equal(empty.paints.size, 0);
  assert.equal(
    buildSimpleOverlay(sourceMeta(), index, { ...numericDefinition(), provinceIds: null })
      .scopeSize,
    2,
  );
  assert.throws(() => buildSimpleOverlay({}, index, { paint: () => '#ffffff', provinceIds: '1' }));
});

test('without an aggregator only paint runs, including metadata-free provinces and an optional constant state', () => {
  const seen = [];
  const result = buildSimpleOverlay({}, indexFixture(), {
    paint(meta, state, { provinceId }) {
      assert.equal(state, undefined);
      assert.deepEqual(meta, { entries: {} });
      seen.push(provinceId);
      return provinceId === 1 ? '#ffffff' : null;
    },
  });
  assert.deepEqual(seen, [1, 2]);
  assert.equal(result.paints.size, 1);
  const constant = buildSimpleOverlay({}, indexFixture(), {
    createState: () => ({ color: '#abcdef' }),
    paint: (_, state) => state.color,
  });
  assert.equal(constant.paints.get(2).color, '#abcdef');
});

test('bad callbacks, asynchronous passes and invalid paint descriptors fail before drawing', () => {
  const index = indexFixture();
  for (const definition of [
    {},
    { paint: true },
    { paint() {}, aggregate: true },
    { paint: () => Promise.resolve('#fff') },
    { paint: () => '#fff', aggregate: () => Promise.resolve() },
    { paint: () => '#fff', createState: () => Promise.resolve({}) },
    { paint: () => ({ color: '#fff', opacity: NaN }) },
    { paint: () => ({ color: '#fff', opacity: 2 }) },
    { paint: () => ({ color: '#fff', fill: 'hatch', spacing: 0 }) },
    { paint: () => ({ color: '#fff', fill: 'hatch', width: 4, spacing: 3 }) },
  ])
    assert.throws(() => buildSimpleOverlay({}, index, definition));
  assert.equal(
    buildSimpleOverlay({}, index, { paint: () => ({ color: '#fff', opacity: 0 }) }).paints.size,
    0,
  );
});

function recordingContext() {
  const calls = [],
    stack = [];
  const context = {
    calls,
    globalAlpha: 1,
    fillStyle: '#123456',
    imageSmoothingEnabled: true,
    save() {
      stack.push([this.globalAlpha, this.fillStyle]);
    },
    restore() {
      [this.globalAlpha, this.fillStyle] = stack.pop();
    },
    clearRect(...args) {
      calls.push({ clear: args });
    },
    fillRect(x, y, width, height) {
      calls.push({ x, y, width, height, color: this.fillStyle, alpha: this.globalAlpha });
    },
  };
  return context;
}
function expandedPixels(context) {
  return context.calls
    .filter((c) => !c.clear)
    .flatMap((c) => Array.from({ length: c.width }, (_, i) => [c.x + i, c.y, c.color, c.alpha]));
}

test('solid paints respect all runs, holes, coasts and opacity; drawing restores canvas state and clears old pixels', () => {
  const index = indexFixture(),
    context = recordingContext();
  drawProvincePaints(
    context,
    index,
    new Map([
      [1, { color: '#ff0000', opacity: 0.4 }],
      [2, '#00ff00'],
    ]),
  );
  const pixels = expandedPixels(context);
  assert.equal(pixels.length, 12);
  for (const [x, y, color, alpha] of pixels) {
    assert.equal(index.idAt(x, y), color === '#ff0000' ? 1 : 2);
    assert.equal(alpha, color === '#ff0000' ? 0.4 : 1);
  }
  assert.equal(context.globalAlpha, 1);
  assert.equal(context.fillStyle, '#123456');
  assert.equal(context.imageSmoothingEnabled, false);
  assert.deepEqual(context.calls[0].clear, [0, 0, 5, 4]);
  drawProvincePaints(context, index, new Map());
  assert.deepEqual(context.calls.at(-1).clear, [0, 0, 5, 4]);
  const count = context.calls.length;
  assert.throws(() =>
    drawProvincePaints(
      context,
      index,
      new Map([
        [1, '#fff'],
        [2, { color: '#fff', opacity: -1 }],
      ]),
    ),
  );
  assert.equal(context.calls.length, count, 'validation prevents partly drawn frames');
});

test('all hatch directions and widths obey pixel phases and never cross a province mask', () => {
  const index = indexFixture();
  for (const direction of ['diagonal', 'reverse', 'horizontal', 'vertical'])
    for (const width of [1, 2]) {
      const context = recordingContext();
      drawProvincePaints(
        context,
        index,
        new Map([[1, { color: '#abc', fill: 'hatch', direction, spacing: 3, width }]]),
      );
      const actual = expandedPixels(context)
        .map(([x, y]) => x + ',' + y)
        .sort();
      const expected = [];
      for (let y = 0; y < index.height; y++)
        for (let x = 0; x < index.width; x++) {
          const coordinate =
            direction === 'vertical'
              ? x
              : direction === 'horizontal'
                ? y
                : direction === 'reverse'
                  ? x - y
                  : x + y;
          if (index.idAt(x, y) === 1 && ((coordinate % 3) + 3) % 3 < width)
            expected.push(x + ',' + y);
        }
      assert.deepEqual(actual, expected.sort(), direction + ':' + width);
      assert(actual.includes('0,0'), 'phase through the anchor keeps small provinces visible');
    }
});

class Node {
  children = [];
  style = {};
  dataset = {};
  context = recordingContext();
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((n) => n !== this);
    this.parent = null;
  }
  getContext() {
    return this.context;
  }
}
function fixture(t) {
  const oldDocument = global.document;
  global.document = { createElement: () => new Node() };
  const owner = new Scope(),
    state = new EventBus(),
    ui = new EventBus();
  state.meta = freeze(sourceMeta());
  state.params = freeze({});
  state.regionIndex = indexFixture();
  state.overlays = new OverlayRegistry();
  state.history = [];
  const renderer = new OverlayRenderer(new Node(), state.overlays);
  renderer.resizeWorld(5, 4);
  ui.state = state;
  ui.input = new EventBus();
  ui.viewport = { ready: true, addOverlay: (options) => renderer.add(options) };
  const ctx = {
    state,
    ui,
    signal: owner.signal,
    scope: owner,
    overlay: (options) =>
      renderer.add({ ...options, id: 'example:' + options.id, signal: owner.signal }),
  };
  t.after(() => {
    owner.dispose();
    renderer.dispose();
    global.document = oldDocument;
  });
  return { ctx, state, ui, owner, renderer };
}

test('controller is lazy, exports the painted canvas, repaints after hiding and preserves local scope without recomputing on visibility', (t) => {
  const { ctx, state, renderer } = fixture(t),
    log = [];
  const layer = new SimpleOverlay(ctx, {
    id: 'heat',
    title: 'Heat',
    provinceIds: [1],
    ...numericDefinition(log),
  });
  assert.deepEqual([layer.overlay.canvas.width, layer.overlay.canvas.height], [1, 1]);
  assert.deepEqual(log, []);
  const original = layer.ensure();
  assert.equal(original.state.sum, 10);
  assert.equal(layer.id, 'example:heat');
  layer.setVisible(true);
  assert.equal(layer.visible, true);
  assert.deepEqual([layer.overlay.canvas.width, layer.overlay.canvas.height], [5, 4]);
  const exported = [];
  renderer.exportTo({ drawImage: (canvas) => exported.push(canvas) });
  assert.deepEqual(exported, [layer.overlay.canvas]);
  layer.overlay.setVisible(false);
  layer.overlay.setVisible(true);
  assert.equal(layer.ensure(), original);
  assert.deepEqual(log, ['aggregate:1', 'paint:1']);
  layer.setProvinceIds([2]);
  assert.equal(layer.ensure().state.sum, 30);
  layer.setProvinceIds([]);
  assert.equal(layer.ensure().paints.size, 0);
  layer.setProvinceIds(null);
  assert.equal(layer.ensure().state.sum, 40);
  assert.equal(original.state.sum, 10, 'old accumulators stay independent');
  assert.deepEqual(state.history, []);
  assert.equal(state.meta.overlays, undefined);
  layer.setProvinceIds([2]);
  layer.dispose();
  assert.equal(state.overlays.has('example:heat'), false);
  assert.equal(state.listenerCount('change'), 0);
  const reopened = new SimpleOverlay(ctx, { id: 'heat', provinceIds: [1], ...numericDefinition() });
  assert.deepEqual(reopened.ensure().provinceIds, [2], 'local display choices survive disposal');
  ctx.scope.defer(() => reopened.dispose());
});

test('metadata, options and map replacement invalidate cached snapshots; owner abort releases every registration and listener', (t) => {
  const { ctx, state, ui, owner, renderer } = fixture(t);
  const layer = new SimpleOverlay(ctx, {
    id: 'constant',
    paint: (meta) => (valueOf(meta) > 20 ? '#fff' : null),
  });
  const first = layer.ensure();
  const before = { meta: state.meta, params: state.params };
  state.meta = freeze({ tiles: { 1: tile(50), 2: tile(30) } });
  state.emit('change', { before, after: { meta: state.meta, params: state.params } });
  assert.equal(layer.ensure().paints.size, 2);
  assert.notEqual(layer.ensure(), first);
  const previous = layer.ensure();
  state.regionIndex = new RegionIndex({
    width: 1,
    height: 1,
    pixels: [3],
    regions: [{ id: 3, area: 1, bbox: [0, 0, 1, 1], anchor: [0, 0] }],
  });
  renderer.resizeWorld(1, 1);
  ui.emit('map:ready', {});
  assert.notEqual(layer.ensure(), previous);
  assert.equal(layer.ensure().scopeSize, 1);
  assert.equal(layer.ensure().paints.size, 0);
  layer.setOptions({ example: 'local' });
  assert.equal(state.overlays.getOptions(layer.overlay.id).example, 'local');
  owner.dispose();
  assert(layer.disposed);
  assert.equal(state.overlays.has(layer.overlay.id), false);
  assert.equal(state.listenerCount('change'), 0);
  assert.equal(state.overlays.listenerCount('settings:change'), 0);
  assert.equal(ui.listenerCount('map:ready'), 0);
  assert.throws(() => layer.ensure(), /отключён/);
});

test('ctx.simpleOverlay prefixes IDs and stops callbacks with its extension; callbacks stay out of registry preferences', async (t) => {
  const { ui, state } = fixture(t),
    log = [],
    host = new ExtensionHost(ui);
  let layer;
  host.register({
    id: 'plugin',
    start(ctx) {
      layer = ctx.simpleOverlay({ id: 'test', title: 'Example', ...numericDefinition(log) });
      ctx.provide({ layer });
    },
  });
  await host.enable('plugin');
  assert.equal(layer.overlay.id, 'plugin:test');
  assert.equal(state.overlays.get(layer.overlay.id).source, 'plugin');
  layer.overlay.setVisible(true);
  layer.setProvinceIds([2]);
  assert.equal(layer.ensure().state.sum, 30);
  const saved = state.overlays.toJSON();
  assert(!JSON.stringify(saved).includes('aggregate'));
  assert(!JSON.stringify(saved).includes('createState'));
  host.disable('plugin');
  assert(layer.disposed);
  assert.equal(state.overlays.list.length, 0);
  const count = log.length;
  ui.emit('map:ready', {});
  assert.equal(log.length, count);
  assert.deepEqual(state.meta, freeze(sourceMeta()));
  assert.deepEqual(state.history, []);
});
