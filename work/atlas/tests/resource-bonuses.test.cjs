'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { getGameState, RegionIndex, EventBus, Scope } = require('../packages/core/index.js');
const { ResourceModel } = require('../extensions/resources-model.js');
const { resourceColor } = require('../extensions/resource-colors.js');
const { collectResourceBonusSources, projectResourceBonuses, drawResourceBonusHatching } = require('../extensions/resource-bonuses.js');
const { ResourceBonusOverlay } = require('../extensions/resource-bonus-overlay.js');
const point = (id, resource, type = 'province-percent', value = 100) => ({ id, source: 'resources', kind: 'resource-point', title: id, description: 'Details', stats: { 'resource.name': resource, 'resource.unit': '*', 'resource.activity': '*', 'resource.bonuses': [{ type, value }] } });
const tiles = { 1: { entries: { coal: point('coal', 'Уголь'), general: point('general', '*', 'global-input-percent', 10), zero: point('zero', 'Железная руда', 'province-flat-each', 0) } }, 2: { entries: { oil: point('oil', 'Нефть', 'total-percent', 30) } } };
test('point sources include zero-valued and production-free points, without reading invalid records as valid points', () => {
  const input = structuredClone(tiles); input[1].entries.broken = point('broken', 'Вода', 'unknown'); input[1].entries.note = { title: 'Note', source: 'user', kind: 'note' };
  const before = JSON.stringify(input), data = collectResourceBonusSources(input);
  assert.equal(data.points.length, 4); assert.equal(data.invalid.length, 1); assert.equal(data.points.find(p => p.id === 'zero').bonuses[0].value, 0);
  assert.deepEqual(data.resources.map(r => r.key).sort(), ['железная руда', 'нефть', 'уголь']); assert.equal(JSON.stringify(input), before);
});
test('resource/type filters keep general bonuses and preserve every source; global bonuses mark only their source province', () => {
  const sources = collectResourceBonusSources(tiles), all = projectResourceBonuses(sources);
  assert.equal(all.pointCount, 4); assert.equal(all.byProvince.size, 2); assert.equal(all.byProvince.get(1).points.length, 3);
  assert(all.byProvince.get(1).colors.includes('#ffffff')); assert.equal(all.legend.find(row => row.resource === '*').pointCount, 1);
  const coal = projectResourceBonuses(sources, { resource: ' УГОЛЬ ' }); assert.equal(coal.pointCount, 2); assert.equal(coal.byProvince.size, 1);
  const general = projectResourceBonuses(sources, { resource: '*' }); assert.equal(general.pointCount, 1); assert.deepEqual(general.byProvince.get(1).colors, ['#ffffff']);
  const global = projectResourceBonuses(sources, { type: 'total-percent' }); assert.equal(global.byProvince.has(1), false); assert.equal(global.byProvince.has(2), true);
  assert.equal(projectResourceBonuses(sources, { resource: 'Нефть', type: 'province-percent' }).pointCount, 0); assert.throws(() => projectResourceBonuses(sources, { type: 'unknown' }));
  assert.equal(all.pointCount, 4); assert.equal(sources.points.length, 4);
});
test('hatching leaves transparent gaps, alternates resource colors, covers the anchor and never paints water, holes or neighbors', () => {
  const pixels = Array.from({ length: 13 * 12 }, (_, i) => i % 13 === 12 ? 2 : i % 13 === 4 && Math.floor(i / 13) === 4 ? 0 : 1);
  const index = new RegionIndex({ width: 13, height: 12, pixels, regions: [{ id: 1, area: 143, bbox: [0, 0, 12, 12], anchor: [6, 6] }, { id: 2, area: 12, bbox: [12, 0, 1, 12], anchor: [12, 5] }] });
  const painted = new Map(), context = { clearRect() { painted.clear(); }, fillRect(x, y, w, h) { assert.equal(w, 1); assert.equal(h, 1); assert.equal(index.idAt(x, y), 1); painted.set(x + ':' + y, this.fillStyle); } };
  drawResourceBonusHatching(context, index, { byProvince: new Map([[1, { colors: [resourceColor('coal'), '#ffffff'] }]]) });
  const row = [...painted.keys()].map(key => key.split(':').map(Number)).filter(([, y]) => y === 6).map(([x]) => x).sort((a, b) => a - b);
  for (let i = 1; i < row.length; i++) assert.equal(row[i] - row[i - 1], 3, 'one stripe pixel and two transparent pixels');
  assert(painted.size > 0 && painted.size < 143 / 2); assert(painted.has('6:6')); assert(!painted.has('4:4'));
  assert([...painted.values()].includes('#ffffff')); assert([...painted.values()].includes(resourceColor('coal'))); assert.equal(context.imageSmoothingEnabled, false);
  drawResourceBonusHatching(context, index, { byProvince: new Map() }); assert.equal(painted.size, 0);
});
test('point overlay is lazy, follows metadata edits and undo, persists only display filters and releases its registrations', t => {
  const state = getGameState(), scope = new Scope(), index = new RegionIndex({ width: 3, height: 1, pixels: [1, 2, 3], regions: [1, 2, 3].map((id, x) => ({ id, area: 1, bbox: [x, 0, 1, 1], anchor: [x, 0] })) });
  state.load({ schemaVersion: 2, map: { id: 'bonus-overlay', original: { dataURL: 'data:image/png;base64,AAAA', width: 3, height: 1 }, indexImage: 'data:image/png;base64,AAAA' }, meta: { tiles } }, index);
  const model = new ResourceModel(state), ui = new EventBus(); ui.viewport = { ready: true, selectedId: null }; ui.registerTooltip = () => {};
  const other = state.overlays.register({ id: 'bonus-test:other' }, { signal: scope.signal });
  const overlay = new ResourceBonusOverlay({ state, ui, scope, signal: scope.signal, windowMenu() {}, menu() {}, overlay(definition) {
    const registration = state.overlays.register({ ...definition, id: 'resources:' + definition.id }, { signal: scope.signal });
    return { id: registration.id, context: { clearRect() {}, fillRect() {} }, get visible() { return registration.current?.visible || false; }, setVisible: visible => state.overlays.setVisible(registration.id, visible) };
  } });
  t.after(() => { scope.dispose(); state.overlays.reset(); });
  assert.equal(overlay.sources, undefined); const before = state.history.toJSON();
  overlay.overlay.setVisible(true); assert.equal(overlay.data.pointCount, 4); const sources = overlay.sources;
  overlay.setOptions({ resource: 'уголь' }); assert.equal(overlay.data.pointCount, 2); assert.equal(overlay.sources, sources);
  overlay.overlay.setVisible(false); overlay.overlay.setVisible(true); assert.equal(overlay.sources, sources);
  assert.deepEqual(state.overlays.getOptions(overlay.overlay.id), { resource: 'уголь', type: '' }); assert.deepEqual(state.history.toJSON(), before); assert.equal(state.overlays.get(other.id).visible, true);
  model.save(3, { title: 'New point', kind: 'resource-point', resource: 'Уголь', activity: '*', unit: '*', bonuses: [{ type: 'province-percent', value: 25 }] }); assert.equal(overlay.data.pointCount, 3);
  state.history.undo(); assert.equal(overlay.data.pointCount, 2); ui.emit('map:ready', {}); assert.equal(overlay.data.pointCount, 2);
  scope.dispose(); assert.equal(state.overlays.has('resources:bonuses'), false); assert.equal(overlay.data.pointCount, 0);
});
