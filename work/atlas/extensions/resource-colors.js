/* Static visual identity, shared by catalog, map fills and object markers. */
(function (root) {
  'use strict';
  const { DEFAULT_RESOURCE_CATALOG } = typeof module !== 'undefined' && module.exports ? require('./resource-catalog-data.js') : root.AtlasExtensions;
  const RESOURCE_COLORS = Object.freeze({
    coal: '#444b5a', 'iron-ore': '#bd7453', oil: '#71607c', rubber: '#58bfa6', bauxite: '#d9986d',
    'alloy-ore': '#a391cf', 'tungsten-ore': '#8fa8bd', helium: '#bce6e8', cotton: '#e7b8d5',
    timber: '#63a674', grain: '#e4c65a', water: '#4fa3e3', iron: '#a2aebc', steel: '#738fa8',
    'alloy-steel': '#9f94c7', aluminium: '#c4d3e2', tungsten: '#b3b9ad', fuel: '#ef9252',
    avgas: '#f3b75b', hydrogen: '#8cd4ee', energy: '#f1de65', fabric: '#bd8eb8', lumber: '#bb9867',
    food: '#b6c96d', parts: '#63bdc6', tools: '#d68c7e', ammunition: '#d0aa4e', airframe: '#92afd7',
    armor: '#829878', airship: '#a8bfd1'
  });
  const GENERAL_RESOURCE_COLOR = '#ffffff';
  const normalized = text => String(text).trim().toLowerCase();
  function customColor(key) {
    let hash = 2166136261; for (const char of key) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
    const hue = (hash >>> 0) % 360 / 60, saturation = .58, lightness = .62;
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation, x = chroma * (1 - Math.abs(hue % 2 - 1)), m = lightness - chroma / 2;
    const rgb = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
    return '#' + rgb.map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  }
  function createResourceColorResolver(catalog = DEFAULT_RESOURCE_CATALOG) {
    const byName = new Map(), byId = new Map();
    for (const data of [DEFAULT_RESOURCE_CATALOG, catalog]) for (const resource of Object.values(data.resources)) {
      byName.set(normalized(resource.name), resource.id); byId.set(resource.id, resource);
    }
    return resource => {
      const value = typeof resource === 'object' && resource ? resource.id : String(resource), name = normalized(value);
      if (name === '*') return GENERAL_RESOURCE_COLOR;
      const id = byId.has(value) ? value : byName.get(name);
      return id && Object.hasOwn(RESOURCE_COLORS, id) ? RESOURCE_COLORS[id] : customColor(id ? 'id:' + id : 'name:' + name);
    };
  }
  const resourceColor = (resource, catalog) => createResourceColorResolver(catalog)(resource);
  const api = { RESOURCE_COLORS, GENERAL_RESOURCE_COLOR, createResourceColorResolver, resourceColor };
  Object.assign(root.AtlasExtensions ||= {}, api); if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
