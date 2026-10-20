'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { getGameState, RegionIndex } = require('../packages/core/index.js');
const { registerBasicStatistics } = require('../packages/statistics/basic.js');
const { ResourceModel, resourceKey, collectResourceStats } = require('../extensions/resources-model.js');
function fixture(t) {
  const state = getGameState(), index = new RegionIndex({ width: 3, height: 1, pixels: [1, 2, 3], regions: [1, 2, 3].map((id, i) => ({ id, area: 1, bbox: [i, 0, 1, 1], anchor: [i, 0] })) });
  state.load({ schemaVersion: 2, map: { id: 'resources', original: { dataURL: 'data:image/png;base64,AAAA', width: 3, height: 1, name: 'test.png' }, indexImage: 'data:image/png;base64,AAAA' }, meta: {} }, index);
  const signal = new AbortController(), basic = registerBasicStatistics(state), model = new ResourceModel(state); model.registerStatistics(signal.signal); t.after(() => { signal.abort(); basic.dispose(); }); return { state, model, signal, index };
}
const production = (baseOutput, extra = {}) => ({ title: 'Mine', kind: 'production', resource: 'Железо', activity: 'extraction', unit: 'т/ход', baseOutput, ...extra });
const point = (bonuses, extra = {}) => ({ title: 'Deposit', kind: 'resource-point', resource: 'Железо', activity: 'extraction', unit: 'т/ход', bonuses, ...extra });
const resourceBlock = (state, ids) => { const r = state.statistics.collect(ids); assert.deepEqual(r.errors, []); return r.get('resources'); };
test('large allocations keep every enterprise in priority order across report pages', () => {
  const entries = Array.from({ length: 601 }, (_, i) => ({ regionId: 1, entry: { id: 'p' + i, title: 'Mine ' + i, source: 'resources', kind: 'production', stats: { 'resource.name': 'Уголь', 'resource.unit': 'ед./ход', 'resource.activity': 'extraction', 'resource.baseOutput': 1, 'resource.priority': 601 - i } } }));
  const report = collectResourceStats({ entries }), tree = report.children.find(n => n.id === 'gross').children.find(n => n.id === 'facilities');
  assert.equal(report.resources[0].net, 601); assert.equal(tree.defaultOpen, false); assert.equal(tree.children.length, 7);
  const rows = tree.children.flatMap(page => page.children);
  assert.deepEqual(rows.map(row => JSON.parse(row.id)[1]), report.allocation.map(p => p.id));
  assert.equal(rows.length, 601); assert.equal(rows[0].title, 'Mine 600 · #1');
});
test('both provincial flat bonuses run at stage 4, followed strictly by 2, 3 and 1', t => {
  const { state, model } = fixture(t); model.save(1, production(100)); model.save(1, production(200)); model.save(2, production(50));
  model.save(1, point([{ type: 'province-flat-total', value: 10 }, { type: 'province-flat-each', value: 5 }, { type: 'province-percent', value: 50 }]));
  model.save(3, point([{ type: 'production-flat', value: 7 }, { type: 'total-percent', value: 20 }]));
  const b = resourceBlock(state, [1, 2, 3]), group = b.details[0]; assert.deepEqual(b.bonusOrder, [4, 2, 3, 1]);
  assert.equal(group.regions[0].after4, 320); assert.equal(group.regions[0].after2, 480); assert.equal(group.regions[0].after3, 494); assert.ok(Math.abs(group.regions[0].after1 - 592.8) < 1e-8); assert.ok(Math.abs(group.total - 661.2) < 1e-8);
  assert.equal(resourceBlock(state, [1, 2]).details[0].total, 530, 'points outside the region pack do not affect it'); assert.equal(resourceBlock(state, [1]).details[0].total, 480);
  assert.equal(resourceBlock(state, [1, 1, 2, 3]).details[0].total, group.total, 'region duplicates do not duplicate global buffs');
});
test('matching bonuses add within a stage; different resources, operations and units stay separate', t => {
  const { state, model } = fixture(t); model.save(1, production(100)); model.save(1, production(40, { resource: 'Сталь', activity: 'processing' })); model.save(1, production(5, { unit: 'кг/ход' }));
  model.save(1, point([{ type: 'total-percent', value: 10 }, { type: 'total-percent', value: 20 }])); const d = resourceBlock(state, [1]).details;
  assert.equal(d.find(g => g.resource === 'Железо' && g.unit === 'т/ход').total, 130); assert.equal(d.find(g => g.resource === 'Сталь').total, 40); assert.equal(d.find(g => g.unit === 'кг/ход').total, 5);
});
test('resource objects only write generic metadata, retain custom stats and survive undo and restore', t => {
  const { state, model, index } = fixture(t), id = model.save(1, production(10));
  const entry = state.tileMetadata.get(1, id); assert.equal(state.history.actions.at(-1).type, 'core.tile.entry.save'); assert.equal(entry.kind, 'production');
  state.tileMetadata.save(1, { ...entry, stats: { ...entry.stats, custom: 7 } }); model.save(1, production(20, { id })); assert.equal(state.tileMetadata.get(1, id).stats.custom, 7);
  state.history.undo(); assert.equal(resourceBlock(state, [1]).details[0].total, 10); state.history.redo();
  const saved = JSON.parse(JSON.stringify(state.toJSON())); state.load(saved, index); assert.equal(resourceBlock(state, [1]).details[0].total, 20);
  model.remove(1, id); assert.equal(model.list(1).length, 0); state.history.undo(); assert.equal(model.list(1).length, 1);
});
test('disabling the library removes its calculator but preserves entries and baseline statistics', t => {
  const { state, model, signal } = fixture(t); model.save(1, production(15)); signal.abort(); const r = state.statistics.collect([1]);
  assert.equal(!!r.get('resources'), false); assert.equal(state.tileMetadata.list(1).length, 1); assert.equal(r.value(['basic.metadata', 'stats', 'resource.baseOutput']), 15);
});
test('invalid resource edits are atomic and malformed imported objects are reported without losing valid output', t => {
  const { state, model } = fixture(t), before = state.history.toJSON();
  for (const value of [production(-1), production(NaN), production(1, { activity: 'constructor' }), point([]), point([{ type: 'unknown', value: 1 }]), point([{ type: 'total-percent', value: -1 }])]) assert.throws(() => model.save(1, value));
  assert.deepEqual(state.history.toJSON(), before); model.save(1, production(10)); state.tileMetadata.save(1, { title: 'Broken', source: 'resources', kind: 'production', stats: {} });
  const report = resourceBlock(state, [1]); assert.equal(report.invalid.length, 1); assert.equal(report.details[0].total, 10);
});
const input = (resource, amount, unit = 'т/ход') => ({ resource, amount, unit });
const recipe = (resource, baseOutput, inputs, extra = {}) => production(baseOutput, { resource, activity: 'production', inputs, ...extra });
test('the new tree separates positive net output, actual gross output and unconstrained potential', t => {
  const { state, model } = fixture(t); model.save(1, production(100)); model.save(2, recipe('Сталь', 100, [input('Железо', 200)]));
  const report = state.statistics.calculate([1, 2]), steel = resourceKey('Сталь', 'т/ход'), iron = resourceKey('Железо', 'т/ход'); assert.deepEqual(report.errors, []);
  assert.equal(report.value(['resources', steel]), 50); assert.equal(report.get(['resources', iron]), null, 'fully consumed raw material is absent from positive net leaves');
  assert.equal(report.value(['resources', 'gross', iron]), 100); assert.equal(report.value(['resources', 'gross', steel]), 50);
  assert.equal(report.value(['resources', 'potential', steel, 'production']), 100); assert.equal(report.value(['resources', 'potential', iron, 'consumption']), 200);
  assert.equal(report.value(['resources', 'bonuses', 'base', steel]), 100);
  assert.deepEqual(report.get('resources').children.filter(n => n.type === 'folder').map(n => n.id), ['gross', 'potential', 'bonuses']);
});
test('bonuses scale the recipe demand together with capacity and shortage scales both back', t => {
  const { state, model } = fixture(t); model.save(1, production(100)); const id = model.save(2, recipe('Сталь', 100, [input('Железо', 50)]));
  model.save(3, point([{ type: 'total-percent', value: 200 }], { resource: 'Сталь', activity: 'production' }));
  const b = resourceBlock(state, [1, 2, 3]), row = b.allocation.find(p => p.id === id), steel = b.resources.find(r => r.resource === 'Сталь');
  assert.equal(row.capacity, 300); assert.equal(row.inputs[0].amount, 150); assert.equal(row.actualOutput, 200); assert.equal(row.consumption[0].actualAmount, 100); assert.equal(steel.net, 200);
  assert.equal(b.resources.find(r => r.resource === 'Железо').net, 0);
  const folder = b.children.find(n => n.id === 'bonuses').children.find(n => n.id === 'applied').children.find(n => n.id === steel.key);
  assert.equal(folder.children.find(n => n.id === 'total-percent').children[0].value, 200);
});
test('scarce input goes to the first enterprise and explicit priorities can reverse the order', t => {
  const { state, model } = fixture(t); model.save(1, production(100)); const first = model.save(2, recipe('Сталь', 40, [input('Железо', 80)])), second = model.save(2, recipe('Медь', 60, [input('Железо', 60)]));
  let b = resourceBlock(state, [2, 1]); assert.equal(b.allocation.find(p => p.id === first).actualOutput, 40); assert.equal(b.allocation.find(p => p.id === second).actualOutput, 20);
  model.save(2, recipe('Сталь', 40, [input('Железо', 80)], { id: first, priority: 5 }));
  b = resourceBlock(state, [1, 2]); assert.equal(b.allocation.find(p => p.id === second).actualOutput, 60); assert.equal(b.allocation.find(p => p.id === first).actualOutput, 20);
});
test('grouping outputs never changes the insertion order of enterprises with equal priorities', t => {
  const { state, model } = fixture(t); model.save(1, production(100));
  const first = model.save(2, recipe('Сталь', 30, [input('Железо', 30)])), second = model.save(2, recipe('Медь', 50, [input('Железо', 50)])), third = model.save(2, recipe('Сталь', 50, [input('Железо', 50)]));
  const b = resourceBlock(state, [1, 2]); assert.deepEqual([first, second, third].map(id => b.allocation.find(p => p.id === id).actualOutput), [30, 50, 20]);
});
test('supply chains revisit the earliest waiting enterprise when a later supplier produces its input', t => {
  const { state, model } = fixture(t); model.save(1, production(100));
  const early = model.save(2, recipe('Машины', 50, [input('Сталь', 100)], { priority: 0 }));
  model.save(2, recipe('Сталь', 100, [input('Железо', 100)], { priority: 2 }));
  const late = model.save(2, recipe('Инструменты', 50, [input('Сталь', 100)], { priority: 3 }));
  const b = resourceBlock(state, [1, 2]); assert.equal(b.allocation.find(p => p.id === early).actualOutput, 50); assert.equal(b.allocation.find(p => p.id === late).actualOutput, 0); assert.equal(b.resources.find(r => r.resource === 'Сталь').net, 0);
});
test('the scarcest of several ingredients limits output; units and region packs never borrow supply', t => {
  const { state, model } = fixture(t); model.save(1, production(100)); model.save(1, production(25, { resource: 'Уголь' }));
  const id = model.save(2, recipe('Сталь', 100, [input('железо', 100), input('Уголь', 50)]));
  let b = resourceBlock(state, [1, 2]); const p = b.allocation.find(p => p.id === id); assert.equal(p.load, .5); assert.equal(p.actualOutput, 50); assert.deepEqual(p.consumption.map(c => c.actualAmount), [50, 25]);
  assert.equal(b.resources.find(r => r.resource === 'Железо').net, 50);
  b = resourceBlock(state, [2]); assert.equal(b.allocation[0].actualOutput, 0);
  model.save(2, recipe('Сталь', 100, [input('Железо', 100, 'кг/ход')], { id })); assert.equal(resourceBlock(state, [1, 2]).allocation.find(p => p.id === id).actualOutput, 0);
});
test('cycles cannot start from nothing, but externally produced seed can feed a bounded cycle', t => {
  const { state, model } = fixture(t); model.save(2, recipe('A', 2, [input('B', 1)])); model.save(2, recipe('B', 2, [input('A', 1)]));
  let b = resourceBlock(state, [2]); assert.ok(b.allocation.every(p => p.actualOutput === 0)); assert.ok(b.resources.every(r => r.net === 0));
  model.save(1, production(1, { resource: 'A' })); b = resourceBlock(state, [1, 2]); assert.equal(b.resources.find(r => r.resource === 'A').net, 2); assert.equal(b.resources.find(r => r.resource === 'B').net, 1);
});
test('recipes and priorities validate atomically, survive history and preserve older input-free entries', t => {
  const { state, model, index } = fixture(t), before = state.history.toJSON();
  for (const config of [recipe('Сталь', 0, [input('Железо', 1)]), recipe('Сталь', 10, [input('Железо', -1)]), recipe('Сталь', 10, [input('*', 1)]), recipe('Сталь', 10, [], { priority: -1 }), recipe('Сталь', 10, [], { priority: .5 })]) assert.throws(() => model.save(1, config));
  assert.deepEqual(state.history.toJSON(), before);
  const id = model.save(1, recipe('Сталь', 10, [input('Железо', 5)], { priority: 7 })); const saved = JSON.parse(JSON.stringify(state.toJSON())); state.load(saved, index);
  assert.equal(state.tileMetadata.get(1, id).stats['resource.priority'], 7); assert.equal(state.tileMetadata.get(1, id).stats['resource.inputs'][0].amount, 5);
  model.save(1, production(20, { id, resource: 'Сталь', activity: 'production' })); assert.equal(state.tileMetadata.get(1, id).stats['resource.inputs'][0].amount, 5, 'omitting a recipe in a programmatic edit preserves it'); state.history.undo(); assert.equal(state.tileMetadata.get(1, id).stats['resource.baseOutput'], 10);
  state.tileMetadata.save(2, { title: 'Legacy mine', source: 'resources', kind: 'production', stats: { 'resource.name': 'Железо', 'resource.activity': 'extraction', 'resource.unit': 'т/ход', 'resource.baseOutput': 100 } });
  assert.equal(resourceBlock(state, [2]).resources[0].net, 100);
});
test('repeated collection is read-only, and generated chains conserve every resource and recipe ratio', t => {
  const { state, model } = fixture(t); model.save(1, production(73, { resource: 'R0' })); model.save(1, production(31, { resource: 'R1' }));
  for (let n = 2; n < 18; n++) model.save(n % 3 + 1, recipe('R' + n, 10 + n * 3, [input('R' + (n - 1), 5 + n), input('R' + (n - 2), 4 + n * 2)], { priority: n % 5 }));
  const before = state.history.toJSON(), first = resourceBlock(state, [1, 2, 3]), second = resourceBlock(state, [3, 2, 1]); assert.deepEqual(first, second); assert.deepEqual(state.history.toJSON(), before);
  for (const c of first.resources) { assert.ok(c.net >= 0); assert.ok(c.consumption <= c.gross + 1e-9); assert.ok(c.gross <= c.maximumProduction + 1e-9); }
  for (const p of first.allocation) { assert.ok(p.load >= 0 && p.load <= 1); for (const c of p.consumption) assert.ok(Math.abs(c.actualAmount - c.amount * p.load) < 1e-9); }
});
test('local and global efficiency bonuses reduce the base recipe in order 4, 2, 3, 1 before output scaling', t => {
  const { state, model } = fixture(t); model.save(1, production(100)); const id = model.save(2, recipe('Сталь', 100, [input('Железо', 200)]));
  model.save(2, point([{ type: 'province-input-flat', value: 20 }, { type: 'province-input-percent', value: 50 }, { type: 'province-percent', value: 100 }], { resource: 'Сталь', activity: 'production' }));
  model.save(3, point([{ type: 'global-input-flat', value: 10 }, { type: 'global-input-percent', value: 25 }], { resource: 'Сталь', activity: 'production' }));
  const b = resourceBlock(state, [1, 2, 3]), p = b.allocation.find(p => p.id === id), c = p.inputs[0];
  assert.deepEqual(c.efficiency, { after4: 180, after2: 90, after3: 80, after1: 60 }); assert.equal(c.rawAmount, 400); assert.equal(c.amount, 120);
  assert.ok(Math.abs(p.actualOutput - 200 * 100 / 120) < 1e-9); assert.equal(p.consumption[0].actualAmount, 100);
  assert.equal(b.resources.find(c => c.resource === 'Железо').maximumConsumption, 120);
});
test('local efficiency remains in its province while global efficiency reaches the selected pack', t => {
  const { state, model } = fixture(t); model.save(1, production(1000)); const a = model.save(2, recipe('Сталь', 100, [input('Железо', 200)])), b = model.save(3, recipe('Сталь', 100, [input('Железо', 200)]));
  model.save(2, point([{ type: 'province-input-percent', value: 50 }], { resource: 'Сталь', activity: '*' })); model.save(1, point([{ type: 'global-input-flat', value: 10 }], { resource: 'Сталь', activity: '*' }));
  let r = resourceBlock(state, [1, 2, 3]); assert.equal(r.allocation.find(p => p.id === a).inputs[0].amount, 90); assert.equal(r.allocation.find(p => p.id === b).inputs[0].amount, 190);
  r = resourceBlock(state, [2, 3]); assert.equal(r.allocation.find(p => p.id === a).inputs[0].amount, 100); assert.equal(r.allocation.find(p => p.id === b).inputs[0].amount, 200);
});
test('efficiency ingredient filters distinguish resource and unit without changing other recipe inputs', t => {
  const { state, model } = fixture(t); const id = model.save(2, recipe('Сталь', 100, [input('Железо', 200), input('Железо', 300, 'кг/ход'), input('Уголь', 50)]));
  model.save(1, point([{ type: 'global-input-flat', value: 10, inputResource: 'железо', inputUnit: 'т/ход' }, { type: 'global-input-percent', value: 50, inputResource: 'Уголь' }], { resource: 'Сталь', activity: '*' }));
  const p = resourceBlock(state, [1, 2]).allocation.find(p => p.id === id); assert.deepEqual(p.inputs.map(i => i.amount), [190, 300, 25]); assert.equal(p.actualOutput, 0, 'a cheaper recipe still cannot consume missing ingredients');
});
test('efficiency cannot create negative demand; stacked percentages cap at zero consumption', t => {
  const { state, model } = fixture(t); const id = model.save(2, recipe('Сталь', 100, [input('Железо', 200)]));
  model.save(2, point([{ type: 'province-input-percent', value: 60 }, { type: 'province-input-percent', value: 60 }, { type: 'global-input-flat', value: 1000 }], { resource: 'Сталь', activity: '*' }));
  const b = resourceBlock(state, [2]), p = b.allocation.find(p => p.id === id); assert.equal(p.inputs[0].amount, 0); assert.equal(p.actualOutput, 100); assert.ok(b.resources.every(c => c.net >= 0 && c.consumption >= 0));
  assert.throws(() => model.save(1, point([{ type: 'global-input-flat', value: 1, inputUnit: 42 }])));
});
