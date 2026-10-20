'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { getGameState, RegionIndex, Scope, clone } = require('../packages/core/index.js');
const { DEFAULT_RESOURCE_CATALOG: defaults } = require('../extensions/resource-catalog-data.js');
const { ResourceCatalog, calculateBlueprintCost, validateCatalog } = require('../extensions/resource-catalog.js');
const totals = node => Object.fromEntries(node.raw.map(row => [row.resourceId, row.amount]));
function fixture(t) {
  const state = getGameState(), index = new RegionIndex({ width: 1, height: 1, pixels: [1], regions: [{ id: 1, area: 1, bbox: [0, 0, 1, 1], anchor: [0, 0] }] });
  state.load({ schemaVersion: 2, map: { id: 'catalog-test', original: { dataURL: 'data:image/png;base64,AAAA', width: 1, height: 1 }, indexImage: 'data:image/png;base64,AAAA' }, meta: { unrelated: 'retained' } }, index);
  const model = new ResourceCatalog(state), scope = new Scope(); model.registerActions(scope.signal); t.after(() => scope.dispose()); return { state, index, model, scope };
}
test('the base catalog is headless, immutable and available without changing history or placing objects', t => {
  const { state, model } = fixture(t); validateCatalog(defaults);
  assert.equal(model.data, defaults); assert.ok(Object.isFrozen(defaults.recipes.steelmaking.inputs));
  assert.equal(defaults.resources.steel.kind, 'product'); assert.equal(defaults.resources.cotton.kind, 'raw');
  for (const r of Object.values(defaults.resources)) assert.equal(model.cost(r.id).complete, true, r.id);
  assert.equal(state.history.actions.length, 0); assert.equal(state.meta.resources, undefined); assert.equal(state.meta.tiles, undefined);
});
test('nested costs scale every recipe proportionally and sum repeated raw ingredients', () => {
  const plan = calculateBlueprintCost(defaults, 'armor', 2.5);
  assert.deepEqual(totals(plan), { 'iron-ore': 15, coal: 10, 'alloy-ore': 2.5 });
  const alloy = plan.inputs[0], steel = alloy.inputs[0], iron = steel.inputs[0];
  assert.deepEqual(totals(alloy), totals(plan)); assert.equal(steel.amount, 10); assert.equal(iron.amount, 10);
  assert.deepEqual(totals(iron), { 'iron-ore': 15, coal: 5 }); assert.equal(plan.batches, 2.5);
  assert.deepEqual(totals(calculateBlueprintCost(defaults, 'armor', .25)), { 'iron-ore': 1.5, coal: 1, 'alloy-ore': .25 });
});
test('alternative recipes apply throughout the tree, including synthesis instead of a natural resource', () => {
  const ordinary = calculateBlueprintCost(defaults, 'airframe'), wood = calculateBlueprintCost(defaults, 'airframe', 1, { recipes: { airframe: 'wood-airframe' } });
  assert.deepEqual(totals(ordinary), { bauxite: 6, coal: 1.8, rubber: 1 });
  assert.deepEqual(totals(wood), { timber: 9, cotton: 3, rubber: 1 });
  const synthetic = calculateBlueprintCost(defaults, 'airframe', 1, { recipes: { airframe: 'wood-airframe', rubber: 'synthetic-rubber' } });
  assert.deepEqual(totals(synthetic), { timber: 9, cotton: 3, coal: 2, oil: .5 });
  assert.deepEqual(totals(calculateBlueprintCost(defaults, 'fuel', 2, { recipes: { fuel: 'synthetic-fuel' } })), { coal: 8, water: 2 });
});
test('multiple outputs retain proportional coproducts and charge the full input without silent credits', () => {
  const data = clone(defaults); data.recipes['oil-refining'].outputs.push({ resourceId: 'rubber', amount: 1 });
  const plan = calculateBlueprintCost(data, 'fuel', 1);
  assert.deepEqual(totals(plan), { oil: 4 / 3 }); assert.deepEqual(plan.outputs, [{ resourceId: 'fuel', amount: 1 }, { resourceId: 'rubber', amount: 1 / 3 }]);
  data.recipes['coal-power'].inputs = []; assert.deepEqual(totals(calculateBlueprintCost(data, 'energy')), {});
});
test('missing recipes, cycles and bounded expansions remain explicit instead of becoming free raw materials', () => {
  const data = clone(defaults); delete data.recipes.steelmaking;
  let node = calculateBlueprintCost(data, 'armor'); assert.equal(node.complete, false); assert.ok(node.unresolved.some(r => r.resourceId === 'steel'));
  data.recipes.steelmaking = { id: 'steelmaking', name: 'Cycle', description: '', inputs: [{ resourceId: 'armor', amount: 1 }], outputs: [{ resourceId: 'steel', amount: 2 }] };
  node = calculateBlueprintCost(data, 'armor'); assert.equal(node.inputs[0].inputs[0].inputs[0].status, 'cycle'); assert.equal(node.complete, false);
  node = calculateBlueprintCost(defaults, 'armor', 1, { maxNodes: 1 }); assert.equal(node.inputs[0].status, 'limit'); assert.equal(node.complete, false);
  assert.equal(calculateBlueprintCost(defaults, 'steel', 1, { recipes: { steel: 'removed' } }).status, 'missing');
});
test('catalog edits are kernel actions, materialize the base once and preserve tiles, defaults and unrelated metadata', t => {
  const { state, model } = fixture(t), before = clone(defaults);
  const id = model.saveResource({ name: 'Test resource', category: 'Tests', unit: 'т', kind: 'raw' });
  assert.equal(state.history.actions.length, 1); assert.equal(state.history.actions[0].type, 'resources.catalog.resource.save');
  assert.equal(model.data.resources[id].unit, 'т'); assert.deepEqual(defaults, before); assert.equal(state.meta.unrelated, 'retained'); assert.equal(state.meta.tiles, undefined);
  const recipeId = model.saveRecipe({ name: 'Test blueprint', inputs: [{ resourceId: id, amount: 3 }], outputs: [{ resourceId: 'steel', amount: 2 }] });
  assert.deepEqual(totals(model.cost('steel', 4, { recipes: { steel: recipeId } })), { [id]: 6 });
  state.history.undo(); assert.equal(model.data.recipes[recipeId], undefined); state.history.redo(); assert.equal(model.data.recipes[recipeId].name, 'Test blueprint');
});
test('invalid edits and deleting referenced resources are atomic; removing recipes leaves visible unresolved dependencies', t => {
  const { state, model } = fixture(t), before = state.history.toJSON();
  for (const amount of [0, -1, NaN, Infinity]) assert.throws(() => model.saveRecipe({ name: 'Invalid', inputs: [], outputs: [{ resourceId: 'steel', amount }] }));
  assert.throws(() => model.saveRecipe({ id: '__proto__', name: 'Unsafe', outputs: [{ resourceId: 'steel', amount: 1 }] }));
  assert.throws(() => model.saveRecipe({ name: 'Foreign', outputs: [{ resourceId: 'missing', amount: 1 }] }));
  assert.throws(() => model.saveRecipe({ name: 'Empty', outputs: [] }));
  assert.throws(() => model.saveRecipe({ name: 'Duplicate', outputs: [{ resourceId: 'steel', amount: 1 }, { resourceId: 'steel', amount: 2 }] }));
  assert.throws(() => model.saveResource({ name: 'сталь', category: 'Duplicate' })); assert.throws(() => model.removeResource('coal'));
  assert.deepEqual(state.history.toJSON(), before); assert.equal(state.meta.resources, undefined);
  model.removeRecipe('steelmaking'); assert.equal(model.cost('steel').complete, false); state.history.undo(); assert.equal(model.cost('steel').complete, true);
  const id = model.saveResource({ name: 'Unused', category: 'Tests' }); model.removeResource(id); assert.equal(model.data.resources[id], undefined);
});
test('exports, branches, undo and extension shutdown retain authored blueprints independently of registered reducers', t => {
  const { state, model, scope, index } = fixture(t);
  model.saveResource({ ...defaults.resources.coal, description: 'Changed' }); state.history.createBranch('proposal'); state.history.checkout('proposal');
  model.saveRecipe({ ...defaults.recipes.steelmaking, outputs: [{ resourceId: 'steel', amount: 4 }] });
  assert.deepEqual(totals(model.cost('steel', 4)), { 'iron-ore': 3, coal: 2 }); state.history.checkout('main'); assert.deepEqual(totals(model.cost('steel', 4)), { 'iron-ore': 6, coal: 4 });
  state.history.merge('proposal'); const saved = JSON.parse(JSON.stringify(state.toJSON())); scope.dispose(); state.load(saved, index);
  assert.equal(state.actions.has('resources.catalog.recipe.save'), false); assert.deepEqual(totals(model.cost('steel', 4)), { 'iron-ore': 3, coal: 2 });
  state.history.undo(); assert.deepEqual(totals(model.cost('steel', 4)), { 'iron-ore': 6, coal: 4 });
});
test('cost evaluation cannot mutate the catalog and rejects nonfinite or overflowing quantities', () => {
  const before = clone(defaults); calculateBlueprintCost(defaults, 'airship', 5); assert.deepEqual(defaults, before);
  for (const amount of [0, -1, NaN, Infinity, '2']) assert.throws(() => calculateBlueprintCost(defaults, 'steel', amount));
  assert.throws(() => calculateBlueprintCost(defaults, 'missing', 1)); assert.throws(() => calculateBlueprintCost(defaults, 'armor', Number.MAX_VALUE));
});
