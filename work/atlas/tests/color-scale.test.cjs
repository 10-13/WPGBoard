'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ColorScale } = require('../packages/ui/color-scale-model.js');
const points = [
  { value: -20, color: '#000000' },
  { value: 0, color: '#ff0000' },
  { value: 80, color: '#ffffff' },
];

test('valued points are sorted, copied and immutable, with all three modes interpolating their anchors', () => {
  const source = [points[2], points[0], points[1]].map((p) => ({ ...p }));
  const scale = new ColorScale(source);
  source[0].color = '#ffffff';
  source.splice(0);
  assert.deepEqual(scale.points, points);
  assert.ok(Object.isFrozen(scale.points));
  assert.ok(scale.points.every(Object.isFrozen));
  for (const mode of ['linear', 'threshold', 'spline']) {
    for (const point of points) assert.equal(scale.color(point.value, mode), point.color);
    assert.equal(scale.color(-1000, mode), '#000000');
    assert.equal(scale.color(1000, mode), '#ffffff');
  }
});

test('linear colors use actual nonuniform values, while thresholds include their lower bound', () => {
  const scale = new ColorScale(points);
  assert.equal(scale.color(-10), '#800000');
  assert.equal(scale.color(40), '#ff8080');
  assert.equal(scale.color(-0.000001, 'threshold'), '#000000');
  assert.equal(scale.color(0, 'threshold'), '#ff0000');
  assert.equal(scale.color(79.999, 'threshold'), '#ff0000');
  const threshold = new ColorScale(points, { mode: 'threshold' });
  assert.deepEqual(threshold.grades(), points, 'all original thresholds remain in the legend');
});

test('natural cubic spline matches analytic values on nonuniform knots and clamps RGB overshoot', () => {
  const scale = new ColorScale(
    [
      { value: 0, color: '#000000' },
      { value: 1, color: '#ffffff' },
      { value: 3, color: '#000000' },
    ],
    { mode: 'spline' },
  );
  assert.equal(scale.color(0.5), '#979797');
  assert.equal(scale.color(2), '#dfdfdf');
  assert.equal(scale.color(0.5, 'linear'), '#808080');
  for (let value = 0; value <= 3; value += 0.001) assert.match(scale.color(value), /^#[a-f\d]{6}$/);
  const shifted = new ColorScale(
    scale.points.map((p) => ({ ...p, value: p.value * 100 + 10000 })),
    { mode: 'spline' },
  );
  assert.equal(shifted.color(10050), '#979797');
  assert.equal(shifted.color(10200), '#dfdfdf');
});

test('two-point cubic spline is linear; empty, singleton and absent data have explicit results', () => {
  const scale = new ColorScale([
    { value: 10, color: '#001122' },
    { value: 20, color: '#ffeecc' },
  ]);
  for (let value = 10; value <= 20; value++)
    assert.equal(scale.color(value, 'spline'), scale.color(value));
  assert.equal(new ColorScale().color(10), null);
  assert.deepEqual(new ColorScale().grades(), []);
  const single = new ColorScale([{ value: 5, color: '#AABBCC' }]);
  assert.equal(single.color(0), '#aabbcc');
  assert.equal(single.grades().length, 1);
  for (const value of [null, undefined, NaN, Infinity, '10'])
    assert.equal(scale.color(value), null);
});

test('cubic spline solves coupled interior knots across more than one segment', () => {
  const scale = new ColorScale(
    [
      { value: 0, color: '#000000' },
      { value: 1, color: '#ffffff' },
      { value: 2, color: '#000000' },
      { value: 3, color: '#ffffff' },
    ],
    { mode: 'spline' },
  );
  assert.equal(scale.color(0.5), '#bfbfbf');
  assert.equal(scale.color(1.5), '#808080');
  assert.equal(scale.color(2.5), '#404040');
});

test('legend grades call exactly the same color function as the map; raw knots are preserved', () => {
  const scale = new ColorScale(points, { mode: 'spline' });
  const grades = scale.grades(5);
  assert.deepEqual(
    grades.map((p) => p.value),
    [-20, 5, 30, 55, 80],
  );
  for (const point of grades) assert.equal(point.color, scale.color(point.value));
  assert.deepEqual(scale.points, points);
  assert.throws(() => scale.grades(1));
  assert.throws(() => scale.grades(Infinity));
});

test('bad points, duplicate thresholds and unknown methods fail at the boundary', () => {
  for (const input of [
    null,
    {},
    [{ value: NaN, color: '#ffffff' }],
    [{ value: 1, color: 'red' }],
    [{ value: 1, color: '#fff' }],
    [points[0], points[0]],
  ])
    assert.throws(() => new ColorScale(input));
  assert.throws(() => new ColorScale(points, { mode: 'unknown' }));
  assert.throws(() => new ColorScale(points).color(0, 'unknown'));
});
