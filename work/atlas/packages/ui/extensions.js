/* A tree of scoped extensions; dependency edges do not change tree ownership. */
(function (root) {
  'use strict';
  const { EventBus, Scope } =
    typeof module !== 'undefined' && module.exports ? require('../core/index.js') : root.AtlasCore;
  const localId = (value) => typeof value === 'string' && /^[a-zA-Z0-9][\w.-]{0,99}$/.test(value);
  class ExtensionHost extends EventBus {
    #definitions = new Map();
    #running = new Map();
    constructor(ui) {
      super();
      this.ui = ui;
    }
    register(definition, { parent = null } = {}) {
      if (parent && !this.#definitions.has(parent))
        throw new Error('Родительское расширение не найдено: ' + parent);
      const staged = new Map();
      const collect = (source, parentId, ancestors) => {
        if (
          !source ||
          !localId(source.id) ||
          typeof source.start !== 'function' ||
          (source.children !== undefined && !Array.isArray(source.children)) ||
          (source.requires !== undefined &&
            (!Array.isArray(source.requires) ||
              source.requires.some((id) => typeof id !== 'string' || !id)))
        )
          throw new Error('Некорректное определение расширения.');
        const id = parentId ? parentId + ':' + source.id : source.id;
        if (id.length > 300 || this.#definitions.has(id) || staged.has(id))
          throw new Error('Расширение уже зарегистрировано: ' + id);
        const record = {
          id,
          parentId,
          ancestors,
          source,
          requires: [...new Set([...ancestors, ...(source.requires || [])])],
          requested: !!parentId && source.enabledByDefault !== false,
          error: '',
        };
        staged.set(id, record);
        for (const child of source.children || []) collect(child, id, [...ancestors, id]);
        return record;
      };
      const ancestors = parent ? [...this.#definitions.get(parent).ancestors, parent] : [];
      const registered = collect(definition, parent, ancestors);
      this.#checkGraph(new Map([...this.#definitions, ...staged]));
      for (const [id, record] of staged) this.#definitions.set(id, record);
      this.emit('change', {});
      this.#reconcile();
      return () => {
        if (this.#definitions.get(registered.id) !== registered) return;
        this.disable(registered.id);
        for (const record of [...this.#definitions.values()]) {
          if (record.id === registered.id || record.ancestors.includes(registered.id))
            this.#definitions.delete(record.id);
        }
        this.emit('change', {});
      };
    }
    #checkGraph(definitions) {
      const done = new Set(),
        visiting = new Set();
      const visit = (id) => {
        if (visiting.has(id)) throw new Error('Цикл зависимостей расширений: ' + id);
        if (done.has(id) || !definitions.has(id)) return;
        visiting.add(id);
        for (const dependency of definitions.get(id).requires) visit(dependency);
        visiting.delete(id);
        done.add(id);
      };
      for (const id of definitions.keys()) visit(id);
    }
    #plan(id, result = [], seen = new Set()) {
      if (seen.has(id)) return result;
      const record = this.#definitions.get(id);
      if (!record) throw new Error('Расширение не найдено: ' + id);
      seen.add(id);
      for (const dependency of record.requires) this.#plan(dependency, result, seen);
      result.push(record);
      return result;
    }
    #view(record) {
      const runtime = this.#running.get(record.id),
        missing = record.requires.filter((id) => !this.isEnabled(id));
      return {
        id: record.id,
        parentId: record.parentId,
        depth: record.ancestors.length,
        name: record.source.name || record.source.id,
        description: record.source.description || '',
        requires: [...record.requires],
        requested: record.requested,
        enabled: this.isEnabled(record.id),
        status:
          runtime?.phase || (record.error ? 'error' : record.requested ? 'waiting' : 'disabled'),
        missing,
        error: record.error,
      };
    }
    get tree() {
      const visit = (parent) =>
        [...this.#definitions.values()]
          .filter((record) => record.parentId === parent)
          .map((record) => ({ ...this.#view(record), children: visit(record.id) }));
      return visit(null);
    }
    get list() {
      const result = [],
        visit = (rows) => {
          for (const { children, ...record } of rows) {
            result.push(record);
            visit(children);
          }
        };
      visit(this.tree);
      return result;
    }
    isEnabled(id) {
      const runtime = this.#running.get(id);
      return runtime?.phase === 'enabled' && !runtime.scope.disposed;
    }
    getAPI(id) {
      return this.isEnabled(id) ? this.#running.get(id).api : undefined;
    }
    async enable(id) {
      const plan = this.#plan(id);
      for (const record of plan) {
        record.requested = true;
        record.error = '';
      }
      this.emit('change', {});
      for (const record of plan) {
        if (!record.requested || !(await this.#start(record))) {
          if (record.error) throw new Error(record.error);
          return false;
        }
      }
      await this.#reconcile();
      return this.isEnabled(id);
    }
    disable(id) {
      const target = this.#definitions.get(id);
      if (!target) return;
      target.requested = false;
      const stopped = new Set();
      const stop = (dependency) => {
        if (stopped.has(dependency)) return;
        stopped.add(dependency);
        for (const record of this.#definitions.values())
          if (record.requires.includes(dependency)) stop(record.id);
        const runtime = this.#running.get(dependency);
        if (runtime) {
          this.#running.delete(dependency);
          runtime.scope.dispose();
        }
        const record = this.#definitions.get(dependency);
        if (record) record.error = '';
      };
      stop(id);
      this.emit('change', {});
    }
    #context(record, runtime) {
      const { id } = record,
        { scope } = runtime,
        ui = this.ui;
      const dependencies = new Set(
        this.#plan(id)
          .slice(0, -1)
          .map((item) => item.id),
      );
      const active = () => {
        if (scope.disposed) throw new Error('Расширение отключено: ' + id);
      };
      return Object.freeze({
        id,
        state: ui.state,
        ui,
        scope,
        signal: scope.signal,
        provide: (api) => {
          active();
          if (runtime.api !== undefined || !api || typeof api !== 'object')
            throw new Error('API расширения задаётся один раз объектом.');
          runtime.api = api;
        },
        require: (dependency) => {
          active();
          if (!dependencies.has(dependency))
            throw new Error('Зависимость не объявлена: ' + dependency);
          if (!this.isEnabled(dependency)) throw new Error('Зависимость отключена: ' + dependency);
          const api = this.getAPI(dependency);
          if (api === undefined) throw new Error('Расширение не опубликовало API: ' + dependency);
          return api;
        },
        on: (type, fn) => ui.input.on(type, fn, { signal: scope.signal }),
        action: (fn) => new root.AtlasUI.ActionHandler(fn, { signal: scope.signal }),
        menu: (menu, item) =>
          menu.register({ ...item, id: id + ':' + item.id, signal: scope.signal }),
        windowMenu: (item) =>
          ui.mainMenu.register({
            ...item,
            id: id + ':window:' + item.id,
            path: ['Вид', 'Окна'],
            signal: scope.signal,
          }),
        window: (options) =>
          ui.windows.open({
            ...options,
            id: id + ':' + options.id,
            windowId: options.windowId ? id + ':' + options.windowId : undefined,
            signal: scope.signal,
          }),
        overlay: (options) =>
          ui.viewport.addOverlay({
            ...options,
            id: id + ':' + options.id,
            source: id,
            signal: scope.signal,
          }),
        layer: (options) =>
          ui.viewport.addOverlay({
            ...options,
            id: id + ':' + options.id,
            source: id,
            signal: scope.signal,
          }),
        onRegionClick: (handler, options = {}) =>
          ui.regionClicks.subscribe(handler, { ...options, mode: 'passive', signal: scope.signal }),
      });
    }
    #start(record) {
      const existing = this.#running.get(record.id);
      if (existing) return existing.promise;
      if (
        this.#definitions.get(record.id) !== record ||
        !record.requested ||
        record.error ||
        record.requires.some((id) => !this.isEnabled(id))
      )
        return Promise.resolve(false);
      const runtime = { scope: new Scope(), phase: 'starting', api: undefined, promise: null };
      this.#running.set(record.id, runtime);
      runtime.promise = Promise.resolve().then(async () => {
        try {
          if (runtime.scope.disposed) return false;
          const cleanup = await record.source.start(this.#context(record, runtime));
          if (typeof cleanup === 'function') runtime.scope.defer(cleanup);
          else if (cleanup?.dispose) runtime.scope.own(cleanup);
          if (runtime.scope.disposed || this.#running.get(record.id) !== runtime) return false;
          runtime.phase = 'enabled';
          this.emit('change', {});
          return true;
        } catch (error) {
          if (this.#running.get(record.id) === runtime) {
            this.#running.delete(record.id);
            record.error = String(error.message || error);
          }
          runtime.scope.dispose();
          this.emit('change', {});
          return false;
        }
      });
      this.emit('change', {});
      return runtime.promise;
    }
    async #reconcile() {
      // Start only ready nodes. In-flight starts are shared by explicit enable calls.
      const ready = [...this.#definitions.values()].filter(
        (record) =>
          record.requested &&
          !record.error &&
          !this.#running.has(record.id) &&
          record.requires.every((id) => this.isEnabled(id)),
      );
      if (!ready.length) return;
      await Promise.all(ready.map((record) => this.#start(record)));
      await this.#reconcile();
    }
  }
  Object.assign((root.AtlasUI ||= {}), { ExtensionHost });
  if (typeof module !== 'undefined' && module.exports) module.exports = { ExtensionHost };
})(globalThis);
