/* Headless blueprint catalog and resource costs. Capacity belongs to enterprises. */
(function (root) {
  'use strict';
  const { clone, freeze, uid } = typeof module !== 'undefined' && module.exports ? require('../packages/core/index.js') : root.AtlasCore;
  const { DEFAULT_RESOURCE_CATALOG } = typeof module !== 'undefined' && module.exports ? require('./resource-catalog-data.js') : root.AtlasExtensions;
  const { resourceColor } = typeof module !== 'undefined' && module.exports ? require('./resource-colors.js') : root.AtlasExtensions;
  const own = (o, k) => Object.hasOwn(o, k), safe = id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id) && !['__proto__', 'prototype', 'constructor'].includes(id);
  const text = (value, length) => typeof value === 'string' && value.trim().length > 0 && value.length <= length;
  function validateCatalog(data) {
    if (!data || data.version !== 1 || !data.resources || !data.recipes || Array.isArray(data.resources) || Array.isArray(data.recipes) || Object.keys(data.resources).length > 200 || Object.keys(data.recipes).length > 400) throw new Error('Некорректный каталог ресурсов.');
    const names = new Set();
    for (const [id, r] of Object.entries(data.resources)) {
      if (!safe(id) || r?.id !== id || !text(r.name, 80) || !text(r.unit, 40) || !text(r.category, 80) || !['raw', 'product'].includes(r.kind) || typeof r.description !== 'string' || r.description.length > 4000) throw new Error('Укажите название, единицу, категорию и тип ресурса.');
      const name = r.name.trim().toLowerCase(); if (names.has(name)) throw new Error('Названия ресурсов должны быть уникальны.'); names.add(name);
    }
    for (const [id, recipe] of Object.entries(data.recipes)) {
      if (!safe(id) || recipe?.id !== id || !text(recipe.name, 100) || typeof recipe.description !== 'string' || recipe.description.length > 4000) throw new Error('Укажите название чертежа.');
      for (const side of ['inputs', 'outputs']) {
        const rows = recipe[side]; if (!Array.isArray(rows) || rows.length > 50 || (side === 'outputs' && !rows.length)) throw new Error('У чертежа должен быть выход; на каждой стороне — до 50 элементов.');
        const seen = new Set();
        for (const row of rows) {
          if (!row || !own(data.resources, row.resourceId) || typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0) throw new Error('Укажите существующий ресурс и положительный объём.');
          if (seen.has(row.resourceId)) throw new Error('Объедините повторяющиеся ресурсы на одной стороне чертежа.'); seen.add(row.resourceId);
        }
      }
    }
    return data;
  }
  function calculateBlueprintCost(data, resourceId, amount = 1, { recipes: choices = {}, maxNodes = 2000 } = {}) {
    validateCatalog(data);
    if (!own(data.resources, resourceId) || !Number.isFinite(amount) || amount <= 0) throw new Error('Выберите ресурс и положительный объём выпуска.');
    if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 10000) throw new Error('Некорректное ограничение дерева.');
    let remaining = maxNodes;
    const producers = id => Object.values(data.recipes).filter(r => r.outputs.some(o => o.resourceId === id));
    const add = (map, id, value) => { const total = (map.get(id) || 0) + value; if (!Number.isFinite(total)) throw new Error('Слишком большой объём расчёта.'); map.set(id, total); };
    const rows = map => [...map].map(([resourceId, amount]) => ({ resourceId, amount }));
    const expand = (id, quantity, path) => {
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Слишком большой или малый объём расчёта.');
      const resource = data.resources[id], variants = producers(id), node = { resourceId: id, amount: quantity, recipeId: null, status: 'raw', inputs: [], outputs: [], raw: [], unresolved: [], complete: true };
      const chosen = own(choices, id) ? choices[id] : resource.kind === 'raw' ? null : variants[0]?.id;
      if (chosen === null && resource.kind === 'raw') { node.raw = [{ resourceId: id, amount: quantity }]; return node; }
      const recipe = variants.find(r => r.id === chosen);
      node.recipeId = recipe?.id || null;
      const problem = !recipe ? 'missing' : path.includes(id) ? 'cycle' : remaining <= 0 || path.length >= 32 ? 'limit' : null;
      if (problem) { node.status = problem; node.complete = false; node.unresolved = [{ resourceId: id, amount: quantity }]; return node; }
      remaining--; node.status = 'recipe';
      node.batches = quantity / recipe.outputs.find(o => o.resourceId === id).amount;
      node.outputs = recipe.outputs.map(o => ({ resourceId: o.resourceId, amount: o.amount * node.batches }));
      if (!Number.isFinite(node.batches) || node.outputs.some(o => !Number.isFinite(o.amount))) throw new Error('Слишком большой объём расчёта.');
      node.inputs = recipe.inputs.map(input => expand(input.resourceId, input.amount * node.batches, [...path, id]));
      const raw = new Map(), unresolved = new Map();
      for (const child of node.inputs) { for (const row of child.raw) add(raw, row.resourceId, row.amount); for (const row of child.unresolved) add(unresolved, row.resourceId, row.amount); }
      node.raw = rows(raw); node.unresolved = rows(unresolved); node.complete = node.inputs.every(n => n.complete); return node;
    };
    return freeze(expand(resourceId, amount, []));
  }
  class ResourceCatalog {
    constructor(state) { this.state = state; }
    get data() { return this.state.meta.resources?.catalog || DEFAULT_RESOURCE_CATALOG; }
    color(resource) { return resourceColor(resource, this.data); }
    recipesFor(id) { return Object.values(this.data.recipes).filter(r => r.outputs.some(o => o.resourceId === id)); }
    registerActions(signal) {
      const catalog = draft => { draft.meta.resources ||= {}; return draft.meta.resources.catalog ||= clone(DEFAULT_RESOURCE_CATALOG); };
      const register = (suffix, reduce) => this.state.actions.register('resources.catalog.' + suffix, { reduce(draft, payload) { const data = catalog(draft); reduce(data, payload); validateCatalog(data); } }, { signal });
      register('resource.save', (data, p) => { if (!safe(p.id)) throw new Error('Некорректный ID ресурса.'); data.resources[p.id] = p; });
      register('resource.remove', (data, { id }) => {
        if (!own(data.resources, id)) throw new Error('Ресурс не найден.');
        if (Object.values(data.recipes).some(r => [...r.inputs, ...r.outputs].some(row => row.resourceId === id))) throw new Error('Ресурс используется в чертежах. Сначала измените или удалите их.'); delete data.resources[id];
      });
      register('recipe.save', (data, p) => { if (!safe(p.id)) throw new Error('Некорректный ID чертежа.'); data.recipes[p.id] = p; });
      register('recipe.remove', (data, { id }) => { if (!own(data.recipes, id)) throw new Error('Чертёж не найден.'); delete data.recipes[id]; });
    }
    saveResource({ id = uid('good'), name, category, unit = 'ед.', kind = 'product', description = '' }) {
      this.state.dispatch('resources.catalog.resource.save', { id, name: name.trim(), category: category.trim(), unit: unit.trim(), kind, description }, { source: 'resources', label: 'Ресурс: ' + name }); return id;
    }
    saveRecipe({ id = uid('blueprint'), name, description = '', inputs = [], outputs }) {
      this.state.dispatch('resources.catalog.recipe.save', { id, name: name.trim(), description, inputs, outputs }, { source: 'resources', label: 'Чертёж: ' + name }); return id;
    }
    removeResource(id) { return this.state.dispatch('resources.catalog.resource.remove', { id }, { source: 'resources', label: 'Удаление ресурса' }); }
    removeRecipe(id) { return this.state.dispatch('resources.catalog.recipe.remove', { id }, { source: 'resources', label: 'Удаление чертежа' }); }
    cost(resourceId, amount = 1, options) { return calculateBlueprintCost(this.data, resourceId, amount, options); }
  }
  const api = { ResourceCatalog, calculateBlueprintCost, validateCatalog };
  Object.assign(root.AtlasExtensions ||= {}, api); if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
