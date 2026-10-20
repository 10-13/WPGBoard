'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('../packages/core/index.js');
const { trackPointerGesture } = require('../packages/ui/windows.js');

class TrackedTarget extends EventTarget {
  listeners = new Set();
  addEventListener(type, fn, options) { super.addEventListener(type, fn, options); this.listeners.add(fn); }
  removeEventListener(type, fn, options) { super.removeEventListener(type, fn, options); this.listeners.delete(fn); }
}
function event(type, props = {}) { return Object.assign(new Event(type, { cancelable: true }), props); }
function fixture(captureFails = false) {
  const view = new TrackedTarget(), doc = new TrackedTarget(), target = new TrackedTarget(), moves = [], ends = [];
  doc.defaultView = view; doc.hidden = false; target.ownerDocument = doc;
  let captured = false;
  target.setPointerCapture = () => { if (captureFails) throw new Error('Target detached'); captured = true; };
  target.hasPointerCapture = () => captured;
  target.releasePointerCapture = () => { captured = false; target.dispatchEvent(event('lostpointercapture', { pointerId: 7 })); };
  const gesture = trackPointerGesture({ currentTarget: target, pointerId: 7 }, { move: e => moves.push(e), end: (e, completed) => ends.push({ e, completed }) });
  return { view, doc, target, moves, ends, gesture, clean() { assert.equal(captured, false); for (const node of [view, doc, target]) assert.equal(node.listeners.size, 0); } };
}
test('pointer release outside the handle completes once and ignores other pointers', () => {
  const f = fixture();
  f.view.dispatchEvent(event('pointerup', { pointerId: 8, buttons: 0 })); assert.equal(f.ends.length, 0);
  f.view.dispatchEvent(event('pointermove', { pointerId: 7, buttons: 1 })); assert.equal(f.moves.length, 1);
  f.view.dispatchEvent(event('pointerup', { pointerId: 7, buttons: 0 }));
  assert.equal(f.ends.length, 1); assert.equal(f.ends[0].completed, true); f.clean();
  f.gesture.cancel(); assert.equal(f.ends.length, 1);
});
test('capture loss, canceled pointers, focus loss, hidden pages, Escape and missing release cancel without dropping', () => {
  for (const reason of ['lostpointercapture', 'pointercancel', 'blur', 'pagehide', 'visibilitychange', 'keydown', 'pointermove', 'dispose']) {
    const f = fixture();
    if (reason === 'lostpointercapture') f.target.dispatchEvent(event(reason, { pointerId: 7 }));
    else if (reason === 'visibilitychange') { f.doc.hidden = true; f.doc.dispatchEvent(event(reason)); }
    else if (reason === 'dispose') f.gesture.cancel();
    else f.view.dispatchEvent(event(reason, { pointerId: 7, key: 'Escape', buttons: 0 }));
    assert.equal(f.ends.length, 1, reason); assert.equal(f.ends[0].completed, false, reason); f.clean();
    f.view.dispatchEvent(event('pointerup', { pointerId: 7, buttons: 0 })); assert.equal(f.ends.length, 1, reason);
  }
});
test('window-level events recover the gesture even when capture cannot be acquired', () => {
  const f = fixture(true);
  f.view.dispatchEvent(event('pointerup', { pointerId: 7, buttons: 0 }));
  assert.equal(f.ends[0].completed, true); f.clean();
});
