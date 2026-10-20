'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { RESOURCE_COLORS, resourceColor, createResourceColorResolver } = require('../extensions/resource-colors.js');
const { DEFAULT_RESOURCE_CATALOG } = require('../extensions/resource-catalog-data.js');
const { layoutResourceMarkers, drawResourceMarkers } = require('../extensions/resource-markers.js');
const { resourceRichness } = require('../extensions/resource-richness.js');
const object = (id, resource, kind = 'production', stats = {}) => ({ id, kind, source: 'resources', stats: { 'resource.name': resource, ...stats } });
const entries = [object('ore', 'Железная руда'), object('steel', 'Сталь'), object('water', 'Вода', 'production', { 'resource.role': 'baseline' }), object('deposit', 'Железная руда', 'resource-point'), object('bonus', '*', 'resource-point')];
test('every base resource has an explicit color, shared by names, IDs, units and the richness overlay', () => {
  assert.deepEqual(Object.keys(RESOURCE_COLORS).sort(), Object.keys(DEFAULT_RESOURCE_CATALOG.resources).sort());
  for (const [id, r] of Object.entries(DEFAULT_RESOURCE_CATALOG.resources)) { assert.match(resourceColor(id), /^#[0-9a-f]{6}$/); assert.equal(resourceColor(id), resourceColor(' ' + r.name.toUpperCase() + ' ')); }
  assert.equal(resourceColor('*'), '#ffffff');
  const block = resourceRichness({ details: [{ resource: 'Сталь', unit: 'т', regions: [{ regionId: 1, after1: 4 }] }] });
  assert.equal(block.legend[0].color, resourceColor('steel'));
  assert.equal(createResourceColorResolver({ resources: { custom: { id: 'custom', name: 'Олово' } } })('Олово'), createResourceColorResolver({ resources: { custom: { id: 'custom', name: 'Tin' } } })('Tin'));
  assert.equal(resourceColor('Медь'), resourceColor(' МЕДЬ '));
});
const rectangleIndex = (region, contains = () => true) => ({ get: id => id === region.id ? region : null, idAt: (x, y) => x >= region.bbox[0] && y >= region.bbox[1] && x < region.bbox[0] + region.bbox[2] && y < region.bbox[1] + region.bbox[3] && contains(x, y) ? region.id : null });
function assertFits(layout, index, id) {
  const [x, y, w, h] = layout.bounds;
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) assert.equal(index.idAt(xx, yy), id);
  assert.equal(new Set(layout.pixels.map(p => p.x + ':' + p.y)).size, layout.count);
  for (const block of layout.blocks) assert.equal(block.bounds[2] * block.bounds[3], block.pixels.length);
}
test('each enterprise remains a pixel; colors are contiguous and the two full rectangles have a one-pixel gap', () => {
  const region = { id: 1, bbox: [0, 0, 60, 60], anchor: [30, 30] }, index = rectangleIndex(region);
  const input = [...entries, object('ore2', 'Железная руда'), object('ore3', 'Железная руда'), object('steel2', 'Сталь')], before = JSON.stringify(input);
  const layout = layoutResourceMarkers(index, region, input);
  assert.equal(layout.count, input.length); assert.equal(layout.pixels.length, input.length); assertFits(layout, index, 1);
  const [production, bonuses] = layout.blocks;
  assert.equal(production.kind, 'production'); assert.equal(bonuses.kind, 'resource-point');
  assert.equal(bonuses.bounds[1], production.bounds[1] + production.bounds[3] + 1);
  assert.deepEqual(production.pixels.map(p => p.id), ['ore', 'ore2', 'ore3', 'steel', 'steel2', 'water']);
  assert.equal(production.pixels.at(-1).color, resourceColor('water')); assert.equal(bonuses.pixels.at(-1).color, '#ffffff');
  assert.equal(JSON.stringify(input), before);
});
test('rectangle proportions follow the bbox and stay near the center without scaling any pixels', () => {
  const many = Array.from({ length: 12 }, (_, i) => object('p' + i, 'Сталь'));
  const layouts = [[90, 20], [20, 90], [40, 40]].map(([w, h]) => {
    const region = { id: 1, bbox: [10, 20, w, h], anchor: [10 + Math.floor(w / 2), 20 + Math.floor(h / 2)] }, index = rectangleIndex(region);
    const layout = layoutResourceMarkers(index, region, many); assertFits(layout, index, 1);
    assert(Math.abs(layout.bounds[0] + layout.bounds[2] / 2 - region.anchor[0] - .5) <= .5);
    assert(Math.abs(layout.bounds[1] + layout.bounds[3] / 2 - region.anchor[1] - .5) <= .5);
    return layout;
  });
  assert(layouts[0].bounds[2] > layouts[0].bounds[3]); assert(layouts[1].bounds[3] > layouts[1].bounds[2]);
  assert(Math.abs(layouts[2].bounds[2] - layouts[2].bounds[3]) <= 1);
});
test('placement searches inside the real province and never paints a hole or neighboring province', () => {
  const region = { id: 7, bbox: [0, 0, 9, 9], anchor: [4, 4] };
  const index = rectangleIndex(region, (x, y) => !(x === 4 && y === 3) && !(x >= 5 && y < 5));
  const layout = layoutResourceMarkers(index, region, entries); assertFits(layout, index, 7);
  assert(layout.bounds); // The centered shape crosses the hole; another complete placement fits.
  const painted = [];
  const context = { fillRect(x, y, w, h) { assert.equal(w, 1); assert.equal(h, 1); assert.equal(index.idAt(x, y), 7); painted.push([x, y, this.fillStyle]); } };
  drawResourceMarkers(context, index, { 7: { entries: Object.fromEntries(entries.map(e => [e.id, e])) } });
  assert.equal(painted.length, entries.length); assert.equal(context.imageSmoothingEnabled, false);
  assert.deepEqual(painted.map(p => p[2]), layout.pixels.map(p => p.color));
});
test('blocks disappear together if their full footprint, including the gap, does not fit', () => {
  const region = { id: 1, bbox: [0, 0, 20, 20], anchor: [10, 10] }, index = rectangleIndex(region, (x, y) => x % 2 === 0 && y % 2 === 0);
  const layout = layoutResourceMarkers(index, region, entries);
  assert.equal(layout.bounds, null); assert.equal(layout.count, entries.length); assert.equal(layout.pixels.length, 0);
  const context = { fillRect() { assert.fail('A hidden group must not paint any pixels'); } };
  drawResourceMarkers(context, index, { 1: { entries: Object.fromEntries(entries.map(e => [e.id, e])) } });
  const tiny = { id: 2, bbox: [0, 0, 1, 1], anchor: [0, 0] };
  assert.equal(layoutResourceMarkers(rectangleIndex(tiny), tiny, entries).bounds, null);
});
test('production-only and bonus-only blocks need no empty block or extra gap; unrelated metadata is ignored', () => {
  const region = { id: 1, bbox: [0, 0, 8, 8], anchor: [4, 4] }, index = rectangleIndex(region);
  for (const kind of ['production', 'resource-point']) {
    const input = [object('single', '*', kind), { id: 'note', source: 'notes', kind, stats: { 'resource.name': 'Сталь' } }];
    const layout = layoutResourceMarkers(index, region, input);
    assert.equal(layout.blocks.length, 1); assert.equal(layout.pixels.length, 1); assert.deepEqual(layout.bounds, [4, 4, 1, 1]);
    assert.equal(layout.pixels[0].color, '#ffffff');
  }
  assert.equal(layoutResourceMarkers(index, region, []).bounds, null);
});
