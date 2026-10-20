'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { warKey } = require('../extensions/nation-relations.js');
const { NationBorders, darkenColor, WAR_BORDER_COLOR } = require('../extensions/nation-borders.js');
function fixture(rows) {
  const width = rows[0].length, height = rows.length, pixels = new Uint8ClampedArray(width * height * 4), labels = [];
  rows.forEach((row, y) => [...row].forEach((value, x) => {
    const id = /[1-9]/.test(value) ? Number(value) : 0, rgb = value === '#' ? [0, 0, 0] : id ? [128, 128, 128] : [47, 78, 94]; labels.push(id); pixels.set([...rgb, 255], (y * width + x) * 4);
  }));
  const borders = new NationBorders({ width, height, idAt: (x, y) => x < 0 || y < 0 || x >= width || y >= height ? null : labels[y * width + x] || null }, pixels);
  const painted = new Map(), touched = new Set();
  const context = { fillStyle: '', fillRect(x, y, length) { for (let n = 0; n < length; n++) { painted.set(y * width + x + n, this.fillStyle); touched.add(y * width + x + n); } }, clearRect(x, y, length) { for (let n = 0; n < length; n++) { painted.delete(y * width + x + n); touched.add(y * width + x + n); } } };
  return { borders, context, painted, touched, at: (x, y) => painted.get(y * width + x) };
}
const nations = (owners = { 1: 'a', 2: 'a' }) => ({ items: { a: { color: '#517eaa' }, b: { color: '#517eaa' } }, owners });
test('internal border shade halves each RGB channel with consistent rounding', () => {
  assert.equal(darkenColor('#517eaa'), '#293f55'); assert.equal(darkenColor('#ffffff'), '#808080'); assert.equal(darkenColor('#000000'), '#000000'); assert.equal(darkenColor('#FF0100'), '#800100'); assert.equal(darkenColor('red'), null);
});
test('internal strokes are colored across their whole width; exterior and unowned borders retain the base', () => {
  const f = fixture(Array(11).fill('11111###22222'));
  f.borders.redraw(f.context, nations()); for (const x of [5, 6, 7]) assert.equal(f.at(x, 5), '#293f55');
  // Different nations keep their external border even when their fill colors match.
  f.borders.redraw(f.context, nations({ 1: 'a', 2: 'b' }), [2]); assert.equal(f.painted.size, 0);
  f.borders.redraw(f.context, nations({ 1: 'a' }), [2]); assert.equal(f.painted.size, 0);
  f.borders.redraw(f.context, nations(), [2]); assert.equal(f.at(6, 5), '#293f55');
});
test('water and coastlines are not bridged, including narrow water between provinces', () => {
  for (const row of ['11111#.......', '11111#.#22222']) { const f = fixture(Array(11).fill(row)); f.borders.redraw(f.context, nations()); assert.equal(f.painted.size, 0, row); }
});
test('all provinces meeting at a junction must have one owner', () => {
  const f = fixture(['11111#22222', '11111#22222', '11111#22222', '11111#22222', '11111#22222', '###########', '33333#33333', '33333#33333', '33333#33333', '33333#33333', '33333#33333']);
  f.borders.redraw(f.context, nations({ 1: 'a', 2: 'a', 3: 'a' })); assert.equal(f.at(5, 5), '#293f55');
  f.borders.redraw(f.context, nations({ 1: 'a', 2: 'a', 3: 'b' }), [3]); assert.equal(f.at(5, 5), undefined); assert.equal(f.at(5, 4), '#293f55');
});
test('recoloring updates only adjacent masks; undoing ownership clears the previous stroke', () => {
  const f = fixture(Array(11).fill('11111#22222#33333')), data = nations({ 1: 'a', 2: 'a', 3: 'a' });
  f.borders.redraw(f.context, data); f.touched.clear(); data.items.a.color = '#c47862';
  f.borders.redraw(f.context, data, [1]); assert.equal(f.at(5, 5), '#623c31'); assert.equal(f.at(11, 5), '#293f55'); assert.ok([...f.touched].every(p => p % 17 === 5));
  delete data.owners[1]; f.borders.redraw(f.context, data, [1]); assert.equal(f.at(5, 5), undefined); assert.equal(f.at(11, 5), '#293f55');
});
test('war borders are red, stop at peace and never color an internal boundary or water', () => {
  const f = fixture(Array(11).fill('11111#22222#33333')), data = nations({ 1: 'a', 2: 'b', 3: 'b' });
  f.borders.redraw(f.context, data); assert.equal(f.at(5, 5), undefined); assert.equal(f.at(11, 5), '#293f55');
  data.wars = { [warKey('b', 'a')]: ['a', 'b'] }; f.borders.redraw(f.context, data);
  assert.equal(f.at(5, 5), WAR_BORDER_COLOR); assert.equal(f.at(11, 5), '#293f55');
  data.owners[2] = 'a'; f.borders.redraw(f.context, data, [2]);
  assert.equal(f.at(5, 5), '#293f55'); assert.equal(f.at(11, 5), WAR_BORDER_COLOR);
  delete data.wars[warKey('a', 'b')]; f.borders.redraw(f.context, data);
  assert.equal(f.at(11, 5), undefined);
  const water = fixture(Array(11).fill('11111#.#22222')); data.wars[warKey('a', 'b')] = ['a', 'b']; data.owners[2] = 'b'; water.borders.redraw(water.context, data); assert.equal(water.painted.size, 0);
});
