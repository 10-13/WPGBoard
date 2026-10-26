'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { History } = require('../packages/core/index.js');
const { collectResourceStats } = require('../extensions/resources-model.js');
const { applyTerraExtraction } = require('../tools/build-terra-extraction.cjs');
const read = (file) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'));
const placement = read('assets/terra-mirabilis-extraction.json');
function originalProject() {
  const project = read('releases/atlas-terra-mirabilis.json');
  const history = History.fromJSON(project.history);
  if (history.snapshot().meta.economy.template === 'terra-mirabilis-extraction-v1') history.undo();
  project.history = history.toJSON();
  return project;
}
const entries = (meta) =>
  Object.entries(meta.tiles).flatMap(([regionId, tile]) =>
    Object.values(tile.entries).map((entry) => ({ regionId: Number(regionId), entry })),
  );

test('the captured resource nations produce exactly one vein per assigned province', () => {
  const original = originalProject();
  const before = History.fromJSON(original.history).snapshot();
  const transformed = applyTerraExtraction(original);
  const history = History.fromJSON(transformed.history);
  const after = history.snapshot();
  assert.equal(history.commits.length, History.fromJSON(original.history).commits.length + 1);
  assert.equal(
    entries(before.meta).filter(({ entry }) => entry.kind === 'resource-point').length,
    69,
  );
  assert.equal(
    entries(after.meta).filter(({ entry }) => entry.kind === 'resource-point').length,
    0,
  );
  const report = collectResourceStats({ entries: entries(after.meta) });
  assert.deepEqual(report.invalid, []);
  assert.deepEqual(Object.fromEntries(report.resources.map((r) => [r.resource, r.net])), {
    Аллюминий: 13,
    Вольфрам: 10,
    Гелий: 1,
    Каучук: 51,
    'Легирующие металлы': 14,
    Нефть: 24,
    Сталь: 10,
    Уголь: 39,
  });
  assert(report.resources.every((r) => r.unit === 'жила(ы)' && r.consumption === 0));
  assert.equal(report.allocation.length, 162);
  assert(report.allocation.every((p) => p.actualOutput === 1 && p.load === 1));
  for (const [key, value] of Object.entries(before.meta)) {
    if (!['tiles', 'resources', 'economy', 'campaign'].includes(key))
      assert.deepEqual(after.meta[key], value);
  }
  for (const { regionId, entry } of entries(before.meta)) {
    if (entry.kind !== 'resource-point')
      assert.deepEqual(after.meta.tiles[regionId].entries[entry.id], entry);
  }
  assert.deepEqual(transformed.map, original.map);
  assert.deepEqual(transformed.regions, original.regions);
  assert.equal(transformed.saveKey, original.saveKey);
  assert.deepEqual(after.params, before.params);
  history.undo();
  assert.deepEqual(history.snapshot(), before);
  history.redo();
  assert.deepEqual(history.snapshot(), after);
  assert.deepEqual(
    applyTerraExtraction(transformed),
    transformed,
    'repeating authoring adds no action',
  );
  assert.deepEqual(History.fromJSON(original.history).snapshot(), before, 'input is not mutated');
});

test('bad geometry, duplicate assignments and unknown resources are rejected before authoring', () => {
  const original = originalProject();
  for (const corrupt of [
    (p) => {
      p.mapSignature = '00000000';
    },
    (p) => {
      p.nations[0].provinceIds.push(p.nations[0].provinceIds[0]);
    },
    (p) => {
      p.nations[0].provinceIds[0] = 999999;
    },
    (p) => {
      p.nations[0].resourceId = 'iron';
    },
  ]) {
    const source = structuredClone(placement);
    corrupt(source);
    assert.throws(() => applyTerraExtraction(original, source));
  }
});
