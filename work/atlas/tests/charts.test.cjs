'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  createPieChart,
  createBarChart,
  createLineChart,
  createHistogram,
  createScatterChart,
  createIntervalChart,
  createHeatmap,
  createTreeMap,
  createIcicleChart,
  createSunburstChart,
  createCirclePack,
  createTreeChart,
  createClusterChart,
} = require('../packages/ui/charts.js');
const geometry = require('../packages/ui/chart-model.js');
const hierarchyLayouts = require('../packages/ui/chart-hierarchy-model.js');
const { ColorScale } = require('../packages/ui/color-scale-model.js');
const { createTable } = require('../packages/ui/table.js');
class Node extends EventTarget {
  constructor(tag) {
    super();
    this.tagName = tag;
    this.children = [];
    this.attributes = new Map();
    this.clientWidth = 320;
    this.style = {
      setProperty(key, value) {
        this[key] = value;
      },
    };
    this.className = '';
    this.classList = {
      add: (name) => {
        if (!this.className.split(' ').includes(name)) this.className += ' ' + name;
      },
      toggle: (name, on) => {
        const all = new Set(this.className.split(' '));
        if (on) all.add(name);
        else all.delete(name);
        this.className = [...all].join(' ');
      },
    };
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }
  getAttribute(key) {
    return this.attributes.get(key);
  }
}
function fixture(t) {
  const previous = { document: global.document, ResizeObserver: global.ResizeObserver };
  const observers = [];
  global.document = {
    createElement: (tag) => new Node(tag),
    createElementNS: (_, tag) => new Node(tag),
  };
  global.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(node) {
      this.node = node;
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  t.after(() => Object.assign(global, previous));
  return observers;
}
const walk = (node) => [node, ...node.children.flatMap(walk)];
const parts = (node) =>
  walk(node).filter((n) => n.className.split(' ').includes('atlas-chart-mark'));
const rows = (node) => node.children[1].children;
const data = [
  { id: 'a', label: 'Первый', value: 3, color: '#123456' },
  { id: 'b', label: '<b>Второй</b>', value: 1, color: '#abcdef' },
];

test('pie charts preserve input data and recalculate visible shares, including one full ring', (t) => {
  fixture(t);
  const original = structuredClone(data),
    chart = createPieChart(data);
  assert.equal(parts(chart).length, 2);
  assert.equal(rows(chart)[0].children[1].children[2].textContent, '3 · 75%');
  rows(chart)[1].dispatchEvent(new Event('click'));
  assert.equal(parts(chart).length, 1);
  assert.equal(parts(chart)[0].tagName, 'circle');
  assert.equal(rows(chart)[0].children[1].children[2].textContent, '3 · 100%');
  chart.update(data, { donut: true });
  assert.equal(parts(chart)[0].getAttribute('fill'), 'none');
  assert.equal(parts(chart)[0].getAttribute('stroke'), '#123456');
  rows(chart)[1].dispatchEvent(new Event('click'));
  assert.equal(rows(chart)[1].children[1].children[0].textContent, '<b>Второй</b>');
  assert.deepEqual(data, original);
  chart.update([]);
  assert.equal(parts(chart).length, 0);
  assert(walk(chart).some((n) => n.textContent === 'Нет данных'));
});
test('invalid updates are atomic; negative values belong to bars, not a pie', (t) => {
  fixture(t);
  const chart = createPieChart(data),
    old = chart.children[0].children[0];
  for (const invalid of [
    [{ label: 'negative', value: -1 }],
    [{ label: 'NaN', value: NaN }],
    [{ label: 'infinite', value: Infinity }],
    [data[0], data[0]],
  ]) {
    assert.throws(() => chart.update(invalid));
    assert.equal(chart.children[0].children[0], old);
  }
  const bar = createBarChart([
    { label: 'Убыль', value: -5 },
    { label: 'Рост', value: 10 },
  ]);
  assert.equal(parts(bar).length, 2);
  for (const rect of parts(bar)) assert(Number(rect.getAttribute('height')) > 0);
  bar.update(
    [
      { label: 'Убыль', value: -5 },
      { label: 'Рост', value: 10 },
    ],
    { orientation: 'horizontal' },
  );
  assert.equal(bar.children[0].children.length, 2);
  assert(
    Math.abs(
      parseFloat(bar.children[0].children[0].children[1].children[0].style.width) - 100 / 3,
    ) < 1e-10,
  );
});
test('line gaps remain gaps; legend toggles, nulls and selection keep the actual values', (t) => {
  fixture(t);
  const seen = [],
    series = [{ id: 's', label: 'Ряд', values: [-2, null, 4] }];
  const chart = createLineChart(series, {
    labels: ['Январь', 'Февраль', 'Март'],
    onSelect: (point) => seen.push(point),
  });
  const path = walk(chart).find((n) => n.getAttribute('class') === 'atlas-chart-line');
  assert.equal((path.getAttribute('d').match(/M/g) || []).length, 2);
  assert.equal(parts(chart).length, 2);
  parts(chart)[1].dispatchEvent(new Event('click'));
  assert.deepEqual(seen, [{ id: 's', label: 'Ряд', value: 4, xLabel: 'Март' }]);
  assert.match(chart.children[2].textContent, /Март.*4/);
  rows(chart)[0].dispatchEvent(new Event('click'));
  assert.equal(parts(chart).length, 0);
  rows(chart)[0].dispatchEvent(new Event('click'));
  assert.equal(parts(chart).length, 2);
  assert.throws(() => chart.update(series, { labels: ['one'] }));
  assert.equal(parts(chart).length, 2);
});
test('resize keeps text at native size and closing an owner releases the observer', (t) => {
  const observers = fixture(t),
    scope = new AbortController();
  const chart = createLineChart([{ label: 'Ряд', values: [1, 2, 3] }], {
    height: 128,
    signal: scope.signal,
  });
  chart.clientWidth = 204;
  observers[0].callback();
  assert(chart.className.includes('atlas-chart--compact'));
  assert.match(chart.children[0].children[0].getAttribute('viewBox'), /^0 0 204 128$/);
  scope.abort();
  assert.equal(observers[0].disconnected, true);
  assert.equal(chart.children.length, 0);
  chart.update([]);
  assert.equal(chart.children.length, 0);
});

test('table sorting uses raw numbers, keeps ties stable and nulls last without changing input', (t) => {
  fixture(t);
  const columns = [
    { key: 'name', label: 'Название' },
    { key: 'value', label: 'Значение', type: 'number' },
  ];
  const input = [
    { id: 'a', name: 'Двенадцать', value: 12 },
    { id: 'b', name: 'Первое два', value: 2 },
    { id: 'c', name: 'Второе два', value: 2 },
    { id: 'd', name: 'Нет числа', value: null },
  ];
  const original = structuredClone(input),
    view = createTable(columns, input);
  const sort = () =>
    view.children[0].children[1].children[0].children[1].children[0].dispatchEvent(
      new Event('click'),
    );
  const names = () =>
    view.children[0].children[2].children.map((row) => row.children[0].textContent);
  sort();
  assert.deepEqual(names(), ['Первое два', 'Второе два', 'Двенадцать', 'Нет числа']);
  sort();
  assert.deepEqual(names(), ['Двенадцать', 'Первое два', 'Второе два', 'Нет числа']);
  assert.deepEqual(input, original);
});
test('table selection, complete inert text, schema updates and scope disposal remain independent', (t) => {
  fixture(t);
  const selected = [],
    scope = new AbortController();
  const view = createTable(
    [{ key: 'name', label: '<b>Название</b>' }],
    [{ id: 'a', name: '<img src=x onerror=alert(1)> длинная подпись' }],
    { onSelect: (row) => selected.push(row), signal: scope.signal },
  );
  const body = () => view.children[0].children[2];
  const row = body().children[0];
  assert.equal(row.children[0].textContent, '<img src=x onerror=alert(1)> длинная подпись');
  row.dispatchEvent(new Event('click'));
  assert.equal(body().children[0], row, 'selection keeps focusable row mounted');
  assert.equal(row.getAttribute('aria-selected'), 'true');
  assert.equal(selected[0].id, 'a');
  view.update([{ amount: -3 }], { columns: [{ key: 'amount', label: 'Баланс', type: 'number' }] });
  assert.equal(body().children[0].children[0].textContent, '-3');
  const current = body();
  assert.throws(() => view.update([{ amount: NaN }]));
  assert.equal(body(), current, 'invalid data does not remove the current table');
  view.update([]);
  assert.equal(body().children[0].children[0].textContent, 'Нет данных');
  scope.abort();
  assert.equal(view.children.length, 0);
});

test('histogram intervals account for every value once, including the final endpoint and constants', () => {
  const bins = geometry.histogram([0, 1, 2, 3, 4], 4);
  assert.deepEqual(
    bins.map((bin) => bin.count),
    [1, 1, 1, 2],
  );
  assert.equal(bins.at(-1).closed, true);
  assert.equal(bins.at(-1).max, 4);
  assert.equal(
    geometry.histogram([7, 7, 7], 4).reduce((sum, bin) => sum + bin.count, 0),
    3,
  );
  assert.deepEqual(geometry.histogram([], 4), []);
  assert.throws(() => geometry.histogram([Infinity]));
  assert.throws(() => geometry.histogram([1], 0));
});
test('stacked bars accumulate positive and negative sides independently; shares total 100%', () => {
  const items = [{ values: [2, -3, 0] }, { values: [6, 2, 0] }, { values: [null, -5, 0] }];
  const stacked = geometry.barSegments(items, 'stacked').filter((s) => s.category === 1);
  assert.deepEqual(
    stacked.map((s) => [s.start, s.end]),
    [
      [0, -3],
      [0, 2],
      [-3, -8],
    ],
  );
  assert.throws(() => geometry.barSegments(items, 'percent'));
  const shares = geometry.barSegments([{ values: [2, 0] }, { values: [6, 0] }], 'percent');
  assert.deepEqual(
    shares.map((s) => [s.start, s.end]),
    [
      [0, 25],
      [25, 100],
      [0, 0],
      [0, 0],
    ],
  );
  assert.deepEqual(
    geometry.barSegments(items, 'ordinary').map((s) => s.value),
    [2, -3, 0],
  );
});
test('series bar variants, hidden rows and horizontal orientation keep raw selection values', (t) => {
  fixture(t);
  const selected = [],
    input = [
      { id: 'a', label: 'A', values: [2, 4] },
      { id: 'b', label: 'B', values: [6, 0] },
    ];
  const chart = createBarChart(input, {
    mode: 'percent',
    labels: ['X', 'Y'],
    onSelect: (p) => selected.push(p),
  });
  assert.equal(parts(chart).length, 4);
  parts(chart)[0].dispatchEvent(new Event('click'));
  assert.equal(selected[0].value, 2);
  assert.equal(selected[0].share, 25);
  rows(chart)[1].dispatchEvent(new Event('click'));
  assert.equal(parts(chart).length, 2);
  assert.match(parts(chart)[0].getAttribute('aria-label'), /100%/);
  for (const mode of ['ordinary', 'grouped', 'stacked', 'percent'])
    chart.update(input, { mode, orientation: 'horizontal' });
  assert.equal(parts(chart).length, 2);
  assert(Number(parts(chart)[0].getAttribute('width')) > 0);
});
test('step lines and optional areas preserve the same null gaps and values', (t) => {
  fixture(t);
  const chart = createLineChart([{ label: 'Step', values: [2, 4, null, 6, 3] }], {
    step: true,
    fill: true,
  });
  const line = walk(chart).find((n) => n.getAttribute('class') === 'atlas-chart-line');
  assert.equal((line.getAttribute('d').match(/M/g) || []).length, 2);
  assert.equal((line.getAttribute('d').match(/H/g) || []).length, 2);
  const areas = walk(chart).filter((n) => n.getAttribute('class') === 'atlas-chart-area');
  assert.equal(areas.length, 2, 'separate areas do not bridge missing data');
  assert.equal(parts(chart).length, 4);
});
test('bubble areas, including zero size, encode the third metric rather than radius', (t) => {
  fixture(t);
  const chart = createScatterChart(
    [
      { id: 'large', label: 'Large', x: -2, y: 10, size: 100 },
      { id: 'small', label: 'Small', x: 4, y: 5, size: 25 },
      { id: 'zero', label: 'Zero', x: 1, y: 2, size: 0 },
    ],
    { bubble: true },
  );
  const circles = walk(chart).filter((n) => n.getAttribute('class') === 'atlas-chart-bubble');
  const radius = circles.map((n) => Number(n.getAttribute('r')));
  assert.deepEqual(radius, [15, 7.5, 0]);
  assert.equal(radius[0] ** 2 / radius[1] ** 2, 4);
  assert.equal(parts(chart).length, 3, 'zero size still has a focusable hit target');
  assert.throws(() => chart.update([{ label: 'bad', x: 1, y: 2, size: -1 }]));
});
test('intervals accept absent centers and expose their actual bounds on selection', (t) => {
  fixture(t);
  const selected = [],
    chart = createIntervalChart(
      [
        { id: 'one', label: 'One', min: -10, center: 0, max: 12 },
        { id: 'two', label: 'Two', min: 2, max: 8 },
      ],
      { onSelect: (p) => selected.push(p) },
    );
  assert.equal(parts(chart).length, 2);
  parts(chart)[1].dispatchEvent(new Event('click'));
  assert.equal(selected[0].center, null);
  assert.equal(selected[0].min, 2);
  assert.equal(selected[0].max, 8);
  assert.throws(() => chart.update([{ label: 'bad', min: 0, max: 4, center: 5 }]));
  assert.equal(parts(chart).length, 2);
});
test('heatmap cell colors come from the supplied shared scale; null is distinct from zero', (t) => {
  fixture(t);
  const scale = new ColorScale([
    { value: 0, color: '#000000' },
    { value: 10, color: '#ffffff' },
  ]);
  const input = { rows: ['R'], columns: ['A', 'B', 'C'], values: [[0, 5, null]] };
  const chart = createHeatmap(input, { scale });
  const cells = parts(chart);
  assert.equal(cells.length, 2);
  assert.equal(cells[0].style.backgroundColor, scale.color(0));
  assert.equal(cells[1].style.backgroundColor, scale.color(5));
  input.values[0][0] = 9;
  assert.equal(cells[0].textContent, '0', 'input mutation does not change the chart snapshot');
  assert.throws(() => chart.update({ ...input, values: [[1]] }));
  assert.equal(parts(chart)[0], cells[0]);
});
test('treemap preserves areas and hierarchy without overlap or mutating source; cycles are rejected', () => {
  const input = {
    id: 'root',
    label: 'Root',
    children: [
      { id: 'a', label: 'A', value: 3 },
      { id: 'b', label: 'B', children: [{ id: 'c', label: 'C', value: 1 }] },
      { id: 'z', label: 'Zero', value: 0 },
    ],
  };
  const original = structuredClone(input),
    tree = geometry.hierarchy(input);
  assert.equal(tree.value, 4);
  const boxes = geometry.treemap(tree.children, 200, 100);
  assert.equal(boxes.length, 2);
  assert.equal(
    boxes.reduce((sum, box) => sum + box.width * box.height, 0),
    20000,
  );
  for (const box of boxes) {
    assert.equal((box.width * box.height) / 20000, box.item.value / 4);
    assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= 200 && box.y + box.height <= 100);
  }
  assert.deepEqual(input, original);
  const cyclic = { label: 'Cycle', children: [] };
  cyclic.children.push(cyclic);
  assert.throws(() => geometry.hierarchy(cyclic));
  assert.throws(() => geometry.hierarchy({ label: 'bad', value: -1 }));
});
test('treemap drill-down and back preserve the path, scope closes every chart type', (t) => {
  const observers = fixture(t),
    scope = new AbortController();
  const tree = createTreeMap(
    {
      id: 'root',
      label: 'Root',
      children: [{ id: 'a', label: 'A', children: [{ id: 'b', label: 'B', value: 3 }] }],
    },
    { signal: scope.signal },
  );
  parts(tree)[0].dispatchEvent(new Event('click'));
  assert(walk(tree).some((n) => n.textContent === 'A' && n.tagName === 'button'));
  const back = walk(tree).find((n) => n.textContent === '← Назад');
  assert.equal(back.disabled, false);
  back.dispatchEvent(new Event('click'));
  assert.equal(walk(tree).find((n) => n.textContent === '← Назад').disabled, true);
  const charts = [
    tree,
    createHistogram([1, 2, 3], { signal: scope.signal }),
    createScatterChart([], { signal: scope.signal }),
    createIntervalChart([], { signal: scope.signal }),
    createHeatmap(
      { rows: [], columns: [], values: [] },
      { scale: new ColorScale([]), signal: scope.signal },
    ),
  ];
  scope.abort();
  assert(observers.every((observer) => observer.disconnected));
  assert(charts.every((chart) => chart.children.length === 0));
});

