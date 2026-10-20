/* Shared native controls. Switch.checked can also be updated by an external model. */
(function (root) {
  'use strict';
  function button(label, callback, { signal, className = '', title = label, disabled = false } = {}) {
    const node = document.createElement('button'); node.type = 'button'; node.className = ['atlas-button', className].filter(Boolean).join(' ');
    node.textContent = label; node.title = title; node.disabled = disabled;
    node.addEventListener('click', callback, signal ? { signal } : undefined); return node;
  }
  function createSwitch(label, onChange, { checked = false, ...options } = {}) {
    const node = button(label, event => { node.checked = !node.checked; onChange?.(node.checked, event); }, options);
    node.classList.add('atlas-switch'); node.setAttribute('role', 'switch');
    Object.defineProperty(node, 'checked', { get: () => node.getAttribute('aria-checked') === 'true', set: value => node.setAttribute('aria-checked', String(!!value)) });
    node.checked = checked; return node;
  }
  Object.assign(root.AtlasUI ||= {}, { controls: Object.freeze({ button, createSwitch }) });
  if (typeof module !== 'undefined' && module.exports) module.exports = { button, createSwitch };
})(globalThis);
