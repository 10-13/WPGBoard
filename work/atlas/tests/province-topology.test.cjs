'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { RegionIndex, ProvinceTopology } = require('../packages/core/index.js');
function fixture(rows) {
  const width = rows[0].length, height = rows.length, pixels = [], rgba = new Uint8Array(width * height * 4), points = new Map();
  rows.forEach((row, y) => [...row].forEach((value, x) => {
    const id = /[1-9]/.test(value) ? Number(value) : 0; pixels.push(id);
    rgba.set([...(id ? [128, 128, 128] : value === '#' ? [0, 0, 0] : [47, 78, 94]), 255], (y * width + x) * 4);
    if (id) { if (!points.has(id)) points.set(id, []); points.get(id).push([x, y]); }
  }));
  const regions = [...points].map(([id, ps]) => { const xs = ps.map(p => p[0]), ys = ps.map(p => p[1]); return { id, area: ps.length, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1], anchor: ps[0] }; });
  const index = new RegionIndex({ width, height, pixels, regions }); return { index, rgba, topology: new ProvinceTopology(index, rgba) };
}
const grid = () => fixture(['111#222#333', '111#222#333', '111#222#333', '###########', '444#555#666', '444#555#666', '444#555#666', '###########', '777#888#999', '777#888#999', '777#888#999']);
test('province neighbors cross raster strokes on both axes and do not connect through corner junctions', () => {
  const { topology } = grid();
  assert.deepEqual(topology.neighborsOf(5), [2, 4, 6, 8]); assert.deepEqual(topology.neighborsOf(1), [2, 4]);
  for (const id of [1, 2, 4, 6, 8, 9]) for (const other of topology.neighborsOf(id)) assert.ok(topology.neighborsOf(other).includes(id));
  assert.deepEqual(topology.neighborsOf(999), []);
});
test('neighbor selection expands exactly one layer, retains its seed and ignores duplicates and unknown IDs', () => {
  const { topology } = grid();
  assert.deepEqual(topology.neighbors([5, 5, 999]), [2, 4, 6, 8]);
  assert.deepEqual(topology.expand([5, 5, 999]), [2, 4, 5, 6, 8]);
  assert.deepEqual(topology.expand(topology.expand([5])), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(topology.expand([]), []);
});
test('erosion removes one entire exterior layer simultaneously, including image edges', () => {
  const { topology } = grid();
  assert.deepEqual(topology.erode([1, 2, 3, 4, 5, 6, 7, 8, 9]), [5]);
  assert.deepEqual(topology.erode([2, 4, 5, 6, 8]), [5]); assert.deepEqual(topology.erode([5]), []);
  assert.equal(topology.touchesExterior(5), false); assert.equal(topology.touchesExterior(1), true);
});
test('water channels and corner contacts never create neighbors; coastal provinces erode away', () => {
  for (const rows of [Array(5).fill('111#.#222'), ['1#', '#2']]) {
    const { topology } = fixture(rows); assert.deepEqual(topology.neighborsOf(1), []); assert.deepEqual(topology.neighborsOf(2), []);
    assert.deepEqual(topology.expand([1]), [1]); assert.deepEqual(topology.erode([1, 2]), []);
  }
});
test('three-pixel borders, direct contacts and narrow intervening provinces are handled without jumping', () => {
  for (const rows of [Array(5).fill('111###222'), ['11111', '11111', '#####', '#####', '#####', '22222', '22222']]) assert.deepEqual(fixture(rows).topology.neighborsOf(1), [2]);
  const { topology } = fixture(['11233', '11233']); assert.deepEqual(topology.neighborsOf(1), [2]); assert.deepEqual(topology.neighborsOf(2), [1, 3]);
});
test('topology and its results are read-only derived geometry and never mutate the source index', () => {
  const { topology, index, rgba } = grid(), before = index.toJSON(), ids = [5];
  assert.ok(Object.isFrozen(topology.neighborsOf(5))); assert.ok(Object.isFrozen(topology.expand(ids))); assert.ok(Object.isFrozen(topology.erode(ids)));
  rgba.fill(0); assert.deepEqual(topology.neighborsOf(5), [2, 4, 6, 8]); assert.deepEqual(index.toJSON(), before); assert.deepEqual(ids, [5]);
  assert.throws(() => new ProvinceTopology(index, new Uint8Array(1)));
});
