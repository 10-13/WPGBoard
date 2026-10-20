/* A view of the resource calculator's provincial potential, without game writes. */
(function (root) {
  'use strict';
  const { resourceKey } = typeof module !== 'undefined' && module.exports ? require('./resources-model.js') : root.AtlasExtensions;
  function resourceColor(index) {
    // Colors belong to encounter slots, not to resource IDs or names.
    if (!Number.isInteger(index) || index < 0) throw new Error('Нужен номер ресурса.');
    const hue = (24 + index * 137.508) % 360, saturation = [62, 68, 58][index % 3], lightness = [58, 62, 54][index % 3];
    return 'hsl(' + hue.toFixed(3) + ' ' + saturation + '% ' + lightness + '%)';
  }
  function resourceRichness(block) {
    const legend = [], resources = new Map(), provinces = new Map();
    for (const group of block.details) {
      const key = resourceKey(group.resource, group.unit);
      if (!group.regions.some(row => row.after1 > 0)) continue;
      if (!resources.has(key)) {
        const item = { key, resource: group.resource, unit: group.unit, color: resourceColor(legend.length), index: legend.length, count: 0 };
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
