/* A view of provincial potential: fixed resource identity and local intensity. */
(function (root) {
  'use strict';
  const { resourceKey } = typeof module !== 'undefined' && module.exports ? require('./resources-model.js') : root.AtlasExtensions;
  const { resourceColor, createResourceColorResolver, resourceShade } = typeof module !== 'undefined' && module.exports ? require('./resource-colors.js') : root.AtlasExtensions;
  function projectResourceRichness(data, hiddenResources = []) {
    const hidden = new Set(hiddenResources), legend = data.legend.map(item => ({ ...item, count: 0, enabled: !hidden.has(item.key) })), resources = new Map(legend.map(item => [item.key, item])), winners = new Map();
    for (const [id, amounts] of data.provinces) {
      let winner = null;
      for (const [key, amount] of amounts) {
        const item = resources.get(key); if (!item.enabled) continue;
        if (!winner || amount > winner.amount || amount === winner.amount && item.index < winner.index) {
          const intensity = item.max === item.min ? .5 : (amount - item.min) / (item.max - item.min);
          winner = { key, amount, index: item.index, color: item.max === item.min ? item.color : resourceShade(item.color, intensity), resource: item.resource, unit: item.unit, intensity };
        }
      }
      if (winner) { winners.set(id, winner); resources.get(winner.key).count++; }
    }
    return { legend, winners, provinces: data.provinces };
  }
  function resourceRichness(block, catalog) {
    const legend = [], resources = new Map(), provinces = new Map(), colorFor = createResourceColorResolver(catalog);
    for (const group of block.details) {
      const key = resourceKey(group.resource, group.unit);
      if (!group.regions.some(row => row.after1 > 0)) continue;
      if (!resources.has(key)) {
        const color = colorFor(group.resource), item = { key, resource: group.resource, unit: group.unit, color, darkColor: resourceShade(color, 0), lightColor: resourceShade(color, 1), index: legend.length, count: 0, producingCount: 0, min: Infinity, max: 0 };
        resources.set(key, item); legend.push(item);
      }
      for (const row of group.regions) {
        if (!(row.after1 > 0)) continue;
        if (!provinces.has(row.regionId)) provinces.set(row.regionId, new Map());
        const amounts = provinces.get(row.regionId), amount = (amounts.get(key) || 0) + row.after1;
        if (!Number.isFinite(amount)) throw new Error('Переполнение потенциала ресурса.');
        amounts.set(key, amount);
      }
    }
    // Bounds use all producing provinces, even where another resource dominates.
    for (const amounts of provinces.values()) for (const [key, amount] of amounts) {
      const item = resources.get(key); item.min = Math.min(item.min, amount); item.max = Math.max(item.max, amount); item.producingCount++;
    }
    for (const item of legend) item.scale = item.min === item.max ? [{ amount: item.min, color: item.color }] : [0, .25, .5, .75, 1].map(t => ({ amount: item.min + (item.max - item.min) * t, color: resourceShade(item.color, t) }));
    return projectResourceRichness({ legend, provinces });
  }
  const api = { resourceColor, resourceRichness, projectResourceRichness };
  Object.assign(root.AtlasExtensions ||= {}, api); if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
