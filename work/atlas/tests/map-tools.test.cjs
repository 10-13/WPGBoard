'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('../packages/core/index.js');
const { MapTools } = require('../packages/ui/map-tools.js');

test('map clicks go to exactly one active extension tool; selection is the neutral default', () => {
  const tools = new MapTools(), painted = [], chosen = [];
  tools.register({ id: 'nations:paint', label: 'Paint', click: e => painted.push(e.id) });
  tools.register({ id: 'metadata:collect', label: 'Set', click: e => chosen.push(e.id) });
  tools.handleClick({ id: 1 }); assert.deepEqual(painted, []); assert.deepEqual(chosen, []);
  tools.activate('nations:paint'); tools.handleClick({ id: 2 });
  tools.activate('metadata:collect'); tools.handleClick({ id: 3 });
  tools.reset(); tools.handleClick({ id: 4 });
  assert.deepEqual(painted, [2]); assert.deepEqual(chosen, [3]); assert.equal(tools.activeId, 'ui:select');
});
test('unloading the active plugin returns to selection and retains other tool registrations', () => {
  const tools = new MapTools(), lifetime = new AbortController(); let calls = 0;
  tools.register({ id: 'paint', label: 'Paint', click() {} });
  tools.register({ id: 'set', label: 'Set', click() { calls++; } }, { signal: lifetime.signal });
  tools.activate('set'); lifetime.abort(); tools.handleClick({ id: 1 });
  assert.equal(calls, 0); assert.equal(tools.activeId, 'ui:select'); assert.deepEqual(tools.list.map(t => t.id), ['ui:select', 'paint']);
  assert.throws(() => tools.activate('set')); tools.activate('paint'); assert.equal(tools.activeId, 'paint');
  tools.register({ id: 'expired', label: 'Expired', click() {} }, { signal: lifetime.signal }); assert.equal(tools.list.some(t => t.id === 'expired'), false);
});
test('an unavailable tool cannot act, and switching tools during a click never invokes the next handler', () => {
  const tools = new MapTools(); let available = true, calls = 0;
  tools.register({ id: 'second', label: 'Second', click() { calls++; } });
  tools.register({ id: 'first', label: 'First', enabled: () => available, click() { tools.activate('second'); } });
  tools.activate('first'); tools.handleClick({ id: 1 }); assert.equal(calls, 0); tools.handleClick({ id: 2 }); assert.equal(calls, 1);
  tools.activate('first'); available = false; tools.handleClick({ id: 3 }); assert.equal(tools.activeId, 'ui:select'); assert.throws(() => tools.activate('first')); assert.equal(calls, 1);
});
