'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('../packages/core/index.js');
const { RegionSelection } = require('../packages/ui/region-selection.js');
test('selection replaces, toggles and batches valid regions without duplicates or redundant changes', () => {
  const selection = new RegionSelection({ valid: id => [1, 2, 3].includes(id) }), changes = [];
  selection.on('change', event => changes.push(event.regionIds));
  selection.replace([1, 1, 99]); selection.toggle(2); selection.toggle(1);
  assert.deepEqual(selection.ids, [2]); selection.add([2, 3]); selection.add([3]); selection.toggle(99);
  assert.deepEqual(selection.ids, [2, 3]); assert.equal(selection.has(3), true); assert.equal(changes.length, 4);
  selection.remove([3, 99]); selection.clear(); selection.clear(); assert.equal(selection.size, 0); assert.equal(changes.length, 6);
});
test('context targeting keeps a selected group, replaces an outside target and clears empty space', () => {
  const selection = new RegionSelection(); selection.replace([1, 2]);
  const snapshot = selection.forContext(2); assert.deepEqual(snapshot, [1, 2]); assert.ok(Object.isFrozen(snapshot));
  selection.toggle(3); assert.deepEqual(snapshot, [1, 2]);
  assert.deepEqual(selection.forContext(4), [4]); assert.deepEqual(selection.forContext(null), []);
});
test('selection never mutates caller arrays and can reset after changing the map', () => {
  let valid = new Set([1, 2]); const selection = new RegionSelection({ valid: id => valid.has(id) });
  const ids = [1, 2]; selection.replace(ids); ids.push(99); assert.deepEqual(selection.ids, [1, 2]);
  valid = new Set([3]); selection.clear(); selection.add([1, 3]); assert.deepEqual(selection.ids, [3]);
});
