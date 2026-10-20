/* A view of the resource calculator's provincial potential, without game writes. */
(function (root) {
  'use strict';
  const { resourceKey } = typeof module !== 'undefined' && module.exports ? require('./resources-model.js') : root.AtlasExtensions;
  const { resourceColor, createResourceColorResolver } = typeof module !== 'undefined' && module.exports ? require('./resource-colors.js') : root.AtlasExtensions;
  function resourceRichness(block, catalog) {
    const legend = [], resources = new Map(), provinces = new Map(), colorFor = createResourceColorResolver(catalog);
    for (const group of block.details) {
      const key = resourceKey(group.resource, group.unit);
      if (!group.regions.some(row => row.after1 > 0)) continue;
      if (!resources.has(key)) {
        const item = { key, resource: group.resource, unit: group.unit, color: colorFor(group.resource), index: legend.length, count: 0 };
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
    const winners = new Map();
    for (const [id, amounts] of provinces) {
      let winner = null;
      for (const [key, amount] of amounts) {
        const item = resources.get(key);
        if (!winner || amount > winner.amount || amount === winner.amount && item.index < winner.index) winner = { key, amount, index: item.index, color: item.color, resource: item.resource, unit: item.unit };
      }
      if (winner) { winners.set(id, winner); resources.get(winner.key).count++; }
    }
    return { legend, winners };
  }
  const api = { resourceColor, resourceRichness };
  Object.assign(root.AtlasExtensions ||= {}, api); if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
