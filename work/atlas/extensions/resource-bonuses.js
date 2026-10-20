/* Read-only map view of resource points, including points without production. */
(function (root) {
  'use strict';
  const { readResourceEntry, RESOURCE_BONUSES } =
    typeof module !== 'undefined' && module.exports
      ? require('./resources-model.js')
      : root.AtlasExtensions;
  const { createResourceColorResolver } =
    typeof module !== 'undefined' && module.exports
      ? require('./resource-colors.js')
      : root.AtlasExtensions;
  const { drawProvincePaints } =
    typeof module !== 'undefined' && module.exports
      ? require('../packages/ui/simple-overlay.js')
      : root.AtlasUI;
  const normalized = (value) => value.trim().toLowerCase();
  function collectResourceBonusSources(tiles, index) {
    const points = [],
      resources = new Map(),
      invalid = [];
    for (const [id, tile] of Object.entries(tiles || {}))
      for (const entry of Object.values(tile.entries || {})) {
        if (entry.source !== 'resources' || entry.kind !== 'resource-point') continue;
        try {
          const regionId = Number(id);
          if (!Number.isInteger(regionId) || regionId < 1 || (index && !index.get(regionId)))
            throw new Error('Неизвестная провинция #' + id);
          const config = readResourceEntry(entry);
          points.push({ ...config, regionId });
          if (config.resource !== '*' && !resources.has(normalized(config.resource)))
            resources.set(normalized(config.resource), config.resource);
        } catch (error) {
          invalid.push(String(error.message || error));
        }
      }
    return {
      points,
      resources: [...resources]
        .map(([key, name]) => ({ key, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      invalid,
    };
  }
  function projectResourceBonuses(sources, { type = '', resource = '' } = {}, catalog) {
    if (type && !Object.hasOwn(RESOURCE_BONUSES, type)) throw new Error('Неизвестный тип бонуса.');
    const filter = normalized(resource),
      colorFor = createResourceColorResolver(catalog),
      groups = new Map(),
      byProvince = new Map();
    let pointCount = 0;
    for (const point of sources.points) {
      if (
        filter &&
        normalized(point.resource) !== filter &&
        !(filter !== '*' && point.resource === '*')
      )
        continue;
      const bonuses = type ? point.bonuses.filter((b) => b.type === type) : point.bonuses;
      if (!bonuses.length) continue;
      const key = normalized(point.resource),
        color = colorFor(point.resource);
      if (!groups.has(key))
        groups.set(key, {
          key,
          resource: point.resource,
          color,
          pointCount: 0,
          provinces: new Set(),
        });
      const group = groups.get(key);
      group.pointCount++;
      group.provinces.add(point.regionId);
      pointCount++;
      if (!byProvince.has(point.regionId))
        byProvince.set(point.regionId, { points: [], colors: [] });
      const row = byProvince.get(point.regionId);
      row.points.push({ ...point, bonuses });
      if (!row.colors.includes(color)) row.colors.push(color);
    }
    const legend = [...groups.values()].map(({ provinces, ...group }) => ({
      ...group,
      provinceCount: provinces.size,
    }));
    return { legend, byProvince, pointCount, invalid: sources.invalid };
  }
  function resourceBonusPaint(row) {
    return row?.colors.length ? { color: row.colors, fill: 'hatch', spacing: 3 } : null;
  }
  function drawResourceBonusHatching(context, index, data) {
    drawProvincePaints(
      context,
      index,
      new Map([...data.byProvince].map(([id, row]) => [id, resourceBonusPaint(row)])),
    );
  }
  const api = {
    collectResourceBonusSources,
    projectResourceBonuses,
    resourceBonusPaint,
    drawResourceBonusHatching,
  };
  Object.assign((root.AtlasExtensions ||= {}), api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
