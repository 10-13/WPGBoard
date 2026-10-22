/* Build a separate reusable party from the authored geography; no primary save
   or default-project data is modified. Scratch data only; run from anywhere with Node.js. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const outputs = path.resolve(root, '../../.local/parties');
fs.mkdirSync(outputs, { recursive: true });
const data = JSON.parse(fs.readFileSync(path.join(root, 'assets/geography-1936.json'), 'utf8'));
const legacy = JSON.parse(fs.readFileSync(path.join(root, 'default-project.json'), 'utf8'));
const assert = require('node:assert/strict');
const hash = crypto
  .createHash('sha256')
  .update(Buffer.from(legacy.indexImage.split(',')[1], 'base64'))
  .digest('hex');
assert.equal(hash, data.mapIndexSha256, 'Geography belongs to a different pixel index.');
assert.deepEqual([legacy.width, legacy.height], data.mapSize);
assert.equal(data.provinces.length, legacy.provinces.length);
const expected = new Set(legacy.provinces.map((p) => p.id));
const regionIds = new Set(data.regionDefinitions.map((r) => r.id));
assert.equal(regionIds.size, data.regionDefinitions.length);
for (const p of data.provinces) {
  assert(expected.delete(p.id), 'Missing, duplicate or unknown province: ' + p.id);
  assert(typeof p.name === 'string' && p.name.trim() && p.name.length <= 80);
  assert(regionIds.has(p.regionId), 'Unknown named region: ' + p.regionId);
}
assert.equal(expected.size, 0);
require('../packages/core/index.js');
require('../packages/platform/browser.js');
legacy.originalImage =
  'data:image/png;base64,' +
  fs.readFileSync(path.join(root, 'assets/original-map.png')).toString('base64');
const project = globalThis.AtlasPlatform.normalize(legacy);
project.saveKey = 'atlas-geography-1936-v1-final';
project.meta = { campaign: { title: 'Мир · 1936' }, nations: { items: {}, owners: {}, wars: {} } };
const history = new globalThis.AtlasCore.History({
  mapId: project.map.id,
  meta: project.meta,
  params: {},
});
history.update(
  (draft) => {
    draft.meta.nations.names = Object.fromEntries(data.provinces.map((p) => [p.id, p.name]));
    draft.meta.regions = {
      items: Object.fromEntries(data.regionDefinitions.map((r) => [r.id, { ...r }])),
      assignments: Object.fromEntries(data.provinces.map((p) => [p.id, p.regionId])),
    };
    draft.meta.geography = {
      template: 'geography-1936-v1',
      referenceDate: data.referenceDate,
      description:
        'Игровая географическая основа: ' +
        data.provinces.length +
        ' провинций, ' +
        data.regionDefinitions.length +
        ' регионов.',
      notes: data.notes,
      sources: data.sources,
    };
  },
  {
    source: 'geography-1936',
    label: 'География 1936: названия провинций и регионы',
    actionType: 'core.patch',
    payload: { template: 'geography-1936-v1' },
  },
);
project.history = history.toJSON();
delete project.meta;
delete project.params;
project.updatedAt = Date.now();
const restored = globalThis.AtlasCore.History.fromJSON(project.history);
assert.equal(Object.keys(restored.snapshot().meta.nations.names).length, legacy.provinces.length);
assert.equal(
  Object.keys(restored.snapshot().meta.regions.assignments).length,
  legacy.provinces.length,
);
restored.undo();
assert.equal(restored.snapshot().meta.regions, undefined);
restored.redo();
assert.deepEqual(restored.snapshot(), history.snapshot());
fs.writeFileSync(path.join(outputs, 'atlas-1936.json'), JSON.stringify(project));
console.log(
  `Prepared ${data.provinces.length} named provinces / ${data.regionDefinitions.length} regions in .local/parties.`,
);
