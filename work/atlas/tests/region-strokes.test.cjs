'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { EventBus } = require('../packages/core/index.js');
const { RegionClicks } = require('../packages/ui/region-clicks.js');
const { MapViewport } = require('../packages/ui/map-view.js');
function editor(clicks, calls, options = {}) {
  return clicks.subscribe(() => calls.push('click'), {
    id: options.id || 'brush',
    mode: 'active',
    ...options,
    stroke: {
      start: (e) => calls.push('start:' + e.x),
      move: (e) => calls.push('move:' + e.x),
      end: (e) => calls.push('end:' + e.x),
      cancel: () => calls.push('cancel'),
    },
  });
}
test('a stroke shares the exclusive active editor and is canceled on replacement or scope closure', () => {
  const clicks = new RegionClicks(),
    calls = [],
    scope = new AbortController();
  const brush = editor(clicks, calls, { signal: scope.signal });
  brush.activate();
  assert.equal(clicks.beginStroke({ id: 1, x: 1 }), true);
  clicks.moveStroke({ id: 1, x: 2 });
  const other = clicks.subscribe(() => {}, { id: 'other', mode: 'active' });
  other.activate();
  clicks.endStroke({ id: 1, x: 3 });
  assert.deepEqual(calls, ['start:1', 'move:2', 'cancel']);
  brush.activate();
  clicks.beginStroke({ id: 1, x: 4 });
  scope.abort();
  assert.equal(clicks.strokeActive, false);
  assert.equal(clicks.activeId, null);
  assert.equal(calls.at(-1), 'cancel');
});
test('stroke observers cannot substitute the editor during the first point; errors cancel safely', () => {
  const errors = [],
    clicks = new RegionClicks({ onError: (e) => errors.push(e.message) }),
    calls = [];
  const brush = editor(clicks, calls),
    other = clicks.subscribe(() => {}, { mode: 'active' });
  clicks.subscribe(() => other.activate());
  brush.activate();
  assert.equal(clicks.beginStroke({ id: 1, x: 1 }), false);
  assert.equal(calls.length, 0);
  const broken = new RegionClicks({ onError: (e) => errors.push(e.message) });
  broken
    .subscribe(() => {}, {
      mode: 'active',
      stroke: {
        start() {
          throw Error('failed stroke');
        },
        move() {},
        end() {},
        cancel() {
          calls.push('cleanup');
        },
      },
    })
    .activate();
  assert.equal(broken.beginStroke({ id: 1 }), false);
  assert.equal(broken.strokeActive, false);
  assert.deepEqual(errors, ['failed stroke']);
  assert.equal(calls.at(-1), 'cleanup');
});
function viewportFixture(t) {
  const previous = global.window;
  global.window = new EventTarget();
  t.after(() => {
    global.window = previous;
  });
  const clicks = new RegionClicks(),
    input = new EventBus(),
    view = Object.create(MapViewport.prototype);
  const captures = new Set();
  Object.assign(view, {
    ready: true,
    regionClicks: clicks,
    input,
    pointers: new Map(),
    tx: 0,
    ty: 0,
    scale: 1,
    element: {
      setPointerCapture: (id) => captures.add(id),
      hasPointerCapture: (id) => captures.has(id),
      releasePointerCapture: (id) => captures.delete(id),
      classList: { add() {}, remove() {} },
    },
    state: { regionIndex: { at: () => ({ id: 1 }), idAt: () => 1 } },
    local: (e) => ({ x: e.clientX, y: e.clientY }),
    world: (p) => p,
    setHover() {},
    select() {},
    constrain() {},
    transform() {},
    fitScale: () => 1,
  });
  input.on('province:click', (e) => clicks.dispatch(e, { active: !e.originalEvent?.shiftKey }));
  const event = (x, y, extra = {}) => ({
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    ...extra,
  });
  return { clicks, view, event };
}
test('mouse and touch drags paint without panning or producing a second click', (t) => {
  const { clicks, view, event } = viewportFixture(t),
    calls = [];
  let observed = 0;
  clicks.subscribe(() => observed++);
  const brush = editor(clicks, calls);
  brush.activate();
  view.down(event(1, 1));
  view.move(event(20, 1));
  view.up(event(25, 1, { buttons: 0 }));
  assert.deepEqual(calls, ['start:1', 'move:20', 'end:25']);
  assert.equal(observed, 1);
  assert.equal(view.tx, 0);
  assert.equal(clicks.strokeActive, false);
  calls.length = 0;
  view.down(event(2, 1, { pointerType: 'touch' }));
  view.move(event(22, 1, { pointerType: 'touch' }));
  view.up(event(23, 1, { pointerType: 'touch', buttons: 0 }));
  assert.deepEqual(calls, ['start:2', 'move:22', 'end:23']);
});
test('Shift selection and middle-button navigation bypass the brush', (t) => {
  const { clicks, view, event } = viewportFixture(t),
    calls = [];
  editor(clicks, calls).activate();
  let seen = 0;
  clicks.subscribe(() => seen++);
  view.down(event(1, 1, { shiftKey: true }));
  view.up(event(1, 1, { shiftKey: true, buttons: 0 }));
  assert.deepEqual(calls, []);
  assert.equal(seen, 1);
  view.down(event(1, 1, { button: 1, buttons: 4 }));
  view.move(event(20, 1, { button: 1, buttons: 4 }));
  view.up(event(20, 1, { button: 1, buttons: 0 }));
  assert.deepEqual(calls, []);
  assert.equal(view.tx, 19);
});
test('a second finger switches to navigation and cancels the whole uncommitted stroke', (t) => {
  const { clicks, view, event } = viewportFixture(t),
    calls = [];
  editor(clicks, calls).activate();
  view.down(event(1, 1, { pointerType: 'touch' }));
  view.down(event(9, 1, { pointerType: 'touch', pointerId: 2 }));
  view.move(event(12, 1, { pointerType: 'touch', pointerId: 2 }));
  view.up(event(12, 1, { pointerType: 'touch', pointerId: 2, buttons: 0 }));
  view.up(event(1, 1, { pointerType: 'touch', buttons: 0 }));
  assert.deepEqual(calls, ['start:1', 'cancel']);
  assert.equal(clicks.strokeActive, false);
});
test('missed mouse release cancels the preview instead of continuing to paint', (t) => {
  const { clicks, view, event } = viewportFixture(t),
    calls = [];
  editor(clicks, calls).activate();
  view.down(event(1, 1));
  view.move(event(5, 1, { buttons: 0 }));
  view.up(event(5, 1, { buttons: 0 }));
  assert.deepEqual(calls, ['start:1', 'cancel']);
  assert.equal(view.pointers.size, 0);
});
