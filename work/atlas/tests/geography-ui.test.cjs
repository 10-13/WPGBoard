'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventBus, Scope, RegionIndex } = require('../packages/core/index.js');
const { geographyEntry } = require('../extensions/geography-model.js');
const { GeographyLayer, GeographyThemeUI } = require('../extensions/geography-ui.js');

function fixture(t) {
  const scope = new Scope();
  const state = new EventBus();
  state.regionIndex = new RegionIndex({
    width: 3,
    height: 1,
    regions: [
      { id: 1, area: 1, bbox: [0, 0, 1, 1], anchor: [0, 0] },
      { id: 2, area: 1, bbox: [2, 0, 1, 1], anchor: [2, 0] },
    ],
    pixels: new Uint32Array([1, 0, 2]),
  });
  state.meta = {
    tiles: {
      1: { entries: { 'geography.environment': geographyEntry({ 'terrain.elevation': 100 }) } },
    },
  };
  const overlays = new EventBus();
  let options = {},
    visible = false;
  overlays.getOptions = () => options;
  overlays.setOptions = (_, value) => {
    options = value;
    overlays.emit('settings:change', {});
  };
  state.overlays = overlays;
  const ui = new EventBus();
  ui.viewport = { ready: true };
  const marks = [];
  const context = {
    clearRect: (...args) => marks.push(['clear', ...args]),
    fillRect: (...args) => marks.push(['fill', ...args]),
  };
  const ctx = {
    state,
    ui,
    scope,
    signal: scope.signal,
    overlay(definition) {
      assert.equal(definition.lazy, true);
      assert.equal(definition.visible, false);
      return {
        id: 'geography:relief:' + definition.id,
        context,
        get visible() {
          return visible;
        },
        setVisible(value) {
          visible = value;
          overlays.emit('change', {});
        },
      };
    },
  };
  t.after(() => scope.dispose());
  return { ctx, marks, state };
}

test('geography layers cache projections, repaint after hiding, and keep exact province masks', (t) => {
  const { ctx, marks } = fixture(t);
  const layer = new GeographyLayer(ctx, {}, 'elevation');
  assert.equal(marks.length, 0);
  const data = layer.ensure();
  assert.equal(data.values.get(1), 100);
  assert.equal(data.values.has(2), false);
  assert.equal(layer.ensure(), data);
  layer.overlay.setVisible(true);
  assert.deepEqual(
    marks.filter((entry) => entry[0] === 'fill'),
    [['fill', 0, 0, 1, 1]],
  );
  layer.draw();
  assert.equal(marks.filter((entry) => entry[0] === 'clear').length, 1);
  layer.overlay.setVisible(false);
  layer.overlay.setVisible(true);
  assert.equal(marks.filter((entry) => entry[0] === 'clear').length, 2);
  assert.equal(layer.ensure(), data);
});

test('geography display options preserve clock fields and invalidate only when data or options change', (t) => {
  const { ctx, marks, state } = fixture(t);
  const layer = new GeographyLayer(ctx, {}, 'elevation');
  const original = layer.ensure();
  layer.setOptions({ utc: '1936-01-01T12:00:00Z', pinnedProvinceIds: [1] });
  layer.setOptions({ metric: 'annual' });
  assert.deepEqual(layer.options, {
    utc: '1936-01-01T12:00:00Z',
    pinnedProvinceIds: [1],
    metric: 'annual',
  });
  const projected = layer.ensure();
  assert.notEqual(projected, original);
  assert.equal(marks.length, 0, 'hidden layers do not allocate or draw');
  const before = state.meta;
  state.meta = { ...before, unrelated: true };
  state.emit('change', { before: { meta: before }, after: { meta: state.meta } });
  assert.equal(layer.ensure(), projected);
  const old = state.meta;
  state.meta = {
    tiles: {
      1: { entries: { 'geography.environment': geographyEntry({ 'terrain.elevation': 200 }) } },
    },
  };
  state.emit('change', { before: { meta: old }, after: { meta: state.meta } });
  assert.equal(layer.ensure().values.get(1), 200);
  ctx.scope.dispose();
  assert.equal(state.listenerCount('change'), 0);
  assert.equal(state.overlays.listenerCount('settings:change'), 0);
});

