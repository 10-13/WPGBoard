'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { getGameState, RegionIndex, Scope, clone } = require('../packages/core/index.js');
const { DEFAULT_RESOURCE_CATALOG: defaults } = require('../extensions/resource-catalog-data.js');
const { ResourceCatalog, validateCatalog } = require('../extensions/resource-catalog.js');
const { resourceColor, resourceShade } = require('../extensions/resource-colors.js');
const { resourceRichness } = require('../extensions/resource-richness.js');
const { layoutResourceMarkers } = require('../extensions/resource-markers.js');
const { collectResourceBonusSources, projectResourceBonuses } = require('../extensions/resource-bonuses.js');
function fixture(t) {
  const state = getGameState(), index = new RegionIndex({ width: 1, height: 1, pixels: [1], regions: [{ id: 1, area: 1, bbox: [0, 0, 1, 1], anchor: [0, 0] }] });
  state.load({ schemaVersion: 2, map: { id: 'resource-color-test', original: { dataURL: 'data:image/png;base64,AAAA', width: 1, height: 1 }, indexImage: 'data:image/png;base64,AAAA' }, meta: {} }, index);
  const catalog = new ResourceCatalog(state), scope = new Scope(); catalog.registerActions(scope.signal); t.after(() => { scope.dispose(); state.overlays.reset(); });
  return { state, index, catalog, scope };
}
test('authored colors override fallbacks by name and ID, remain stable after renaming and keep general bonuses white', () => {
  const data = clone(defaults); data.resources.coal.color = '#00AB4C';
  for (const query of ['coal', 'Уголь', ' УГОЛЬ ', data.resources.coal]) assert.equal(resourceColor(query, data), '#00ab4c');
  data.resources.coal.name = 'Каменный уголь'; assert.equal(resourceColor('Каменный уголь', data), '#00ab4c');
  assert.equal(resourceColor('Сталь', data), resourceColor('steel'));
  assert.equal(resourceColor('Медь', data), resourceColor('Медь'));
  assert.equal(resourceColor('*', data), '#ffffff');
  data.resources.coal.color = 'url(bad)'; assert.equal(resourceColor('coal', data), resourceColor('coal'));
  validateCatalog(defaults); assert.equal(defaults.resources.coal.color, undefined);
});
test('resource colors are game actions and survive branches, serialization and reducer shutdown; unrelated edits retain them', t => {
  const { state, index, catalog, scope } = fixture(t), baseline = clone(defaults), oldColor = catalog.color('coal');
  assert.equal(state.history.actions.length, 0);
  catalog.saveResource({ ...catalog.data.resources.coal, color: '#00AB4C' });
  assert.equal(catalog.data.resources.coal.color, '#00ab4c'); assert.equal(catalog.color('Уголь'), '#00ab4c');
  assert.equal(state.history.actions.at(-1).type, 'resources.catalog.resource.save');
  state.history.undo(); assert.equal(catalog.color('coal'), oldColor); state.history.redo(); assert.equal(catalog.color('coal'), '#00ab4c');
  state.history.createBranch('palette'); state.history.checkout('palette');
  catalog.saveResource({ ...catalog.data.resources.coal, color: '#dd2244' });
  state.history.checkout('main'); assert.equal(catalog.color('coal'), '#00ab4c');
  state.history.merge('palette'); assert.equal(catalog.color('coal'), '#dd2244');
  const { color, ...otherFields } = catalog.data.resources.coal;
  catalog.saveResource({ ...otherFields, description: 'Different description' }); assert.equal(catalog.color('coal'), '#dd2244');
  const saved = JSON.parse(JSON.stringify(state.toJSON())); scope.dispose(); state.load(saved, index);
  assert.equal(catalog.color('Уголь'), '#dd2244'); assert.equal(state.actions.has('resources.catalog.resource.save'), false);
  state.history.undo(); assert.equal(catalog.data.resources.coal.description, otherFields.description);
  state.history.undo(); assert.equal(catalog.color('coal'), '#00ab4c');
  assert.deepEqual(defaults, baseline);
});
test('invalid color edits reject atomically without changing catalog or history', t => {
  const { state, catalog } = fixture(t), before = state.history.toJSON();
  for (const color of ['red', '#123', '#12345678', '#GGGGGG', '', null, 123456, 'url(https://example.test)']) {
    assert.throws(() => catalog.saveResource({ ...defaults.resources.coal, color }), /#RRGGBB/);
    assert.deepEqual(state.history.toJSON(), before); assert.equal(state.meta.resources, undefined);
  }
  const bad = clone(defaults); bad.resources.coal.color = '#123'; assert.throws(() => validateCatalog(bad), /#RRGGBB/);
});
test('resource markers, hatching and intensity scales use the same saved color without changing resource quantities', () => {
  const data = clone(defaults); data.resources.coal.color = '#006b35';
  const point = { id: 'mine', title: 'Mine', description: '', source: 'resources', kind: 'resource-point', stats: { 'resource.name': 'Уголь', 'resource.unit': '*', 'resource.activity': '*', 'resource.bonuses': [{ type: 'province-percent', value: 100 }] } };
  const sources = collectResourceBonusSources({ 1: { entries: { mine: point } } });
  assert.deepEqual(projectResourceBonuses(sources, {}, data).byProvince.get(1).colors, ['#006b35']);
  const region = { id: 1, bbox: [0, 0, 30, 30], anchor: [15, 15] }, index = { idAt: () => 1 };
  const production = { id: 'factory', source: 'resources', kind: 'production', stats: { 'resource.name': 'Уголь' } };
  const { createResourceColorResolver } = require('../extensions/resource-colors.js');
  assert.deepEqual(layoutResourceMarkers(index, region, [point, production], createResourceColorResolver(data)).pixels.map(p => p.color), ['#006b35', '#006b35']);
  const block = { details: [{ resource: 'Уголь', unit: 'т', regions: [{ regionId: 1, after1: 10 }, { regionId: 2, after1: 20 }] }] };
  const rendered = resourceRichness(block, data); assert.equal(rendered.legend[0].color, '#006b35');
  assert.equal(rendered.winners.get(1).color, resourceShade('#006b35', 0)); assert.equal(rendered.winners.get(2).color, resourceShade('#006b35', 1));
  assert.deepEqual([...rendered.winners.values()].map(p => p.amount), [10, 20]);
});
