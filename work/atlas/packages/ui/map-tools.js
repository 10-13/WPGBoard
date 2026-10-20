/* Exclusive map-click tools; UI state only, independent of game domains. */
(function (root) {
  'use strict';
  const { EventBus } = root.AtlasCore;
  class MapTools extends EventBus {
    #tools = new Map(); #activeId = 'ui:select';
    constructor() { super(); this.#tools.set('ui:select', { id: 'ui:select', label: 'Выбор тайла', shortcut: 'I', order: -100, enabled: () => true, click() {} }); }
    get activeId() { return this.#activeId; }
    get active() { return this.list.find(tool => tool.id === this.#activeId); }
    get list() { return [...this.#tools.values()].sort((a, b) => a.order - b.order).map(({ id, label, shortcut, order, enabled }) => Object.freeze({ id, label, shortcut, order, enabled: !!enabled() })); }
    register({ id, label, click, shortcut = '', order = 0, enabled = () => true }, { signal } = {}) {
      if (typeof id !== 'string' || !id || this.#tools.has(id) || typeof label !== 'string' || !label || typeof click !== 'function' || typeof enabled !== 'function' || !Number.isFinite(order)) throw new Error('Нужны уникальный ID, название и обработчик инструмента.');
      let registered = !signal?.aborted;
      const dispose = () => { if (!registered) return; registered = false; this.#tools.delete(id); signal?.removeEventListener('abort', dispose); if (this.#activeId === id) this.reset(); else this.emit('change', { activeId: this.#activeId }); };
      if (registered) { this.#tools.set(id, { id, label, click, shortcut, order, enabled }); signal?.addEventListener('abort', dispose, { once: true }); this.emit('change', { activeId: this.#activeId }); }
      return Object.freeze({ id, activate: () => this.activate(id), dispose });
    }
    activate(id) {
      const tool = this.#tools.get(id); if (!tool || !tool.enabled()) throw new Error('Инструмент недоступен.');
      if (this.#activeId === id) return; const previousId = this.#activeId; this.#activeId = id; this.emit('change', { activeId: id, previousId });
    }
    reset() { this.activate('ui:select'); }
    handleClick(event) { const tool = this.#tools.get(this.#activeId); if (!tool?.enabled()) { this.reset(); return; } return tool.click(event); }
  }
  Object.assign(root.AtlasUI ||= {}, { MapTools });
  if (typeof module !== 'undefined' && module.exports) module.exports = { MapTools };
})(globalThis);
