/* Resource recipes and bonuses are ordinary tile entries, interpreted here. */
(function (root) {
  'use strict';
  const { planResourceFlow } = typeof module !== 'undefined' && module.exports ? require('./resource-flow.js') : root.AtlasExtensions;
  const ACTIVITIES = { extraction: 'Добыча', processing: 'Переработка', production: 'Производство' };
  const BONUSES = {
    'province-flat-total': { label: '4 · Число к итогу провинции', stage: 4 },
    'province-flat-each': { label: '4 · Число каждому производству провинции', stage: 4 },
    'province-percent': { label: '2 · Процент к выпуску провинции', stage: 2, percent: true },
    'production-flat': { label: '3 · Число каждому производству набора', stage: 3 },
    'total-percent': { label: '1 · Процент к общему выпуску набора', stage: 1, percent: true },
    'province-input-flat': { label: '4 · Снижение расхода в провинции числом', stage: 4, efficiency: true },
    'province-input-percent': { label: '2 · Снижение расхода в провинции, %', stage: 2, efficiency: true, percent: true },
    'global-input-flat': { label: '3 · Снижение расхода во всём наборе числом', stage: 3, efficiency: true },
    'global-input-percent': { label: '1 · Снижение расхода во всём наборе, %', stage: 1, efficiency: true, percent: true }
  };
  const KEYS = ['resource.baseOutput', 'resource.bonuses', 'resource.inputs', 'resource.priority'];
  const normalized = text => text.trim().toLowerCase();
  const resourceKey = (resource, unit) => JSON.stringify([normalized(resource), normalized(unit)]);
  const resourceGroupKey = (resource, activity, unit) => JSON.stringify([normalized(resource), activity, normalized(unit)]);
  const nameValid = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit && value.trim() !== '*';
  function readInputs(value) {
    if (!Array.isArray(value) || value.length > 50) throw new Error('Нужен список расходов, до 50 ресурсов.');
    const inputs = new Map();
    for (const input of value) {
      if (!input || !nameValid(input.resource, 80) || !nameValid(input.unit, 40) || typeof input.amount !== 'number' || !Number.isFinite(input.amount) || input.amount < 0) throw new Error('Укажите ресурс, единицу и неотрицательный расход.');
      if (!input.amount) continue;
      const key = resourceKey(input.resource, input.unit), amount = (inputs.get(key)?.amount || 0) + input.amount;
      if (!Number.isFinite(amount)) throw new Error('Переполнение расхода ресурса.');
      inputs.set(key, { key, resource: input.resource.trim(), unit: input.unit.trim(), amount });
    }
    return [...inputs.values()];
  }
  function readResourceEntry(entry) {
    if (entry.source !== 'resources' || !['production', 'resource-point'].includes(entry.kind)) return null;
    const s = entry.stats, config = { id: entry.id, title: entry.title, description: entry.description, kind: entry.kind, resource: s['resource.name'], activity: s['resource.activity'], unit: s['resource.unit'] };
    if (typeof config.resource !== 'string' || !config.resource.trim() || config.resource.length > 80 || typeof config.unit !== 'string' || !config.unit.trim() || config.unit.length > 40 || (!Object.hasOwn(ACTIVITIES, config.activity) && !(entry.kind === 'resource-point' && config.activity === '*'))) throw new Error('Неверный ресурс, единица или вид производства: ' + entry.title);
    if (entry.kind === 'production') {
      config.baseOutput = s['resource.baseOutput']; config.priority = s['resource.priority'] ?? 0; config.inputs = readInputs(s['resource.inputs'] ?? []);
      if (!nameValid(config.resource, 80) || !nameValid(config.unit, 40) || typeof config.baseOutput !== 'number' || !Number.isFinite(config.baseOutput) || config.baseOutput < 0 || (!config.baseOutput && config.inputs.length)) throw new Error('Для рецепта с расходами нужен положительный базовый выпуск: ' + entry.title);
      if (!Number.isInteger(config.priority) || config.priority < 0 || config.priority > 1000000) throw new Error('Приоритет должен быть целым числом от 0 до 1000000.');
    } else {
      config.bonuses = s['resource.bonuses'];
      if (!Array.isArray(config.bonuses) || !config.bonuses.length || config.bonuses.length > 50 || config.bonuses.some(b => !b || !Object.hasOwn(BONUSES, b.type) || typeof b.value !== 'number' || !Number.isFinite(b.value) || b.value < 0)) throw new Error('Нужны корректные баффы (от 1 до 50): ' + entry.title);
      config.bonuses = config.bonuses.map(b => {
        if (!BONUSES[b.type].efficiency) return b;
        const inputResource = b.inputResource ?? '*', inputUnit = b.inputUnit ?? '*';
        if (!(inputResource === '*' || nameValid(inputResource, 80)) || !(inputUnit === '*' || nameValid(inputUnit, 40))) throw new Error('Некорректный фильтр сырья у бонуса эффективности.');
        return { ...b, inputResource: inputResource.trim(), inputUnit: inputUnit.trim() };
      });
    }
    return config;
  }
  const leaf = (id, title, value, unit) => ({ id, title, value, ...(unit ? { unit } : {}) });
  const folder = (id, title, children) => ({ id, title, children });
  const sum = values => { const value = values.reduce((a, b) => a + b, 0); if (!Number.isFinite(value)) throw new Error('Переполнение расчёта ресурсов.'); return value; };
  function collectResourceStats(context) {
    const productions = [], points = [], invalid = [];
    for (const item of context.entries) {
      try { const config = readResourceEntry(item.entry); if (config) (config.kind === 'production' ? productions : points).push({ ...config, regionId: item.regionId, sequence: productions.length }); }
      catch (e) { invalid.push(e.message); }
    }
    const groups = new Map(), commodities = new Map(), details = [], facilities = [], bonusRecords = new Map();
    const commodity = (resource, unit) => { const key = resourceKey(resource, unit); if (!commodities.has(key)) commodities.set(key, { key, resource, unit, base: 0, maximumProduction: 0, maximumConsumption: 0, gross: 0, consumption: 0 }); return commodities.get(key); };
    for (const p of productions) { const key = resourceGroupKey(p.resource, p.activity, p.unit); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(p); commodity(p.resource, p.unit); }
    for (const group of groups.values()) {
      const first = group[0], matched = points.filter(p => (p.resource === '*' || normalized(p.resource) === normalized(first.resource)) && (p.activity === '*' || p.activity === first.activity) && (p.unit === '*' || normalized(p.unit) === normalized(first.unit)));
      const buffs = matched.flatMap(p => p.bonuses.map((b, index) => ({ ...b, regionId: p.regionId, pointId: p.id, title: p.title, index }))), global = type => sum(buffs.filter(b => b.type === type).map(b => b.value)), localRows = [];
      for (const regionId of new Set(group.map(p => p.regionId))) {
        const local = group.filter(p => p.regionId === regionId), base = sum(local.map(p => p.baseOutput)), bonus = type => sum(buffs.filter(b => b.regionId === regionId && b.type === type).map(b => b.value));
        const after4 = base + bonus('province-flat-total') + local.length * bonus('province-flat-each'), after2 = after4 * (1 + bonus('province-percent') / 100), after3 = after2 + local.length * global('production-flat'), after1 = after3 * (1 + global('total-percent') / 100);
        if (![base, after4, after2, after3, after1].every(Number.isFinite)) throw new Error('Переполнение выпуска: ' + first.resource + '. Уменьшите бонусы.');
        localRows.push({ regionId, count: local.length, base, after4, after2, after3, after1 });
        for (const p of local) {
          const share = base ? p.baseOutput / base : 1 / local.length;
          const capacity = ((p.baseOutput + bonus('province-flat-total') * share + bonus('province-flat-each')) * (1 + bonus('province-percent') / 100) + global('production-flat')) * (1 + global('total-percent') / 100);
          const ratio = p.baseOutput ? capacity / p.baseOutput : 0;
          if (!Number.isFinite(capacity) || !Number.isFinite(ratio)) throw new Error('Переполнение мощности предприятия: ' + p.title);
          const inputs = p.inputs.map(input => {
            const matching = buffs.filter(b => BONUSES[b.type].efficiency && (b.type.startsWith('global-') || b.regionId === p.regionId) && (b.inputResource === '*' || normalized(b.inputResource) === normalized(input.resource)) && (b.inputUnit === '*' || normalized(b.inputUnit) === normalized(input.unit)));
            const amount = type => sum(matching.filter(b => b.type === type).map(b => b.value));
            const after4 = Math.max(0, input.amount - amount('province-input-flat')), after2 = after4 * Math.max(0, 1 - amount('province-input-percent') / 100), after3 = Math.max(0, after2 - amount('global-input-flat')), after1 = after3 * Math.max(0, 1 - amount('global-input-percent') / 100);
            return { ...input, baseAmount: input.amount, rawAmount: input.amount * ratio, amount: after1 * ratio, efficiency: { after4, after2, after3, after1 } };
          });
          facilities.push({ ...p, key: resourceKey(p.resource, p.unit), capacity, inputs });
        }
      }
      const key = resourceKey(first.resource, first.unit);
      for (const b of buffs) if (b.type === 'production-flat' || b.type === 'total-percent' || b.type.startsWith('global-') || group.some(p => p.regionId === b.regionId)) {
        const id = JSON.stringify([key, b.regionId, b.pointId, b.index]); if (!bonusRecords.has(id)) bonusRecords.set(id, { ...b, id, key });
      }
      details.push({ resource: first.resource, activity: first.activity, unit: first.unit, base: sum(localRows.map(p => p.base)), total: sum(localRows.map(p => p.after1)), regions: localRows });
    }
    for (const p of facilities) {
      const c = commodity(p.resource, p.unit); c.base = sum([c.base, p.baseOutput]); c.maximumProduction = sum([c.maximumProduction, p.capacity]);
      for (const input of p.inputs) { if (!Number.isFinite(input.amount)) throw new Error('Переполнение расхода: ' + p.title); const c = commodity(input.resource, input.unit); c.maximumConsumption = sum([c.maximumConsumption, input.amount]); }
    }
    const allocation = planResourceFlow(facilities);
    for (const p of allocation) { const c = commodities.get(p.key); c.gross = sum([c.gross, p.actualOutput]); for (const input of p.consumption) { const c = commodities.get(input.key); c.consumption = sum([c.consumption, input.actualAmount]); } }
    const resources = [...commodities.values()].sort((a, b) => a.resource.localeCompare(b.resource, 'ru') || a.unit.localeCompare(b.unit, 'ru'));
    const resourceName = c => resources.some(other => other !== c && normalized(other.resource) === normalized(c.resource)) ? c.resource + ' · ' + c.unit : c.resource;
    for (const c of resources) {
      const residual = c.gross - c.consumption, tolerance = Math.max(c.gross, c.consumption) * 1e-10;
      if (residual < -tolerance) throw new Error('Отрицательный баланс ресурса: ' + c.resource);
      c.net = Math.abs(residual) <= tolerance && c.consumption > 0 ? 0 : Math.max(0, residual);
    }
    const bonusGroups = resources.filter(c => c.maximumProduction > 0 || c.base > 0).map(c => {
      const rows = [...bonusRecords.values()].filter(b => b.key === c.key);
      return folder(c.key, resourceName(c), [leaf('gain', 'Прибавка к максимальному выпуску', c.maximumProduction - c.base, c.unit), ...Object.entries(BONUSES).filter(([type]) => rows.some(b => b.type === type)).map(([type, spec]) => folder(type, spec.label, rows.filter(b => b.type === type).map(b => leaf(b.id, b.title + ' · провинция #' + b.regionId + (spec.efficiency && b.inputResource !== '*' ? ' · сырьё: ' + b.inputResource : ''), b.value, spec.percent ? '%' : spec.efficiency ? b.inputUnit === '*' ? 'ед. сырья' : b.inputUnit : c.unit))))]);
    });
    const facilityRows = allocation.map(p => folder(JSON.stringify([p.regionId, p.id]), p.title + ' · #' + p.regionId, [leaf('priority', 'Приоритет', p.priority), leaf('load', 'Загрузка', p.load * 100, '%'), leaf('output', 'Фактический выпуск', p.actualOutput, p.unit), ...p.consumption.map(input => leaf('input:' + input.key, 'Расход: ' + input.resource, input.actualAmount, input.unit))]));
    // Keep every enterprise and its allocation order; large reports open in pages.
    const facilityTree = folder('facilities', 'Загрузка предприятий · по приоритету', facilityRows);
    if (facilityRows.length > 200) {
      facilityTree.defaultOpen = false; facilityTree.children = [];
      for (let start = 0; start < facilityRows.length; start += 100) facilityTree.children.push({ ...folder('page:' + start, 'Предприятия ' + (start + 1) + '–' + Math.min(start + 100, facilityRows.length), facilityRows.slice(start, start + 100)), defaultOpen: false });
    }
    const children = [
      ...resources.filter(c => c.net > 0).map(c => leaf(c.key, c.resource, c.net, c.unit)),
      folder('gross', 'Грязное производство', [
        ...resources.filter(c => c.maximumProduction > 0 || c.base > 0).map(c => leaf(c.key, resourceName(c), c.gross, c.unit)),
        facilityTree
      ]),
      folder('potential', 'Потенциал', resources.map(c => folder(c.key, resourceName(c), [leaf('production', 'Общее максимальное производство', c.maximumProduction, c.unit), leaf('consumption', 'Общее максимальное потребление', c.maximumConsumption, c.unit)]))),
      folder('bonuses', 'Бонусы', [folder('base', 'Базовое производство', resources.filter(c => c.maximumProduction > 0 || c.base > 0).map(c => leaf(c.key, resourceName(c), c.base, c.unit))), folder('applied', 'Бонусы', bonusGroups)])
    ];
    if (invalid.length) children.push(leaf('invalid', 'Некорректные записи пропущены', invalid));
    return { children, details, resources, allocation, bonusOrder: [4, 2, 3, 1], invalid };
  }
  class ResourceModel {
    constructor(state) { this.state = state; }
    list(regionId) { return this.state.tileMetadata.list(regionId).filter(e => e.source === 'resources' && ['production', 'resource-point'].includes(e.kind)); }
    save(regionId, config) {
      const original = config.id ? this.state.tileMetadata.get(regionId, config.id) : null; if (original && original.source !== 'resources') throw new Error('Эта запись принадлежит другому модулю.');
      const stats = { ...(original?.stats || {}), 'resource.name': String(config.resource || '').trim() || (config.kind === 'resource-point' ? '*' : ''), 'resource.activity': config.activity, 'resource.unit': String(config.unit || '').trim() || (config.kind === 'resource-point' ? '*' : 'ед./ход') };
      if (config.kind === 'production') {
        stats['resource.baseOutput'] = config.baseOutput; stats['resource.inputs'] = config.inputs ?? original?.stats['resource.inputs'] ?? []; stats['resource.priority'] = config.priority ?? original?.stats['resource.priority'] ?? 0; delete stats['resource.bonuses'];
      } else { stats['resource.bonuses'] = config.bonuses; delete stats['resource.baseOutput']; delete stats['resource.inputs']; delete stats['resource.priority']; }
      const value = { id: config.id, title: config.title, description: config.description || '', stats, kind: config.kind, source: 'resources' }; if (!['production', 'resource-point'].includes(config.kind)) throw new Error('Неизвестный вид объекта.'); readResourceEntry(value);
      return this.state.tileMetadata.save(regionId, value, { label: (config.kind === 'production' ? 'Производство: ' : 'Ресурсная точка: ') + config.title });
    }
    remove(regionId, id) { const entry = this.state.tileMetadata.get(regionId, id); if (!entry || entry.source !== 'resources') throw new Error('Объект не найден.'); return this.state.tileMetadata.remove(regionId, id, { source: 'resources', label: 'Удаление: ' + entry.title }); }
    registerStatistics(signal) { return this.state.statistics.register('resources', { title: 'Ресурсы · чистый выпуск', keys: KEYS, collect: collectResourceStats }, { signal }); }
  }
  const api = { ResourceModel, readResourceEntry, collectResourceStats, resourceKey, resourceGroupKey, RESOURCE_ACTIVITIES: ACTIVITIES, RESOURCE_BONUSES: BONUSES };
  Object.assign(root.AtlasExtensions ||= {}, api); if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
