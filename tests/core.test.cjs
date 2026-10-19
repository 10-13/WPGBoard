'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { History, RegionIndex, getGameState, GameState, EventBus, Scope, equal } = require('../packages/core/index.js');
const fixture = () => new RegionIndex({ width: 3, height: 2, regions: [{ id: 1, area: 2, bbox: [1, 0, 2, 1], anchor: [1, 0] }, { id: 2, area: 2, bbox: [0, 1, 2, 1], anchor: [0, 1] }], pixels: new Uint32Array([0, 1, 1, 2, 2, 0]) });
test('singleton is headless; params, original map, geometry and metadata cannot be changed behind history', () => {
  const state = getGameState(); assert.equal(state, getGameState()); assert.throws(() => new GameState());
  const map = { id: 'fixture', original: { name: 'test.png', dataURL: 'data:image/png;base64,AAAA', width: 3, height: 2 }, indexImage: 'data:image/png;base64,AAAA' };
  state.load({ schemaVersion: 2, map, params: { rules: { version: 1 } }, meta: { domain: { count: 0 } } }, fixture());
  assert.throws(() => { state.params.rules.version = 4; }); assert.throws(() => { state.meta.domain.count = 9; }); assert.throws(() => { state.originalMap.name = 'changed'; });
  assert.equal(state.regions.set, undefined); assert.throws(() => { state.regions.get(1).bbox[0] = 999; });
  state.updateMeta('domain', d => { d.count++; }, { label: 'count' }); assert.equal(state.meta.domain.count, 1); assert.equal(state.history.commits.length, 1);
  state.updateParams(p => { p.rules.version = 2; }); assert.equal(state.params.rules.version, 2); state.history.undo(); assert.equal(state.params.rules.version, 1);
  assert.throws(() => state.setMeta(['__proto__', 'polluted'], true)); assert.equal({}.polluted, undefined);
  const exported = state.toJSON(); state.load(exported, fixture()); assert.equal(state.meta.domain.count, 1); assert.equal(state.history.commits.length, 3);
});
test('region lookup is constant, geometry is validated, run masks cover each region exactly', () => {
  const pixels = new Uint32Array([0, 1]); const index = new RegionIndex({ width: 2, height: 1, pixels, regions: [{ id: 1, area: 1, bbox: [1, 0, 1, 1], anchor: [1, 0] }] });
  pixels[1] = 0; assert.equal(index.idAt(1, 0), 1); assert.equal(index.idAt(NaN, 0), null); assert.equal(index.idAt(-1, 0), null); assert.equal(index.idAt(2, 0), null);
  let area = 0; index.forEachRun(1, (start, length) => { assert.equal(start, 1); area += length; }); assert.equal(area, 1);
  assert.throws(() => new RegionIndex({ width: 1, height: 1, pixels: [4], regions: [{ id: 1, area: 1, bbox: [0, 0, 1, 1], anchor: [0, 0] }] }));
});
test('staged actions do not change the active game; merge retains source history', () => {
  const h = new History({ mapId: 'a', meta: { nation: { owners: { a: 'old' } } } }); h.createBranch('proposal');
  h.update(d => { d.meta.nation.owners.a = 'new'; }, { branch: 'proposal', label: 'proposal' });
  assert.equal(h.snapshot().meta.nation.owners.a, 'old'); assert.equal(h.snapshot('proposal').meta.nation.owners.a, 'new');
  const sourceHead = h.branches.find(b => b.name === 'proposal').head; h.merge('proposal');
  assert.equal(h.snapshot().meta.nation.owners.a, 'new'); assert.equal(h.branches.find(b => b.name === 'proposal').head, sourceHead); assert.equal(h.commits.at(-1).parents.length, 2);
  const count = h.commits.length; assert.equal(h.merge('proposal').commit, null); assert.equal(h.commits.length, count);
});
test('three-way merge handles disjoint edits, new object namespaces and real conflicts atomically', () => {
  const h = new History({ meta: { owners: { a: 'old', b: 'old' } } }); h.createBranch('draft');
  h.update(d => { d.meta.owners.a = 'main'; d.meta.new = { x: 1 }; });
  h.update(d => { d.meta.owners.b = 'draft'; d.meta.new = { y: 2 }; }, { branch: 'draft' }); h.merge('draft');
  assert.deepEqual(h.snapshot().meta, { owners: { a: 'main', b: 'draft' }, new: { x: 1, y: 2 } });
  h.createBranch('conflict'); h.update(d => { d.meta.owners.a = 'ours'; }); h.update(d => { d.meta.owners.a = 'theirs'; }, { branch: 'conflict' });
  const before = h.toJSON(); assert.equal(h.previewMerge('conflict').conflicts.length, 1); assert.throws(() => h.merge('conflict')); assert.deepEqual(h.toJSON(), before);
  h.merge('conflict', { strategy: 'theirs' }); assert.equal(h.snapshot().meta.owners.a, 'theirs');
});
test('deleting a parent conflicts with changes to a child, while equal changes merge cleanly', () => {
  const h = new History({ meta: { a: { x: 1 } } }); h.createBranch('draft'); h.update(d => { delete d.meta.a; }); h.update(d => { d.meta.a.x = 2; }, { branch: 'draft' }); assert.equal(h.previewMerge('draft').conflicts.length, 1);
  h.merge('draft', { strategy: 'ours' }); assert.deepEqual(h.snapshot().meta, {});
  const equalChanges = new History({ meta: { x: 0 } }); equalChanges.createBranch('d'); equalChanges.update(d => { d.meta.x = 1; }); equalChanges.update(d => { d.meta.x = 1; }, { branch: 'd' }); assert.equal(equalChanges.previewMerge('d').conflicts.length, 0);
});
test('undo/redo append compensating records, survive roundtrip, and preserve original actions', () => {
  const h = new History({ meta: { x: 1 } }); h.update(d => { d.meta.x = 2; }); const original = h.commits[0]; h.undo(); assert.equal(h.snapshot().meta.x, 1); assert.equal(h.commits.length, 2); assert.equal(h.canUndo, false); assert.equal(h.canRedo, true);
  const restored = History.fromJSON(JSON.parse(JSON.stringify(h.toJSON()))); restored.redo(); assert.equal(restored.snapshot().meta.x, 2); assert.deepEqual(restored.commits[0], original); assert.equal(restored.commits.at(-1).kind, 'redo');
});
test('branch exchange validates identity and preconditions and never silently applies proposals', () => {
  const a = new History({ mapId: 'same', meta: { a: 0 } }), b = new History({ mapId: 'same', meta: { a: 0 } }); a.createBranch('proposal'); a.update(d => { d.meta.a = 7; }, { branch: 'proposal' });
  const bundle = a.exportBranch('proposal'); b.importBranch(bundle); assert.equal(b.snapshot().meta.a, 0); b.merge('proposal'); assert.equal(b.snapshot().meta.a, 7);
  assert.throws(() => new History({ mapId: 'other', meta: { a: 0 } }).importBranch(bundle));
  const bad = JSON.parse(JSON.stringify(bundle)); bad.commits[0].actions[0].before.value = 900; const target = new History({ mapId: 'same', meta: { a: 0 } }); const before = target.toJSON(); assert.throws(() => target.importBranch(bad)); assert.deepEqual(target.toJSON(), before);
  const cyclic = JSON.parse(JSON.stringify(bundle)); cyclic.commits[0].parents = [cyclic.commits[0].id]; assert.throws(() => target.importBranch(cyclic));
});
test('scope and AbortSignal disconnect event handlers idempotently', () => { const bus = new EventBus(), scope = new Scope(); let calls = 0, disposals = 0; bus.on('test', () => calls++, { signal: scope.signal }); scope.defer(() => disposals++); bus.emit('test'); scope.dispose(); scope.dispose(); bus.emit('test'); assert.equal(calls, 1); assert.equal(disposals, 1); assert.equal(bus.listenerCount('test'), 0); });
test('registered kernel actions are named, addressable and replayable without their extension reducer', () => {
  const state = getGameState(), map = { id: 'actions', original: { name: 'test.png', dataURL: 'data:image/png;base64,AAAA', width: 3, height: 2 }, indexImage: 'data:image/png;base64,AAAA' };
  state.load({ schemaVersion: 2, map, meta: { count: 0 } }, fixture()); const scope = new Scope();
  state.actions.register('test.increment', { label: 'Increment', reduce: (draft, payload) => { draft.meta.count += payload.by; } }, { signal: scope.signal });
  const commit = state.dispatch('test.increment', { by: 3 }); assert.equal(commit.action.type, 'test.increment'); assert.equal(state.history.getAction(commit.action.id).payload.by, 3); assert.equal(state.meta.count, 3);
  scope.dispose(); assert.equal(state.actions.has('test.increment'), false); assert.throws(() => state.dispatch('test.increment', { by: 1 }));
  state.history.revertAction(commit.action.id); assert.equal(state.meta.count, 0); state.history.applyAction(commit.action.id); assert.equal(state.meta.count, 3);
  const saved = state.toJSON(); state.load(saved, fixture()); assert.equal(state.history.getAction(commit.action.id).type, 'test.increment'); assert.equal(state.history.actions.length, 3);
});
test('kernel reducers are synchronous and atomic; nested state writes and history changes are rejected', () => {
  const state = getGameState(), before = state.toJSON();
  const bad = state.actions.register('test.invalid', { reduce: draft => { draft.meta.count = 9; state.setMeta('nested', 1); } });
  assert.throws(() => state.dispatch('test.invalid')); assert.deepEqual(state.toJSON().history, before.history); bad.dispose();
  const asyncAction = state.actions.register('test.async', { reduce: async draft => { draft.meta.count = 10; } }); assert.throws(() => state.dispatch('test.async')); assert.deepEqual(state.toJSON().history, before.history); asyncAction.dispose();
  assert.throws(() => state.updateMeta('count', async () => 10)); assert.deepEqual(state.toJSON().history, before.history);
  assert.throws(() => state.setMeta('date', new Date()));
});
test('large journals roundtrip in topological order and retain independently addressable action IDs', () => {
  const h = new History({ meta: { count: 0 } }); for (let i = 1; i <= 600; i++) h.update(d => { d.meta.count = i; });
  const data = h.toJSON(); data.commits.reverse(); const restored = History.fromJSON(data); assert.equal(restored.snapshot().meta.count, 600); assert.equal(restored.actions.length, 600); assert.equal(new Set(restored.actions.map(a => a.id)).size, 600);
});
