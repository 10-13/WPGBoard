'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventBus, Scope } = require('../packages/core/index.js');
const geography = require('../extensions/geography-model.js');
class Node extends EventTarget {
  children = [];
  attributes = new Map();
  style = {};
  className = '';
  classList = {
    add: (...names) => {
      this.className += ' ' + names.join(' ');
    },
  };
  constructor(tag = 'div') {
    super();
    this.tagName = tag;
    this.ownText = '';
  }
  get textContent() {
    return this.ownText + this.children.map((node) => node.textContent).join('');
  }
  set textContent(value) {
    this.ownText = String(value);
    this.children = [];
  }
  append(...nodes) {
    this.children.push(
      ...nodes.map((node) =>
        typeof node === 'string' ? Object.assign(new Node('#text'), { textContent: node }) : node,
      ),
    );
  }
  prepend(...nodes) {
    this.children.unshift(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.ownText = '';
    this.append(...nodes);
  }
  setAttribute(key, value) {
    this.attributes.set(key, value);
  }
  getAttribute(key) {
    return this.attributes.get(key);
  }
  querySelector(selector) {
    return this.all().find((node) => node.className.split(' ').includes(selector.slice(1))) || null;
  }
  all() {
    return this.children.flatMap((node) => [node, ...node.all()]);
  }
  checkValidity() {
    return true;
  }
}
class Layer extends EventBus {
  options = {};
  constructor(ctx, model, theme) {
    super();
    this.theme = theme;
    this.overlay = {
      visible: false,
      setVisible: (value) => {
        this.overlay.visible = value;
        this.emit('change', {});
      },
    };
  }
  setOptions(patch) {
    this.options = { ...this.options, ...patch };
    this.emit('change', {});
  }
  ensure() {
    return {
      values: new Map([
        [1, 0],
        [2, 180],
      ]),
      counts: new Map([
        [0, 1],
        [180, 1],
      ]),
      colors: new Map([
        [1, '#ffffff'],
        [2, '#888888'],
      ]),
    };
  }
}
function fixture(run) {
  const previous = {
    document: global.document,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval,
  };
  global.document = { createElement: (tag) => new Node(tag), activeElement: null };
  require('../packages/ui/controls.js');
  require('../packages/ui/data-view.js');
  global.AtlasUI.dom = {
    el: (tag, name = '', text = '') =>
      Object.assign(new Node(tag), { className: name, textContent: text }),
    field: (label, input) => {
      const node = new Node('label');
      node.append(label, input);
      return node;
    },
  };
  Object.assign(global.AtlasExtensions, geography, { GeographyLayer: Layer });
  delete require.cache[require.resolve('../extensions/geography-time-ui.js')];
  const { GeographyTimeUI } = require('../extensions/geography-time-ui.js');
  const timers = new Map();
  let timerId = 0;
  global.setInterval = (fn) => {
    timers.set(++timerId, fn);
    return timerId;
  };
  global.clearInterval = (id) => timers.delete(id);
  const scope = new Scope(),
    selection = new EventBus();
  selection.ids = [1];
  const state = {
    meta: { geography: { referenceDate: '1936-06-21' } },
    regionIndex: new Map([
      [1, {}],
      [2, {}],
    ]),
  };
  const data = new Map([
      [1, { 'time.offsetMinutes': 0, 'time.zoneName': 'UTC', 'geo.lat': 0, 'geo.lon': 0 }],
      [2, { 'time.offsetMinutes': 180, 'time.zoneName': 'UTC+3', 'geo.lat': 55, 'geo.lon': 45 }],
    ]),
    updates = [];
  const model = {
    read: (id) => data.get(id),
    update: (ids, patch) => {
      updates.push({ ids, patch });
      for (const id of ids) data.set(id, { ...data.get(id), ...patch });
    },
  };
  const ctx = {
    state,
    ui: Object.assign(new EventBus(), {
      mainMenu: {},
      tileMenu: {},
      viewport: { selectedId: 1 },
      regionSelection: selection,
      input: new EventBus(),
    }),
    windowMenu() {},
    menu() {},
    window(options) {
      const pane = new Node();
      options.render(pane, scope, {
        onRegionClick: (fn) => {
          ctx.click = fn;
          scope.defer(() => {
            ctx.click = null;
          });
        },
      });
      return pane;
    },
  };
  const ui = new GeographyTimeUI(ctx, model);
  try {
    run({ ui, ctx, state, model, updates, scope, timers, selection });
  } finally {
    scope.dispose();
    Object.assign(global, previous);
  }
}
const click = (node) => node.dispatchEvent(new Event('click'));
test('UTC and pinned places remain local view options; invalid dates cannot enter the clock', () =>
  fixture(({ ui, state }) => {
    const before = JSON.stringify(state.meta);
    assert.equal(new Date(ui.readUTC()).toISOString(), '1936-06-21T12:00:00.000Z');
    ui.setUTC('2000-02-29T23:00:00Z');
    assert.equal(new Date(ui.readUTC()).toISOString(), '2000-02-29T23:00:00.000Z');
    assert.throws(() => ui.setUTC('2201-01-01T00:00:00Z'));
    assert.equal(new Date(ui.readUTC()).toISOString(), '2000-02-29T23:00:00.000Z');
    ui.daylight.setOptions({ pinnedProvinceIds: [2, 2, 1, 999, '1'] });
    assert.deepEqual(ui.pinned(), [2, 1]);
    assert.equal(JSON.stringify(state.meta), before);
  }));
test('window edits metadata through the model, keeps clocks local, and stops playback on close', () =>
  fixture(({ ui, ctx, state, updates, scope, timers, selection }) => {
    const pane = ui.open(),
      nodes = () => pane.all(),
      named = (text) =>
        nodes().find((node) => node.tagName === 'button' && node.textContent === text);
    assert.match(pane.textContent, /1936-06-21 12:00/);
    selection.ids = [1, 2];
    selection.emit('change', {});
    nodes().find((node) => node.type === 'number').value = '330';
    nodes().find((node) => node.type === 'text').value = 'UTC+05:30';
    click(named('Сохранить пояс'));
    assert.deepEqual(updates, [
      { ids: [1, 2], patch: { 'time.offsetMinutes': 330, 'time.zoneName': 'UTC+05:30' } },
    ]);
    const before = JSON.stringify(state.meta);
    click(named('Добавить выбранные места'));
    assert.deepEqual(ui.pinned(), [1, 2]);
    click(named('+1 час'));
    assert.match(pane.textContent, /1936-06-21 18:30/);
    const play = named('Ход времени: +1 мин/с');
    click(play);
    assert.equal(timers.size, 1);
    const ms = ui.readUTC();
    [...timers.values()][0]();
    assert.equal(ui.readUTC(), ms + 60000);
    assert.equal(JSON.stringify(state.meta), before);
    assert.equal(updates.length, 1);
    assert.equal(typeof ctx.click, 'function');
    scope.dispose();
    assert.equal(timers.size, 0);
    assert.equal(ctx.click, null);
    assert.equal(play.checked, false);
  }));
