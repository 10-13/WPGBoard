'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { button, createSwitch, createSelect } = require('../packages/ui/controls.js');
class Control extends EventTarget {
  constructor(tag) {
    super();
    this.tag = tag;
  }
  children = [];
  storedValue = '';
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  get value() {
    return this.tag === 'select'
      ? this.children.find((option) => option.value === this.storedValue)?.value || ''
      : this.storedValue;
  }
  set value(value) {
    this.storedValue = String(value);
  }
  get options() {
    return this.children;
  }
  attributes = new Map();
  classList = { add() {} };
  setAttribute(key, value) {
    this.attributes.set(key, value);
  }
  getAttribute(key) {
    return this.attributes.get(key);
  }
}
function fixture(run) {
  const previous = global.document;
  global.document = { createElement: (tag) => new Control(tag) };
  try {
    run();
  } finally {
    global.document = previous;
  }
}
test('a shared switch updates accessible state before its callback; model updates do not trigger the callback', () =>
  fixture(() => {
    const calls = [],
      node = createSwitch(
        'Highlight',
        (checked) => {
          assert.equal(node.checked, checked);
          calls.push(checked);
        },
        { checked: true },
      );
    assert.equal(node.type, 'button');
    assert.equal(node.getAttribute('role'), 'switch');
    node.dispatchEvent(new Event('click'));
    assert.equal(node.checked, false);
    assert.deepEqual(calls, [false]);
    node.checked = true;
    assert.deepEqual(calls, [false]);
    node.dispatchEvent(new Event('click'));
    assert.deepEqual(calls, [false, false]);
  }));
test('shared controls release click callbacks with their owner signal', () =>
  fixture(() => {
    const lifetime = new AbortController();
    let calls = 0;
    const node = button('Run', () => calls++, { signal: lifetime.signal }),
      toggle = createSwitch('Toggle', () => calls++, { signal: lifetime.signal });
    node.dispatchEvent(new Event('click'));
    lifetime.abort();
    node.dispatchEvent(new Event('click'));
    toggle.dispatchEvent(new Event('click'));
    assert.equal(calls, 1);
    assert.equal(toggle.checked, false);
  }));

test('shared select retains native form attributes, string IDs, inert labels and disabled options', () =>
  fixture(() => {
    const items = [
      { value: 'blocked', label: 'Недоступно', disabled: true, title: 'Причина' },
      [0, '<b>Ресурс</b>'],
      ['coal', 'Уголь'],
    ];
    const before = structuredClone(items);
    const node = createSelect(items, undefined, {
      label: 'Выбор ресурса',
      title: 'Подсказка',
      required: true,
      name: 'resource',
      className: 'wide',
    });
    assert.equal(node.tag, 'select');
    assert.equal(node.value, '0');
    assert.equal(node.className, 'atlas-select wide');
    assert.equal(node.required, true);
    assert.equal(node.getAttribute('aria-label'), 'Выбор ресурса');
    assert.equal(node.name, 'resource');
    assert.equal(node.title, 'Подсказка');
    assert.equal(node.options[0].disabled, true);
    assert.equal(node.options[0].title, 'Причина');
    assert.equal(node.options[1].textContent, '<b>Ресурс</b>');
    assert.deepEqual(items, before);
    assert.equal(createSelect([], undefined, { disabled: true }).disabled, true);
  }));

test('changing select items preserves values, handles removed choices and never dispatches a user callback', () =>
  fixture(() => {
    const calls = [],
      node = createSelect(
        [
          ['a', 'A'],
          ['b', 'B'],
        ],
        (value, event) => {
          assert.equal(value, node.value);
          assert.equal(event.type, 'change');
          calls.push(value);
        },
        { value: 'b' },
      );
    assert.equal(node.value, 'b');
    node.setItems([
      ['b', 'Новое название'],
      ['c', 'C'],
    ]);
    assert.equal(node.value, 'b');
    assert.equal(node.options[0].textContent, 'Новое название');
    node.value = 'c';
    assert.deepEqual(calls, []);
    node.dispatchEvent(new Event('change'));
    assert.deepEqual(calls, ['c']);
    node.setItems([['a', 'A']]);
    assert.equal(node.value, '', 'removed choice cannot silently select another object');
    node.setItems([['a', 'A'], { value: 'custom', label: 'Снимок', disabled: true }], {
      value: 'custom',
    });
    assert.equal(node.value, 'custom', 'a disabled row may represent a model-owned snapshot');
    assert.deepEqual(calls, ['c']);
    node.setItems([]);
    assert.equal(node.value, '');
    assert.equal(node.options.length, 0);
  }));

test('select callbacks follow their owner signal across item updates', () =>
  fixture(() => {
    const lifetime = new AbortController(),
      calls = [];
    const node = createSelect([['a', 'A']], (value) => calls.push(value), {
      signal: lifetime.signal,
    });
    node.setItems([['b', 'B']], { value: 'b' });
    node.dispatchEvent(new Event('change'));
    lifetime.abort();
    node.value = 'b';
    node.dispatchEvent(new Event('change'));
    assert.deepEqual(calls, ['b']);
    const stopped = createSelect([['a', 'A']], (value) => calls.push(value), {
      signal: lifetime.signal,
    });
    stopped.dispatchEvent(new Event('change'));
    assert.deepEqual(calls, ['b']);
  }));

test('invalid and duplicate select items fail atomically before replacing the visible list', () =>
  fixture(() => {
    const node = createSelect([['a', 'A']], undefined, { value: 'a' }),
      original = node.options[0];
    for (const items of [
      null,
      [{}],
      [[NaN, 'N']],
      [
        ['x', 'X'],
        ['x', 'Again'],
      ],
      [
        [1, 'N'],
        ['1', 'S'],
      ],
    ]) {
      assert.throws(() => node.setItems(items));
      assert.equal(node.options[0], original);
      assert.equal(node.value, 'a');
    }
    assert.throws(() => createSelect([], true));
  }));
