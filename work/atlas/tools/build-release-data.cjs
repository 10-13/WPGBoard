/* Explicit authoring tool. Ordinary builds never regenerate release data. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { History } = require('../packages/core/index.js');
const { applyTerraExtraction } = require('./build-terra-extraction.cjs');
const {
  applyGeographySeed,
  mapSignature,
  GEOGRAPHY_ENTRY,
} = require('../extensions/geography-model.js');
const root = path.resolve(__dirname, '..');
const local = path.resolve(root, '../../.local');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const releases = read(path.join(root, 'releases.json'));
const seed = read(path.join(root, 'assets/environment-geography.json'));
fs.mkdirSync(path.join(local, 'release-data'), { recursive: true });

for (const tool of [
  'build-geography-1936.cjs',
  'build-economy-1936.cjs',
  'build-resource-points-1936.cjs',
]) {
  const result = spawnSync(process.execPath, [path.join(__dirname, tool)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, tool + ' failed.');
}

const named = read(path.join(local, 'parties/atlas-1936.json'));
const descriptors = new Map(named.regions.map((province) => [province.id, province]));
const index = {
  width: named.map.original.width,
  height: named.map.original.height,
  size: descriptors.size,
  regions: descriptors,
  get: (id) => descriptors.get(id),
};
assert.equal(mapSignature(index), seed.mapSignature);
const bases = {
  empty: named,
  geography: named,
  'geography-resources': read(path.join(local, 'parties/atlas-1936-economy.json')),
  'terra-mirabilis': read(path.join(local, 'parties/atlas-1936-resources.json')),
};
const summaries = [];
for (const release of releases) {
  let project = structuredClone(bases[release.id]);
  project.saveKey = 'atlas-release-' + release.id + '-v1';
  const history =
    release.id === 'empty'
      ? new History({
          mapId: project.map.id,
          params: {},
          meta: { campaign: { title: release.title } },
        })
      : History.fromJSON(project.history);
  const before = history.snapshot();
  if (release.id !== 'empty') {
    history.update(
      (draft) => {
        applyGeographySeed(draft, seed, index);
        draft.meta.campaign.title = release.title;
      },
      {
        source: 'geography',
        label: 'География: рельеф, климат и часовые пояса',
        actionType: 'geography.seed.apply',
        payload: { dataset: 'environment-geography-v1', period: seed.provenance.period },
      },
    );
    const after = history.snapshot();
    assert.deepEqual(after.meta.nations, before.meta.nations);
    assert.deepEqual(after.meta.regions, before.meta.regions);
    for (const [id, tile] of Object.entries(before.meta.tiles || {})) {
      for (const [key, entry] of Object.entries(tile.entries)) {
        if (key !== GEOGRAPHY_ENTRY) assert.deepEqual(after.meta.tiles[id].entries[key], entry);
      }
    }
    history.undo();
    assert.deepEqual(history.snapshot(), before);
    history.redo();
    assert.deepEqual(history.snapshot(), after);
  }
  project.history = history.toJSON();
  if (release.id === 'terra-mirabilis') project = applyTerraExtraction(project);
  project.updatedAt = Date.now();
  const finalHistory = History.fromJSON(project.history);
  if (release.id !== 'terra-mirabilis')
    assert.deepEqual(finalHistory.snapshot(), history.snapshot());
  const file = path.join(local, 'release-data', release.file.replace(/\.html$/, '.json'));
  fs.writeFileSync(file, JSON.stringify(project));
  const meta = finalHistory.snapshot().meta;
  const entries = Object.values(meta.tiles || {}).flatMap((tile) => Object.values(tile.entries));
  summaries.push({
    release: release.id,
    provinces: project.regions.length,
    namedRegions: Object.keys(meta.regions?.items || {}).length,
    geography: entries.filter((entry) => entry.id === GEOGRAPHY_ENTRY).length,
    productions: entries.filter((entry) => entry.kind === 'production').length,
    points: entries.filter((entry) => entry.kind === 'resource-point').length,
    saveKey: project.saveKey,
  });
}
fs.mkdirSync(path.join(local, 'reports'), { recursive: true });
fs.writeFileSync(path.join(local, 'reports/releases.json'), JSON.stringify(summaries, null, 2));
console.log(JSON.stringify(summaries));
console.log('Prepared .local/release-data only. Install explicitly with build.py --party-data.');