test('restored invalid UTC preferences cannot prevent a daylight layer from opening', (t) => {
  const { ctx, state } = fixture(t);
  state.meta.tiles[1].entries['geography.environment'] = geographyEntry({
    'geo.lat': 50,
    'geo.lon': 10,
  });
  state.overlays.setOptions('', { utc: 'invalid UTC', pinnedProvinceIds: [1] });
  const layer = new GeographyLayer(ctx, {}, 'daylight');
  assert.equal(layer.ensure().values.size, 1);
  assert.equal(
    layer.options.utc,
    'invalid UTC',
    'a display fallback does not silently change saved choices',
  );
});

test('numeric windows use the shared area control, local bounds, and the separate relief launcher', (t) => {
  const { ctx, state } = fixture(t);
  const previousUI = global.AtlasUI;
  class Node {
    constructor(text = '') {
      this.text = text;
      this.children = [];
      this.style = {};
      this.classList = { add() {} };
    }
    append(...children) {
      this.children.push(...children);
    }
    replaceChildren(...children) {
      this.children = children;
    }
    setAttribute() {}
    get textContent() {
      return this.text + this.children.map((node) => node.textContent).join('');
    }
  }
  const buttons = [];
  const controls = [];
  const button = (label, handler) => {
    const node = new Node(label);
    node.click = handler;
    buttons.push(node);
    return node;
  };
  global.AtlasUI = {
    dom: { el: (_, __, text) => new Node(text), field: (_, node) => node },
    controls: { button, createSwitch: button },
    dataView: {
      createDataRow: (label, value) => new Node(label + ': ' + value),
      createDataGroup: (label) => {
        const element = new Node(label),
          body = new Node();
        element.append(body);
        return { element, body };
      },
    },
    overlayScope: {
      createScopeControl: (options) => {
        controls.push(options);
        return new Node('Область');
      },
    },
  };
  t.after(() => {
    global.AtlasUI = previousUI;
  });
  state.regions = state.regionIndex.regions;
  state.meta.tiles[2] = {
    entries: { 'geography.environment': geographyEntry({ 'terrain.elevation': 900 }) },
  };
  const selection = new EventBus();
  selection.ids = [1];
  ctx.ui.regionSelection = selection;
  ctx.ui.input = new EventBus();
  ctx.ui.viewport.selectedId = null;
  ctx.ui.registerTooltip = () => {};
  const opened = [];
  ctx.window = (definition) => {
    const pane = new Node();
    definition.render(pane, ctx.scope, { onRegionClick() {} });
    opened.push({ definition, pane });
    return pane;
  };
  const layer = new GeographyThemeUI(ctx, { read: () => null }, 'elevation', {
    registerMenus: false,
  });
  const pane = layer.open();
  assert.equal(layer.ensure().max, 900);
  assert.equal(controls[0].state, state);
  assert.equal(controls[0].selection, selection);
  controls[0].onChange([1]);
  assert.deepEqual(controls.at(-1).readIds(), [1]);
  assert.deepEqual([...layer.ensure().values.keys()], [1]);
  assert.equal(layer.ensure().min, 100);
  assert.equal(layer.ensure().max, 100);
  assert.match(pane.textContent, /Минимум — максимум в области: 100 — 100 м/);
  assert.match(pane.textContent, /Без данных в области: 0/);
  let launched = 0;
  ctx.ui.on('geography:relief:open', () => launched++);
  state.meta.tiles[1].entries['geography.environment'].stats['terrain.relief'] = 200;
  const relief = new GeographyThemeUI(ctx, { read: () => null }, 'relief', {
    registerMenus: false,
  });
  buttons.find((node) => node.text === 'Перепады высот').click();
  assert.equal(launched, 1);
  assert.equal(opened.at(-1).definition.id, 'relief');
  assert.equal(relief.ensure().values.get(1), 200);
  assert.match(opened.at(-1).pane.textContent, /Чем больше перепад, тем плотнее штрихи/);
  assert.equal(state.meta.overlays, undefined, 'the selected area never becomes game metadata');
});
