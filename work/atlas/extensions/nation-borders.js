/* Derived nation border masks. No game state, history or UI dependencies. */
(function (root) {
  'use strict';
  const validColor = (color) => /^#[\da-f]{6}$/i.test(color);
  const { isAtWar } = root.AtlasExtensions;
  const WAR_BORDER_COLOR = '#ff3b30';
  const darkenColor = (color) =>
    validColor(color)
      ? '#' +
        [1, 3, 5]
          .map((i) =>
            Math.round(parseInt(color.slice(i, i + 2), 16) * 0.5)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')
      : null;
  class NationBorders {
    constructor(index, rgba) {
      const { width, height } = index,
        total = width * height;
      if (rgba.length !== total * 4)
        throw new Error('Размер изображения границ не совпадает с индексом.');
      this.width = width;
      this.groups = [];
      this.byRegion = new Map();
      const ink = new Uint8Array(total),
        groups = new Map();
      for (let p = 0; p < total; p++) {
        const i = p * 4;
        ink[p] = rgba[i + 3] > 128 && Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) <= 48 ? 1 : 0;
      }
      const directions = [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
      ];
      for (let p = 0; p < total; p++) {
        if (!ink[p]) continue;
        const x = p % width,
          y = Math.floor(p / width);
        if (index.idAt(x, y)) continue;
        const distances = new Map();
        let exterior = false;
        // Stop each ray at the first area it reaches: never jump over water or
        // a narrow province. Four pixels cover the source map's raster strokes.
        for (const [dx, dy] of directions) {
          for (let distance = 1; distance <= 4; distance++) {
            const xx = x + dx * distance,
              yy = y + dy * distance;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) {
              exterior = true;
              break;
            }
            const id = index.idAt(xx, yy);
            if (id) {
              distances.set(id, Math.min(distances.get(id) || Infinity, distance));
              break;
            }
            if (!ink[yy * width + xx]) {
              exterior = true;
              break;
            }
          }
          if (exterior) break;
        }
        if (exterior || distances.size < 2) continue;
        // A ray parallel to a stroke may see a distant junction. Only the two
        // nearest areas and ties belong to this pixel's local border.
        const limit = [...distances.values()].sort((a, b) => a - b)[1];
        const regions = [...distances]
            .filter(([, distance]) => distance <= limit)
            .map(([id]) => id)
            .sort((a, b) => a - b),
          key = regions.join(',');
        let group = groups.get(key);
        if (!group) {
          group = { regions, runs: [] };
          groups.set(key, group);
        }
        const runs = group.runs,
          n = runs.length;
        if (n && runs[n - 2] + runs[n - 1] === p && x > 0) runs[n - 1]++;
        else runs.push(p, 1);
      }
      for (const group of groups.values()) {
        group.runs = new Uint32Array(group.runs);
        this.groups.push(group);
        for (const id of group.regions) {
          if (!this.byRegion.has(id)) this.byRegion.set(id, new Set());
          this.byRegion.get(id).add(group);
        }
      }
    }
    redraw(context, nations, changedIds = null) {
      const groups = changedIds
        ? new Set([...changedIds].flatMap((id) => [...(this.byRegion.get(Number(id)) || [])]))
        : this.groups;
      for (const group of groups) {
        const owner = nations.owners?.[group.regions[0]],
          owners = [...new Set(group.regions.map((id) => nations.owners?.[id]).filter(Boolean))];
        const war = owners.some((a, i) => owners.slice(i + 1).some((b) => isAtWar(nations, a, b)));
        const color = war
          ? WAR_BORDER_COLOR
          : owner && group.regions.every((id) => nations.owners?.[id] === owner)
            ? darkenColor(nations.items?.[owner]?.color)
            : null;
        if (color) context.fillStyle = color;
        for (let i = 0; i < group.runs.length; i += 2) {
          const start = group.runs[i],
            length = group.runs[i + 1],
            x = start % this.width,
            y = Math.floor(start / this.width);
          if (color) context.fillRect(x, y, length, 1);
          else context.clearRect(x, y, length, 1);
        }
      }
    }
  }
  Object.assign((root.AtlasExtensions ||= {}), { NationBorders, darkenColor, WAR_BORDER_COLOR });
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { NationBorders, darkenColor, WAR_BORDER_COLOR };
})(globalThis);
