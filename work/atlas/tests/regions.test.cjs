'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { getGameState, RegionIndex, Scope } = require('../packages/core/index.js');
const { RegionsModel } = require('../extensions/regions-model.js');
require('../extensions/nation-relations.js');
const { NationsModel } = require('../extensions/nations-model.js');
function fixture(t) {
  const state = getGameState(), index = new RegionIndex({ width: 3, height: 1, pixels: [1, 2, 3], regions: [1, 2, 3].map((id, i) => ({ id, area: 1, bbox: [i, 0, 1, 1], anchor: [i, 0] })) });
  state.load({ schemaVersion: 2, map: { id: 'region-test', original: { dataURL: 'data:image/png;base64,AAAA', width: 3, height: 1, name: 'test.png' }, indexImage: 'data:image/png;base64,AAAA' }, meta: { nations: { items: { a: { id: 'a', name: 'A', color: '#123456' }, b: { id: 'b', name: 'B', color: '#654321' } }, owners: { 1: 'a', 2: 'b' }, names: { 1: 'One' }, groups: { obsolete: { id: 'obsolete', name: 'Old' } }, groupAssignments: { 1: 'obsolete' } } } }, index);
  const model = new RegionsModel(state), scope = new Scope(); model.registerActions(scope.signal); t.after(() => scope.dispose()); return { state, model, index, scope };
}
test('regions start independently of obsolete nation groups; the nation library no longer exposes group actions', t => {
  const { state, model, scope } = fixture(t), nations = new NationsModel(state); nations.registerActions(scope.signal);
  assert.deepEqual(model.data.items, {}); assert.equal(model.forProvince(1), null); assert.equal(state.history.actions.length, 0);
  assert.equal(nations.setGroup, undefined); assert.equal(nations.assignGroup, undefined); assert.equal(state.actions.has('nations.group.save'), false);
  assert.equal(state.actions.has('nations.group.remove'), false); assert.equal(state.actions.has('nations.region.set'), false);
});
test('creating a named region with selected provinces is one action, and renaming preserves its membership', t => {
  const { state, model } = fixture(t), before = state.meta.nations;
  const id = model.save({ name: ' North ', provinceIds: [1, 2, 2] });
  assert.equal(model.data.items[id].name, 'North'); assert.deepEqual(model.members(id), [1, 2]); assert.equal(state.history.actions.length, 1);
  assert.equal(state.history.actions[0].type, 'regions.save'); assert.equal(model.forProvince(2).id, id); assert.deepEqual(state.meta.nations, before);
  model.save({ id, name: 'Northern region' }); assert.deepEqual(model.members(id), [1, 2]); assert.equal(model.data.items[id].name, 'Northern region');
  state.history.undo(); assert.equal(model.data.items[id].name, 'North'); state.history.undo(); assert.deepEqual(model.data.items, {}); state.history.redo(); assert.deepEqual(model.members(id), [1, 2]);
});
test('batch assignment moves only selected provinces, and clearing them preserves other region members', t => {
  const { state, model } = fixture(t); model.save({ id: 'north', name: 'North', provinceIds: [1, 2] }); model.save({ id: 'south', name: 'South', provinceIds: [3] });
  model.assign([2, 3, 3], 'north'); assert.deepEqual(model.members('north'), [1, 2, 3]); assert.deepEqual(model.members('south'), []);
  assert.deepEqual(state.history.actions.at(-1).payload.provinceIds, [2, 3]);
  model.assign([1, 3], null); assert.deepEqual(model.members('north'), [2]); assert.equal(model.forProvince(1), null); assert.ok(model.data.items.south);
  state.history.undo(); assert.deepEqual(model.members('north'), [1, 2, 3]);
});
test('removing a region clears its assignments atomically and undo restores both', t => {
  const { state, model } = fixture(t); model.save({ id: 'north', name: 'North', provinceIds: [1, 2] }); model.save({ id: 'south', name: 'South', provinceIds: [3] });
  model.remove('north'); assert.equal(model.data.items.north, undefined); assert.equal(model.forProvince(1), null); assert.deepEqual(model.members('south'), [3]);
  state.history.undo(); assert.deepEqual(model.members('north'), [1, 2]); assert.equal(model.data.items.north.name, 'North');
});
test('invalid names, unsafe IDs, missing provinces and unknown target regions fail without changing history', t => {
  const { state, model } = fixture(t), before = state.toJSON();
  for (const run of [() => model.save({ name: '' }), () => model.save({ id: '__proto__', name: 'Bad' }), () => model.save({ name: 'Bad', provinceIds: [99] }), () => model.assign([1], 'unknown'), () => model.assign([1, 99], null), () => model.remove('unknown'), () => state.dispatch('regions.assign', { provinceIds: '1', regionId: null })]) assert.throws(run);
  assert.deepEqual(state.toJSON(), before);
});
test('region actions survive export, restoration and independent reversal with the library disabled', t => {
  const { state, model, index, scope } = fixture(t); const id = model.save({ name: 'Saved', provinceIds: [1, 3] }); model.assign([2], id);
  const saved = JSON.parse(JSON.stringify(state.toJSON())); scope.dispose(); state.load(saved, index); assert.equal(state.actions.has('regions.assign'), false); assert.deepEqual(model.members(id), [1, 2, 3]);
  state.history.undo(); assert.deepEqual(model.members(id), [1, 3]); state.history.redo(); assert.deepEqual(model.members(id), [1, 2, 3]);
});
test('region changes merge independently of national ownership and do not mutate the map index', t => {
  const { state, model, scope, index } = fixture(t), nations = new NationsModel(state); nations.registerActions(scope.signal);
  state.history.createBranch('plan'); state.history.checkout('plan'); model.save({ id: 'north', name: 'North', provinceIds: [1, 2] }); state.history.checkout('main');
  nations.assign([1, 3], 'b'); state.history.merge('plan'); assert.deepEqual(model.members('north'), [1, 2]); assert.equal(state.meta.nations.owners[1], 'b'); assert.equal(state.regionIndex, index);
  assert.deepEqual(nations.nationsFor([1, 2, 2, 3]), ['b']); nations.assign([1], 'a'); assert.deepEqual(nations.nationsFor([1, 2, 3]), ['a', 'b']);
});
