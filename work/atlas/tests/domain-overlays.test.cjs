'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../packages/core/index.js');
require('../extensions/nation-relations.js');
const { NationsModel } = require('../extensions/nations-model.js');
require('../extensions/nation-borders.js');
const { ResourceModel } = require('../extensions/resources-model.js');
require('../extensions/resource-richness.js');
require('../extensions/resource-bonuses.js');
const { ResourceOverlay } = require('../extensions/resource-overlay.js');
const { ResourceBonusOverlay } = require('../extensions/resource-bonus-overlay.js');
const { SimpleOverlay } = require('../packages/ui/simple-overlay.js');

function fixture(t, meta = {}) {
  const state = core.getGameState(),
    scope = new core.Scope(),
    ui = new core.EventBus();
  const index = new core.RegionIndex({
    width: 5,
    height: 2,
    pixels: [1, 1, 0, 2, 3, 1, 0, 0, 2, 3],
    regions: [
      { id: 1, area: 3, bbox: [0, 0, 2, 2], anchor: [0, 0] },
      { id: 2, area: 2, bbox: [3, 0, 1, 2], anchor: [3, 0] },
      { id: 3, area: 2, bbox: [4, 0, 1, 2], anchor: [4, 0] },
    ],
  });
  state.load(
    {
      schemaVersion: 2,
      map: {
        id: 'domain-overlay-test',
        original: { dataURL: 'data:image/png;base64,AAAA', width: 5, height: 2 },
        indexImage: 'data:image/png;base64,AAAA',
      },
      meta,
    },
    index,
  );
  ui.viewport = { ready: true, selectedId: null, originalImage: {} };
  ui.registerTooltip = () => {};
  const layers = new Map();
  const ctx = {
    state,
    ui,
    scope,
    signal: scope.signal,
    windowMenu() {},
    menu() {},
    overlay(definition) {
      const registration = state.overlays.register(
        { ...definition, id: 'domain:' + definition.id },
        { signal: scope.signal },
      );
      const pixels = new Map();
      const context = {
        clears: 0,
        clearRect(x, y, w, h) {
          this.clears++;
          for (let yy = y; yy < y + h; yy++)
            for (let xx = x; xx < x + w; xx++) pixels.delete(xx + ',' + yy);
        },
        fillRect(x, y, w, h) {
          for (let yy = y; yy < y + h; yy++)
            for (let xx = x; xx < x + w; xx++) pixels.set(xx + ',' + yy, this.fillStyle);
        },
      };
      const handle = {
        id: registration.id,
        context,
        pixels,
        canvas: { width: index.width, height: index.height },
        get visible() {
          return registration.current?.visible || false;
        },
        setVisible: (visible) => state.overlays.setVisible(registration.id, visible),
        dispose: () => registration.dispose(),
      };
      layers.set(definition.id, handle);
      return handle;
    },
    simpleOverlay(definition) {
      return new SimpleOverlay(this, definition);
    },
  };
  t.after(() => {
    scope.dispose();
    state.overlays.reset();
  });
  return { state, index, ui, scope, ctx, layers };
}

