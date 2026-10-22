/* Shared native controls. Model updates do not dispatch user callbacks. */
(function (root) {
  'use strict';
  function button(
    label,
    callback,
    { signal, className = '', title = label, disabled = false } = {},
  ) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = ['atlas-button', className].filter(Boolean).join(' ');
    node.textContent = label;
    node.title = title;
    node.disabled = disabled;
    node.addEventListener('click', callback, signal ? { signal } : undefined);
    return node;
  }
  function createSwitch(label, onChange, { checked = false, ...options } = {}) {
    const node = button(
      label,
      (event) => {
        node.checked = !node.checked;
        onChange?.(node.checked, event);
      },
      options,
    );
    node.classList.add('atlas-switch');
    node.setAttribute('role', 'switch');
    Object.defineProperty(node, 'checked', {
      get: () => node.getAttribute('aria-checked') === 'true',
      set: (value) => node.setAttribute('aria-checked', String(!!value)),
    });
    node.checked = checked;
    return node;
  }
  function createSelect(
    items = [],
    onChange,
    { value, label, title, className = '', disabled = false, required = false, name, signal } = {},
  ) {
    if (onChange != null && typeof onChange !== 'function')
      throw new TypeError('Обработчик выбора должен быть функцией.');
    const node = document.createElement('select');
    node.className = ['atlas-select', className].filter(Boolean).join(' ');
    node.disabled = disabled;
    node.required = required;
    if (label !== undefined) node.setAttribute('aria-label', label);
    if (title !== undefined) node.title = title;
    if (name !== undefined) node.name = name;
    // Replacing items is a model update: keep the value, never invoke onChange.
    node.setItems = (nextItems, selection = {}) => {
      if (!Array.isArray(nextItems)) throw new TypeError('Пункты списка должны быть массивом.');
      const values = new Set(),
        rows = nextItems.map((item) => {
          const row = Array.isArray(item) ? { value: item[0], label: item[1] } : item;
          if (
            !row ||
            !['string', 'number'].includes(typeof row.value) ||
            (typeof row.value === 'number' && !Number.isFinite(row.value)) ||
            row.label == null
          )
            throw new TypeError('Пункт списка содержит value и label.');
          const value = String(row.value);
          if (values.has(value)) throw new Error('Повторяющееся значение списка: ' + value);
          values.add(value);
          return { ...row, value };
        });
      const selected = Object.hasOwn(selection, 'value') ? selection.value : node.value;
      const options = rows.map((row) => {
        const option = document.createElement('option');
        option.value = row.value;
        option.textContent = String(row.label);
        option.disabled = !!row.disabled;
        if (row.title !== undefined) option.title = String(row.title);
        return option;
      });
      node.replaceChildren(...options);
      node.value =
        selected === undefined
          ? rows.find((row) => !row.disabled)?.value || ''
          : String(selected ?? '');
      return node;
    };
    node.setItems(items, { value });
    if (onChange)
      node.addEventListener(
        'change',
        (event) => onChange(node.value, event),
        signal ? { signal } : undefined,
      );
    return node;
  }
  function valueInput(tag, type, options) {
    const { value = '', label, className = '', onInput, onChange, signal } = options;
    for (const callback of [onInput, onChange])
      if (callback != null && typeof callback !== 'function')
        throw new TypeError('Обработчик поля ввода должен быть функцией.');
    const node = document.createElement(tag);
    if (type) node.type = type;
    node.className = [tag === 'textarea' ? 'atlas-textarea' : 'atlas-input', className]
      .filter(Boolean)
      .join(' ');
    for (const key of [
      'id',
      'name',
      'title',
      'placeholder',
      'required',
      'disabled',
      'readOnly',
      'minLength',
      'maxLength',
      'pattern',
      'min',
      'max',
      'step',
      'rows',
      'cols',
      'autocomplete',
      'inputMode',
      'spellcheck',
      'wrap',
    ])
      if (options[key] !== undefined) node[key] = options[key];
    if (label !== undefined) node.setAttribute('aria-label', label);
    if (options.list !== undefined) node.setAttribute('list', options.list);
    node.value = value == null ? '' : String(value);
    for (const [event, callback] of [
      ['input', onInput],
      ['change', onChange],
    ])
      if (callback)
        node.addEventListener(
          event,
          (event) => callback(node.value, event),
          signal ? { signal } : undefined,
        );
    return node;
  }
  function createTextInput({ type = 'text', ...options } = {}) {
    if (!['text', 'search', 'email', 'url', 'tel', 'password'].includes(type))
      throw new TypeError(
        'Текстовое поле поддерживает text, search, email, url, tel или password.',
      );
    return valueInput('input', type, options);
  }
  function createNumberInput(options = {}) {
    return valueInput('input', 'number', options);
  }
  function createTextArea(options = {}) {
    return valueInput('textarea', null, options);
  }
  function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }
  function field(label, input) {
    const node = el('label', 'field');
    node.append(el('span', 'field-label', label), input);
    return node;
  }
  const api = {
    button,
    createSwitch,
    createSelect,
    createTextInput,
    createNumberInput,
    createTextArea,
    el,
    field,
  };
  Object.assign((root.AtlasUI ||= {}), { controls: Object.freeze(api) });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
