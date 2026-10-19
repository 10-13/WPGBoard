(function (root) {
  'use strict';
  const { EventBus, Scope } = root.AtlasCore;
  const el = (tag, className = '', text = '') => { const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node; };
  function button(label, callback, { signal, className = '', title = label } = {}) { const b = el('button', className, label); b.type = 'button'; b.title = title; b.addEventListener('click', callback, signal ? { signal } : undefined); return b; }
  function field(label, input) { const node = el('label', 'field'); node.append(el('span', 'field-label', label), input); return node; }
  class ExtensionHost extends EventBus {
    #definitions = new Map(); #running = new Map();
    constructor(ui) { super(); this.ui = ui; }
    register(definition) { if (!definition?.id || typeof definition.start !== 'function' || this.#definitions.has(definition.id)) throw new Error('Расширение уже зарегистрировано или имеет неверный формат.'); this.#definitions.set(definition.id, definition); this.emit('change', {}); return () => { this.disable(definition.id); this.#definitions.delete(definition.id); this.emit('change', {}); }; }
    get list() { return [...this.#definitions.values()].map(d => ({ id: d.id, name: d.name || d.id, description: d.description || '', enabled: this.isEnabled(d.id) })); }
    isEnabled(id) { return !!this.#running.get(id) && !this.#running.get(id).disposed; }
    async enable(id) {
      if (this.isEnabled(id)) return; const definition = this.#definitions.get(id); if (!definition) throw new Error('Расширение не найдено.');
      const scope = new Scope(), ui = this.ui; this.#running.set(id, scope);
      const context = Object.freeze({ id, state: ui.state, ui, scope, signal: scope.signal,
        on: (type, fn) => ui.input.on(type, fn, { signal: scope.signal }),
        action: fn => new root.AtlasUI.ActionHandler(fn, { signal: scope.signal }),
        menu: (menu, item) => menu.register({ ...item, id: id + ':' + item.id, signal: scope.signal }),
        window: options => ui.windows.open({ ...options, id: id + ':' + options.id, windowId: options.windowId ? id + ':' + options.windowId : undefined, signal: scope.signal }),
        layer: options => ui.viewport.addLayer({ ...options, id: id + ':' + options.id, signal: scope.signal }),
      });
      try { const cleanup = await definition.start(context); if (typeof cleanup === 'function') scope.defer(cleanup); else if (cleanup?.dispose) scope.own(cleanup); }
      catch (error) { scope.dispose(); this.#running.delete(id); this.emit('change', {}); throw error; }
      this.emit('change', {});
    }
    disable(id) { const scope = this.#running.get(id); if (!scope) return; scope.dispose(); this.#running.delete(id); this.emit('change', {}); }
  }
  const singletonKey = Symbol('Interface'); let singleton;
  class Interface extends EventBus {
    #statuses = new Map(); #tooltipProviders = new Map(); #titleProviders = new Map(); #badges = new Map(); #toastTimer;
    constructor(key) {
      super(); if (key !== singletonKey) throw new Error('Используйте AtlasUI.getUI().');
      this.input = new EventBus(); this.mainMenu = new root.AtlasUI.TreeMenu({ id: 'main', onError: e => this.notify(e.message) }); this.tileMenu = new root.AtlasUI.TreeMenu({ id: 'tile', onError: e => this.notify(e.message) }); this.extensions = new ExtensionHost(this);
    }
    async mount({ host, state = root.AtlasCore.getGameState() }) {
      if (this.host) return this; this.host = host; this.state = state; host.className = 'atlas-shell';
      const header = el('header', 'shell-header'); header.append(el('span', 'shell-mark', '✧'), el('strong', 'shell-brand', 'АТЛАС'));
      this.title = el('span', 'shell-title'); this.branch = el('span', 'branch-label'); header.append(this.title, this.branch);
      this.saveStatus = el('span', 'save-status', 'Локальная партия'); header.append(this.saveStatus, button('Модули', () => this.showExtensions(), { className: 'modules-button' }));
      const menubar = el('nav', 'shell-menubar'); menubar.setAttribute('aria-label', 'Основное меню');
      this.workspace = el('main', 'workspace'); this.mapHost = el('div', 'map-host'); this.windowHost = el('div', 'window-host'); this.workspace.append(this.mapHost, this.windowHost);
      this.tooltip = el('div', 'map-tooltip'); this.tooltip.hidden = true; this.workspace.append(this.tooltip);
      const navigation = el('div', 'map-navigation'); this.zoomLabel = el('span', 'zoom-label', '100%');
      navigation.append(button('−', () => this.viewport.zoom(1 / 1.3), { title: 'Уменьшить' }), this.zoomLabel, button('+', () => this.viewport.zoom(1.3), { title: 'Увеличить' }), button('⊡', () => this.viewport.fit(), { title: 'Вся карта (0)' })); this.workspace.append(navigation);
      this.footer = el('footer', 'shell-footer'); this.status = el('span', 'status-text'); this.coords = el('span', 'coordinates', 'X —  Y —'); this.footer.append(this.status, this.coords);
      this.toast = el('div', 'toast'); this.toast.hidden = true; this.busyOverlay = el('div', 'busy-overlay'); this.busyOverlay.hidden = true;
      host.replaceChildren(header, menubar, this.workspace, this.footer, this.toast, this.busyOverlay);
      this.viewport = new root.AtlasUI.MapViewport(this.mapHost, state, this.input); this.windows = new root.AtlasUI.WindowManager(this.windowHost);
      this.mainMenu.mountBar(menubar, () => ({ state, ui: this }));
      this.mainMenu.register({ id: 'ui.fit', path: ['Вид'], label: 'Вся карта', shortcut: '0', handler: () => this.viewport.fit() });
      this.mainMenu.register({ id: 'ui.ids', path: ['Вид'], label: 'Показать / скрыть ID', shortcut: '#', handler: () => { this.viewport.showIds = !this.viewport.showIds; this.viewport.drawNumbers(); } });
      this.mainMenu.register({ id: 'ui.base', path: ['Вид'], label: 'Сменить светлую / исходную основу', handler: () => this.viewport.setBaseStyle(this.viewport.baseStyle === 'original' ? 'light' : 'original') });
      this.mainMenu.register({ id: 'ui.modules', path: ['Вид'], label: 'Расширения', handler: () => this.showExtensions() });
      this.mainMenu.register({ id: 'ui.windows-help', path: ['Вид'], label: 'Управление окнами', handler: () => this.showWindowHelp() });
      this.input.on('province:context', e => this.tileMenu.open({ x: e.clientX, y: e.clientY, context: { ...e, state, ui: this } }));
      this.input.on('province:hover', event => this.#showTooltip(event));
      this.input.on('pointer:move', event => { this.coords.textContent = 'X ' + Math.floor(event.x) + '  Y ' + Math.floor(event.y); if (!this.tooltip.hidden) { const r = this.workspace.getBoundingClientRect(); this.tooltip.style.left = Math.max(5, Math.min(event.clientX - r.left + 16, r.width - this.tooltip.offsetWidth - 5)) + 'px'; this.tooltip.style.top = Math.max(5, Math.min(event.clientY - r.top + 16, r.height - this.tooltip.offsetHeight - 5)) + 'px'; } });
      this.viewport.on('camera:change', e => { this.zoomLabel.textContent = Math.round(e.scale * 100) + '%'; });
      this.viewport.on('ready', () => { this.refresh(); this.emit('map:ready', { state }); });
      state.on('change', () => this.refresh()); state.on('history:change', () => this.refresh());
      document.addEventListener('keydown', e => { if (e.target.closest('input,select,textarea,[contenteditable=true]')) return; if (e.key === 'Escape') { this.mainMenu.close(); this.tileMenu.close(); } if (e.code === 'Digit0') this.viewport.fit(); if (e.key === '+' || e.key === '=') this.viewport.zoom(1.3); if (e.key === '-') this.viewport.zoom(1 / 1.3); this.input.emit('key', e); });
      this.refresh(); return this;
    }
    async renderMap() { if (this.state.loaded) await this.viewport.load(); }
    refresh() {
      if (!this.host) return; let title = this.state.originalMap?.name || 'Карта не загружена'; for (const provider of this.#titleProviders.values()) title = provider(this.state) || title;
      this.title.textContent = title; this.branch.textContent = [...this.#badges.values()].map(p => p(this.state)).filter(Boolean).join(' | '); this.branch.hidden = !this.branch.textContent; this.status.textContent = [this.state.regions.size.toLocaleString('ru-RU') + ' областей', ...[...this.#statuses.values()].map(p => p(this.state)).filter(Boolean)].join('  ·  ');
    }
    registerStatus(id, provider, { signal } = {}) { return this.#register(this.#statuses, id, provider, signal); }
    registerTitle(id, provider, { signal } = {}) { return this.#register(this.#titleProviders, id, provider, signal); }
    registerBadge(id, provider, { signal } = {}) { return this.#register(this.#badges, id, provider, signal); }
    registerTooltip(id, provider, { signal } = {}) { return this.#register(this.#tooltipProviders, id, provider, signal); }
    #register(registry, id, provider, signal) { if (registry.has(id)) throw new Error('Провайдер уже зарегистрирован.'); registry.set(id, provider); const dispose = () => { registry.delete(id); signal?.removeEventListener('abort', dispose); this.refresh(); }; signal?.addEventListener('abort', dispose, { once: true }); if (signal?.aborted) dispose(); this.refresh(); return dispose; }
    #showTooltip(event) { this.tooltip.hidden = !event.id; this.tooltip.replaceChildren(); if (!event.id) return; this.tooltip.append(el('strong', '', 'Провинция #' + event.id)); for (const provider of this.#tooltipProviders.values()) { const text = provider(event, this.state); if (text) this.tooltip.append(el('div', '', String(text))); } }
    notify(message) { if (!this.toast) return; this.toast.textContent = String(message); this.toast.hidden = false; clearTimeout(this.#toastTimer); this.#toastTimer = setTimeout(() => this.toast.hidden = true, 4500); }
    setBusy(value, message = 'Загрузка карты…') { this.busyOverlay.hidden = !value; this.busyOverlay.textContent = message; }
    showExtensions() {
      this.windows.open({ id: 'ui:extensions', title: 'Расширения', x: Math.max(10, this.workspace.clientWidth - 340), y: 18, width: 320, height: 310, render: (pane, scope) => {
        const draw = () => { pane.replaceChildren(el('p', 'muted', 'Отключение удаляет UI и подписки модуля. Данные игры сохраняются.')); for (const extension of this.extensions.list) { const row = el('label', 'extension-row'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = extension.enabled; input.setAttribute('aria-label', extension.name); const text = el('span'); text.append(el('strong', '', extension.name), el('small', '', extension.description)); row.append(input, text); input.onchange = async () => { try { input.disabled = true; if (input.checked) await this.extensions.enable(extension.id); else this.extensions.disable(extension.id); } catch (error) { this.notify(error.message); draw(); } finally { input.disabled = false; } }; pane.append(row); } };
        this.extensions.on('change', draw, { signal: scope.signal }); draw();
      } });
    }
    showWindowHelp() { this.windows.open({ id: 'ui:window-help', title: 'Окна и вкладки', x: 330, y: 60, width: 300, height: 230, render: pane => { pane.append(el('p', '', 'Тяните заголовок или значок ⠿, чтобы переместить окно. Отпустите его над другим окном — вкладки объединятся.'), el('p', '', 'Вкладку можно перетащить в другое окно или вынести на карту, чтобы отделить. Потяните за нижний правый угол для изменения размера.'), el('p', '', 'Крестик вкладки закрывает её. Последняя закрытая вкладка автоматически закрывает окно. Правый клик по провинции открывает её меню.')); } }); }
  }
  const getUI = () => singleton || (singleton = new Interface(singletonKey));
  Object.assign(root.AtlasUI, { Interface, ExtensionHost, getUI, dom: { el, button, field } });
})(globalThis);
