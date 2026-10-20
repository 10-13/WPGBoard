'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { RegionIndex } = require('../packages/core/index.js');
const { RegionSelection, drawRegionSet } = require('../packages/ui/region-selection.js');
test('selection replaces, toggles and batches valid regions without duplicates or redundant changes', () => {
  const selection = new RegionSelection({ valid: id => [1, 2, 3].includes(id) }), changes = [];
  selection.on('change', event => changes.push(event.regionIds));
  selection.replace([1, 1, 99]); selection.toggle(2); selection.toggle(1);
  assert.deepEqual(selection.ids, [2]); selection.add([2, 3]); selection.add([3]); selection.toggle(99);
  assert.deepEqual(selection.ids, [2, 3]); assert.equal(selection.has(3), true); assert.equal(changes.length, 4);
  selection.remove([3, 99]); selection.clear(); selection.clear(); assert.equal(selection.size, 0); assert.equal(changes.length, 6);
});
test('context targeting keeps a selected group, replaces an outside target and clears empty space', () => {
  const selection = new RegionSelection(); selection.replace([1, 2]);
  const snapshot = selection.forContext(2); assert.deepEqual(snapshot, [1, 2]); assert.ok(Object.isFrozen(snapshot));
  selection.toggle(3); assert.deepEqual(snapshot, [1, 2]);
  assert.deepEqual(selection.forContext(4), [4]); assert.deepEqual(selection.forContext(null), []);
});
test('selection never mutates caller arrays and can reset after changing the map', () => {
  let valid = new Set([1, 2]); const selection = new RegionSelection({ valid: id => valid.has(id) });
  const ids = [1, 2]; selection.replace(ids); ids.push(99); assert.deepEqual(selection.ids, [1, 2]);
  valid = new Set([3]); selection.clear(); selection.add([1, 3]); assert.deepEqual(selection.ids, [3]);
});
function rasterFixture(rows, { offsetX = 0, offsetY = 0, width = rows[0].length, height = rows.length } = {}) {
  const mapWidth = rows[0].length, pixels = [...rows.join('')].map(Number), regions = [];
  for (const id of new Set(pixels.filter(Boolean))) {
    const points = pixels.flatMap((value, p) => value === id ? [[p % mapWidth, Math.floor(p / mapWidth)]] : []), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    regions.push({ id, area: points.length, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1], anchor: points[0] });
  }
  const index = new RegionIndex({ width: mapWidth, height: rows.length, regions, pixels }), painted = new Map();
  const context = {
    canvas: { width, height },
    clearRect() { painted.clear(); },
    fillRect(x, y, length, h) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + length; xx++) if (xx >= 0 && yy >= 0 && xx < width && yy < height) painted.set(yy * width + xx, this.fillStyle); }
  };
  return { index, painted, draw(ids) { drawRegionSet(context, index, ids, { fill: 'fill', edge: 'edge', offsetX, offsetY }); }, at: (x, y) => painted.get(y * width + x) };
}
test('province highlighting closes horizontal and vertical edges, including the map perimeter', () => {
  const f = rasterFixture(['11111', '11111', '11111', '11111']); f.draw([1]);
  for (let x = 0; x < 5; x++) { assert.equal(f.at(x, 0), 'edge'); assert.equal(f.at(x, 3), 'edge'); }
  for (let y = 0; y < 4; y++) { assert.equal(f.at(0, y), 'edge'); assert.equal(f.at(4, y), 'edge'); }
  assert.equal(f.at(2, 1), 'fill'); assert.equal(f.painted.size, 20);
});
test('batch highlighting retains each province contour around holes, notches and neighbors on both axes', () => {
  const rows = ['111112222', '111112222', '110112222', '111112222', '001112222', '333333333', '333333333', '333333333'];
  const f = rasterFixture(rows); f.draw([1, 2, 3, 1]);
  // Check the raster, not draw-call counts: every four-neighbor edge must be present.
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++) {
    const id = f.index.idAt(x, y);
    const edge = id && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => f.index.idAt(x + dx, y + dy) !== id);
    assert.equal(f.at(x, y), id ? edge ? 'edge' : 'fill' : undefined, `${x},${y}`);
  }
});
test('cropped hover rendering uses the same complete contour and clears the old highlight', () => {
  const f = rasterFixture(['0000000', '0011100', '0011100', '0011100', '0000000'], { offsetX: 2, offsetY: 1, width: 3, height: 3 });
  f.draw([1]); assert.equal(f.painted.size, 9); assert.equal(f.at(1, 0), 'edge'); assert.equal(f.at(1, 2), 'edge'); assert.equal(f.at(1, 1), 'fill');
  f.draw([]); assert.equal(f.painted.size, 0);
});
