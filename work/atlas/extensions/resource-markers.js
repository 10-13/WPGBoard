/* Two pixel blocks: one pixel per enterprise/bonus, fully contained by its province. */
(function (root) {
  'use strict';
  const { createResourceColorResolver } = typeof module !== 'undefined' && module.exports ? require('./resource-colors.js') : root.AtlasExtensions;
  const RESOURCE_MARKER_FRAME_COLOR = '#101c22', placements = new WeakMap();
  function groupByColor(entries, colorFor) {
    const groups = new Map();
    for (const entry of entries) {
      const color = colorFor(entry.stats['resource.name']);
      if (!groups.has(color)) groups.set(color, []);
      groups.get(color).push({ id: entry.id, kind: entry.kind, resource: entry.stats['resource.name'], color });
    }
    return [...groups.values()].flat();
  }
  function rectangles(count) {
    if (!count) return [{ width: 0, height: 0 }];
    const result = [];
    // Exact factors keep every cell meaningful: no padding pixels or lost objects.
    for (let width = 1; width <= count; width++) if (count % width === 0) result.push({ width, height: count / width });
    return result;
  }
  function nearestPlacement(index, region, width, height) {
    let cache = placements.get(index); if (!cache) placements.set(index, cache = new Map());
    const key = region.id + ':' + width + ':' + height;
    if (cache.has(key)) return cache.get(key);
    const [bx, by, bw, bh] = region.bbox;
    const cx = region.anchor[0] + .5 - width / 2, cy = region.anchor[1] + .5 - height / 2;
    const x = Math.max(bx, Math.min(bx + bw - width, Math.round(cx))), y = Math.max(by, Math.min(by + bh - height, Math.round(cy)));
    let fits = true;
    for (let yy = y; fits && yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) if (index.idAt(xx, yy) !== region.id) { fits = false; break; }
    if (fits) { const result = [x, y]; cache.set(key, result); return result; }
    // Scan the actual mask, including holes and disconnected parts. Column heights
    // find full rectangles in O(bbox area), without allocating a bbox-sized bitmap.
    const heights = new Uint32Array(bw); let best = null, distance = Infinity;
    for (let yy = by; yy < by + bh; yy++) {
      let run = 0;
      for (let xx = 0; xx < bw; xx++) {
        heights[xx] = index.idAt(bx + xx, yy) === region.id ? heights[xx] + 1 : 0;
        run = heights[xx] >= height ? run + 1 : 0;
        if (run < width) continue;
        const left = bx + xx - width + 1, top = yy - height + 1, d = (left - cx) ** 2 + (top - cy) ** 2;
        if (d < distance) { best = [left, top]; distance = d; }
      }
    }
    cache.set(key, best); return best;
  }
  function layoutResourceMarkers(index, region, entries, colorFor = createResourceColorResolver()) {
    const objects = entries.filter(e => e.source === 'resources' && ['production', 'resource-point'].includes(e.kind) && typeof e.stats?.['resource.name'] === 'string' && e.stats['resource.name'].trim());
    const production = groupByColor(objects.filter(e => e.kind === 'production'), colorFor), bonuses = groupByColor(objects.filter(e => e.kind === 'resource-point'), colorFor);
    const empty = { bounds: null, blocks: [], pixels: [], count: objects.length };
    if (!objects.length) return empty;
    const [, , bw, bh] = region.bbox, gap = production.length && bonuses.length ? 1 : 0, candidates = [];
    for (const p of rectangles(production.length)) for (const b of rectangles(bonuses.length)) {
      const width = Math.max(p.width, b.width) + 2, height = p.height + (production.length ? 2 : 0) + gap + b.height + (bonuses.length ? 2 : 0);
      if (width <= bw && height <= bh) candidates.push({ p, b, width, height, score: Math.abs(Math.log(Math.max(p.width, b.width) / (p.height + gap + b.height) / (bw / bh))) });
    }
    // Decorative frames affect fitting, while the approved pixel layout keeps its proportions.
    candidates.sort((a, b) => a.score - b.score || a.width * a.height - b.width * b.height || a.width - b.width);
    for (const candidate of candidates) {
      const position = nearestPlacement(index, region, candidate.width, candidate.height); if (!position) continue;
      const [x, y] = position, blocks = [], pixels = [];
      for (const [kind, values, shape, top] of [['production', production, candidate.p, y], ['resource-point', bonuses, candidate.b, y + candidate.p.height + (production.length ? 2 : 0) + gap]]) {
        if (!values.length) continue;
        const frameLeft = x + Math.floor((candidate.width - shape.width - 2) / 2), left = frameLeft + 1, bounds = [left, top + 1, shape.width, shape.height], frame = [frameLeft, top, shape.width + 2, shape.height + 2];
        const cells = values.map((value, i) => ({ ...value, x: left + i % shape.width, y: top + 1 + Math.floor(i / shape.width) }));
        blocks.push({ kind, bounds, frame, pixels: cells }); pixels.push(...cells);
      }
      return { bounds: [x, y, candidate.width, candidate.height], blocks, pixels, count: objects.length };
    }
    // Both blocks are hidden together when their complete footprint cannot fit.
    return empty;
  }
  function drawResourceMarkers(context, index, tiles, catalog) {
    const colorFor = createResourceColorResolver(catalog); context.imageSmoothingEnabled = false;
    for (const [key, tile] of Object.entries(tiles || {})) {
      const region = index.get(Number(key)); if (!region) continue;
      const layout = layoutResourceMarkers(index, region, Object.values(tile.entries || {}), colorFor);
      context.fillStyle = RESOURCE_MARKER_FRAME_COLOR;
      for (const block of layout.blocks) {
        const [x, y, width, height] = block.frame;
        for (let row = 0; row < height; row++) {
          if (row === 0 || row === height - 1) context.fillRect(x, y + row, width, 1);
          else { context.fillRect(x, y + row, 1, 1); context.fillRect(x + width - 1, y + row, 1, 1); }
        }
      }
      for (const pixel of layout.pixels) { context.fillStyle = pixel.color; context.fillRect(pixel.x, pixel.y, 1, 1); }
    }
  }
  const api = { RESOURCE_MARKER_FRAME_COLOR, layoutResourceMarkers, drawResourceMarkers };
  Object.assign(root.AtlasExtensions ||= {}, api); if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
