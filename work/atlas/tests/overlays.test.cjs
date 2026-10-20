'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { OverlayRegistry, getGameState, RegionIndex } = require('../packages/core/index.js');
test('the headless registry orders definitions deterministically and never saves runtime definitions', () => {
  const overlays = new OverlayRegistry(); let settingsChanges = 0; overlays.on('settings:change', () => settingsChanges++);
  const a = overlays.register({ id: 'a', title: 'A', order: 20 }), b = overlays.register({ id: 'b', order: 10 });
  overlays.register({ id: 'c', order: 20, exportable: false }); assert.deepEqual(overlays.list.map(o => o.id), ['b', 'a', 'c']);
  assert.ok(Object.isFrozen(overlays.list)); assert.ok(Object.isFrozen(overlays.get('a'))); assert.equal(overlays.get('c').exportable, false);
  a.dispose(); b.dispose(); assert.equal(settingsChanges, 0); assert.deepEqual(overlays.toJSON(), { version: 1, order: [], visibility: {} });
});
test('visibility and order restore independently of registration order and reset to module defaults', () => {
  const overlays = new OverlayRegistry(); overlays.register({ id: 'a' }); overlays.register({ id: 'b', visible: false });
  overlays.setVisible('b', true); overlays.reorder(['b', 'a']); const saved = overlays.toJSON();
  const restored = new OverlayRegistry(); restored.restore(saved); restored.register({ id: 'a' }); restored.register({ id: 'b', visible: false });
  assert.deepEqual(restored.list.map(o => o.id), ['b', 'a']); assert.equal(restored.get('b').visible, true);
  saved.visibility.b = false; assert.equal(restored.get('b').visible, true, 'preferences are copied');
  restored.reset(); assert.deepEqual(restored.list.map(o => o.id), ['a', 'b']); assert.equal(restored.get('b').visible, false);
});
test('unloaded modules retain their position and visibility while other overlays move', () => {
  const overlays = new OverlayRegistry(), life = new AbortController();
  overlays.register({ id: 'a' }); overlays.register({ id: 'b' }, { signal: life.signal }); overlays.register({ id: 'c' });
  overlays.reorder(['c', 'b', 'a']); overlays.setVisible('b', false); life.abort();
  overlays.move('a', -1); assert.deepEqual(overlays.list.map(o => o.id), ['a', 'c']);
  overlays.register({ id: 'b' }); assert.deepEqual(overlays.list.map(o => o.id), ['a', 'b', 'c']); assert.equal(overlays.get('b').visible, false);
});
test('invalid or disconnected registrations and preferences are atomic, and no-op changes stay quiet', () => {
  const overlays = new OverlayRegistry(), life = new AbortController(); let changes = 0;
  overlays.register({ id: 'a' }); overlays.on('settings:change', () => changes++);
  assert.equal(overlays.setVisible('a', true), null); assert.equal(overlays.move('a', 1), null); overlays.reorder(['a']); assert.equal(changes, 0);
  const before = overlays.toJSON();
  for (const run of [() => overlays.register({ id: 'a' }), () => overlays.register({ id: '__proto__' }), () => overlays.setVisible('missing', false), () => overlays.setVisible('a', 'yes'), () => overlays.reorder([]), () => overlays.reorder(['a', 'a']), () => overlays.restore({ version: 1, order: ['a'], visibility: { a: 1 } }), () => overlays.restore({ version: 2, order: [], visibility: {} })]) assert.throws(run);
  assert.deepEqual(overlays.toJSON(), before); life.abort(); const expired = overlays.register({ id: 'expired' }, { signal: life.signal }); assert.equal(expired.current, null); assert.equal(overlays.has('expired'), false);
});
test('display preferences do not enter actions, history, branches, or shared party exports', () => {
  const state = getGameState(), index = new RegionIndex({ width: 1, height: 1, pixels: [1], regions: [{ id: 1, area: 1, bbox: [0, 0, 1, 1], anchor: [0, 0] }] });
  const project = { schemaVersion: 2, map: { id: 'display-only', original: { dataURL: 'data:image/png;base64,AAAA', width: 1, height: 1 }, indexImage: 'data:image/png;base64,AAAA' }, meta: { object: { exists: true } } };
  state.load(project, index); const a = state.overlays.register({ id: 'display:a' }), b = state.overlays.register({ id: 'display:b' });
  const history = state.history.toJSON(), meta = state.meta; state.overlays.setVisible(a.id, false); state.overlays.reorder([b.id, a.id]); state.overlays.setOptions(a.id, { hiddenResources: ['coal'] });
  assert.deepEqual(state.history.toJSON(), history); assert.equal(state.meta, meta); assert.equal(state.toJSON().overlays, undefined); assert.equal(state.toJSON().meta, undefined);
  assert.equal(state.actions.types.some(d => d.type.startsWith('core.overlay')), false);
  state.history.createBranch('test'); state.setMeta('object', { exists: false }); state.history.undo(); state.history.checkout('test');
  assert.equal(state.overlays.get(a.id).visible, false); assert.deepEqual(state.overlays.list.map(o => o.id), [b.id, a.id]);
  state.load(project, index); assert.equal(state.overlays.get(a.id).visible, false, 'loading a party does not replace local display preferences');
  assert.deepEqual(state.overlays.getOptions(a.id), { hiddenResources: ['coal'] }); a.dispose(); b.dispose(); state.overlays.reset();
});
test('per-overlay view options persist locally, survive unloading and reset with display defaults', () => {
  const overlays = new OverlayRegistry(), registration = overlays.register({ id: 'resources:richness' }); let changes = 0;
  overlays.on('settings:change', () => changes++);
  const options = { hiddenResources: ['coal'], nested: { selected: true } };
  assert.deepEqual(overlays.getOptions(registration.id), {}); assert.equal(overlays.setOptions(registration.id, {}), false);
  overlays.setOptions(registration.id, options); options.hiddenResources.push('water');
  assert.deepEqual(overlays.getOptions(registration.id).hiddenResources, ['coal']); assert(Object.isFrozen(overlays.getOptions(registration.id).nested));
  assert.equal(overlays.setOptions(registration.id, { hiddenResources: ['coal'], nested: { selected: true } }), false); assert.equal(changes, 1);
  const restored = new OverlayRegistry(); restored.restore(overlays.toJSON()); registration.dispose();
  assert.deepEqual(overlays.getOptions('resources:richness').hiddenResources, ['coal']);
  restored.register({ id: 'resources:richness' }); assert.deepEqual(restored.getOptions('resources:richness').hiddenResources, ['coal']);
  const before = restored.toJSON();
  for (const change of [() => restored.setOptions('missing', {}), () => restored.setOptions('resources:richness', []), () => restored.restore({ ...before, options: { a: 1 } }), () => restored.setOptions('resources:richness', { bad: NaN })]) assert.throws(change);
  assert.deepEqual(restored.toJSON(), before); restored.reset(); assert.deepEqual(restored.getOptions('resources:richness'), {});
});
