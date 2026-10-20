/* Headless overlay definitions and local display preferences. No game actions, Canvas or DOM. */
(function (root) {
  'use strict';
  function createOverlayAPI({ EventBus, clone, freeze, equal }) {
    const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
    const validId = id => typeof id === 'string' && !!id.trim() && id.length <= 150 && !unsafe.has(id);
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const ids = values => { if (!Array.isArray(values) || values.length > 10000 || values.some(id => !validId(id)) || new Set(values).size !== values.length) throw new Error('Нужен список уникальных ID оверлеев.'); return values; };
    const defaults = () => ({ version: 1, order: [], visibility: {} });
    const settings = value => {
      const data = clone(value); if (!object(data) || data.version !== 1 || !object(data.visibility) || Object.keys(data.visibility).length > 10000 || Object.entries(data.visibility).some(([id, visible]) => !validId(id) || typeof visible !== 'boolean')) throw new Error('Некорректные настройки отображения оверлеев.');
      if (data.options !== undefined && (!object(data.options) || Object.keys(data.options).length > 10000 || Object.entries(data.options).some(([id, options]) => !validId(id) || !object(options)) || JSON.stringify(data.options).length > 1000000)) throw new Error('Некорректные параметры отображения оверлеев.');
      return freeze({ version: 1, order: [...ids(data.order)], visibility: data.visibility, ...(data.options !== undefined ? { options: data.options } : {}) });
    };
    class OverlayRegistry extends EventBus {
      #definitions = new Map(); #last = []; #settings = freeze(defaults());
      #savedOrder() { return this.#settings.order; }
      get list() {
        const saved = this.#savedOrder(), rank = new Map(saved.map((id, i) => [id, i])), visibility = this.#settings.visibility;
        return freeze([...this.#definitions.values()].sort((a, b) => {
          const ar = rank.get(a.id), br = rank.get(b.id);
          if (ar !== undefined || br !== undefined) return (ar ?? Infinity) - (br ?? Infinity);
          return a.order - b.order || a.id.localeCompare(b.id);
        }).map((d, index) => ({ ...d, visible: object(visibility) && Object.hasOwn(visibility, d.id) && typeof visibility[d.id] === 'boolean' ? visibility[d.id] : d.visible, index })));
      }
      has(id) { return this.#definitions.has(id); }
      get(id) { return this.list.find(item => item.id === id) || null; }
      register({ id, title = id, source = 'core', order = 10, visible = true, exportable = true }, { signal } = {}) {
        if (!validId(id) || this.has(id) || typeof title !== 'string' || !title.trim() || typeof source !== 'string' || !source.trim() || !Number.isFinite(order) || typeof visible !== 'boolean' || typeof exportable !== 'boolean') throw new Error('Нужны уникальный ID, название и параметры оверлея.');
        const definition = freeze({ id, title, source, order, visible, exportable }), registry = this;
        let active = !signal?.aborted;
        const dispose = () => { if (!active) return; active = false; if (this.#definitions.get(id) === definition) this.#definitions.delete(id); signal?.removeEventListener('abort', dispose); this.#changed(); };
        if (active) { this.#definitions.set(id, definition); signal?.addEventListener('abort', dispose, { once: true }); this.#changed(); }
        return Object.freeze({ id, get current() { return active ? registry.get(id) : null; }, dispose });
      }
      setVisible(id, visible) {
        const overlay = this.get(id); if (!overlay) throw new Error('Оверлей не зарегистрирован.');
        if (typeof visible !== 'boolean') throw new TypeError('Видимость должна быть логическим значением.');
        if (overlay.visible === visible) return null;
        return this.restore({ ...this.#settings, visibility: { ...this.#settings.visibility, [id]: visible } });
      }
      getOptions(id) { return this.#settings.options?.[id] || Object.freeze({}); }
      setOptions(id, options) {
        if (!this.has(id)) throw new Error('Оверлей не зарегистрирован.');
        if (!object(options)) throw new TypeError('Параметры отображения должны быть объектом.');
        if (equal(this.getOptions(id), options)) return false;
        return this.restore({ ...this.#settings, options: { ...(this.#settings.options || {}), [id]: options } });
      }
      reorder(orderedIds) {
        ids(orderedIds); const current = this.list.map(item => item.id);
        if (orderedIds.length !== current.length || orderedIds.some(id => !this.has(id))) throw new Error('Укажите каждый зарегистрированный оверлей ровно один раз.');
        if (equal(current, orderedIds)) return null;
        // Keep the slots of temporarily unloaded modules; they retain their place when enabled again.
        let cursor = 0; const order = this.#savedOrder().map(id => this.has(id) ? orderedIds[cursor++] : id);
        order.push(...orderedIds.slice(cursor));
        return this.restore({ ...this.#settings, order });
      }
      move(id, delta) {
        if (!this.has(id) || !Number.isInteger(delta)) throw new Error('Укажите оверлей и целое смещение.');
        const order = this.list.map(item => item.id), from = order.indexOf(id), to = Math.max(0, Math.min(order.length - 1, from + delta));
        if (from === to) return null; order.splice(from, 1); order.splice(to, 0, id); return this.reorder(order);
      }
      reset() { return this.restore(defaults()); }
      toJSON() { return clone(this.#settings); }
      restore(value) { const next = settings(value); if (equal(this.#settings, next)) return false; this.#settings = next; this.#changed(); this.emit('settings:change', { settings: this.#settings }); return true; }
      #changed() { const list = this.list; if (equal(list, this.#last)) return; this.#last = list; this.emit('change', { overlays: list }); }
    }
    return { OverlayRegistry };
  }
  root.AtlasOverlayCore = { createOverlayAPI };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createOverlayAPI };
})(globalThis);
