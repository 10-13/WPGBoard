/* Derived outlines and label anchors for named regions. No game state or rendering APIs. */
(function (root) {
  'use strict';
  class RegionGeometry {
    #index;
    #ink;
    #gaps = new Map();
    constructor(index, rgba) {
      this.#index = index;
      this.width = index.width;
      this.height = index.height;
      if (rgba.length !== this.width * this.height * 4)
        throw new Error('Размер изображения не совпадает с индексом регионов.');
      this.#ink = new Uint8Array(this.width * this.height);
      for (let p = 0; p < this.#ink.length; p++) {
        const i = p * 4;
        this.#ink[p] =
          rgba[i + 3] > 128 && Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) <= 48 ? 1 : 0;
      }
    }
    #gap(x, y) {
      const p = y * this.width + x;
      if (this.#gaps.has(p)) return this.#gaps.get(p);
      const distances = new Map();
      let exterior = !this.#ink[p];
      if (!exterior)
        for (const [dx, dy] of [
          [-1, -1],
          [0, -1],
          [1, -1],
          [-1, 0],
          [1, 0],
          [-1, 1],
          [0, 1],
          [1, 1],
        ]) {
          for (let distance = 1; distance <= 4; distance++) {
            const xx = x + dx * distance,
              yy = y + dy * distance;
            if (xx < 0 || yy < 0 || xx >= this.width || yy >= this.height) {
              exterior = true;
              break;
            }
            const id = this.#index.idAt(xx, yy);
            if (id) {
              distances.set(id, Math.min(distances.get(id) || Infinity, distance));
              break;
            }
            // Never join shores across even a one-pixel strip of water.
            if (!this.#ink[yy * this.width + xx]) {
              exterior = true;
              break;
            }
          }
          if (exterior) break;
        }
      const limit = [...distances.values()].sort((a, b) => a - b)[1] ?? Infinity;
      const result = {
        exterior,
        ids: [...distances].filter(([, distance]) => distance <= limit).map(([id]) => id),
      };
      this.#gaps.set(p, result);
      return result;
    }
    build(data) {
      const assignments = new Map(),
        members = new Map(),
        items = data?.items || {};
      for (const [provinceId, regionId] of Object.entries(data?.assignments || {})) {
        const id = Number(provinceId);
        if (!Object.hasOwn(items, regionId) || !this.#index.get(id)) continue;
        assignments.set(id, regionId);
        if (!members.has(regionId)) members.set(regionId, []);
        members.get(regionId).push(id);
      }
      const result = [];
      for (const [id, provinceIds] of members) {
        const points = [],
          sourceRuns = [];
        let area = 0,
          sumX = 0,
          sumY = 0;
        for (const provinceId of provinceIds)
          this.#index.forEachRun(provinceId, (start, length) => {
            const x = start % this.width,
              y = Math.floor(start / this.width);
            sourceRuns.push(start, length);
            area += length;
            sumX += ((2 * x + length - 1) * length) / 2;
            sumY += y * length;
            for (let xx = x; xx < x + length; xx++) {
              let edge = false;
              for (const [dx, dy] of [
                [-1, 0],
                [1, 0],
                [0, -1],
                [0, 1],
              ]) {
                const nx = xx + dx,
                  ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) {
                  edge = true;
                  break;
                }
                const neighbor = this.#index.idAt(nx, ny);
                if (neighbor) {
                  if (assignments.get(neighbor) !== id) {
                    edge = true;
                    break;
                  }
                } else {
                  const gap = this.#gap(nx, ny);
                  if (
                    gap.exterior ||
                    gap.ids.length < 2 ||
                    gap.ids.some((neighborId) => assignments.get(neighborId) !== id)
                  ) {
                    edge = true;
                    break;
                  }
                }
              }
              if (edge) points.push(y * this.width + xx);
            }
          });
        // The centroid can fall in a lake or between islands. Snap to real member pixels.
        const cx = sumX / area,
          cy = sumY / area;
        let anchor = null,
          best = Infinity;
        for (let i = 0; i < sourceRuns.length; i += 2) {
          const start = sourceRuns[i],
            length = sourceRuns[i + 1],
            y = Math.floor(start / this.width),
            left = start % this.width;
          const x = Math.max(left, Math.min(left + length - 1, Math.round(cx))),
            distance = (x - cx) ** 2 + (y - cy) ** 2;
          if (distance < best) {
            best = distance;
            anchor = [x, y];
          }
        }
        points.sort((a, b) => a - b);
        const runs = [];
        for (const p of points) {
          const n = runs.length;
          if (n && runs[n - 2] + runs[n - 1] === p && p % this.width) runs[n - 1]++;
          else runs.push(p, 1);
        }
        result.push({
          id,
          name: String(items[id].name || id),
          area,
          anchor,
          runs: new Uint32Array(runs),
        });
      }
      return result;
    }
  }
  function wrapRegionName(name, measure, maxWidth) {
    const lines = [];
    let line = '';
    for (const word of String(name).split(/\s+/u).filter(Boolean)) {
      if (line && measure(line + ' ' + word) <= maxWidth) {
        line += ' ' + word;
        continue;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      for (const character of word) {
        if (line && measure(line + character) > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  Object.assign((root.AtlasExtensions ||= {}), { RegionGeometry, wrapRegionName });
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { RegionGeometry, wrapRegionName };
})(globalThis);
