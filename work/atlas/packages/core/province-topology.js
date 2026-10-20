/* Read-only province adjacency derived from labels and the original raster. */
(function (root) {
  'use strict';
  class ProvinceTopology {
    #neighbors = new Map();
    #exterior = new Set();
    constructor(index, rgba) {
      const { width, height } = index,
        total = width * height;
      if (!rgba || rgba.length !== total * 4)
        throw new Error('Размер изображения не совпадает с индексом провинций.');
      for (const id of index.regions.keys()) this.#neighbors.set(id, new Set());
      const ink = new Uint8Array(total);
      const cardinal = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ];
      for (let p = 0; p < total; p++) {
        const i = p * 4;
        ink[p] = rgba[i + 3] > 128 && Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) <= 48 ? 1 : 0;
      }
      const connect = (a, b) => {
        if (a && b && a !== b) {
          this.#neighbors.get(a).add(b);
          this.#neighbors.get(b).add(a);
        }
      };
      const ray = (x, y, dx, dy) => {
        for (let distance = 1; distance <= 4; distance++) {
          const xx = x + dx * distance,
            yy = y + dy * distance;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) return { exterior: true };
          const id = index.idAt(xx, yy);
          if (id) return { id };
          if (!ink[yy * width + xx]) return { exterior: true }; // Never cross water.
        }
        return {};
      };
      for (let p = 0; p < total; p++) {
        const x = p % width,
          y = Math.floor(p / width),
          id = index.idAt(x, y);
        if (id) {
          for (const [dx, dy] of cardinal) {
            const xx = x + dx,
              yy = y + dy,
              other = index.idAt(xx, yy);
            if (other) {
              if (dx === 1 || dy === 1) connect(id, other);
            } else if (xx < 0 || yy < 0 || xx >= width || yy >= height || !ink[yy * width + xx])
              this.#exterior.add(id);
          }
        } else if (ink[p]) {
          // Opposing cardinal rays find a shared border, not a diagonal corner.
          // Black strokes have no province ID; bridge ink only, up to four pixels.
          for (const [a, b] of [
            [ray(x, y, -1, 0), ray(x, y, 1, 0)],
            [ray(x, y, 0, -1), ray(x, y, 0, 1)],
          ]) {
            connect(a.id, b.id);
            if (a.id && b.exterior) this.#exterior.add(a.id);
            if (b.id && a.exterior) this.#exterior.add(b.id);
          }
        }
      }
      Object.freeze(this);
    }
    #valid(ids) {
      return new Set([...ids].filter((id) => this.#neighbors.has(id)));
    }
    neighborsOf(id) {
      return Object.freeze([...(this.#neighbors.get(id) || [])].sort((a, b) => a - b));
    }
    touchesExterior(id) {
      return this.#exterior.has(id);
    }
    neighbors(ids) {
      const selected = this.#valid(ids),
        result = new Set();
      for (const id of selected)
        for (const neighbor of this.#neighbors.get(id))
          if (!selected.has(neighbor)) result.add(neighbor);
      return Object.freeze([...result].sort((a, b) => a - b));
    }
    expand(ids) {
      const selected = this.#valid(ids);
      return Object.freeze(
        [...new Set([...selected, ...this.neighbors(selected)])].sort((a, b) => a - b),
      );
    }
    erode(ids) {
      const selected = this.#valid(ids);
      return Object.freeze(
        [...selected]
          .filter(
            (id) =>
              !this.#exterior.has(id) &&
              [...this.#neighbors.get(id)].every((neighbor) => selected.has(neighbor)),
          )
          .sort((a, b) => a - b),
      );
    }
  }
  root.AtlasTopologyCore = { ProvinceTopology };
  if (typeof module !== 'undefined' && module.exports) module.exports = { ProvinceTopology };
})(globalThis);
