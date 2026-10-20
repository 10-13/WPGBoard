'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('../packages/ui/data-view.js');
class Element extends EventTarget {
  children = []; dataset = {};
  append(...children) { this.children.push(...children); }
  setAttribute() {}
}
test('collapsed data folders mount on first open, preserve descendants and remember their state', () => {
  const previous = global.document; global.document = { createElement: () => new Element() };
  try {
    const parent = new Element(), expanded = new Map();
    global.AtlasUI.dataView.renderDataTree(parent, [{ id: 'large', type: 'folder', title: 'Large', defaultOpen: false, children: [{ id: 'nested', type: 'folder', title: 'Nested', children: [{ id: 'result', title: 'Result', value: 42 }] }] }], { expanded });
    const group = parent.children[0].children[0], body = group.children[1];
    assert.equal(body.children.length, 0);
    group.open = true; group.dispatchEvent(new Event('toggle'));
    assert.equal(body.children.length, 1); const nested = body.children[0];
    assert.equal(nested.children[1].children.length, 1);
    group.open = false; group.dispatchEvent(new Event('toggle'));
    group.open = true; group.dispatchEvent(new Event('toggle'));
    assert.equal(body.children.length, 1); assert.equal(body.children[0], nested);
    assert.equal(expanded.get('["large"]'), true);
  } finally { global.document = previous; }
});
