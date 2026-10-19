/* Headless game state and append-only history. No browser or rendering APIs. */
(function (root) {
  'use strict';
  const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const plain = o => o !== null && typeof o === 'object' && !Array.isArray(o);
  const uid = prefix => prefix + '-' + (root.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  function assertJSON(value, depth = 0, seen = new Set()) {
    if (depth > 64) throw new Error('Слишком глубокая структура данных.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || seen.has(value)) throw new Error('Допустимы только JSON-данные без циклических ссылок.');
    seen.add(value);
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Ожидается обычный JSON-объект.');
    for (const key of Object.keys(value)) {
      if (forbidden.has(key)) throw new Error('Недопустимый ключ данных: ' + key);
      assertJSON(value[key], depth + 1, seen);
    }
    seen.delete(value);
  }
  function clone(value) { assertJSON(value); return JSON.parse(JSON.stringify(value)); }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
    return value;
  }
  function equal(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    const ak = Object.keys(a), bk = Object.keys(b);
    return ak.length === bk.length && ak.every(k => own(b, k) && equal(a[k], b[k]));
  }
  function pathOf(path) {
    const result = typeof path === 'string' ? [path] : path;
    if (!Array.isArray(result) || result.length > 64 || result.some(k => typeof k !== 'string' || !k || forbidden.has(k))) throw new Error('Путь должен быть массивом безопасных строк.');
    return [...result];
  }
  const absent = () => ({ exists: false });
  const present = value => ({ exists: true, value });
  const slotEqual = (a, b) => a.exists === b.exists && (!a.exists || equal(a.value, b.value));
  function read(value, path) {
    for (const key of path) { if (!plain(value) || !own(value, key)) return absent(); value = value[key]; }
    return present(value);
  }
  function write(data, path, slot) {
    if (!path.length) { if (!slot.exists || !plain(slot.value)) throw new Error('Корень состояния должен оставаться объектом.'); return clone(slot.value); }
    let target = data;
    for (const key of path.slice(0, -1)) { if (!plain(target[key])) target[key] = {}; target = target[key]; }
    const last = path.at(-1); if (slot.exists) target[last] = clone(slot.value); else delete target[last];
    return data;
  }
  function diffSlot(before, after, target, path, result) {
    if (slotEqual(before, after)) return;
    if (before.exists && after.exists && plain(before.value) && plain(after.value)) {
      for (const key of new Set([...Object.keys(before.value), ...Object.keys(after.value)])) {
        diffSlot(own(before.value, key) ? present(before.value[key]) : absent(), own(after.value, key) ? present(after.value[key]) : absent(), target, [...path, key], result);
      }
    } else result.push({ target, path, before: clone(before), after: clone(after) });
  }
  function diff(before, after) {
    const actions = [];
    for (const target of ['params', 'meta']) diffSlot(present(before[target]), present(after[target]), target, [], actions);
    return actions;
  }
  function validateActions(actions) {
    if (!Array.isArray(actions) || actions.length > 100000) throw new Error('Некорректный список действий.');
    for (const action of actions) {
      if (!['params', 'meta'].includes(action.target)) throw new Error('Неизвестная область состояния.');
      pathOf(action.path);
      for (const slot of [action.before, action.after]) {
        if (!slot || typeof slot.exists !== 'boolean' || (slot.exists && !own(slot, 'value'))) throw new Error('Действие должно содержать предыдущее и новое значение.');
        if (slot.exists) assertJSON(slot.value);
      }
    }
  }
  function apply(snapshot, actions, check = true) {
    validateActions(actions); const next = clone(snapshot);
    for (const action of actions) {
      if (check && !slotEqual(read(next[action.target], action.path), action.before)) throw new Error('Действие устарело: ' + action.target + '/' + action.path.join('/'));
      next[action.target] = write(next[action.target], action.path, action.after);
    }
    if (!plain(next.params) || !plain(next.meta)) throw new Error('Параметры и метаданные должны быть объектами.');
    return freeze(next);
  }
  class EventBus {
    #listeners = new Map();
    on(type, fn, { signal } = {}) {
      if (typeof fn !== 'function') throw new TypeError('Обработчик должен быть функцией.');
      if (signal?.aborted) return () => {};
      if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
      const set = this.#listeners.get(type); set.add(fn);
      const off = () => { set.delete(fn); signal?.removeEventListener('abort', off); if (!set.size) this.#listeners.delete(type); };
      signal?.addEventListener('abort', off, { once: true }); return off;
    }
    emit(type, detail) {
      for (const fn of [...(this.#listeners.get(type) || [])]) { try { fn(detail); } catch (error) { console.error('Atlas listener:', error); } }
    }
    listenerCount(type) { return this.#listeners.get(type)?.size || 0; }
  }
  class Scope {
    #controller = new AbortController(); #cleanup = []; #disposed = false;
    get signal() { return this.#controller.signal; }
    get disposed() { return this.#disposed; }
    defer(fn) { if (this.#disposed) fn(); else this.#cleanup.push(fn); return fn; }
    own(value) { this.defer(typeof value === 'function' ? value : () => value.dispose()); return value; }
    dispose() {
      if (this.#disposed) return; this.#disposed = true; this.#controller.abort();
      for (const fn of this.#cleanup.splice(0).reverse()) { try { fn(); } catch (error) { console.error('Atlas cleanup:', error); } }
    }
  }
  class ReadonlyMap {
    #map;
    constructor(map) { this.#map = map; Object.freeze(this); }
    get size() { return this.#map.size; }
    get(key) { return this.#map.get(key); }
    has(key) { return this.#map.has(key); }
    keys() { return this.#map.keys(); }
    values() { return this.#map.values(); }
    entries() { return this.#map.entries(); }
    [Symbol.iterator]() { return this.entries(); }
    forEach(fn) { this.#map.forEach((v, k) => fn(v, k, this)); }
  }
  class RegionIndex {
    #pixels; #items; #runs = new Map();
    constructor({ width, height, regions, pixels }) {
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 20000000 || !pixels || pixels.length !== width * height) throw new Error('Некорректный размер индекса.');
      if (!Array.isArray(regions) || !regions.length || regions.length > 100000) throw new Error('Некорректный список регионов.');
      this.width = width; this.height = height; this.#items = new Map();
      for (const region of regions) {
        const { id, bbox, anchor, area } = region;
        if (!Number.isInteger(id) || id < 1 || id > 100000 || this.#items.has(id) || !Number.isInteger(area) || area < 1 || !Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isInteger) || !Array.isArray(anchor) || anchor.length !== 2 || !anchor.every(Number.isInteger)) throw new Error('Некорректная геометрия региона.');
        const [x, y, w, h] = bbox;
        if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > width || y + h > height || anchor[0] < x || anchor[1] < y || anchor[0] >= x + w || anchor[1] >= y + h) throw new Error('Регион выходит за пределы карты.');
        this.#items.set(id, freeze({ id, bbox: [...bbox], anchor: [...anchor], area }));
      }
      // The caller cannot later mutate the index through its original typed array.
      this.#pixels = new Uint32Array(pixels);
      const counts = new Map(), bounds = new Map();
      for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
        const id = this.#pixels[i]; if (!id) continue;
        if (!this.#items.has(id)) throw new Error('Неизвестный ID в индексе: ' + id);
        counts.set(id, (counts.get(id) || 0) + 1);
        const b = bounds.get(id) || [width, height, -1, -1]; b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); bounds.set(id, b);
      }
      for (const r of this.#items.values()) {
        const b = bounds.get(r.id);
        if (!b || counts.get(r.id) !== r.area || !equal(r.bbox, [b[0], b[1], b[2] - b[0] + 1, b[3] - b[1] + 1]) || this.idAt(...r.anchor) !== r.id) throw new Error('Метаданные региона не совпадают с индексом: ' + r.id);
      }
      this.regions = new ReadonlyMap(this.#items); Object.freeze(this);
    }
    get size() { return this.#items.size; }
    get(id) { return this.#items.get(Number(id)) || null; }
    idAt(x, y) { if (!Number.isFinite(x) || !Number.isFinite(y)) return null; x = Math.floor(x); y = Math.floor(y); return x < 0 || y < 0 || x >= this.width || y >= this.height ? null : this.#pixels[y * this.width + x] || null; }
    at(x, y) { return this.get(this.idAt(x, y)); }
    forEachRun(id, fn) {
      const region = this.get(id); if (!region) return;
      if (!this.#runs.has(region.id)) {
        const [x, y, w, h] = region.bbox, runs = [];
        for (let yy = y; yy < y + h; yy++) {
          let start = -1;
          for (let xx = x; xx <= x + w; xx++) {
            const match = xx < x + w && this.#pixels[yy * this.width + xx] === region.id;
            if (match && start < 0) start = xx;
            if (!match && start >= 0) { runs.push(yy * this.width + start, xx - start); start = -1; }
          }
        }
        this.#runs.set(region.id, new Uint32Array(runs));
      }
      const runs = this.#runs.get(region.id); for (let i = 0; i < runs.length; i += 2) fn(runs[i], runs[i + 1]);
    }
    toJSON() { return [...this.#items.values()].map(r => clone(r)); }
  }
  function mergeSlot(base, ours, theirs, path, target, strategy, conflicts) {
    if (slotEqual(ours, theirs) || slotEqual(base, theirs)) return ours;
    if (slotEqual(base, ours)) return theirs;
    if (ours.exists && theirs.exists && plain(ours.value) && plain(theirs.value) && (!base.exists || plain(base.value))) {
      const result = {}, baseValue = base.exists ? base.value : {};
      for (const key of new Set([...Object.keys(baseValue), ...Object.keys(ours.value), ...Object.keys(theirs.value)])) {
        const next = mergeSlot(own(baseValue, key) ? present(baseValue[key]) : absent(), own(ours.value, key) ? present(ours.value[key]) : absent(), own(theirs.value, key) ? present(theirs.value[key]) : absent(), [...path, key], target, strategy, conflicts);
        if (next.exists) result[key] = next.value;
      }
      return present(result);
    }
    conflicts.push({ target, path, base: clone(base), ours: clone(ours), theirs: clone(theirs) });
    return strategy === 'theirs' ? theirs : ours;
  }
  class History extends EventBus {
    #baseline; #nodes = new Map(); #branches = new Map(); #active = 'main'; #cache = new Map(); #stacks = new Map(); #editing = false;
    constructor({ params = {}, meta = {}, mapId = '' } = {}) {
      super(); if (!plain(params) || !plain(meta)) throw new Error('Ожидаются объекты params и meta.');
      this.#baseline = freeze(clone({ params, meta })); Object.defineProperty(this, 'mapId', { value: String(mapId), enumerable: true }); this.#branches.set('main', null); this.#stacks.set('main', { undo: [], redo: [] });
    }
    get activeBranch() { return this.#active; }
    get branches() { return [...this.#branches].map(([name, head]) => freeze({ name, head })); }
    get commits() { return [...this.#nodes.values()]; }
    get actions() { return this.commits.map(node => freeze({ ...node.action, commitId: node.id, label: node.label, source: node.source, timestamp: node.timestamp, patches: node.actions })); }
    getAction(id) { return this.actions.find(action => action.id === id) || null; }
    applyAction(id, { branch = this.#active } = {}) { const action = this.getAction(id); if (!action) throw new Error('Экшен не найден.'); return this.commit(action.patches, { branch, label: 'Применить: ' + action.label, actionType: 'core.action.apply', payload: { actionId: id } }); }
    revertAction(id, { branch = this.#active } = {}) { const action = this.getAction(id); if (!action) throw new Error('Экшен не найден.'); return this.commit(action.patches.slice().reverse().map(p => ({ ...p, before: p.after, after: p.before })), { branch, label: 'Обратить: ' + action.label, actionType: 'core.action.revert', payload: { actionId: id } }); }
    get baseline() { return this.#baseline; }
    get head() { return this.#branches.get(this.#active); }
    get executing() { return this.#editing; }
    get canUndo() { return !!this.#stacks.get(this.#active)?.undo.length; }
    get canRedo() { return !!this.#stacks.get(this.#active)?.redo.length; }
    #name(name) { if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('Укажите имя ветки длиной до 80 символов.'); return name.trim(); }
    #head(branch) { if (!this.#branches.has(branch)) throw new Error('Ветка не найдена: ' + branch); return this.#branches.get(branch); }
    snapshot(branch = this.#active) { return this.#materialize(this.#head(branch)); }
    #materialize(id) {
      if (!id) return this.#baseline; if (this.#cache.has(id)) return this.#cache.get(id);
      const chain = []; let current = id;
      while (current && !this.#cache.has(current)) { const node = this.#nodes.get(current); if (!node) throw new Error('Неизвестный коммит.'); chain.push(node); current = node.parents[0] || null; }
      let value = current ? this.#cache.get(current) : this.#baseline;
      for (const node of chain.reverse()) { value = apply(value, node.actions); this.#cache.set(node.id, value); }
      while (this.#cache.size > 32) this.#cache.delete(this.#cache.keys().next().value);
      return value;
    }
    createBranch(name, { from = this.#active } = {}) {
      if (this.#editing) throw new Error('Нельзя менять историю внутри обработчика экшена.');
      name = this.#name(name); if (this.#branches.has(name)) throw new Error('Такая ветка уже есть.');
      this.#branches.set(name, this.#head(from)); this.#stacks.set(name, { undo: [], redo: [] }); this.emit('history:change', { type: 'branch', branch: name }); return name;
    }
    checkout(name) { if (this.#editing) throw new Error('Нельзя менять ветку внутри экшена.'); this.#head(name); if (name === this.#active) return; const before = this.snapshot(); this.#active = name; this.emit('change', { before, after: this.snapshot(), branch: name, type: 'checkout' }); this.emit('history:change', { type: 'checkout', branch: name }); }
    commit(actions, { label = 'Изменение', branch = this.#active, source = 'external', parents, kind = 'action', reference = null, actionType = 'core.patch', payload = null } = {}) {
      if (this.#editing) throw new Error('Вложенная запись истории из обработчика экшена запрещена.');
      const first = this.#head(branch), before = this.snapshot(branch); validateActions(actions);
      if (!actions.length && kind !== 'merge') return null;
      const nodeParents = parents || [first];
      if (nodeParents[0] !== first || nodeParents.some(id => id !== null && !this.#nodes.has(id))) throw new Error('Неверные родители коммита.');
      if (typeof actionType !== 'string' || !actionType || actionType.length > 120) throw new Error('Некорректный тип экшена.');
      const after = apply(before, actions), node = freeze({ id: uid('commit'), parents: [...nodeParents], label: String(label).slice(0, 200), source: String(source).slice(0, 100), kind, reference, timestamp: Date.now(), action: { id: uid('action'), type: actionType, payload: clone(payload) }, actions: clone(actions) });
      this.#nodes.set(node.id, node); this.#branches.set(branch, node.id); this.#cache.set(node.id, after);
      while (this.#cache.size > 32) this.#cache.delete(this.#cache.keys().next().value);
      if (kind === 'action' || kind === 'merge') { this.#stacks.get(branch).undo.push(node.id); this.#stacks.get(branch).redo = []; }
      if (branch === this.#active) this.emit('change', { before, after, branch, commit: node, type: kind });
      this.emit('history:change', { type: kind, branch, commit: node }); return node;
    }
    update(mutator, options = {}) { if (this.#editing) throw new Error('Вложенный экшен запрещён.'); const before = this.snapshot(options.branch), draft = clone(before); this.#editing = true; try { const result = mutator(draft); if (result?.then) { result.catch(() => {}); throw new Error('Обработчик экшена должен быть синхронным.'); } } finally { this.#editing = false; } return this.commit(diff(before, draft), options); }
    undo() {
      const stacks = this.#stacks.get(this.#active), id = stacks.undo.at(-1); if (!id) return null;
      const original = this.#nodes.get(id), inverse = original.actions.slice().reverse().map(a => ({ ...a, before: a.after, after: a.before }));
      const result = this.commit(inverse, { label: 'Отмена: ' + original.label, kind: 'undo', reference: id, actionType: 'core.undo', payload: { actionId: original.action.id } }); stacks.undo.pop(); stacks.redo.push(id); this.emit('history:change', { type: 'undo:stack', branch: this.#active }); return result;
    }
    redo() {
      const stacks = this.#stacks.get(this.#active), id = stacks.redo.at(-1); if (!id) return null;
      const original = this.#nodes.get(id), result = this.commit(original.actions, { label: 'Повтор: ' + original.label, kind: 'redo', reference: id, actionType: 'core.redo', payload: { actionId: original.action.id } }); stacks.redo.pop(); stacks.undo.push(id); this.emit('history:change', { type: 'redo:stack', branch: this.#active }); return result;
    }
    #ancestors(id) {
      const result = new Set([null]), pending = [id];
      while (pending.length) { const current = pending.pop(); if (result.has(current)) continue; result.add(current); pending.push(...this.#nodes.get(current).parents); }
      return result;
    }
    #mergeBase(a, b) {
      const ours = this.#ancestors(a), theirs = this.#ancestors(b), common = [...ours].filter(id => theirs.has(id)), dominated = new Set();
      for (const id of common) if (id) for (const parent of this.#nodes.get(id).parents) dominated.add(parent);
      const best = common.filter(id => !dominated.has(id));
      if (best.length !== 1) throw new Error('Несколько баз слияния. Сначала объедините промежуточные ветки.'); return best[0];
    }
    previewMerge(source, { target = 'main', strategy = 'reject' } = {}) {
      if (!['reject', 'ours', 'theirs'].includes(strategy)) throw new Error('Неизвестная стратегия слияния.');
      const sourceHead = this.#head(source), targetHead = this.#head(target), baseId = this.#mergeBase(targetHead, sourceHead), base = this.#materialize(baseId), ours = this.snapshot(target), theirs = this.snapshot(source), merged = {}, conflicts = [];
      for (const area of ['params', 'meta']) merged[area] = mergeSlot(present(base[area]), present(ours[area]), present(theirs[area]), [], area, strategy, conflicts).value;
      return { source, target, sourceHead, targetHead, baseId, conflicts, actions: diff(ours, merged), alreadyMerged: this.#ancestors(targetHead).has(sourceHead) };
    }
    merge(source, options = {}) {
      const preview = this.previewMerge(source, options);
      if (preview.conflicts.length && (!options.strategy || options.strategy === 'reject')) { const error = new Error('Конфликт слияния: ' + preview.conflicts.length); error.conflicts = preview.conflicts; throw error; }
      if (preview.alreadyMerged) return { ...preview, commit: null };
      const commit = this.commit(preview.actions, { branch: preview.target, parents: [preview.targetHead, preview.sourceHead], label: options.label || 'Слияние ' + source + ' → ' + preview.target, source: 'history', kind: 'merge', actionType: 'core.merge', payload: { source, target: preview.target, baseId: preview.baseId } });
      return { ...preview, commit };
    }
    exportBranch(name = this.#active) {
      const head = this.#head(name), ancestors = this.#ancestors(head);
      return { format: 'atlas-branch', version: 1, mapId: this.mapId, baseline: clone(this.#baseline), name, head, commits: this.commits.filter(c => ancestors.has(c.id)).map(c => clone(c)) };
    }
    importBranch(bundle, { name = bundle?.name } = {}) {
      if (this.#editing) throw new Error('Нельзя импортировать историю внутри экшена.');
      if (!bundle || bundle.format !== 'atlas-branch' || bundle.version !== 1 || bundle.mapId !== this.mapId || !equal(bundle.baseline, this.#baseline)) throw new Error('Журнал относится к другой карте или исходному состоянию.');
      name = this.#name(name); if (this.#branches.has(name)) throw new Error('Имя импортируемой ветки занято.');
      const trial = History.fromJSON(this.toJSON()); trial.#ingest(bundle.commits);
      if (bundle.head !== null && !trial.#nodes.has(bundle.head)) throw new Error('Не найден конец импортируемой ветки.');
      trial.#materialize(bundle.head); this.#nodes = trial.#nodes; this.#cache = trial.#cache;
      this.#branches.set(name, bundle.head); this.#stacks.set(name, { undo: [], redo: [] }); this.emit('history:change', { type: 'import', branch: name }); return name;
    }
    #ingest(commits) {
      if (!Array.isArray(commits) || commits.length > 50000) throw new Error('Слишком большой или неверный журнал.');
      const pending = new Map(), waiting = new Map(), dependencies = new Map(), queue = [], actionIds = new Set(this.commits.map(c => c.action.id));
      for (const raw of commits) {
        if (!raw || typeof raw.id !== 'string' || !raw.id || raw.id.length > 150 || !Array.isArray(raw.parents) || !raw.parents.length || raw.parents.length > 2 || raw.parents.some(p => p !== null && typeof p !== 'string')) throw new Error('Некорректный коммит.');
        const c = clone(raw); c.action ||= { id: 'action:' + c.id, type: 'core.patch', payload: null };
        if (!c.action || typeof c.action.id !== 'string' || !c.action.id || typeof c.action.type !== 'string' || !c.action.type || !own(c.action, 'payload')) throw new Error('Некорректный экшен.');
        if (this.#nodes.has(c.id)) { if (!equal(this.#nodes.get(c.id), c)) throw new Error('Разные коммиты с одинаковым ID.'); continue; }
        if (pending.has(c.id) || actionIds.has(c.action.id)) throw new Error('Повторяющийся ID коммита или экшена.'); actionIds.add(c.action.id); validateActions(c.actions); pending.set(c.id, c);
      }
      for (const c of pending.values()) {
        const parents = [...new Set(c.parents.filter(p => p !== null && !this.#nodes.has(p)))];
        for (const parent of parents) { if (!pending.has(parent)) throw new Error('Неизвестный родитель коммита.'); if (!waiting.has(parent)) waiting.set(parent, []); waiting.get(parent).push(c.id); }
        dependencies.set(c.id, parents.length); if (!parents.length) queue.push(c.id);
      }
      let visited = 0;
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i], c = pending.get(id), after = apply(this.#materialize(c.parents[0]), c.actions); this.#nodes.set(id, freeze(c)); this.#cache.set(id, after); visited++;
        while (this.#cache.size > 32) this.#cache.delete(this.#cache.keys().next().value);
        for (const child of waiting.get(id) || []) { dependencies.set(child, dependencies.get(child) - 1); if (!dependencies.get(child)) queue.push(child); }
      }
      if (visited !== pending.size) throw new Error('Цикл в журнале коммитов.');
    }
    toJSON() { return { version: 1, mapId: this.mapId, baseline: clone(this.#baseline), activeBranch: this.#active, branches: this.branches, commits: this.commits.map(c => clone(c)), stacks: [...this.#stacks].map(([name, stack]) => [name, clone(stack)]) }; }
    static fromJSON(data) {
      if (!data || data.version !== 1 || !plain(data.baseline) || !Array.isArray(data.branches)) throw new Error('Некорректный формат истории.');
      const history = new History({ ...data.baseline, mapId: data.mapId }); history.#ingest(data.commits);
      history.#branches.clear(); history.#stacks.clear();
      for (const b of data.branches) {
        const name = history.#name(b.name); if (history.#branches.has(name) || (b.head !== null && !history.#nodes.has(b.head))) throw new Error('Некорректная ветка.');
        history.#branches.set(name, b.head); history.#stacks.set(name, { undo: [], redo: [] }); history.#materialize(b.head);
      }
      if (!history.#branches.has('main') || !history.#branches.has(data.activeBranch)) throw new Error('Отсутствует основная или активная ветка.');
      history.#active = data.activeBranch;
      for (const [name, stack] of data.stacks || []) { if (!history.#branches.has(name) || !stack || !Array.isArray(stack.undo) || !Array.isArray(stack.redo) || [...stack.undo, ...stack.redo].some(id => !history.#nodes.has(id))) throw new Error('Некорректная история отмены.'); history.#stacks.set(name, clone(stack)); }
      return history;
    }
  }
  class ActionRegistry extends EventBus {
    #types = new Map(); #execute;
    constructor(execute) { super(); this.#execute = execute; }
    get types() { return [...this.#types.values()].map(d => freeze({ type: d.type, description: d.description || '' })); }
    has(type) { return this.#types.has(type); }
    register(type, { reduce, validate, label, description = '' }, { signal } = {}) {
      if (typeof type !== 'string' || !/^[\w.:-]{1,120}$/.test(type) || typeof reduce !== 'function' || this.#types.has(type)) throw new Error('Некорректный или уже зарегистрированный тип экшена.');
      let active = !signal?.aborted; const dispose = () => { if (!active) return; active = false; this.#types.delete(type); signal?.removeEventListener('abort', dispose); this.emit('change', { type }); };
      if (active) { this.#types.set(type, { type, reduce, validate, label, description }); signal?.addEventListener('abort', dispose, { once: true }); this.emit('change', { type }); }
      return Object.freeze({ type, dispose });
    }
    dispatch(type, payload = null, options = {}) { const definition = this.#types.get(type); if (!definition) throw new Error('Тип экшена не зарегистрирован: ' + type); const data = freeze(clone(payload)); definition.validate?.(data); return this.#execute(definition, data, options); }
  }
  const singletonToken = Symbol('GameState'); let singleton;
  class GameState extends EventBus {
    #map = null; #regionIndex = null; #history = null; #snapshot = freeze({ params: {}, meta: {} }); #off = []; #actions;
    constructor(token) {
      super(); if (token !== singletonToken) throw new Error('Используйте AtlasCore.getGameState().');
      this.#actions = new ActionRegistry((definition, payload, options) => this.#requireHistory().update(draft => definition.reduce(draft, payload, { regionIndex: this.regionIndex, originalMap: this.originalMap }), { ...options, label: options.label || (typeof definition.label === 'function' ? definition.label(payload) : definition.label) || definition.type, actionType: definition.type, payload }));
      this.#actions.register('core.meta.set', { reduce: (draft, payload) => { draft.meta = write(draft.meta, pathOf(payload.path), present(payload.value)); }, label: 'Изменение метаданных' });
      this.#actions.register('core.meta.delete', { reduce: (draft, payload) => { draft.meta = write(draft.meta, pathOf(payload.path), absent()); }, label: 'Удаление метаданных' });
    }
    get map() { return this.#map; }
    get originalMap() { return this.#map?.original || null; }
    get regionIndex() { return this.#regionIndex; }
    get regions() { return this.#regionIndex?.regions || new ReadonlyMap(new Map()); }
    get params() { return this.#snapshot.params; }
    get meta() { return this.#snapshot.meta; }
    get history() { return this.#history; }
    get actions() { return this.#actions; }
    dispatch(type, payload, options) { return this.#actions.dispatch(type, payload, options); }
    get loaded() { return !!this.#map; }
    load(project, regionIndex) {
      if (this.#history?.executing) throw new Error('Нельзя менять игру внутри экшена.');
      if (!project || project.schemaVersion !== 2 || !(regionIndex instanceof RegionIndex) || !plain(project.map) || typeof project.map.id !== 'string' || !plain(project.map.original)) throw new Error('Некорректный проект ядра.');
      const map = clone(project.map);
      if (map.original.width !== regionIndex.width || map.original.height !== regionIndex.height || typeof map.original.dataURL !== 'string' || !/^data:image\/png;base64,/.test(map.original.dataURL) || !/^data:image\/png;base64,/.test(map.indexImage)) throw new Error('Карта не соответствует индексу.');
      const history = project.history ? History.fromJSON(project.history) : new History({ params: project.params || {}, meta: project.meta || {}, mapId: map.id });
      if (history.mapId !== map.id) throw new Error('История относится к другой карте.');
      for (const off of this.#off) off(); this.#map = freeze(map); this.#regionIndex = regionIndex; this.#history = history; this.#snapshot = history.snapshot();
      this.#off = [history.on('change', event => { this.#snapshot = event.after; this.emit('change', event); }), history.on('history:change', event => this.emit('history:change', event))];
      this.emit('map:loaded', { state: this });
    }
    getMeta(path = []) { const slot = read(this.meta, pathOf(path)); return slot.exists ? slot.value : undefined; }
    updateMeta(path, mutator, options = {}) {
      const keys = pathOf(path);
      return this.#requireHistory().update(draft => {
        const slot = read(draft.meta, keys), value = slot.exists ? clone(slot.value) : {};
        const result = mutator(value); if (result?.then) { result.catch(() => {}); throw new Error('Изменение метаданных должно быть синхронным.'); } draft.meta = write(draft.meta, keys, present(result === undefined ? value : result));
      }, { ...options, actionType: options.actionType || 'core.meta.patch', payload: options.payload || { path: keys } });
    }
    setMeta(path, value, options = {}) { return this.dispatch('core.meta.set', { path: pathOf(path), value }, options); }
    deleteMeta(path, options = {}) { return this.dispatch('core.meta.delete', { path: pathOf(path) }, options); }
    updateParams(mutator, options = {}) { return this.#requireHistory().update(draft => mutator(draft.params), { ...options, source: options.source || 'parameters', actionType: 'core.params.patch' }); }
    #requireHistory() { if (!this.#history) throw new Error('Сначала загрузите игру.'); return this.#history; }
    toJSON() { if (!this.loaded) throw new Error('Игра не загружена.'); return { schemaVersion: 2, map: clone(this.map), regions: this.regionIndex.toJSON(), history: this.history.toJSON(), updatedAt: Date.now() }; }
  }
  const getGameState = () => singleton || (singleton = new GameState(singletonToken));
  const api = { EventBus, Scope, ReadonlyMap, RegionIndex, History, ActionRegistry, GameState, getGameState, diff, clone, equal, freeze, uid };
  root.AtlasCore = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