test('nation ownership uses the shared one-pass layer; colors, scope, undo and visibility preserve exact masks', (t) => {
  const f = fixture(t, {
    nations: {
      items: {
        a: { id: 'a', name: 'A', color: '#224466' },
        b: { id: 'b', name: 'B', color: '#aa6622' },
      },
      owners: { 1: 'a', 2: 'b' },
    },
  });
  const model = new NationsModel(f.state);
  model.registerActions(f.scope.signal);
  const sandbox = {
    AtlasCore: core,
    AtlasExtensions: { ...global.AtlasExtensions },
    AtlasUI: { dom: {}, dataView: {}, controls: require('../packages/ui/controls.js') },
    document: {
      createElement() {
        return {
          getContext() {
            return {
              drawImage() {},
              getImageData() {
                return { data: new Uint8ClampedArray(40).fill(255) };
              },
            };
          },
        };
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../extensions/nations.js'), 'utf8'), sandbox);
  const painter = new sandbox.AtlasExtensions.NationPainter(f.ctx, model),
    layer = f.layers.get('ownership');
  assert(painter.ownership instanceof SimpleOverlay);
  assert.deepEqual(
    [...layer.pixels],
    [
      ['0,0', '#224466'],
      ['1,0', '#224466'],
      ['0,1', '#224466'],
      ['3,0', '#aa6622'],
      ['3,1', '#aa6622'],
    ],
  );
  painter.ownership.setProvinceIds([2]);
  assert.deepEqual([...layer.pixels.values()], ['#aa6622', '#aa6622']);
  painter.ownership.setProvinceIds(null);
  layer.setVisible(false);
  model.assign([1], 'b');
  layer.setVisible(true);
  assert([...layer.pixels.values()].every((color) => color === '#aa6622'));
  model.assign([2], null);
  assert.equal(layer.pixels.has('3,0'), false);
  f.state.history.undo();
  assert.equal(layer.pixels.get('3,0'), '#aa6622');
  model.setNation({ id: 'b', name: 'B', color: '#abcdef' });
  assert([...layer.pixels.values()].every((color) => color === '#abcdef'));
  const clears = layer.context.clears;
  model.setWar('a', 'b', true);
  assert.equal(layer.context.clears, clears, 'war borders stay separate from ownership fills');
  const before = f.state.history.toJSON();
  painter.ownership.setProvinceIds([]);
  assert.equal(layer.pixels.size, 0);
  layer.setVisible(false);
  layer.setVisible(true);
  assert.deepEqual(f.state.history.toJSON(), before, 'display changes never create actions');
  f.scope.dispose();
  assert.equal(f.state.overlays.has(layer.id), false);
});

const point = (resource) => ({
  title: resource,
  kind: 'resource-point',
  resource,
  activity: '*',
  unit: '*',
  bonuses: [{ type: 'province-percent', value: 100 }],
});
const production = (resource, amount) => ({
  title: resource,
  kind: 'production',
  resource,
  activity: 'extraction',
  unit: 'ед./ход',
  baseOutput: amount,
});

test('point layer shares hatch descriptors and clips its legend without rescanning sources', (t) => {
  const f = fixture(t),
    model = new ResourceModel(f.state);
  model.save(1, point('Уголь'));
  model.save(1, point('*'));
  model.save(2, point('Нефть'));
  const layer = new ResourceBonusOverlay(f.ctx);
  assert(layer instanceof SimpleOverlay);
  layer.setVisible(true);
  const sources = layer.sources,
    before = f.state.history.toJSON();
  const paint = layer.result.paints.get(1);
  assert.equal(paint.fill, 'hatch');
  assert.equal(paint.spacing, 3);
  assert.equal(paint.color.length, 2);
  assert(paint.color.includes('#ffffff'));
  layer.setProvinceIds([1]);
  assert.equal(layer.ensure().pointCount, 2);
  assert.equal(layer.ensure().byProvince.has(2), false);
  assert.equal(layer.result.paints.has(2), false);
  assert.equal(layer.sources, sources);
  layer.setOptions({ resource: '*' });
  assert.equal(layer.data.pointCount, 1);
  layer.setProvinceIds([]);
  assert.equal(layer.data.pointCount, 0);
  assert.equal(layer.result.paints.size, 0);
  layer.setProvinceIds(null);
  layer.setOptions({ resource: '' });
  assert.equal(layer.data.pointCount, 3);
  assert.equal(layer.sources, sources);
  assert.deepEqual(f.state.history.toJSON(), before);
  layer.dispose();
  assert.equal(f.state.overlays.has(layer.id), false);
  assert.equal(layer.sources, null);
});

test('restored visible resource layers initialize through the common controller and statistics invalidation recovers errors', (t) => {
  const f = fixture(t),
    model = new ResourceModel(f.state);
  model.save(1, production('Уголь', 10));
  model.save(2, point('Уголь'));
  f.state.overlays.restore({
    version: 1,
    order: [],
    visibility: { 'domain:richness': true, 'domain:bonuses': true },
  });
  const richness = new ResourceOverlay(f.ctx),
    bonuses = new ResourceBonusOverlay(f.ctx);
  assert(richness instanceof SimpleOverlay);
  assert(bonuses instanceof SimpleOverlay);
  assert.match(richness.message, /недоступен/);
  assert.equal(richness.data.winners.size, 0);
  assert.equal(bonuses.data.pointCount, 1);
  model.registerStatistics(f.scope.signal);
  assert.equal(richness.data.winners.get(1).amount, 10);
  assert.equal(richness.message, '');
  richness.setVisible(false);
  model.save(1, production('Нефть', 20));
  richness.setVisible(true);
  assert.equal(richness.data.winners.get(1).resource, 'Нефть');
  const before = f.state.history.toJSON();
  richness.setOptions({ hiddenResources: [] });
  bonuses.setOptions({ type: 'province-percent' });
  assert.deepEqual(f.state.history.toJSON(), before);
  richness.dispose();
  bonuses.dispose();
  assert.equal(f.state.statistics.listenerCount('change'), 0);
});
