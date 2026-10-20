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
test('province menus show single commands for one target and batch commands for any nonempty selection', () => {
  const menu = new TreeMenu({ regionContext: true });
  menu.register({ id: 'single', path: ['Single'], label: 'Edit', handler: () => {} });
  menu.register({ id: 'batch', path: ['Batch'], label: 'Assign', batch: true, handler: () => {} });
  assert.equal(menu.getTree({ regionIds: [] }).length, 0);
  assert.deepEqual(menu.getTree({ id: 1 }).map(group => group.label), ['Single', 'Batch']);
  assert.deepEqual(menu.getTree({ regionIds: [1, 2], id: 1 }).map(group => group.label), ['Batch']);
  assert.equal(menu.getTree({ regionIds: [1, 1] }).length, 2);
});
test('province handlers receive a number or frozen array, with predicates and execution sharing the same context', () => {
  const menu = new TreeMenu({ regionContext: true }), calls = []; let enabled = true;
  menu.register({ id: 'single', label: 'Single', handler: (id, context) => calls.push([id, context.id]) });
  menu.register({ id: 'batch', label: 'Batch', batch: true, when: context => context.regionIds.includes(2), enabled: () => enabled, handler: (ids, context) => { assert.ok(Object.isFrozen(ids)); calls.push([ids, context.id]); } });
  menu.invoke('single', { regionIds: [1, 2] }); menu.invoke('batch', { regionIds: [] }); menu.invoke('batch', { id: 1 });
  menu.invoke('single', { id: 1 }); menu.invoke('batch', { id: 2 }); menu.invoke('batch', { regionIds: [1, 2, 2], id: 1 });
  enabled = false; menu.invoke('batch', { id: 2 });
  assert.deepEqual(calls, [[1, 1], [[2], 2], [[1, 2], null]]);
});
test('ordinary reusable menus retain the original context API and disconnected batch commands cannot run', () => {
  const ordinary = new TreeMenu(), context = { hello: 1 }; let received;
  ordinary.register({ id: 'plain', label: 'Plain', handler: value => received = value }); ordinary.invoke('plain', context); assert.equal(received, context);
  const menu = new TreeMenu({ regionContext: true }), lifetime = new AbortController();
  menu.register({ id: 'batch', label: 'Batch', batch: true, signal: lifetime.signal, handler: () => assert.fail('disconnected') });
  lifetime.abort(); menu.invoke('batch', { id: 1 }); assert.equal(menu.size, 0);
});
test('root menu order stays stable regardless of extension registration order or child priorities', () => {
  const menu = new TreeMenu({ rootOrder: ['Файл', 'Вид', 'Мир', 'Инструменты'] });
  for (const [id, path, order] of [['world', ['Мир', 'Нации'], -200], ['tools', ['Инструменты', 'Выделение'], 0], ['view-b', ['Вид', 'Окна'], 5], ['view-a', ['Вид', 'Окна'], 2], ['file', ['Файл'], -100]]) menu.register({ id, path, order, label: id, handler: () => {} });
  assert.deepEqual(menu.getTree().map(n => n.label), ['Файл', 'Вид', 'Мир', 'Инструменты']);
  assert.deepEqual(menu.getTree({}, ['Вид', 'Окна']).map(n => n.id), ['view-a', 'view-b']);
  menu.unregister('file'); assert.deepEqual(menu.getTree().map(n => n.label), ['Вид', 'Мир', 'Инструменты']);
  assert.throws(() => new TreeMenu({ rootOrder: ['A', 'A'] }));
});
test('window launchers share handler lifecycle and disappear with their extension', async () => {
  require('../packages/ui/controls.js'); require('../packages/ui/index.js');
  const menu = new TreeMenu(), host = new globalThis.AtlasUI.ExtensionHost({ mainMenu: menu }); let action, calls = 0;
  host.register({ id: 'example', start(ctx) {
    action = ctx.action(() => calls++);
    ctx.menu(menu, { id: 'list', path: ['Мир', 'Нации'], label: 'Список', handler: action });
    ctx.windowMenu({ id: 'list', label: 'Нации', handler: action });
  } });
  await host.enable('example');
  assert.equal(menu.getTree({}, ['Вид', 'Окна'])[0].id, 'example:window:list');
  menu.invoke('example:window:list'); menu.invoke('example:list'); assert.equal(calls, 2);
  action.disable(); assert.equal(menu.size, 0); assert.deepEqual(menu.getTree(), []);
  host.disable('example'); await host.enable('example'); assert.equal(menu.size, 2);
  host.disable('example'); assert.equal(menu.size, 0); menu.invoke('example:window:list'); assert.equal(calls, 2);
});
