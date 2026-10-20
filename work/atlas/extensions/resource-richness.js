/* A view of provincial potential: fixed resource identity and local intensity. */
(function (root) {
  'use strict';
  const { normalizeOverlayScope } = root.AtlasCore || require('../packages/core/index.js');
  const { ColorScale } =
    typeof module !== 'undefined' && module.exports
      ? require('../packages/ui/color-scale-model.js')
      : root.AtlasUI;
  const { resourceKey } =
    typeof module !== 'undefined' && module.exports
      ? require('./resources-model.js')
      : root.AtlasExtensions;
  const { resourceColor, createResourceColorResolver, resourceShade } =
    typeof module !== 'undefined' && module.exports
      ? require('./resource-colors.js')
      : root.AtlasExtensions;
  function projectResourceRichness(
    data,
    hiddenResources = [],
    provinceIds = data.provinceIds ?? null,
  ) {
    const scopeIds = normalizeOverlayScope(provinceIds),
      scope = scopeIds === null ? null : new Set(scopeIds),
      allProvinces = data.allProvinces || data.provinces,
      allLegend = data.allLegend || data.legend,
      provinces =
        scope === null ? allProvinces : new Map([...allProvinces].filter(([id]) => scope.has(id))),
      hidden = new Set(hiddenResources),
      candidates = allLegend.map((item) => ({
        ...item,
        min: Infinity,
        max: 0,
        producingCount: 0,
        count: 0,
        enabled: !hidden.has(item.key),
      })),
      resources = new Map(candidates.map((item) => [item.key, item])),
      winners = new Map();
    // Normalize within the displayed area, including provinces where this resource loses.
    for (const amounts of provinces.values())
      for (const [key, amount] of amounts) {
        const item = resources.get(key);
        item.min = Math.min(item.min, amount);
        item.max = Math.max(item.max, amount);
        item.producingCount++;
      }
    const legend = candidates.filter((item) => item.producingCount > 0);
    for (const item of legend) {
      item.colorScale = new ColorScale(
        item.min === item.max
          ? [{ value: item.min, color: item.color }]
          : [
              { value: item.min, color: resourceShade(item.color, 0) },
              { value: item.max, color: resourceShade(item.color, 1) },
            ],
      );
      item.scale = item.colorScale.grades().map(({ value, color }) => ({ amount: value, color }));
    }
    for (const [id, amounts] of provinces) {
      let winner = null;
      for (const [key, amount] of amounts) {
        const item = resources.get(key);
        if (!item.enabled) continue;
        if (
          !winner ||
          amount > winner.amount ||
          (amount === winner.amount && item.index < winner.index)
        ) {
          const intensity =
            item.max === item.min ? 0.5 : (amount - item.min) / (item.max - item.min);
          winner = {
            key,
            amount,
            index: item.index,
            color: item.colorScale.color(amount),
            resource: item.resource,
            unit: item.unit,
            intensity,
          };
        }
      }
      if (winner) {
        winners.set(id, winner);
        resources.get(winner.key).count++;
      }
    }
    return { legend, winners, provinces, allLegend, allProvinces, provinceIds: scopeIds };
  }
  function resourceRichness(block, catalog, provinceIds = null) {
    const legend = [],
      resources = new Map(),
      provinces = new Map(),
      colorFor = createResourceColorResolver(catalog);
    for (const group of block.details) {
      const key = resourceKey(group.resource, group.unit);
      if (!group.regions.some((row) => row.after1 > 0)) continue;
      if (!resources.has(key)) {
        const color = colorFor(group.resource),
          item = {
            key,
            resource: group.resource,
            unit: group.unit,
            color,
            darkColor: resourceShade(color, 0),
            lightColor: resourceShade(color, 1),
            index: legend.length,
            count: 0,
            producingCount: 0,
            min: Infinity,
            max: 0,
          };
        resources.set(key, item);
        legend.push(item);
      }
      for (const row of group.regions) {
        if (!(row.after1 > 0)) continue;
        if (!provinces.has(row.regionId)) provinces.set(row.regionId, new Map());
        const amounts = provinces.get(row.regionId),
          amount = (amounts.get(key) || 0) + row.after1;
        if (!Number.isFinite(amount)) throw new Error('Переполнение потенциала ресурса.');
        amounts.set(key, amount);
      }
    }
    return projectResourceRichness({ legend, provinces }, [], provinceIds);
  }
  const api = { resourceColor, resourceRichness, projectResourceRichness };
  Object.assign((root.AtlasExtensions ||= {}), api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
