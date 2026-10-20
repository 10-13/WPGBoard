/* Generic tile entries and read-only statistic interpreters; no DOM or domains. */
(function (root) {
  'use strict';
  function createMetadataAPI({ EventBus, clone, freeze, uid }) {
    const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    function key(value) { if (typeof value !== 'string' || !value.trim() || value.length > 100 || unsafe.has(value)) throw new Error('Укажите безопасный непустой ключ длиной до 100 символов.'); return value; }
    function region(index, id) { if (!Number.isInteger(id) || !index?.get(id)) throw new Error('Провинция не найдена.'); return id; }
    function entry(value) {
      if (!object(value) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 100 || typeof value.description !== 'string' || value.description.length > 8000 || !object(value.stats) || Object.keys(value.stats).length > 100) throw new Error('Запись должна иметь название, описание и объект статов (до 100 полей).');
      key(value.id); for (const stat of Object.keys(value.stats)) key(stat);
      return { id: value.id, title: value.title.trim(), description: value.description, stats: clone(value.stats), source: key(value.source || 'user'), kind: key(value.kind || 'note') };
    }
    function treeNodes(nodes, depth = 0, count = { value: 0 }) {
      if (!Array.isArray(nodes) || depth > 32) throw new Error('Нужен массив узлов дерева глубиной до 32.'); const ids = new Set();
      return nodes.map(raw => {
        if (!object(raw) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 2048 || ids.has(raw.id) || ++count.value > 10000) throw new Error('Узлам нужны уникальные ID; максимум 10000 узлов.'); ids.add(raw.id);
        const node = clone(raw); node.title = node.title === undefined ? node.id : node.title;
        if (typeof node.title !== 'string' || (node.unit !== undefined && typeof node.unit !== 'string')) throw new Error('Заголовок и единицы узла должны быть строками.');
        if (Object.hasOwn(node, 'children')) { if (Object.hasOwn(node, 'value')) throw new Error('Папка не может одновременно быть результатом.'); node.type = 'folder'; node.children = treeNodes(node.children, depth + 1, count); }
        else { if (!Object.hasOwn(node, 'value')) throw new Error('Лист должен содержать value.'); node.type = 'stat'; }
        return node;
      });
    }
    function statisticResult(regionIds, tree, errors) {
      const result = { regionIds, tree, errors }, get = path => {
        const parts = typeof path === 'string' ? [path] : path; if (!Array.isArray(parts) || !parts.length || parts.some(id => typeof id !== 'string')) throw new Error('Путь — массив ID узлов.');
        let children = tree, node = null; for (const id of parts) { node = children.find(node => node.id === id); if (!node) return null; children = node.children || []; } return node;
      };
      Object.defineProperties(result, { get: { value: get }, value: { value: path => { const node = get(path); return node?.type === 'stat' ? node.value : undefined; } } }); return freeze(result);
    }
    class TileMetadata {
      #state;
      constructor(state) {
        this.#state = state;
        state.actions.register('core.tile.entry.save', { label: 'Метаданные провинции', reduce(draft, payload, { regionIndex }) {
          const id = region(regionIndex, payload.regionId), value = entry(payload.entry);
          draft.meta.tiles ||= {}; draft.meta.tiles[id] ||= { entries: {} }; draft.meta.tiles[id].entries ||= {}; draft.meta.tiles[id].entries[value.id] = value;
        } });
        state.actions.register('core.tile.entry.remove', { label: 'Удаление метаданных провинции', reduce(draft, payload, { regionIndex }) {
          const id = region(regionIndex, payload.regionId); key(payload.entryId);
          if (draft.meta.tiles?.[id]?.entries) { delete draft.meta.tiles[id].entries[payload.entryId]; if (!Object.keys(draft.meta.tiles[id].entries).length) delete draft.meta.tiles[id]; }
        } });
      }
      list(regionId) { region(this.#state.regionIndex, regionId); return Object.freeze(Object.values(this.#state.meta.tiles?.[regionId]?.entries || {})); }
      get(regionId, entryId) { region(this.#state.regionIndex, regionId); key(entryId); const entries = this.#state.meta.tiles?.[regionId]?.entries || {}; return Object.hasOwn(entries, entryId) ? entries[entryId] : null; }
      save(regionId, value, options = {}) {
        if (!object(value)) throw new Error('Ожидается объект метаданных.');
        const normalized = entry({ ...value, id: value.id || uid('entry'), description: value.description || '', stats: value.stats || {} });
        this.#state.dispatch('core.tile.entry.save', { regionId, entry: normalized }, { source: normalized.source, label: 'Метаданные: ' + normalized.title, ...options }); return normalized.id;
      }
      remove(regionId, entryId, options = {}) { return this.#state.dispatch('core.tile.entry.remove', { regionId, entryId }, options); }
    }
    class StatisticsRegistry extends EventBus {
      #state; #interpreters = new Map(); #collecting = false;
      constructor(state) { super(); this.#state = state; }
      get list() { return [...this.#interpreters].map(([id, d]) => ({ id, title: d.title, keys: [...d.keys] })); }
      register(id, { title = id, keys = [], collect, order = 0 }, { signal } = {}) {
        key(id); if (this.#interpreters.has(id) || typeof collect !== 'function' || !Array.isArray(keys) || keys.some(k => typeof k !== 'string') || !Number.isFinite(order)) throw new Error('Некорректный или уже зарегистрированный сборщик.');
        let active = !signal?.aborted;
        const dispose = () => { if (!active) return; active = false; this.#interpreters.delete(id); signal?.removeEventListener('abort', dispose); this.emit('change', {}); };
        if (active) { this.#interpreters.set(id, { title: String(title), keys: [...keys], collect, order }); signal?.addEventListener('abort', dispose, { once: true }); this.emit('change', {}); }
        return Object.freeze({ id, dispose });
      }
      registerInterpreter(...args) { return this.register(...args); }
      collect(regionIds) {
        if (!this.#state.loaded || this.#collecting || !Array.isArray(regionIds)) throw new Error('Нужна загруженная карта и массив регионов; вложенный сбор запрещён.');
        const ids = [...new Set(regionIds)]; for (const id of ids) region(this.#state.regionIndex, id); ids.sort((a, b) => a - b);
        this.#collecting = true;
        try { return this.#state.history.readOnly(() => {
          const regions = ids.map(id => this.#state.regions.get(id)), entries = ids.flatMap(regionId => this.#state.tileMetadata.list(regionId).map(entry => ({ regionId, entry }))), tree = [], errors = [], handled = new Set();
          const context = freeze({ regionIds: ids, regions, allRegions: [...this.#state.regions.values()], entries, meta: this.#state.meta, params: this.#state.params, values: stat => entries.filter(e => Object.hasOwn(e.entry.stats, stat)).map(e => ({ regionId: e.regionId, entryId: e.entry.id, value: e.entry.stats[stat] })) });
          for (const [id, definition] of [...this.#interpreters].sort(([, a], [, b]) => a.order - b.order)) {
            try {
              const result = definition.collect(freeze({ ...context, handledKeys: [...handled] }));
              if (result?.then) { result.catch(() => {}); throw new Error('Сборщик должен быть синхронным.'); }
              if (!result || !Array.isArray(result.children)) throw new Error('Сборщик должен вернуть {children: [...узлы дерева]}.');
              const node = treeNodes([{ ...result, id, title: definition.title }])[0]; tree.push(node); for (const stat of definition.keys) handled.add(stat);
            } catch (error) { errors.push({ id, title: definition.title, message: String(error.message || error) }); }
          }
          return statisticResult(ids, tree, errors);
        }); } finally { this.#collecting = false; }
      }
      calculate(regionIds) { return this.collect(regionIds); }
    }
    return { TileMetadata, StatisticsRegistry };
  }
  root.AtlasMetadataCore = { createMetadataAPI };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createMetadataAPI };
})(globalThis);
