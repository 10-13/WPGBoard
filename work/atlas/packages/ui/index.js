(function (root) {
  'use strict';
  const { EventBus } = root.AtlasCore;
  const { ExtensionHost } =
    typeof module !== 'undefined' && module.exports ? require('./extensions.js') : root.AtlasUI;
  const { button, createSwitch } = root.AtlasUI.controls;
  const el = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  function field(label, input) {
    const node = el('label', 'field');
    node.append(el('span', 'field-label', label), input);
    return node;
  }
  const singletonKey = Symbol('Interface');
  let singleton;
  class Interface extends EventBus {
    #statuses = new Map();
    #tooltipProviders = new Map();
    #toastTimer;
    constructor(key) {
      super();
      if (key !== singletonKey) throw new Error('Используйте AtlasUI.getUI().');
      this.input = new EventBus();
      this.regionClicks = new root.AtlasUI.RegionClicks({ onError: (e) => this.notify(e.message) });
      this.saveStatus = 'Локальная партия';
      this.mainMenu = new root.AtlasUI.TreeMenu({
        id: 'main',
        rootOrder: ['Файл', 'Вид', 'Мир', 'Инструменты'],
        onError: (e) => this.notify(e.message),
      });
      this.tileMenu = new root.AtlasUI.TreeMenu({
        id: 'tile',
        regionContext: true,
        onError: (e) => this.notify(e.message),
      });
      this.extensions = new ExtensionHost(this);
    }
    async mount({ host, state = root.AtlasCore.getGameState() }) {
      if (this.host) return this;
      this.host = host;
      this.state = state;
      host.className = 'atlas-shell';
      const menubar = el('nav', 'shell-menubar');
      menubar.setAttribute('aria-label', 'Основное меню');
      this.workspace = el('main', 'workspace');
      this.mapHost = el('div', 'map-host');
      this.windowHost = el('div', 'window-host');
      this.workspace.append(this.mapHost, this.windowHost);
      this.tooltip = el('div', 'map-tooltip');
      this.tooltip.hidden = true;
      this.workspace.append(this.tooltip);
      const navigation = el('div', 'map-navigation');
      this.zoomLabel = el('span', 'zoom-label', '100%');
      navigation.append(
        button('−', () => this.viewport.zoom(1 / 1.3), { title: 'Уменьшить' }),
        this.zoomLabel,
        button('+', () => this.viewport.zoom(1.3), { title: 'Увеличить' }),
        button('⊡', () => this.viewport.fit(), { title: 'Вся карта' }),
      );
      this.workspace.append(navigation);
      this.footer = el('footer', 'shell-footer');
      this.status = el('span', 'status-text');
      this.coords = el('span', 'coordinates', 'X —  Y —');
      this.footer.append(this.status, this.coords);
      this.toast = el('div', 'toast');
      this.toast.hidden = true;
      this.busyOverlay = el('div', 'busy-overlay');
      this.busyOverlay.hidden = true;
      const menuRow = el('div', 'shell-menu-row');
      menuRow.append(menubar);
      host.replaceChildren(menuRow, this.workspace, this.footer, this.toast, this.busyOverlay);
      this.viewport = new root.AtlasUI.MapViewport(this.mapHost, state, this.input);
      this.windows = new root.AtlasUI.WindowManager(this.windowHost, {
        regionClicks: this.regionClicks,
      });
      this.regionSelection = new root.AtlasUI.RegionSelection({
        valid: (id) => state.regions.has(id),
      });
      const selectionLayer = this.viewport.addOverlay({
        id: 'ui:selection',
        title: 'Выделение провинций',
        source: 'ui',
        order: 95,
        exportable: false,
      });
      const drawSelection = () =>
        root.AtlasUI.drawRegionSet(
          selectionLayer.context,
          state.regionIndex,
          this.regionSelection.ids,
        );
      this.regionSelection.on('change', (event) => {
        drawSelection();
        this.refresh();
        this.input.emit('regions:selection', event);
      });
      this.viewport.on('ready', drawSelection);
      state.on('map:loaded', () => this.regionSelection.clear());
      this.regionClicks.subscribe(
        (event) => {
          if (event.originalEvent?.shiftKey) this.regionSelection.toggle(event.id);
          else this.regionSelection.replace(event.id == null ? [] : [event.id]);
        },
        { id: 'ui:selection', mode: 'passive' },
      );
      this.mainMenu.mountBar(menubar, () => ({ state, ui: this }));
      const refreshClicks = () => {
        this.viewport.element.style.setProperty(
          '--region-click-cursor',
          this.regionClicks.active?.cursor || 'crosshair',
        );
        this.refresh();
      };
      this.regionClicks.on('change', refreshClicks);
      refreshClicks();
      this.input.on('province:click', (event) =>
        this.regionClicks.dispatch(event, { active: !event.originalEvent?.shiftKey }),
      );
      this.mainMenu.register({
        id: 'ui.clear-selection',
        path: ['Инструменты', 'Выделение'],
        label: 'Снять выделение',
        enabled: () => this.regionSelection.size > 0,
        handler: () => this.regionSelection.clear(),
      });
      this.mainMenu.register({
        id: 'ui.select-all',
        path: ['Инструменты', 'Выделение'],
        label: 'Выделить все провинции',
        enabled: () => state.loaded,
        handler: () => this.regionSelection.replace([...state.regions.keys()]),
      });
      this.mainMenu.register({
        id: 'ui.invert-selection',
        path: ['Инструменты', 'Выделение'],
        label: 'Инвертировать выделение',
        enabled: () => state.loaded,
        handler: () =>
          this.regionSelection.replace(
            [...state.regions.keys()].filter((id) => !this.regionSelection.has(id)),
          ),
      });
      this.mainMenu.register({
        id: 'ui.expand-selection',
        path: ['Инструменты', 'Выделение'],
        label: 'Добавить соседние провинции',
        enabled: () => this.regionSelection.size > 0,
        handler: () =>
          this.regionSelection.replace(
            this.viewport.getTopology().expand(this.regionSelection.ids),
          ),
      });
      this.mainMenu.register({
        id: 'ui.erode-selection',
        path: ['Инструменты', 'Выделение'],
        label: 'Эрозия выделения',
        enabled: () => this.regionSelection.size > 0,
        handler: () =>
          this.regionSelection.replace(this.viewport.getTopology().erode(this.regionSelection.ids)),
      });
      this.mainMenu.register({
        id: 'ui.stop-editing',
        path: ['Инструменты', 'Выделение'],
        label: 'Выключить активное редактирование',
        enabled: () => !!this.regionClicks.activeId,
        handler: () => this.regionClicks.clearActive(),
      });
      this.mainMenu.register({
        id: 'ui.fit',
        path: ['Вид'],
        label: 'Вся карта',
        handler: () => this.viewport.fit(),
      });
      this.mainMenu.register({
        id: 'ui.ids',
        path: ['Вид'],
        label: 'Показать / скрыть ID',
        handler: () => {
          this.viewport.showIds = !this.viewport.showIds;
          this.viewport.drawNumbers();
        },
      });
      this.mainMenu.register({
        id: 'ui.base',
        path: ['Вид'],
        label: 'Сменить светлую / исходную основу',
        handler: () =>
          this.viewport.setBaseStyle(this.viewport.baseStyle === 'original' ? 'light' : 'original'),
      });
      this.mainMenu.register({
        id: 'ui.modules',
        path: ['Вид', 'Окна'],
        label: 'Расширения',
        handler: () => this.showExtensions(),
      });
      this.mainMenu.register({
        id: 'ui.overlays',
        path: ['Вид', 'Окна'],
        label: 'Оверлеи',
        handler: () => this.showOverlays(),
      });
      this.mainMenu.register({
        id: 'ui.windows-help',
        path: ['Вид', 'Окна'],
        label: 'Управление окнами',
        handler: () => this.showWindowHelp(),
      });
      this.input.on('province:context', (e) => {
        const regionIds = this.regionSelection.forContext(e.id),
          id = regionIds.length === 1 ? regionIds[0] : null,
          region = id ? state.regions.get(id) : null;
        if (id) this.viewport.select(id);
        this.tileMenu.open({
          x: e.clientX,
          y: e.clientY,
          context: {
            ...e,
            id,
            region,
            province: region,
            clickedId: e.id,
            regionIds,
            state,
            ui: this,
          },
        });
      });
      this.input.on('province:hover', (event) => this.#showTooltip(event));
      this.input.on('pointer:move', (event) => {
        this.coords.textContent = 'X ' + Math.floor(event.x) + '  Y ' + Math.floor(event.y);
        if (!this.tooltip.hidden) {
          const r = this.workspace.getBoundingClientRect();
          this.tooltip.style.left =
            Math.max(
              5,
              Math.min(event.clientX - r.left + 16, r.width - this.tooltip.offsetWidth - 5),
            ) + 'px';
          this.tooltip.style.top =
            Math.max(
              5,
              Math.min(event.clientY - r.top + 16, r.height - this.tooltip.offsetHeight - 5),
            ) + 'px';
        }
      });
      this.viewport.on('camera:change', (e) => {
        this.zoomLabel.textContent = Math.round(e.scale * 100) + '%';
      });
      this.viewport.on('ready', () => {
        this.refresh();
        this.emit('map:ready', { state });
      });
      state.on('change', () => this.refresh());
      state.on('history:change', () => this.refresh());
      this.refresh();
      return this;
    }
    async renderMap() {
      if (this.state.loaded) await this.viewport.load();
    }
    refresh() {
      if (!this.host) return;
      this.status.textContent = [
        this.state.regions.size.toLocaleString('ru-RU') + ' областей',
        this.regionClicks.active?.label || 'Просмотр',
        this.regionSelection?.size ? 'Выделено: ' + this.regionSelection.size : '',
        ...[...this.#statuses.values()].map((p) => p(this.state)).filter(Boolean),
        this.saveStatus,
      ]
        .filter(Boolean)
        .join('  ·  ');
    }
    setSaveStatus(message) {
      this.saveStatus = message;
      this.refresh();
    }
    registerStatus(id, provider, { signal } = {}) {
      return this.#register(this.#statuses, id, provider, signal);
    }
    registerTooltip(id, provider, { signal } = {}) {
      return this.#register(this.#tooltipProviders, id, provider, signal);
    }
    #register(registry, id, provider, signal) {
      if (registry.has(id)) throw new Error('Провайдер уже зарегистрирован.');
      registry.set(id, provider);
      const dispose = () => {
        registry.delete(id);
        signal?.removeEventListener('abort', dispose);
        this.refresh();
      };
      signal?.addEventListener('abort', dispose, { once: true });
      if (signal?.aborted) dispose();
      this.refresh();
      return dispose;
    }
    #showTooltip(event) {
      this.tooltip.hidden = !event.id;
      this.tooltip.replaceChildren();
      if (!event.id) return;
      this.tooltip.append(el('strong', '', 'Провинция #' + event.id));
      for (const provider of this.#tooltipProviders.values()) {
        const text = provider(event, this.state);
        if (text) this.tooltip.append(el('div', '', String(text)));
      }
    }
    notify(message) {
      if (!this.toast) return;
      this.toast.textContent = String(message);
      this.toast.hidden = false;
      clearTimeout(this.#toastTimer);
      this.#toastTimer = setTimeout(() => (this.toast.hidden = true), 4500);
    }
    setBusy(value, message = 'Загрузка карты…') {
      this.busyOverlay.hidden = !value;
      this.busyOverlay.textContent = message;
    }
    showOverlays() {
      this.windows.open({
        id: 'ui:overlays',
        title: 'Оверлеи',
        x: Math.max(12, this.workspace.clientWidth - 350),
        y: 32,
        width: 330,
        height: 310,
        render: (pane, scope) => {
          const draw = () => {
            const focused = pane.contains(document.activeElement) ? document.activeElement : null,
              focusId = focused?.dataset.overlayId,
              focusControl = focused?.dataset.overlayControl;
            pane.replaceChildren(
              el(
                'p',
                'muted',
                'Сверху — передний план. Переключатель показывает или скрывает оверлей; стрелки меняют порядок. Настройки локальные.',
              ),
            );
            const list = [...this.state.overlays.list].reverse();
            for (const [index, overlay] of list.entries()) {
              const row = el('div', 'overlay-row');
              row.dataset.overlayItem = overlay.id;
              const toggle = createSwitch(
                overlay.title,
                (visible) => this.state.overlays.setVisible(overlay.id, visible),
                { checked: overlay.visible, className: 'overlay-toggle' },
              );
              toggle.replaceChildren(
                root.AtlasUI.dataView.createDataRow(
                  overlay.title,
                  overlay.visible ? 'вкл' : 'выкл',
                ),
              );
              toggle.setAttribute('aria-label', overlay.title);
              const up = button('↑', () => this.state.overlays.move(overlay.id, 1), {
                className: 'icon-button',
                title: 'Поднять оверлей: ' + overlay.title,
                disabled: index === 0,
              });
              up.setAttribute('aria-label', 'Поднять оверлей: ' + overlay.title);
              const down = button('↓', () => this.state.overlays.move(overlay.id, -1), {
                className: 'icon-button',
                title: 'Опустить оверлей: ' + overlay.title,
                disabled: index === list.length - 1,
              });
              down.setAttribute('aria-label', 'Опустить оверлей: ' + overlay.title);
              for (const [control, name] of [
                [toggle, 'toggle'],
                [up, 'up'],
                [down, 'down'],
              ]) {
                control.dataset.overlayId = overlay.id;
                control.dataset.overlayControl = name;
              }
              row.append(toggle, up, down);
              pane.append(row);
            }
            pane.append(
              button('Порядок и видимость по умолчанию', () => this.state.overlays.reset(), {
                className: 'wide',
              }),
              el(
                'p',
                'muted',
                'В PNG включаются видимые оверлеи карты в этом порядке. Подсветки наведения, выделения и набора статистики в PNG не входят.',
              ),
            );
            if (focusId) {
              const controls = [...pane.querySelectorAll('button')].filter(
                  (node) => node.dataset.overlayId === focusId,
                ),
                control =
                  controls.find(
                    (node) => node.dataset.overlayControl === focusControl && !node.disabled,
                  ) || controls[0];
              control?.focus({ preventScroll: true });
            }
          };
          this.state.overlays.on('change', draw, { signal: scope.signal });
          draw();
        },
      });
    }
    showExtensions() {
      this.windows.open({
        id: 'ui:extensions',
        title: 'Расширения',
        x: Math.max(10, this.workspace.clientWidth - 340),
        y: 18,
        width: 320,
        height: 420,
        render: (pane, scope) => {
          const { createDataGroup, createDataRow } = root.AtlasUI.dataView;
          const expanded = new Map();
          const draw = () => {
            const focused = document.activeElement?.dataset.extensionId;
            pane.replaceChildren(
              el(
                'p',
                'muted',
                'Дочерний модуль зависит от всех родителей. Дополнительные связи не меняют дерево. Данные игры сохраняются при отключении.',
              ),
            );
            const names = new Map(this.extensions.list.map((item) => [item.id, item.name]));
            const labels = {
              enabled: 'Вкл.',
              starting: 'Запуск',
              waiting: 'Ожидает',
              error: 'Ошибка',
              disabled: 'Выкл.',
            };
            const render = (extension, parent, path = '') => {
              const title = path ? path + ' → ' + extension.name : extension.name;
              const group = createDataGroup(extension.name, {
                id: extension.id,
                open: expanded.get(extension.id) ?? extension.children.length > 0,
                onToggle: (value) => expanded.set(extension.id, value),
              });
              const toggle = createSwitch(
                labels[extension.status],
                async (checked, event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  try {
                    if (checked) await this.extensions.enable(extension.id);
                    else this.extensions.disable(extension.id);
                  } catch (error) {
                    this.notify(error.message);
                  }
                  draw();
                },
                { checked: extension.requested, title: title },
              );
              toggle.dataset.extensionId = extension.id;
              toggle.setAttribute('aria-label', 'Расширение: ' + title);
              group.element.classList.add('extension-node');
              group.element.querySelector('summary').append(toggle);
              if (extension.description) group.body.append(el('p', 'muted', extension.description));
              if (extension.requires.length)
                group.body.append(
                  createDataRow(
                    'Зависимости',
                    extension.requires.map((id) => names.get(id) || id).join(', '),
                  ),
                );
              if (extension.missing.length && extension.requested)
                group.body.append(
                  createDataRow(
                    'Ожидает',
                    extension.missing.map((id) => names.get(id) || id).join(', '),
                  ),
                );
              if (extension.missing.length && extension.requested)
                group.body.append(
                  button(
                    'Включить зависимости',
                    async () => {
                      try {
                        await this.extensions.enable(extension.id);
                      } catch (error) {
                        this.notify(error.message);
                      }
                    },
                    { disabled: extension.missing.some((id) => !names.has(id)) },
                  ),
                );
              if (extension.error) group.body.append(el('p', 'form-error', extension.error));
              for (const child of extension.children) render(child, group.body, title);
              parent.append(group.element);
            };
            for (const extension of this.extensions.tree) render(extension, pane);
            if (focused)
              [...pane.querySelectorAll('button[data-extension-id]')]
                .find((node) => node.dataset.extensionId === focused)
                ?.focus({ preventScroll: true });
          };
          this.extensions.on('change', draw, { signal: scope.signal });
          draw();
        },
      });
    }
    showWindowHelp() {
      this.windows.open({
        id: 'ui:window-help',
        title: 'Окна и вкладки',
        x: 330,
        y: 60,
        width: 300,
        height: 230,
        render: (pane) => {
          pane.append(
            el(
              'p',
              '',
              'Тяните заголовок или значок ⠿, чтобы переместить окно. Отпустите его над другим окном — вкладки объединятся.',
            ),
            el(
              'p',
              '',
              'Вкладку можно перетащить в другое окно или вынести на карту, чтобы отделить. Потяните за нижний правый угол для изменения размера.',
            ),
            el(
              'p',
              '',
              'Крестик вкладки закрывает её. Последняя закрытая вкладка автоматически закрывает окно. Правый клик по провинции открывает её меню.',
            ),
          );
        },
      });
    }
  }
  const getUI = () => singleton || (singleton = new Interface(singletonKey));
  Object.assign(root.AtlasUI, {
    Interface,
    ExtensionHost,
    getUI,
    dom: { el, button, createSwitch, field },
  });
})(globalThis);
