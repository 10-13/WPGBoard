'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ColorScale } = require('../packages/ui/color-scale-model.js');
require('../packages/ui/controls.js');
const { createColorScale } = require('../packages/ui/color-scale.js');
class Node extends EventTarget {
  children = [];
  attributes = new Map();
  style = {};
  append(...items) {
    this.children.push(...items);
  }
  replaceChildren(...items) {
    this.children = items;
  }
  setAttribute(key, value) {
    this.attributes.set(key, value);
  }
}
test('a reusable scale view updates between empty, singleton and threshold models without losing the original values', (t) => {
  const previous = global.document;
  global.document = { createElement: () => new Node() };
  t.after(() => {
    global.document = previous;
  });
  const model = new ColorScale(
    [
      { value: 0, color: '#000000' },
      { value: 12, color: '#123456' },
      { value: 100, color: '#ffffff' },
    ],
    { mode: 'threshold' },
  );
  const node = createColorScale(model, { label: 'Высота', formatValue: (n) => n + ' метров' });
  assert.equal(node.attributes.get('aria-label'), 'Высота');
  assert.match(node.children[0].style.backgroundImage, /12%/);
  assert.deepEqual(
    node.children[1].children.map((n) => n.children[0].textContent),
    ['0 метров', '12 метров', '100 метров'],
  );
  node.update(new ColorScale());
  assert.equal(node.children.length, 1);
  assert.equal(node.children[0].textContent, 'Нет данных для шкалы');
  node.update(new ColorScale([{ value: 200, color: '#abcdef' }]));
  assert.equal(node.children[0].style.backgroundColor, '#abcdef');
  assert.equal(node.children[1].children.length, 1);
  assert.equal(model.points[1].value, 12);
});

test('hatch samples receive the same value and color as the model and text formatting stays inert', (t) => {
  const previous = global.document;
  global.document = { createElement: () => new Node() };
  t.after(() => {
    global.document = previous;
  });
  const model = new ColorScale([
    { value: 0, color: '#000000' },
    { value: 10, color: '#ffffff' },
  ]);
  const seen = [];
  const node = createColorScale(model, {
    steps: 3,
    formatValue: () => '<b>Long label</b>',
    sampleStyle(value, color) {
      seen.push({ value, color });
      return { backgroundColor: 'transparent' };
    },
  });
  assert.deepEqual(seen, model.grades(3));
  assert.equal(node.children.length, 1);
  for (const grade of node.children[0].children) {
    assert.equal(grade.children[1].textContent, '<b>Long label</b>');
    assert.equal(grade.children[0].style.backgroundColor, 'transparent');
  }
});

test('one view delegates mode selection and can be updated with the same points in another mode', (t) => {
  const previous = global.document;
  global.document = { createElement: () => new Node() };
  t.after(() => {
    global.document = previous;
  });
  const points = [
    { value: 0, color: '#000000' },
    { value: 10, color: '#ffffff' },
  ];
  const selected = [];
  const view = createColorScale(new ColorScale(points), {
    onModeChange(mode) {
      selected.push(mode);
      view.update(new ColorScale(points, { mode }));
    },
  });
  const select = view.children[0].children[1];
  assert.equal(select.value, 'linear');
  select.value = 'threshold';
  select.dispatchEvent(new Event('change'));
  assert.deepEqual(selected, ['threshold']);
  assert.equal(view.children[0].children[1].value, 'threshold');
  assert.equal(
    view.children.filter((node) => node.className === 'atlas-color-scale-bar').length,
    1,
  );
});
