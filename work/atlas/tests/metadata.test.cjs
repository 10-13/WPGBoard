'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { getGameState, RegionIndex, History } = require('../packages/core/index.js');
const { registerBasicStatistics } = require('../packages/statistics/basic.js'); let basic;
function fixture() {
  const state = getGameState(), index = new RegionIndex({ width: 3, height: 1, pixels: [1, 1, 2], regions: [{ id: 1, area: 2, bbox: [0, 0, 2, 1], anchor: [0, 0] }, { id: 2, area: 1, bbox: [2, 0, 1, 1], anchor: [2, 0] }] });
  state.load({ schemaVersion: 2, map: { id: 'metadata', original: { dataURL: 'data:image/png;base64,AAAA', width: 3, height: 1, name: 'test.png' }, indexImage: 'data:image/png;base64,AAAA' }, meta: {} }, index); basic?.dispose(); basic = registerBasicStatistics(state); return { state, index };
}
test('generic entries preserve arbitrary JSON stats and use intrinsic kernel actions', () => {
  const { state } = fixture(); assert.deepEqual(state.tileMetadata.list(1), []);
  const id = state.tileMetadata.save(1, { title: 'Port', description: 'Harbor', stats: { population: 20, biome: 'coast', rules: { enabled: true } } });
  const entry = state.tileMetadata.get(1, id); assert.equal(entry.title, 'Port'); assert.equal(entry.stats.rules.enabled, true);
  assert.throws(() => { entry.stats.population = 99; }); assert.throws(() => state.tileMetadata.list(1).push(entry));
  assert.equal(state.history.actions.at(-1).type, 'core.tile.entry.save'); state.history.undo(); assert.equal(state.tileMetadata.get(1, id), null); state.history.redo(); assert.equal(state.tileMetadata.get(1, id).stats.population, 20);
  state.tileMetadata.remove(1, id); assert.deepEqual(state.tileMetadata.list(1), []); state.history.undo(); assert.equal(state.tileMetadata.get(1, id).description, 'Harbor');
});
test('entry edits validate region, title, numeric data and unsafe stat keys atomically', () => {
  const { state } = fixture(), before = state.history.toJSON();
  for (const [regionId, value] of [[99, { title: 'X' }], [1, { title: '' }], [1, { title: 'X', stats: { broken: Infinity } }], [1, { title: 'X', stats: [] }], [1, { title: 'X', stats: JSON.parse('{"__proto__":2}') }]]) assert.throws(() => state.tileMetadata.save(regionId, value));
  assert.deepEqual(state.history.toJSON(), before);
});
test('metadata branches, merge and roundtrip retain independent entries', () => {
  const { state, index } = fixture(); state.history.createBranch('draft'); state.history.checkout('draft'); state.tileMetadata.save(1, { id: 'mine', title: 'Mine', stats: { output: 10 } });
  state.history.checkout('main'); state.tileMetadata.save(2, { id: 'town', title: 'Town', stats: { population: 3 } }); state.history.merge('draft');
  const saved = JSON.parse(JSON.stringify(state.toJSON())); state.load(saved, index); assert.equal(state.tileMetadata.list(1).length, 1); assert.equal(state.tileMetadata.list(2).length, 1);
  const restored = History.fromJSON(saved.history); assert.equal(restored.snapshot().meta.tiles[1].entries.mine.stats.output, 10);
});
test('statistics deduplicate regions and provide area and fallback sums without plugins', () => {
  const { state } = fixture(); state.tileMetadata.save(1, { title: 'A', stats: { population: 20, biome: 'coast' } }); state.tileMetadata.save(2, { title: 'B', stats: { population: 30 } });
  const report = state.statistics.collect([2, 1, 1]); assert.deepEqual(report.regionIds, [1, 2]);
  assert.equal(report.value(['basic.geometry', 'area']), 3); assert.equal(report.value(['basic.metadata', 'stats', 'population']), 50); assert.equal(report.value(['basic.metadata', 'entries']), 2);
  assert.throws(() => state.statistics.collect([99])); assert.equal(state.statistics.collect([]).value(['basic.geometry', 'count']), 0);
});
test('stat interpreters claim keys, detach by signal, and cannot alter the game or break other collectors', () => {
  const { state } = fixture(), signal = new AbortController(); state.tileMetadata.save(1, { title: 'A', stats: { population: 20, reserve: 7 } });
  const before = state.history.toJSON();
  state.statistics.registerInterpreter('population', { title: 'People', keys: ['population'], collect: c => ({ children: [{ id: 'people', title: 'People', value: c.values('population').reduce((n, v) => n + v.value, 0), unit: 'чел.' }] }) }, { signal: signal.signal });
  state.statistics.register('bad', { collect: () => { state.setMeta('broken', true); return { children: [] }; } }, { signal: signal.signal });
  state.statistics.register('bad-history', { collect: () => { state.history.createBranch('broken'); return { children: [] }; } }, { signal: signal.signal });
  state.statistics.register('async', { collect: async () => ({ children: [] }) }, { signal: signal.signal });
  const report = state.statistics.collect([1]); assert.equal(report.errors.length, 3); assert.equal(report.value(['population', 'people']), 20); assert.equal(!!report.get(['basic.metadata', 'stats', 'population']), false);
  assert.deepEqual(state.history.toJSON(), before); signal.abort(); assert.equal(state.statistics.list.length, 2); assert.equal(state.statistics.collect([1]).value(['basic.metadata', 'stats', 'population']), 20);
});
test('the kernel has no built-in calculators: libraries register and dispose them independently', () => {
  const { state } = fixture(); basic.dispose(); assert.deepEqual(state.statistics.collect([1]).tree, []);
  const custom = state.statistics.register('custom', { collect: c => ({ children: [{ id: 'count', title: 'Count', value: c.regions.length }] }) }); assert.equal(state.statistics.collect([1, 2]).value(['custom', 'count']), 2); custom.dispose(); assert.deepEqual(state.statistics.list, []);
});
test('each calculator owns a folder; nested leaves have stable paths, units and serializable values', () => {
  const { state } = fixture();
  const registration = state.statistics.register('custom.tree', { title: 'Tree', collect: () => ({ children: [{ id: 'folder', title: 'Nested', children: [{ id: 'zero', title: 'Result', value: 0, unit: 'т' }] }] }) });
  const result = state.statistics.calculate([1, 2]); assert.equal(result.get('custom.tree').type, 'folder'); assert.equal(result.get(['custom.tree', 'folder']).type, 'folder'); assert.equal(result.value(['custom.tree', 'folder', 'zero']), 0); assert.equal(result.get(['custom.tree', 'folder', 'zero']).unit, 'т'); assert.equal(result.get(['custom.tree', 'missing']), null); assert.equal(result.value('custom.tree'), undefined);
  assert.throws(() => { result.get(['custom.tree', 'folder', 'zero']).value = 1; });
  assert.deepEqual(JSON.parse(JSON.stringify(result)).tree, result.tree); registration.dispose();
});
test('invalid result trees fail in isolation and do not suppress the remaining calculator folders', () => {
  const { state } = fixture();
  const a = state.statistics.register('bad.tree', { collect: () => ({ children: [{ id: 'same', value: 1 }, { id: 'same', value: 2 }] }) });
  const b = state.statistics.register('bad.folder', { collect: () => ({ children: [{ id: 'both', value: 1, children: [] }] }) });
  const r = state.statistics.collect([1]); assert.equal(r.errors.length, 2); assert.equal(r.tree.length, 2); assert.equal(r.value(['basic.geometry', 'area']), 2); a.dispose(); b.dispose();
});
