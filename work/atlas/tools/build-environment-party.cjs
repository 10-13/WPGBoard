/* Create an independent geography copy. UI rollouts never invoke this generator. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { History, clone } = require('../packages/core/index.js');
const {
  applyGeographySeed,
  readGeography,
  mapSignature,
  projectGeography,
  GEOGRAPHY_ENTRY,
} = require('../extensions/geography-model.js');
const { GEOGRAPHY_THEMES, GEOGRAPHY_KEYS } = require('../extensions/geography-data.js');
const root = path.resolve(__dirname, '..'),
  outputs = path.resolve(root, '../../outputs');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const seed = read(path.join(root, 'assets/environment-geography.json'));
const originalGeography = read(path.join(root, 'assets/geography-1936.json'));
const filename = 'atlas-1936-geography',
  jsonPath = path.join(outputs, filename + '.json');
const existing = fs.existsSync(jsonPath);
const project = existing ? read(jsonPath) : read(path.join(outputs, 'atlas-1936-resources.json'));
if (!existing) project.saveKey = 'atlas-environment-1936-' + crypto.randomUUID();
assert.equal(
  crypto
    .createHash('sha256')
    .update(Buffer.from(project.map.indexImage.split(',')[1], 'base64'))
    .digest('hex'),
  originalGeography.mapIndexSha256,
);
const regions = new Map(project.regions.map((region) => [region.id, region]));
// This authored-data operation needs immutable descriptors only; pixel masks stay in the party.
const index = {
  width: project.map.original.width,
  height: project.map.original.height,
  size: regions.size,
  regions,
  get: (id) => regions.get(id),
};
assert.equal(mapSignature(index), seed.mapSignature);
const history = History.fromJSON(project.history),
  before = history.snapshot();
const otherEntries = (meta) =>
  Object.fromEntries(
    Object.entries(meta.tiles || {})
      .map(([id, tile]) => [
        id,
        Object.fromEntries(Object.entries(tile.entries).filter(([id]) => id !== GEOGRAPHY_ENTRY)),
      ])
      .filter(([, entries]) => Object.keys(entries).length),
  );
const objects = otherEntries(before.meta);
const action = history.update(
  (draft) => {
    applyGeographySeed(draft, seed, index);
    if (!existing) draft.meta.campaign.title = '1936 · География, климат и ресурсные точки';
  },
  {
    source: 'geography',
    label: 'География: рельеф, норма 1970–2000 и часовые пояса',
    actionType: 'geography.seed.apply',
    payload: {
      dataset: 'environment-geography-v1',
      mapSignature: seed.mapSignature,
      period: seed.provenance.period,
    },
  },
);
const after = history.snapshot();
assert.deepEqual(
  otherEntries(after.meta),
  objects,
  'Resource points and other authored entries must be preserved.',
);
assert.deepEqual(after.meta.nations, before.meta.nations);
assert.deepEqual(after.meta.regions, before.meta.regions);
for (const record of seed.provinces) {
  const stats = readGeography(after.meta, record.id);
  assert(stats);
  assert.equal(Object.keys(stats).length, Object.keys(GEOGRAPHY_KEYS).length);
}
for (const theme of Object.keys(GEOGRAPHY_THEMES))
  assert.equal(
    projectGeography(after.meta, index, theme, { utc: '1936-01-01T12:00:00Z' }).values.size,
    regions.size,
  );
if (action) {
  const check = History.fromJSON(history.toJSON());
  check.undo();
  assert.deepEqual(check.snapshot(), before);
  check.redo();
  assert.deepEqual(check.snapshot(), after);
}
project.history = history.toJSON();
if (action) project.updatedAt = Date.now();
assert.deepEqual(History.fromJSON(JSON.parse(JSON.stringify(project.history))).snapshot(), after);
const serialized = JSON.stringify(project),
  template = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const html = template.replace(
  /(<script id="atlas-data" type="application\/json">)[\s\S]*?(<\/script>)/,
  (_, start, end) => start + serialized.replaceAll('<', '\\u003c') + end,
);
assert.equal((html.match(/id="atlas-geography-seed"/g) || []).length, 1);
fs.writeFileSync(jsonPath, serialized);
fs.writeFileSync(path.join(outputs, filename + '.html'), html);
fs.writeFileSync(path.join(root, 'dist', filename + '.html'), html);
console.log(
  JSON.stringify({
    provinces: regions.size,
    names: Object.keys(after.meta.nations.names).length,
    namedRegions: Object.keys(after.meta.regions.items).length,
    otherObjects: Object.values(objects).reduce((n, entries) => n + Object.keys(entries).length, 0),
    period: seed.provenance.period,
    historyCommits: history.commits.length,
    actionAdded: !!action,
    saveKey: project.saveKey,
  }),
);
