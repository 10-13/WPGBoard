(function (root) {
  'use strict';
  const { EventBus, uid } = root.AtlasCore;
  class ActionHandler extends EventBus {
    #fn; #active = true; #off;
    constructor(fn, { signal } = {}) {
      super(); if (typeof fn !== 'function') throw new TypeError('Нужен обработчик действия.'); this.#fn = fn;
      const abort = () => this.disable(); signal?.addEventListener('abort', abort, { once: true });
      this.#off = () => signal?.removeEventListener('abort', abort); if (signal?.aborted) this.disable();
    }
    get active() { return this.#active; }
    invoke(context) { if (this.#active) return this.#fn(context); }
    disable() { if (!this.#active) return; this.#active = false; this.#fn = null; this.#off?.(); this.emit('inactive', {}); }
    dispose() { this.disable(); }
  }
  class TreeMenu extends EventBus {
    #items = new Map(); #bar = null; #contextProvider; #popup = null; #popupCleanup;
    constructor({ id = uid('menu'), onError = error => console.error(error) } = {}) { super(); this.id = id; this.onError = onError; }
    get size() { return this.#items.size; }
    register({ id = uid('action'), path = [], label, handler, signal, when = () => true, enabled = () => true, order = 0, shortcut = '' }) {
      if (this.#items.has(id)) throw new Error('Пункт меню уже зарегистрирован: ' + id);
      if (!Array.isArray(path) || path.some(x => typeof x !== 'string') || typeof label !== 'string' || !label) throw new Error('Нужны путь и подпись пункта меню.');
      const owned = !(handler instanceof ActionHandler), action = owned ? new ActionHandler(handler, { signal }) : handler;
      let disposed = false, offInactive = () => {};
      const dispose = () => { if (disposed) return; disposed = true; this.#items.delete(id); offInactive(); signal?.removeEventListener('abort', dispose); if (owned) action.dispose(); this.#changed(); };
      const registration = Object.freeze({ id, handler: action, dispose });
      if (!action.active || signal?.aborted) return registration;
      this.#items.set(id, { id, path: [...path], label, handler: action, when, enabled, order, shortcut, dispose });
      offInactive = action.on('inactive', dispose); signal?.addEventListener('abort', dispose, { once: true }); this.#changed(); return registration;
    }
    unregister(id) { this.#items.get(id)?.dispose(); }
    has(id) { return this.#items.has(id); }
    getTree(context = {}, prefix = []) {
      const rootNode = { children: [] };
      for (const item of this.#items.values()) {
        if (!item.handler.active || !item.when(context) || prefix.some((p, i) => item.path[i] !== p)) continue;
        let node = rootNode;
        for (const group of item.path.slice(prefix.length)) {
          let child = node.children.find(c => c.group && c.label === group);
          if (!child) { child = { group: true, label: group, children: [], order: item.order }; node.children.push(child); }
          child.order = Math.min(child.order, item.order); node = child;
        }
        node.children.push({ ...item, enabled: typeof item.enabled === 'function' ? !!item.enabled(context) : !!item.enabled });
      }
      const sort = node => { node.children.sort((a, b) => a.order - b.order); for (const child of node.children) if (child.group) sort(child); };
      sort(rootNode); return rootNode.children;
    }
    #changed() { this.close(); this.#renderBar(); this.emit('change', { menu: this }); }
    mountBar(container, contextProvider = () => ({})) { this.#bar = container; this.#contextProvider = contextProvider; this.#renderBar(); return () => { container.replaceChildren(); this.#bar = null; }; }
    #renderBar() {
      if (!this.#bar) return; this.#bar.replaceChildren();
      for (const node of this.getTree(this.#contextProvider())) {
        const button = document.createElement('button'); button.className = 'menubar-item'; button.textContent = node.label;
        button.onclick = event => { event.stopPropagation(); if (node.group) { const r = button.getBoundingClientRect(); this.open({ x: r.left, y: r.bottom + 2, path: [node.label], context: this.#contextProvider() }); } else this.#invoke(node, this.#contextProvider()); };
        this.#bar.append(button);
      }
    }
    #invoke(item, context) {
      if (!item.handler.active || !item.enabled) return;
      this.close(); try { const result = item.handler.invoke(context); if (result?.catch) result.catch(this.onError); } catch (error) { this.onError(error); }
    }
    open({ x = 10, y = 40, context = {}, path = [] } = {}) {
      this.close(); const nodes = this.getTree(context, path); if (!nodes.length) return;
      const container = document.createElement('div'); container.className = 'tree-menu-root'; container.dataset.menu = this.id; document.body.append(container); this.#popup = container;
      const draw = (items, px, py, level) => {
        for (const panel of [...container.children]) if (Number(panel.dataset.level) >= level) panel.remove();
        const panel = document.createElement('div'); panel.className = 'tree-menu-panel'; panel.dataset.level = level; panel.setAttribute('role', 'menu');
        for (const item of items) {
          const button = document.createElement('button'); button.className = 'tree-menu-item'; button.setAttribute('role', 'menuitem');
          const label = document.createElement('span'); label.textContent = item.label; button.append(label);
          const hint = document.createElement('small'); hint.textContent = item.group ? '›' : item.shortcut; button.append(hint);
          if (item.group) { button.setAttribute('aria-haspopup', 'menu'); button.onclick = event => { event.stopPropagation(); const r = button.getBoundingClientRect(); draw(item.children, r.right + 2, r.top, level + 1); }; }
          else { button.disabled = !item.enabled; button.onclick = event => { event.stopPropagation(); this.#invoke(item, context); }; }
          panel.append(button);
        }
        container.append(panel); const rect = panel.getBoundingClientRect();
        panel.style.left = Math.max(4, Math.min(px, window.innerWidth - rect.width - 4)) + 'px';
        panel.style.top = Math.max(4, Math.min(py, window.innerHeight - rect.height - 4)) + 'px';
      };
      draw(nodes, x, y, 0);
      const outside = event => { if (!container.contains(event.target)) this.close(); }, key = event => { if (event.key === 'Escape') this.close(); }, resize = () => this.close();
      document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key); window.addEventListener('resize', resize);
      this.#popupCleanup = () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); window.removeEventListener('resize', resize); };
      this.emit('open', { context });
    }
    close() { this.#popup?.remove(); this.#popup = null; this.#popupCleanup?.(); this.#popupCleanup = null; }
    dispose() { this.close(); for (const item of [...this.#items.values()]) item.dispose(); this.#bar?.replaceChildren(); this.#bar = null; }
  }
  Object.assign(root.AtlasUI ||= {}, { ActionHandler, TreeMenu });
  if (typeof module !== 'undefined' && module.exports) module.exports = { ActionHandler, TreeMenu };
})(globalThis);
