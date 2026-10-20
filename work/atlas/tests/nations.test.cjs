'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { getGameState, RegionIndex, Scope, History } = require('../packages/core/index.js');
const { warKey } = require('../extensions/nation-relations.js');
const { NationsModel } = require('../extensions/nations-model.js');
function fixture(t) {
  const state = getGameState(), index = new RegionIndex({ width: 2, height: 1, pixels: [1, 2], regions: [1, 2].map((id, i) => ({ id, area: 1, bbox: [i, 0, 1, 1], anchor: [i, 0] })) });
  state.load({ schemaVersion: 2, map: { id: 'wars', original: { dataURL: 'data:image/png;base64,AAAA', width: 2, height: 1, name: 'test.png' }, indexImage: 'data:image/png;base64,AAAA' }, meta: { nations: { items: Object.fromEntries(['a', 'b', 'c'].map(id => [id, { id, name: id.toUpperCase(), color: '#517eaa' }])), owners: { 1: 'a', 2: 'b' }, groups: {}, groupAssignments: {}, names: {} } } }, index);
  const model = new NationsModel(state), scope = new Scope(); model.registerActions(scope.signal); t.after(() => scope.dispose());
  return { state, model, index, scope };
}
test('existing parties start at peace; one canonical action changes both enemy lists', t => {
  const { state, model } = fixture(t); assert.deepEqual(model.enemies('a'), []); assert.equal(state.history.actions.length, 0);
  model.setWar('b', 'a', true); assert.equal(model.atWar('a', 'b'), true); assert.equal(model.atWar('b', 'a'), true);
  assert.deepEqual(model.enemies('a').map(n => n.id), ['b']); assert.deepEqual(model.enemies('b').map(n => n.id), ['a']);
  assert.deepEqual(state.meta.nations.wars, { [warKey('a', 'b')]: ['a', 'b'] });
  assert.equal(state.history.actions.at(-1).type, 'nations.war.set'); assert.equal(state.history.actions.at(-1).payload.atWar, true);
  model.setWar('a', 'b', true); assert.equal(state.history.actions.length, 1, 'reverse order does not duplicate a war');
  model.setWar('a', 'c', true); assert.equal(model.enemies('a').length, 2); assert.equal(model.enemies('b').length, 1);
});
test('peace, independent action reversal and save/restore retain symmetric relations without an installed reducer', t => {
  const { state, model, index, scope } = fixture(t); model.setWar('a', 'b', true); const war = state.history.actions.at(-1);
  model.setWar('b', 'a', false); const peace = state.history.actions.at(-1); assert.equal(model.atWar('a', 'b'), false);
  state.history.undo(); assert.equal(model.atWar('a', 'b'), true); state.history.redo(); assert.equal(model.atWar('a', 'b'), false);
  state.history.revertAction(peace.id); assert.equal(model.atWar('a', 'b'), true);
  const saved = JSON.parse(JSON.stringify(state.toJSON())); scope.dispose(); state.load(saved, index);
  assert.equal(model.atWar('b', 'a'), true); assert.equal(state.actions.has('nations.war.set'), false);
  state.history.revertAction(war.id); assert.equal(model.atWar('a', 'b'), false);
});
test('invalid declarations are rejected atomically', t => {
  const { state, model } = fixture(t), before = state.toJSON();
  for (const args of [['a', 'a', true], ['a', 'missing', true], ['a', 'constructor', true], ['a', 'b', 'yes']]) assert.throws(() => model.setWar(...args));
  assert.deepEqual(state.toJSON().history, before.history);
});
test('deleting a nation removes its wars and ownership together; undo restores both', t => {
  const { state, model } = fixture(t); model.setWar('a', 'b', true); model.setWar('a', 'c', true); model.setWar('b', 'c', true);
  model.removeNation('a'); assert.deepEqual(model.enemies('b').map(n => n.id), ['c']); assert.equal(Object.keys(model.data.wars).length, 1); assert.equal(model.data.owners[1], undefined);
  state.history.undo(); assert.equal(model.data.owners[1], 'a'); assert.equal(model.enemies('a').length, 2); assert.equal(model.enemies('b').length, 2);
});
test('wars can be staged, exchanged and merged as kernel history while preserving other relations', t => {
  const { state, model } = fixture(t); state.history.createBranch('proposal'); state.history.checkout('proposal'); model.setWar('a', 'b', true);
  const bundle = state.history.exportBranch('proposal'); state.history.checkout('main'); assert.equal(model.atWar('a', 'b'), false);
  model.setWar('b', 'c', true); state.history.merge('proposal'); assert.equal(model.atWar('a', 'b'), true); assert.equal(model.atWar('b', 'c'), true);
  const other = new History({ mapId: state.history.mapId, ...state.history.baseline }); other.importBranch(bundle); assert.equal(other.snapshot().meta.nations.wars, undefined);
  other.merge('proposal'); assert.deepEqual(other.snapshot().meta.nations.wars[warKey('a', 'b')], ['a', 'b']);
});
