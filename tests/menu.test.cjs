'use strict';
const test = require('node:test'), assert = require('node:assert/strict'); require('../packages/core/index.js');
const { TreeMenu, ActionHandler } = require('../packages/ui/tree-menu.js');
test('reusable menu removes every registration of a disconnected handler and prunes empty groups', () => {
  const main = new TreeMenu(), tile = new TreeMenu(), action = new ActionHandler(() => {});
  main.register({ id: 'a', path: ['World', 'Nations'], label: 'Paint', handler: action }); tile.register({ id: 'a', label: 'Paint', handler: action }); assert.equal(main.getTree()[0].children[0].children[0].id, 'a');
  action.disable(); assert.equal(main.size, 0); assert.equal(tile.size, 0); assert.equal(main.getTree().length, 0);
});
test('unregistering an entry or destroying its menu does not disable a shared external action', () => {
  const a = new TreeMenu(), b = new TreeMenu(), shared = new ActionHandler(() => {}); a.register({ id: 'one', label: 'One', handler: shared }); b.register({ id: 'two', label: 'Two', handler: shared });
  a.unregister('one'); assert.equal(shared.active, true); assert.equal(b.size, 1); a.register({ id: 'three', label: 'Three', handler: shared }); a.dispose(); assert.equal(shared.active, true); assert.equal(b.size, 1); shared.dispose(); assert.equal(b.size, 0);
});
test('AbortSignal removes owned menu actions automatically and contextual visibility is reusable', () => {
  const menu = new TreeMenu(), controller = new AbortController(); const item = menu.register({ id: 'one', path: ['A'], label: 'B', handler: () => {}, when: c => !!c.id, enabled: c => c.id === 1, signal: controller.signal });
  assert.equal(menu.getTree({}).length, 0); assert.equal(menu.getTree({ id: 2 })[0].children[0].enabled, false); assert.equal(menu.getTree({ id: 1 })[0].children[0].enabled, true); controller.abort(); assert.equal(item.handler.active, false); assert.equal(menu.size, 0);
});
