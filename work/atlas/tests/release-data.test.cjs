'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const { History } = require('../packages/core/index.js');
const { GEOGRAPHY_ENTRY } = require('../extensions/geography-model.js');
const root = path.resolve(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('four authored releases have independent saves and the intended datasets', () => {
  const releases = read('releases.json');
  assert.deepEqual(
    releases.map((release) => release.id),
    ['empty', 'geography', 'geography-resources', 'terra-mirabilis'],
  );
  const keys = new Set();
  let names, regions;
  for (const release of releases) {
    const project = read('releases/' + release.file.replace(/\.html$/, '.json'));
    assert(!keys.has(project.saveKey));
    keys.add(project.saveKey);
    assert.equal(project.regions.length, 4587);
    const history = History.fromJSON(project.history);
    const meta = history.snapshot().meta;
    const entries = Object.values(meta.tiles || {}).flatMap((tile) => Object.values(tile.entries));
    assert.equal(meta.overlays, undefined);
    if (release.id === 'empty') {
      assert.equal(entries.length, 0);
      assert.equal(Object.keys(meta.regions?.items || {}).length, 0);
      assert.equal(Object.keys(meta.nations?.names || {}).length, 0);
      continue;
    }
    assert.equal(Object.keys(meta.nations.names).length, 4587);
    assert.equal(Object.keys(meta.regions.items).length, 162);
    assert.equal(entries.filter((entry) => entry.id === GEOGRAPHY_ENTRY).length, 4587);
    names ||= meta.nations.names;
    regions ||= meta.regions;
    assert.deepEqual(meta.nations.names, names);
    assert.deepEqual(meta.regions, regions);
    const productions = entries.filter((entry) => entry.kind === 'production');
    const points = entries.filter((entry) => entry.kind === 'resource-point');
    if (release.id === 'geography') {
      assert.equal(productions.length, 0);
      assert.equal(points.length, 0);
    } else if (release.id === 'geography-resources') {
      assert.equal(productions.length, 14756);
      assert.equal(points.length, 264);
    } else {
      assert.equal(productions.length, 0);
      assert.equal(points.length, 69);
      assert.deepEqual(
        meta.resources.catalog,
        read('assets/terra-mirabilis-resources.json').catalog,
      );
      for (const point of read('assets/resource-import-1936.json').points) {
        assert(meta.tiles[point.provinceId].entries[point.id]);
      }
    }
  }
});
