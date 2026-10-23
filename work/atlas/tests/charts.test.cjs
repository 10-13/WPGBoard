'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { createPieChart, createBarChart, createLineChart } = require('../packages/ui/charts.js');
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
