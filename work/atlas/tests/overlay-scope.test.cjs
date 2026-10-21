'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { EventBus, Scope, normalizeOverlayScope } = require('../packages/core/index.js');
const { AreaRegistry, createScopeControl } = require('../packages/ui/overlay-scope.js');

test('overlay scopes distinguish world, empty and explicit sets, reject malformed IDs and never change their input', () => {
  const input = [3, 1, 3, 99],
    index = new Map([
      [1, {}],
      [2, {}],
      [3, {}],
    ]);
  const ids = normalizeOverlayScope(input, index);
  assert.deepEqual(ids, [1, 3]);
  assert(Object.isFrozen(ids));
  assert.deepEqual(input, [3, 1, 3, 99]);
  assert.equal(normalizeOverlayScope(null, index), null);
  assert.equal(normalizeOverlayScope(undefined, index), null);
  assert.deepEqual(normalizeOverlayScope([], index), []);
  for (const value of ['1', [0], [1.2], ['1'], [NaN]])
    assert.throws(() => normalizeOverlayScope(value, index));
});
test('area providers are independent scoped registrations, expose fresh snapshots and disappear on unloading', () => {
  const registry = new AreaRegistry(),
    scope = new Scope();
  let ids = [1, 2];
  registry.register(
    'regions',
    { getAreas: () => [{ id: 'north', title: 'North', provinceIds: ids }] },
    { signal: scope.signal },
  );
  const other = registry.register('districts', {
    getAreas: () => [{ id: 'north', title: 'District', provinceIds: [3] }],
  });
  assert.deepEqual(
    registry.list.map((a) => a.id),
    ['regions:north', 'districts:north'],
  );
  const snapshot = registry.list;
  ids = [2];
  assert.deepEqual(snapshot[0].provinceIds, [1, 2]);
  assert.deepEqual(registry.list[0].provinceIds, [2]);
  assert.throws(() => registry.register('regions', { getAreas: () => [] }));
  scope.dispose();
  assert.deepEqual(
    registry.list.map((a) => a.id),
    ['districts:north'],
  );
  other.dispose();
  assert.deepEqual(registry.list, []);
});
class Node extends EventTarget {
  constructor(tag = 'div') {
    super();
    this.tag = tag;
    this.children = [];
    this.className = '';
    this.attributes = {};
    this.ownText = '';
    this.style = {};
    this.classList = { add: (...values) => (this.className += ' ' + values.join(' ')) };
  }
  append(...nodes) {
    for (const n of nodes)
      this.children.push(
        typeof n === 'object' ? n : Object.assign(new Node('text'), { textContent: String(n) }),
      );
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.ownText = '';
    this.append(...nodes);
  }
  set textContent(v) {
    this.ownText = String(v);
    this.children = [];
  }
  get textContent() {
    return this.ownText + this.children.map((n) => n.textContent).join('');
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
  }
  getAttribute(k) {
    return this.attributes[k];
  }
  get options() {
    return this.children;
  }
  all() {
    return this.children.flatMap((n) => [n, ...n.all()]);
  }
  querySelector(selector) {
    return this.all().find((n) => n.className.split(' ').includes(selector.slice(1))) || null;
  }
}
test('shared controls snapshot selection or provider areas, restore world and release external observers with the tab', () => {
  const previous = { document: global.document, Option: global.Option, ui: global.AtlasUI };
  global.document = { createElement: (tag) => new Node(tag) };
  global.Option = class extends Node {
    constructor(title, value) {
      super('option');
      this.textContent = title;
      this.value = value;
    }
  };
  require('../packages/ui/controls.js');
  require('../packages/ui/data-view.js');
  global.AtlasUI.dom = {
    el: (tag, cls = '', text = '') =>
      Object.assign(new Node(tag), { className: cls, textContent: text }),
    field: (label, input) => {
      const n = new Node('label');
      n.append(label, input);
      return n;
    },
  };
  const state = new EventBus(),
    selection = new EventBus(),
    areas = new AreaRegistry(),
    scope = new Scope();
  state.regionIndex = new Map([
    [1, {}],
    [2, {}],
    [3, {}],
  ]);
  state.overlays = new EventBus();
  selection.ids = [3];
  let value = null;
  areas.register('regions', {
    getAreas: () => [{ id: '__world', title: 'North', provinceIds: [1, 2] }],
  });
  try {
    const control = createScopeControl({
      state,
      selection,
      areas,
      readIds: () => value,
      onChange: (ids) => {
        value = ids;
      },
      signal: scope.signal,
    });
    const named = (text) => control.all().find((n) => n.tag === 'button' && n.textContent === text),
      select = control.all().find((n) => n.tag === 'select');
    named('Взять выделение').dispatchEvent(new Event('click'));
    assert.deepEqual(value, [3]);
    selection.ids = [1];
    selection.emit('change', {});
    assert.deepEqual(value, [3], 'selection changes do not move the clipped area');
    select.value = 'region:regions:__world';
    select.dispatchEvent(new Event('change'));
    assert.deepEqual(value, [1, 2]);
    assert.match(control.textContent, /ОбластьNorth/);
    named('Весь мир').dispatchEvent(new Event('click'));
    assert.equal(value, null);
    assert.equal(named('Весь мир').disabled, true);
    assert.equal(selection.listenerCount('change'), 1);
    scope.dispose();
    assert.equal(selection.listenerCount('change'), 0);
    assert.equal(state.overlays.listenerCount('settings:change'), 0);
    assert.equal(areas.listenerCount('change'), 0);
  } finally {
    scope.dispose();
    global.document = previous.document;
    global.Option = previous.Option;
    global.AtlasUI = previous.ui;
  }
});