const hierarchyData = () => ({
  id: 'world',
  label: 'World',
  color: '#123456',
  colorValue: 60,
  children: [
    { id: 'a', label: 'A', value: 9, colorValue: 90 },
    {
      id: 'group',
      label: 'Branch',
      colorValue: 50,
      children: [
        { id: 'b', label: 'B', value: 3, colorValue: 20 },
        { id: 'c', label: 'C', value: 1, colorValue: 80 },
      ],
    },
  ],
});
const hierarchyFactories = [
  createTreeMap,
  createIcicleChart,
  createSunburstChart,
  createCirclePack,
  createTreeChart,
  createClusterChart,
];
test('partition views share totals and preserve quantitative spans across levels and orientations', () => {
  const input = hierarchyData(),
    original = structuredClone(input),
    tree = geometry.hierarchy(input);
  for (const kind of ['icicle', 'sunburst'])
    for (const orientation of ['horizontal', 'vertical']) {
      const result = hierarchyLayouts.layout(kind, tree, { width: 600, height: 320, orientation });
      assert.equal(result.root.value, 13, 'aggregate parents are not summed a second time');
      assert.equal(result.nodes.length, 5);
      for (const node of result.nodes) {
        assert([node.x0, node.x1, node.y0, node.y1].every(Number.isFinite));
        if (node.parent)
          assert(
            Math.abs(
              (node.x1 - node.x0) / (node.parent.x1 - node.parent.x0) -
                node.value / node.parent.value,
            ) < 1e-10,
          );
      }
    }
  assert.deepEqual(input, original);
});
test('circle packing contains every child, separates siblings and uses proportional leaf areas', () => {
  const tree = geometry.hierarchy(hierarchyData()),
    result = hierarchyLayouts.layout('pack', tree, { width: 600, height: 320 });
  for (const node of result.nodes) {
    assert([node.x, node.y, node.r].every(Number.isFinite));
    if (node.parent)
      assert(
        Math.hypot(node.x - node.parent.x, node.y - node.parent.y) + node.r <= node.parent.r + 1e-8,
      );
    if (node.children)
      for (let i = 0; i < node.children.length; i++)
        for (let j = i + 1; j < node.children.length; j++) {
          const a = node.children[i],
            b = node.children[j];
          assert(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 1e-8);
        }
  }
  const a = result.nodes.find((node) => node.data.id === 'a'),
    c = result.nodes.find((node) => node.data.id === 'c');
  assert(Math.abs(a.r ** 2 / c.r ** 2 - 9) < 1e-10);
});
test('cluster aligns leaves while tidy tree preserves depth, with finite radial and Cartesian layouts', () => {
  const tree = geometry.hierarchy(hierarchyData());
  for (const orientation of ['horizontal', 'vertical', 'radial']) {
    const cluster = hierarchyLayouts.layout('cluster', tree, {
      width: 600,
      height: 320,
      orientation,
    });
    const tidy = hierarchyLayouts.layout('tree', tree, { width: 600, height: 320, orientation });
    assert.equal(
      new Set(cluster.nodes.filter((node) => !node.children).map((node) => node.y)).size,
      1,
    );
    assert.equal(
      new Set(tidy.nodes.filter((node) => !node.children).map((node) => node.y)).size,
      2,
    );
    assert(
      cluster.nodes
        .concat(tidy.nodes)
        .every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)),
    );
  }
});
test('every hierarchy view uses explicit parent colors and shared scope, drill-down survives resize and updates', (t) => {
  const observers = fixture(t),
    scale = new ColorScale([
      { value: 0, color: '#000000' },
      { value: 100, color: '#ffffff' },
    ]);
  for (const create of hierarchyFactories) {
    const scope = new AbortController(),
      input = hierarchyData(),
      original = structuredClone(input);
    const chart = create(input, { scale, signal: scope.signal });
    const actualColors = walk(chart).flatMap((node) => [
      node.getAttribute('fill'),
      node.style.backgroundColor,
    ]);
    assert(actualColors.includes(scale.color(50)), 'branch uses the shared metric scale');
    assert(!actualColors.includes('#123456'), 'metric mode does not mix original family colors');
    parts(chart)
      .find((node) => node.getAttribute('aria-label').startsWith('Branch ·'))
      .dispatchEvent(new Event('click'));
    assert.equal(
      walk(chart).find((node) => node.tagName === 'button' && node.textContent === '← Назад')
        .disabled,
      false,
    );
    chart.clientWidth = 181;
    observers.at(-1).callback();
    chart.update(input);
    assert(
      walk(chart).some(
        (node) => node.tagName === 'button' && node.textContent === 'Branch' && node.disabled,
      ),
    );
    const before = chart.children[0].children[0];
    assert.throws(() => chart.update({ label: 'bad', value: -1 }));
    assert.equal(chart.children[0].children[0], before);
    chart.update({
      id: 'world',
      label: 'World',
      children: [{ id: 'new', label: 'New', value: 1 }],
    });
    assert.equal(
      walk(chart).find((node) => node.tagName === 'button' && node.textContent === '← Назад')
        .disabled,
      true,
      'removed branch returns to nearest existing ancestor',
    );
    assert.deepEqual(input, original);
    scope.abort();
    assert.equal(chart.children.length, 0);
    assert(observers.at(-1).disconnected);
  }
});
test('missing color metrics use a neutral color, and zero-valued structural trees remain visible', (t) => {
  fixture(t);
  const scale = new ColorScale([
    { value: 0, color: '#000000' },
    { value: 100, color: '#ffffff' },
  ]);
  const chart = createIcicleChart(
    {
      label: 'Missing',
      color: '#123456',
      children: [{ label: 'Known', value: 3, colorValue: 60 }],
    },
    { scale },
  );
  assert(walk(chart).some((node) => node.style.backgroundColor === '#576977'));
  for (const create of [createTreeChart, createClusterChart]) {
    const structural = create({ label: 'Root', children: [{ label: 'Leaf' }] });
    assert.equal(parts(structural).length, 2);
    structural.update({ label: 'Root', children: [{ label: 'Leaf' }] }, { orientation: 'radial' });
    assert(
      walk(structural).every((node) =>
        [...node.attributes.values()].every((value) => !/NaN|Infinity/.test(value)),
      ),
    );
  }
});
