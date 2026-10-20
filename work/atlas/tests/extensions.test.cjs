'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { EventBus } = require('../packages/core/index.js');
const { RegionClicks } = require('../packages/ui/region-clicks.js');
const { ExtensionHost } = require('../packages/ui/extensions.js');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture() {
  const objects = new Map();
  const register = (options) => {
    objects.set(options.id, options);
    options.signal.addEventListener('abort', () => objects.delete(options.id), { once: true });
    return options;
  };
  const ui = {
    state: { meta: { retained: true }, history: [] },
    input: new EventBus(),
    regionClicks: new RegionClicks(),
    mainMenu: { register },
    windows: { open: register },
    viewport: { addOverlay: register },
  };
  const host = new ExtensionHost(ui);
  ui.extensions = host;
  return { host, ui, objects };
}
test('extensions remain a tree; every ancestor is an implicit dependency and external dependencies do not move nodes', async () => {
  const { host } = fixture(),
    started = [];
  host.register({
    id: 'world',
    start() {
      started.push('world');
    },
    children: [
      {
        id: 'economy',
        start() {
          started.push('economy');
        },
        children: [
          {
            id: 'nations',
            requires: ['nations'],
            start() {
              started.push('integration');
            },
          },
        ],
      },
    ],
  });
  host.register({
    id: 'nations',
    start() {
      started.push('nations');
    },
  });
  assert.deepEqual(
    host.list.map((node) => [node.id, node.depth]),
    [
      ['world', 0],
      ['world:economy', 1],
      ['world:economy:nations', 2],
      ['nations', 0],
    ],
  );
  assert.deepEqual(host.list[2].requires, ['world', 'world:economy', 'nations']);
  await host.enable('world');
  assert.equal(host.isEnabled('world:economy'), true);
  assert.equal(host.isEnabled('world:economy:nations'), false);
  assert.equal(host.list[2].status, 'waiting');
  assert.deepEqual(host.list[2].missing, ['nations']);
  await host.enable('nations');
  assert.equal(host.isEnabled('world:economy:nations'), true);
  assert.deepEqual(started, ['world', 'economy', 'nations', 'integration']);
  assert.equal(host.tree[0].children[0].children[0].parentId, 'world:economy');
});
test('enabling a child starts its parents and declared dependencies in order and gives only declared APIs', async () => {
  const { host, ui } = fixture(),
    seen = [],
    before = JSON.stringify(ui.state);
  host.register({
    id: 'a',
    start(ctx) {
      ctx.provide({ value: 7 });
      seen.push('a');
    },
    children: [
      {
        id: 'bridge',
        requires: ['b'],
        start(ctx) {
          assert.equal(ctx.require('a').value, 7);
          assert.equal(ctx.require('b').value, 9);
          assert.throws(() => ctx.require('hidden'), /не объявлена/);
          seen.push('bridge');
          ctx.provide({ sum: 16 });
        },
      },
    ],
  });
  host.register({
    id: 'b',
    start(ctx) {
      ctx.provide({ value: 9 });
      seen.push('b');
    },
  });
  await host.enable('a:bridge');
  assert.deepEqual(seen, ['a', 'b', 'bridge']);
  assert.equal(host.getAPI('a:bridge').sum, 16);
  assert.equal(JSON.stringify(ui.state), before);
});
test('disable releases consumers before dependencies, restores requested children and respects individually disabled children', async () => {
  const { host } = fixture(),
    stopped = [];
  host.register({
    id: 'a',
    start() {
      return () => stopped.push('a');
    },
    children: [
      {
        id: 'bridge',
        requires: ['b'],
        start() {
          return () => stopped.push('bridge');
        },
      },
      {
        id: 'other',
        start() {
          return () => stopped.push('other');
        },
      },
    ],
  });
  host.register({
    id: 'b',
    start() {
      return () => stopped.push('b');
    },
  });
  await host.enable('a:bridge');
  host.disable('b');
  assert.deepEqual(stopped, ['bridge', 'b']);
  assert.equal(host.isEnabled('a'), true);
  assert.equal(host.isEnabled('a:other'), true);
  assert.equal(host.list.find((n) => n.id === 'a:bridge').requested, true);
  await host.enable('b');
  assert.equal(host.isEnabled('a:bridge'), true);
  host.disable('a:other');
  host.disable('a');
  assert.equal(stopped.at(-1), 'a');
  assert.equal(host.getAPI('a'), undefined);
  await host.enable('a');
  assert.equal(host.isEnabled('a:bridge'), true);
  assert.equal(host.isEnabled('a:other'), false);
});
test('missing dependencies are explained and cycles or duplicate registrations are rejected atomically', async () => {
  const { host } = fixture();
  host.register({ id: 'a', requires: ['b'], start() {} });
  await assert.rejects(host.enable('a'), /не найдено: b/);
  assert.equal(host.list[0].requested, false);
  assert.throws(() => host.register({ id: 'b', requires: ['a'], start() {} }), /Цикл/);
  assert.deepEqual(
    host.list.map((n) => n.id),
    ['a'],
  );
  assert.throws(
    () =>
      host.register({
        id: 'b',
        start() {},
        children: [
          { id: 'x', start() {} },
          { id: 'x', start() {} },
        ],
      }),
    /уже зарегистрировано/,
  );
  assert.deepEqual(
    host.list.map((n) => n.id),
    ['a'],
  );
  assert.throws(
    () =>
      host.register({
        id: 'x',
        start() {},
        children: [
          {
            id: 'bad',
            requires: ['x'],
            children: [{ id: 'loop', requires: ['x:bad'], start() {} }],
            start() {},
          },
        ],
        requires: ['x:bad:loop'],
      }),
    /Цикл/,
  );
  host.register({ id: 'b', start() {} });
  await host.enable('a');
  assert.equal(host.isEnabled('a'), true);
});
test('concurrent enables share startup; disabling a pending start prevents resurrection and disposes late cleanup', async () => {
  const { host } = fixture(),
    gate = deferred();
  let starts = 0,
    disposed = 0;
  host.register({
    id: 'slow',
    async start() {
      starts++;
      await gate.promise;
      return () => disposed++;
    },
    children: [
      {
        id: 'child',
        start() {
          assert.fail('parent was canceled');
        },
      },
    ],
  });
  const one = host.enable('slow'),
    two = host.enable('slow');
  await tick();
  assert.equal(starts, 1);
  assert.equal(host.isEnabled('slow'), false);
  host.disable('slow');
  gate.resolve();
  assert.deepEqual(await Promise.all([one, two]), [false, false]);
  assert.equal(disposed, 1);
  assert.equal(host.isEnabled('slow'), false);
  assert.equal(host.isEnabled('slow:child'), false);
});
test('unregister removes only its subtree, stops external consumers and lets replacements restart them', async () => {
  const { host } = fixture();
  const off = host.register({ id: 'a', start() {}, children: [{ id: 'child', start() {} }] });
  host.register({ id: 'b', requires: ['a:child'], start() {} });
  await host.enable('b');
  off();
  assert.deepEqual(
    host.list.map((n) => n.id),
    ['b'],
  );
  assert.equal(host.isEnabled('b'), false);
  assert.deepEqual(host.list[0].missing, ['a:child']);
  host.register({ id: 'a', start() {}, children: [{ id: 'child', start() {} }] });
  await host.enable('a');
  assert.equal(host.isEnabled('b'), true);
  off();
  assert.equal(host.isEnabled('a'), true);
});
test('scoped menus, windows, overlays and province observers are released across dependency links', async () => {
  const { host, ui, objects } = fixture();
  let events = 0,
    clicks = 0;
  host.register({
    id: 'a',
    start() {},
    children: [
      {
        id: 'link',
        requires: ['b'],
        start(ctx) {
          ctx.menu(ui.mainMenu, { id: 'command' });
          ctx.window({ id: 'pane' });
          ctx.overlay({ id: 'map' });
          ctx.on('probe', () => events++);
          ctx.onRegionClick(() => clicks++);
        },
      },
    ],
  });
  host.register({ id: 'b', start() {} });
  await host.enable('a:link');
  assert.equal(objects.size, 3);
  ui.input.emit('probe', {});
  ui.regionClicks.dispatch({ id: 1 });
  assert.equal(events, 1);
  assert.equal(clicks, 1);
  host.disable('b');
  assert.equal(objects.size, 0);
  assert.equal(ui.regionClicks.list.length, 0);
  ui.input.emit('probe', {});
  ui.regionClicks.dispatch({ id: 1 });
  assert.equal(events, 1);
  assert.equal(clicks, 1);
});
test('failed children clean up, show errors without breaking the parent and can be retried', async () => {
  const { host, ui } = fixture();
  let fail = true,
    calls = 0;
  host.register({
    id: 'a',
    start() {},
    children: [
      {
        id: 'child',
        start(ctx) {
          ctx.on('probe', () => calls++);
          if (fail) throw new Error('failed integration');
        },
      },
    ],
  });
  await host.enable('a');
  assert.equal(host.isEnabled('a'), true);
  assert.equal(host.isEnabled('a:child'), false);
  assert.equal(host.list[1].status, 'error');
  ui.input.emit('probe', {});
  assert.equal(calls, 0);
  fail = false;
  await host.enable('a:child');
  ui.input.emit('probe', {});
  assert.equal(calls, 1);
});
test('a separately registered child starts under a running parent and unregistering it keeps the parent', async () => {
  const { host } = fixture();
  host.register({ id: 'a', start() {} });
  await host.enable('a');
  const off = host.register({ id: 'child', start() {} }, { parent: 'a' });
  await tick();
  assert.equal(host.isEnabled('a:child'), true);
  assert.equal(host.tree[0].children[0].id, 'a:child');
  off();
  assert.equal(host.isEnabled('a'), true);
  assert.equal(host.list.length, 1);
});
