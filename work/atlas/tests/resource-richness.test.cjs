'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { getGameState, RegionIndex, Scope, EventBus } = require('../packages/core/index.js');
const { ResourceModel } = require('../extensions/resources-model.js');
const { resourceColor, resourceRichness } = require('../extensions/resource-richness.js');
const { ResourceOverlay, drawResourceRichness } = require('../extensions/resource-overlay.js');
function fixture(t) {
  const state = getGameState(), scope = new Scope();
  const index = new RegionIndex({ width: 3, height: 1, pixels: [1, 2, 3], regions: [1, 2, 3].map((id, x) => ({ id, area: 1, bbox: [x, 0, 1, 1], anchor: [x, 0] })) });
  state.load({ schemaVersion: 2, map: { id: 'richness-test', original: { dataURL: 'data:image/png;base64,AAAA', width: 3, height: 1 }, indexImage: 'data:image/png;base64,AAAA' }, meta: {} }, index);
  const model = new ResourceModel(state); model.registerStatistics(scope.signal); t.after(() => { scope.dispose(); state.overlays.reset(); });
  return { state, scope, model, index };
}
const production = (resource, baseOutput, extra = {}) => ({ title: resource, kind: 'production', activity: 'extraction', resource, unit: 'ед./ход', baseOutput, ...extra });
const collect = state => resourceRichness(state.statistics.calculate([1, 2, 3]).get('resources'));
test('provincial wealth uses calculator potential, sums activity groups and honors local bonuses without game writes', t => {
  const { state, model } = fixture(t);
  model.save(1, production('Уголь', 10)); model.save(1, production('Зерно', 18));
  model.save(1, { title: 'Шахта', kind: 'resource-point', activity: 'extraction', resource: 'Уголь', unit: 'ед./ход', bonuses: [{ type: 'province-percent', value: 100 }] });
  model.save(2, production('Уголь', 10)); model.save(2, production('Зерно', 12)); model.save(2, production('Уголь', 5, { activity: 'production' }));
  model.save(3, production('Сталь', 40, { activity: 'production', inputs: [{ resource: 'Железо', unit: 'ед./ход', amount: 10 }] }));
  const before = state.history.toJSON(), result = collect(state);
  assert.equal(result.winners.get(1).resource, 'Уголь'); assert.equal(result.winners.get(1).amount, 20);
  assert.equal(result.winners.get(2).amount, 15); assert.equal(result.winners.get(3).resource, 'Сталь', 'potential remains visible when a factory lacks inputs');
  assert.deepEqual(state.history.toJSON(), before);
  state.history.undo(); assert.equal(collect(state).winners.has(3), false); state.history.redo(); assert.equal(collect(state).winners.get(3).amount, 40);
});
test('static resource colors survive encounter order and units; ties still choose the first', () => {
  const group = (resource, unit, rows) => ({ resource, unit, regions: rows.map(([regionId, after1]) => ({ regionId, after1 })) });
  const result = resourceRichness({ details: [group('Зерно', 'т', [[1, 10], [2, 8]]), group('Уголь', 'т', [[1, 10]]), group(' зерно ', 'Т', [[2, 3]]), group('Уголь', 'кг', [[2, 12]])] });
  assert.deepEqual(result.legend.map(row => row.resource), ['Зерно', 'Уголь', 'Уголь']);
  assert.equal(result.winners.get(1).resource, 'Зерно'); assert.equal(result.winners.get(2).unit, 'кг');
  assert.deepEqual(result.legend.map(row => row.count), [1, 0, 1]);
  const swapped = resourceRichness({ details: [group('Уголь', 'т', [[1, 10]]), group('Зерно', 'т', [[1, 10]])] });
  assert.equal(swapped.winners.get(1).resource, 'Уголь'); assert.equal(swapped.legend[0].color, result.legend[1].color);
  assert.equal(result.legend[1].color, result.legend[2].color); assert.equal(resourceColor('grain'), resourceColor(' ЗЕРНО '));
});
test('zero output and bonus-only provinces stay transparent', t => {
  const { state, model } = fixture(t); model.save(1, production('Вода', 0));
  model.save(2, { title: 'Руда', kind: 'resource-point', activity: 'extraction', resource: 'Уголь', unit: 'ед./ход', bonuses: [{ type: 'province-percent', value: 100 }] });
  const result = collect(state); assert.equal(result.legend.length, 0); assert.equal(result.winners.size, 0);
});
test('richness paints only exact province pixels, including holes and map edges', () => {
  const pixels = [1, 1, 0, 2, 1, 0, 1, 2, 1, 1, 1, 0], index = new RegionIndex({ width: 4, height: 3, pixels, regions: [{ id: 1, area: 7, bbox: [0, 0, 3, 3], anchor: [0, 0] }, { id: 2, area: 2, bbox: [3, 0, 1, 2], anchor: [3, 0] }] });
  const painted = new Array(12).fill(null), context = { clearRect() { painted.fill(null); }, fillRect(x, y, w, h) { assert.equal(h, 1); for (let i = 0; i < w; i++) painted[y * 4 + x + i] = this.fillStyle; } };
  drawResourceRichness(context, index, { winners: new Map([[1, { color: 'orange' }], [2, { color: 'blue' }]]) });
  assert.deepEqual(painted, pixels.map(id => id === 1 ? 'orange' : id === 2 ? 'blue' : null)); assert.equal(context.imageSmoothingEnabled, false);
  drawResourceRichness(context, index, { winners: new Map() }); assert.ok(painted.every(value => value === null));
});
test('the ordinary overlay lazily calculates, follows edits and releases with its module; visibility leaves other layers and history intact', t => {
  const { state, model, scope } = fixture(t); model.save(1, production('Уголь', 10));
  const ui = new EventBus(); ui.viewport = { ready: true }; ui.registerTooltip = () => {};
  let calculations = 0; const calculate = state.statistics.calculate.bind(state.statistics); state.statistics.calculate = (...args) => { calculations++; return calculate(...args); }; t.after(() => delete state.statistics.calculate);
  const other = state.overlays.register({ id: 'richness-test:other', visible: true }, { signal: scope.signal });
  const context = { clearRect() {}, fillRect() {} };
  const overlay = new ResourceOverlay({ state, ui, scope, signal: scope.signal, windowMenu() {}, menu() {}, overlay(definition) {
    const registration = state.overlays.register({ ...definition, id: 'resources:' + definition.id }, { signal: scope.signal });
    return { id: registration.id, canvas: {}, context, get visible() { return registration.current?.visible || false; }, setVisible: visible => state.overlays.setVisible(registration.id, visible) };
  } });
  assert.equal(calculations, 0); const before = state.history.toJSON();
  overlay.overlay.setVisible(true); assert.equal(calculations, 1); assert.equal(overlay.data.winners.get(1).resource, 'Уголь');
  overlay.overlay.setVisible(false); overlay.overlay.setVisible(true); assert.equal(calculations, 1);
  assert.equal(state.overlays.get(other.id).visible, true); assert.deepEqual(state.history.toJSON(), before);
  model.save(1, production('Зерно', 30)); assert.equal(overlay.data.winners.get(1).resource, 'Зерно');
  state.history.undo(); assert.equal(overlay.data.winners.get(1).resource, 'Уголь');
  ui.emit('map:ready', {}); assert.equal(overlay.data.winners.get(1).resource, 'Уголь');
  scope.dispose(); assert.equal(state.overlays.has('resources:richness'), false); assert.equal(overlay.data.winners.size, 0);
});
