'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { RegionIndex } = require('../packages/core/index.js');
const { RegionGeometry, wrapRegionName } = require('../extensions/region-geometry.js');
function fixture(rows) {
  const width = rows[0].length, height = rows.length, labels = [], pixels = new Uint8ClampedArray(width * height * 4), bounds = new Map();
  rows.forEach((row, y) => [...row].forEach((value, x) => {
    const id = /[1-9]/.test(value) ? Number(value) : 0; labels.push(id); pixels.set([...(value === '#' ? [0, 0, 0] : id ? [128, 128, 128] : [47, 78, 94]), 255], (y * width + x) * 4);
    if (id) { if (!bounds.has(id)) bounds.set(id, []); bounds.get(id).push([x, y]); }
  }));
  const regions = [...bounds].map(([id, points]) => { const xs = points.map(p => p[0]), ys = points.map(p => p[1]); return { id, area: points.length, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1], anchor: points[0] }; });
  const index = new RegionIndex({ width, height, pixels: labels, regions });
  const geometry = new RegionGeometry(index, pixels);
  const points = region => { const set = new Set(); for (let i = 0; i < region.runs.length; i += 2) for (let n = 0; n < region.runs[i + 1]; n++) set.add(region.runs[i] + n); return set; };
  return { index, geometry, at: (region, x, y) => points(region).has(y * width + x) };
}
const data = assignments => ({ items: { north: { name: 'North' }, south: { name: 'South' }, empty: { name: 'Empty' } }, assignments });
test('one named region has an exterior contour without the internal seam between its provinces', () => {
  const f = fixture(Array(15).fill('11111###22222')), [region] = f.geometry.build(data({ 1: 'north', 2: 'north' }));
  assert.equal(region.area, 150); assert.equal(f.at(region, 0, 7), true); assert.equal(f.at(region, 12, 7), true);
  assert.equal(f.at(region, 4, 7), false); assert.equal(f.at(region, 8, 7), false);
  assert.equal(f.at(region, 3, 0), true); assert.equal(f.at(region, 9, 14), true);
});
test('different named regions and unassigned provinces retain their separating edges', () => {
  const f = fixture(Array(15).fill('11111###22222'));
  const [north, south] = f.geometry.build(data({ 1: 'north', 2: 'south' }));
  assert.equal(f.at(north, 4, 7), true); assert.equal(f.at(south, 8, 7), true);
  const [only] = f.geometry.build(data({ 1: 'north' })); assert.equal(f.at(only, 4, 7), true);
});
test('named region contours join provinces across horizontal strokes too', () => {
  const f = fixture([...Array(5).fill('111111111111111'), ...Array(3).fill('###############'), ...Array(5).fill('222222222222222')]);
  const [region] = f.geometry.build(data({ 1: 'north', 2: 'north' }));
  assert.equal(f.at(region, 7, 4), false); assert.equal(f.at(region, 7, 8), false);
  assert.equal(f.at(region, 7, 0), true); assert.equal(f.at(region, 7, 12), true);
  const [separate] = f.geometry.build(data({ 1: 'north', 2: 'south' })); assert.equal(f.at(separate, 7, 4), true);
});
test('a narrow water channel is never mistaken for an internal province border', () => {
  const f = fixture(Array(15).fill('11111#.#22222')), [region] = f.geometry.build(data({ 1: 'north', 2: 'north' }));
  assert.equal(f.at(region, 4, 7), true); assert.equal(f.at(region, 8, 7), true);
  assert.ok([1, 2].includes(f.index.idAt(...region.anchor)), 'a disconnected region label stays on a member province');
});
test('label anchors stay inside concave member areas and empty or stale definitions draw nothing', () => {
  const f = fixture(['1111111', '11...11', '11...11', '11...11', '1111111']), [region] = f.geometry.build(data({ 1: 'north', 999: 'south' }));
  assert.equal(f.index.idAt(...region.anchor), 1); assert.equal(region.name, 'North'); assert.deepEqual(f.geometry.build(data({})), []);
  assert.deepEqual(f.geometry.build(data({ 1: 'removed' })), []);
});
test('rebuilding after membership changes restores the seam, without changing the map index', () => {
  const f = fixture(Array(15).fill('11111###22222')), before = f.index.toJSON();
  f.geometry.build(data({ 1: 'north', 2: 'north' })); const [region] = f.geometry.build(data({ 1: 'north', 2: 'south' }));
  assert.equal(f.at(region, 4, 7), true); assert.deepEqual(f.index.toJSON(), before);
  assert.throws(() => new RegionGeometry(f.index, new Uint8Array(3)));
});
test('long names wrap fully, including unbroken words and Unicode, without ellipses', () => {
  const measure = text => [...text].length * 6;
  const text = 'Северный промышленный округ', lines = wrapRegionName(text, measure, 72);
  assert.equal(lines.join(' '), text); assert.ok(lines.every(line => measure(line) <= 72));
  const unbroken = 'ОченьДлинноеИмяРегионаБезПробелов🙂'; const wrapped = wrapRegionName(unbroken, measure, 60);
  assert.equal(wrapped.join(''), unbroken); assert.ok(wrapped.every(line => measure(line) <= 60));
});
