(function (root) {
  'use strict';
  const { EventBus, Scope, uid } = root.AtlasCore;
  // Capture can disappear when the pointer leaves the browser or its target changes.
  // Always release the gesture's UI state, including when no pointerup arrives.
  function trackPointerGesture(start, { move, end }) {
    const target = start.currentTarget,
      doc = target.ownerDocument,
      view = doc.defaultView,
      listeners = [];
    let active = true;
    const listen = (node, type, handler) => {
      node.addEventListener(type, handler, true);
      listeners.push(() => node.removeEventListener(type, handler, true));
    };
    const finish = (event, completed = false) => {
      if (!active) return;
      active = false;
      for (const remove of listeners) remove();
      if (target.hasPointerCapture(start.pointerId)) target.releasePointerCapture(start.pointerId);
      end(event, completed);
    };
    const matches = (event) => event.pointerId === start.pointerId;
    listen(view, 'pointermove', (event) => {
      if (!matches(event)) return;
      if (event.buttons === 0) finish(event);
      else move(event);
    });
    listen(view, 'pointerup', (event) => {
      if (matches(event) && !(event.buttons & 1)) finish(event, true);
    });
    listen(view, 'pointercancel', (event) => {
      if (matches(event)) finish(event);
    });
    listen(target, 'lostpointercapture', (event) => {
      if (matches(event)) finish(event);
    });
    listen(view, 'blur', (event) => finish(event));
    listen(view, 'pagehide', (event) => finish(event));
    listen(view, 'keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(event);
      }
    });
    listen(doc, 'visibilitychange', (event) => {
      if (doc.hidden) finish(event);
    });
    try {
      target.setPointerCapture(start.pointerId);
    } catch {
      /* Window listeners still handle release outside the target. */
    }
    return { cancel: () => finish(null) };
  }
  class WindowManager extends EventBus {
    #windows = new Map();
    #tabs = new Map();
    #z = 10;
    #gesture = null;
    #scope = new Scope();
    constructor(host, { regionClicks } = {}) {
      super();
      this.host = host;
      this.regionClicks = regionClicks;
      window.addEventListener(
        'resize',
        () => {
          for (const w of this.#windows.values()) this.#clamp(w);
        },
        { signal: this.#scope.signal },
      );
    }
    get windows() {
      return [...this.#windows.values()].map((w) => ({
        id: w.id,
        tabIds: [...w.tabs],
        activeTab: w.active,
      }));
    }
    get tabCount() {
      return this.#tabs.size;
    }
    open({
      id = uid('tab'),
      title = 'Окно',
      windowId = id,
      x = 18,
      y = 18,
      width = 280,
      height = 340,
      render,
      content,
      signal,
    } = {}) {
      if (signal?.aborted) return null;
      if (this.#tabs.has(id)) {
        const existing = this.#tabs.get(id);
        this.activate(id);
        return existing.handle;
      }
      let win = this.#windows.get(windowId);
      if (!win) win = this.#createWindow({ id: windowId, x, y, width, height });
      const scope = new Scope(),
        pane = document.createElement('div'),
        button = document.createElement('div');
      pane.className = 'window-pane';
      pane.dataset.tabPane = id;
      button.className = 'window-tab';
      button.dataset.tab = id;
      button.setAttribute('role', 'tab');
      button.tabIndex = 0;
      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = title;
      const close = document.createElement('button');
      close.className = 'tab-close';
      close.textContent = '×';
      close.title = 'Закрыть вкладку';
      close.setAttribute('aria-label', 'Закрыть вкладку ' + title);
      close.onclick = (event) => {
        event.stopPropagation();
        this.closeTab(id);
      };
      button.append(label, close);
      const tab = {
        id,
        title,
        pane,
        button,
        scope,
        windowId: win.id,
        signal,
        abort: () => this.closeTab(id),
      };
      tab.handle = Object.freeze({
        id,
        element: pane,
        signal: scope.signal,
        get windowId() {
          return tab.windowId;
        },
        activate: () => this.activate(id),
        close: () => this.closeTab(id),
        dispose: () => this.closeTab(id),
        setTitle: (value) => {
          tab.title = String(value);
          label.textContent = value;
        },
        onRegionClick: (handler, options = {}) => {
          if (!this.regionClicks) throw new Error('Ввод регионов не подключён.');
          return this.regionClicks.subscribe(handler, { ...options, signal: scope.signal });
        },
      });
      button.addEventListener('pointerdown', (event) => {
        if (event.target.closest('button')) return;
        this.#startDrag(event, win, id);
      });
      button.addEventListener('click', (event) => {
        if (!event.target.closest('button')) this.activate(id);
      });
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.activate(id);
        }
      });
      this.#tabs.set(id, tab);
      win.tabs.push(id);
      win.strip.append(button);
      win.body.append(pane);
      signal?.addEventListener('abort', tab.abort, { once: true });
      try {
        if (content) pane.append(content);
        const cleanup = render?.(pane, scope, tab.handle);
        if (typeof cleanup === 'function') scope.defer(cleanup);
      } catch (error) {
        this.closeTab(id);
        throw error;
      }
      this.activate(id);
      this.emit('change', { type: 'open', id, windowId: win.id });
      return tab.handle;
    }
    #createWindow({ id, x, y, width, height }) {
      const element = document.createElement('section');
      element.className = 'overlay-window';
      element.dataset.window = id;
      element.setAttribute('role', 'dialog');
      const chrome = document.createElement('div');
      chrome.className = 'window-chrome';
      const grip = document.createElement('div');
      grip.className = 'window-grip';
      grip.textContent = '⠿';
      grip.title = 'Перетащите окно; отпустите над другим окном для объединения';
      const strip = document.createElement('div');
      strip.className = 'window-tabs';
      strip.setAttribute('role', 'tablist');
      const close = document.createElement('button');
      close.className = 'window-close';
      close.textContent = '×';
      close.title = 'Закрыть окно';
      close.setAttribute('aria-label', 'Закрыть окно ' + id);
      close.onclick = () => this.closeWindow(id);
      chrome.append(grip, strip, close);
      const body = document.createElement('div');
      body.className = 'window-body';
      const resize = document.createElement('div');
      resize.className = 'window-resize';
      resize.setAttribute('role', 'separator');
      resize.setAttribute('aria-label', 'Изменить размер окна');
      resize.tabIndex = 0;
      element.append(chrome, body, resize);
      this.host.append(element);
      const win = { id, element, chrome, strip, body, tabs: [], active: null, x, y, width, height };
      this.#windows.set(id, win);
      element.style.width = width + 'px';
      element.style.height = height + 'px';
      this.#clamp(win);
      element.addEventListener('pointerdown', () => this.#focus(win));
      grip.addEventListener('pointerdown', (event) => this.#startDrag(event, win));
      chrome.addEventListener('pointerdown', (event) => {
        if (event.target === chrome || event.target === strip) this.#startDrag(event, win);
      });
      resize.addEventListener('pointerdown', (event) => this.#startResize(event, win));
      resize.addEventListener('keydown', (event) => {
        const delta = {
          ArrowRight: [10, 0],
          ArrowLeft: [-10, 0],
          ArrowDown: [0, 10],
          ArrowUp: [0, -10],
        }[event.key];
        if (!delta) return;
        event.preventDefault();
        this.resize(id, win.width + delta[0], win.height + delta[1]);
      });
      return win;
    }
    #focus(win) {
      win.element.style.zIndex = ++this.#z;
      for (const w of this.#windows.values()) w.element.classList.toggle('focused', w === win);
    }
    #clamp(win) {
      const w = this.host.clientWidth,
        h = this.host.clientHeight;
      // A hidden/reparented browser panel can briefly report a tiny viewport.
      if (w < 160 || h < 90) return;
      win.width = Math.max(Math.min(220, w - 8), Math.min(win.width, w - 8));
      win.height = Math.max(Math.min(100, h - 8), Math.min(win.height, h - 8));
      win.x = Math.max(0, Math.min(win.x, w - win.width));
      win.y = Math.max(0, Math.min(win.y, h - win.height));
      Object.assign(win.element.style, {
        left: win.x + 'px',
        top: win.y + 'px',
        width: win.width + 'px',
        height: win.height + 'px',
      });
    }
    activate(id) {
      const tab = this.#tabs.get(id);
      if (!tab) return;
      const win = this.#windows.get(tab.windowId);
      win.active = id;
      for (const tabId of win.tabs) {
        const t = this.#tabs.get(tabId);
        t.pane.hidden = tabId !== id;
        t.button.classList.toggle('active', tabId === id);
        t.button.setAttribute('aria-selected', String(tabId === id));
      }
      win.element.setAttribute('aria-label', tab.title);
      this.#focus(win);
      this.emit('change', { type: 'activate', id, windowId: win.id });
    }
    closeTab(id) {
      const tab = this.#tabs.get(id);
      if (!tab) return;
      const win = this.#windows.get(tab.windowId);
      if (this.#gesture?.windowId === win.id) this.#gesture.cancel();
      this.#tabs.delete(id);
      tab.signal?.removeEventListener('abort', tab.abort);
      tab.scope.dispose();
      tab.button.remove();
      tab.pane.remove();
      win.tabs = win.tabs.filter((t) => t !== id);
      if (!win.tabs.length) {
        win.element.remove();
        this.#windows.delete(win.id);
      } else this.activate(win.active === id ? win.tabs.at(-1) : win.active);
      this.emit('change', { type: 'close', id, windowId: win.id });
    }
    closeWindow(id) {
      const win = this.#windows.get(id);
      if (win) for (const tab of [...win.tabs]) this.closeTab(tab);
    }
    resize(id, width, height) {
      const win = this.#windows.get(id);
      if (!win) return;
      win.width = width;
      win.height = height;
      this.#clamp(win);
      this.emit('change', { type: 'resize', windowId: id });
    }
    moveTab(id, targetId) {
      const tab = this.#tabs.get(id),
        target = this.#windows.get(targetId);
      if (!tab || !target || tab.windowId === targetId) return;
      const source = this.#windows.get(tab.windowId);
      source.tabs = source.tabs.filter((t) => t !== id);
      tab.windowId = targetId;
      target.tabs.push(id);
      target.strip.append(tab.button);
      target.body.append(tab.pane);
      if (!source.tabs.length) {
        source.element.remove();
        this.#windows.delete(source.id);
      } else this.activate(source.tabs.at(-1));
      this.activate(id);
      this.emit('change', { type: 'move-tab', id, targetId });
    }
    merge(sourceId, targetId) {
      const source = this.#windows.get(sourceId);
      if (!source || sourceId === targetId || !this.#windows.has(targetId)) return;
      for (const id of [...source.tabs]) this.moveTab(id, targetId);
      this.emit('change', { type: 'merge', sourceId, targetId });
    }
    #dropTarget(x, y, excluded) {
      for (const el of document.elementsFromPoint(x, y)) {
        const node = el.closest('.overlay-window');
        if (node && node.dataset.window !== excluded && this.#windows.has(node.dataset.window))
          return this.#windows.get(node.dataset.window);
      }
      return null;
    }
    #startDrag(event, initialWindow, tabId = null) {
      if (event.button !== 0 || this.#gesture) return;
      const tab = tabId && this.#tabs.get(tabId),
        win = tab ? this.#windows.get(tab.windowId) : this.#windows.get(initialWindow.id);
      if (!win) return;
      event.preventDefault();
      event.stopPropagation();
      this.#focus(win);
      const mode = tabId && win.tabs.length > 1 ? 'tab' : 'window';
      const gesture = {
        windowId: win.id,
        x: event.clientX,
        y: event.clientY,
        left: win.x,
        top: win.y,
        moved: false,
      };
      this.#gesture = gesture;
      let drop = null,
        ghost = null;
      const move = (e) => {
        const dx = e.clientX - gesture.x,
          dy = e.clientY - gesture.y;
        if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
        gesture.moved = true;
        if (mode === 'window') {
          win.x = gesture.left + dx;
          win.y = gesture.top + dy;
          win.element.classList.add('dragging-window');
          this.#clamp(win);
        } else {
          if (!ghost) {
            ghost = document.createElement('div');
            ghost.className = 'tab-drag-ghost';
            ghost.textContent = tab.title;
            document.body.append(ghost);
          }
          ghost.style.left = e.clientX + 10 + 'px';
          ghost.style.top = e.clientY + 10 + 'px';
        }
        drop?.element.classList.remove('drop-target');
        drop = this.#dropTarget(e.clientX, e.clientY, win.id);
        drop?.element.classList.add('drop-target');
      };
      const finish = (e, completed) => {
        const moved = gesture.moved;
        this.#gesture = null;
        win.element.classList.remove('dragging-window');
        drop?.element.classList.remove('drop-target');
        ghost?.remove();
        if (!completed) return;
        if (moved && drop)
          mode === 'window' ? this.merge(win.id, drop.id) : this.moveTab(tabId, drop.id);
        else if (moved && mode === 'tab') {
          const host = this.host.getBoundingClientRect(),
            newId = uid('window');
          this.#createWindow({
            id: newId,
            x: e.clientX - host.left - 50,
            y: e.clientY - host.top - 12,
            width: win.width,
            height: win.height,
          });
          this.moveTab(tabId, newId);
        } else if (!moved && tabId) this.activate(tabId);
        this.emit('change', { type: 'move-window', windowId: win.id });
      };
      gesture.cancel = trackPointerGesture(event, { move, end: finish }).cancel;
    }
    #startResize(event, win) {
      if (event.button !== 0 || this.#gesture) return;
      event.preventDefault();
      event.stopPropagation();
      const start = { x: event.clientX, y: event.clientY, w: win.width, h: win.height };
      const move = (e) =>
        this.resize(win.id, start.w + e.clientX - start.x, start.h + e.clientY - start.y);
      this.#gesture = {
        windowId: win.id,
        cancel: trackPointerGesture(event, {
          move,
          end: () => {
            this.#gesture = null;
          },
        }).cancel,
      };
    }
    dispose() {
      this.#gesture?.cancel();
      this.#scope.dispose();
      for (const id of [...this.#windows.keys()]) this.closeWindow(id);
    }
  }
  Object.assign((root.AtlasUI ||= {}), { WindowManager });
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { WindowManager, trackPointerGesture };
})(globalThis);
