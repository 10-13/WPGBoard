'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { button, createSwitch } = require('../packages/ui/controls.js');
class Control extends EventTarget {
  attributes = new Map(); classList = { add() {} };
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key); }
}
function fixture(run) { const previous = global.document; global.document = { createElement: () => new Control() }; try { run(); } finally { global.document = previous; } }
test('a shared switch updates accessible state before its callback; model updates do not trigger the callback', () => fixture(() => {
  const calls = [], node = createSwitch('Highlight', checked => { assert.equal(node.checked, checked); calls.push(checked); }, { checked: true });
  assert.equal(node.type, 'button'); assert.equal(node.getAttribute('role'), 'switch');
  node.dispatchEvent(new Event('click')); assert.equal(node.checked, false); assert.deepEqual(calls, [false]);
  node.checked = true; assert.deepEqual(calls, [false]); node.dispatchEvent(new Event('click')); assert.deepEqual(calls, [false, false]);
}));
test('shared controls release click callbacks with their owner signal', () => fixture(() => {
  const lifetime = new AbortController(); let calls = 0;
  const node = button('Run', () => calls++, { signal: lifetime.signal }), toggle = createSwitch('Toggle', () => calls++, { signal: lifetime.signal });
  node.dispatchEvent(new Event('click')); lifetime.abort(); node.dispatchEvent(new Event('click')); toggle.dispatchEvent(new Event('click'));
  assert.equal(calls, 1); assert.equal(toggle.checked, false);
}));
