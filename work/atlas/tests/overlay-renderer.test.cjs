'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { OverlayRegistry } = require('../packages/core/index.js');
const { OverlayRenderer } = require('../packages/ui/overlays.js');
class Node {
  children = []; style = {}; dataset = {}; context = { imageSmoothingEnabled: true };
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
  getContext() { return this.context; }
}
function fixture(run) {
  const previous = global.document; global.document = { createElement: () => new Node() };
  const registry = new OverlayRegistry(), host = new Node(), renderer = new OverlayRenderer(host, registry);
  try { run({ registry, renderer, host }); } finally { renderer.dispose(); global.document = previous; }
}
test('canvas and screen planes share registry order, visibility and PNG composition', () => fixture(({ registry, renderer, host }) => {
  renderer.resizeWorld(500, 300); const calls = [], a = renderer.add({ id: 'a', order: 1 }), temporary = renderer.add({ id: 'temporary', order: 2, exportable: false });
  renderer.add({ id: 'labels', order: 3, space: 'screen', exportDraw: () => calls.push('labels') });
  assert.equal(a.canvas.width, 500); assert.equal(a.canvas.height, 300); assert.equal(a.context.imageSmoothingEnabled, false);
  const target = { drawImage: canvas => calls.push(canvas.dataset.layer) };
  renderer.exportTo(target); assert.deepEqual(calls, ['a', 'labels']);
  registry.reorder(['labels', 'temporary', 'a']); assert.equal(host.children.find(n => n.dataset.overlay === 'labels').style.zIndex, '1');
  calls.length = 0; renderer.exportTo(target); assert.deepEqual(calls, ['labels', 'a']);
  registry.setVisible('a', false); assert.equal(host.children.find(n => n.dataset.overlay === 'a').hidden, true); calls.length = 0; renderer.exportTo(target); assert.deepEqual(calls, ['labels']);
  assert.equal(temporary.visible, true); assert.throws(() => renderer.add({ id: 'invalid', space: 'screen' })); assert.equal(registry.has('invalid'), false);
}));
test('camera transforms affect only world planes, and aborting a module removes its canvas and definition', () => fixture(({ registry, renderer, host }) => {
  const life = new AbortController(); const layer = renderer.add({ id: 'world', signal: life.signal }); renderer.add({ id: 'screen', space: 'screen', exportable: false });
  renderer.transform('translate(10px,20px) scale(2)'); assert.equal(host.children[0].children[0].style.transform, 'translate(10px,20px) scale(2)'); assert.equal(host.children[1].children[0].style.transform, undefined);
  renderer.resizeWorld(20, 30); assert.equal(layer.canvas.height, 30); life.abort(); assert.equal(registry.has('world'), false); assert.equal(host.children.length, 1); assert.throws(() => layer.setVisible(true)); layer.dispose();
}));
