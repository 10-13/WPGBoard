/* Build a separate reusable party from the authored geography; no primary save
   or default-project data is modified. Run from anywhere with Node.js. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const outputs = path.resolve(root, '../../outputs');
const data = JSON.parse(fs.readFileSync(path.join(root, 'assets/geography-1936.json'), 'utf8'));
const legacy = JSON.parse(fs.readFileSync(path.join(root, 'default-project.json'), 'utf8'));
const assert = require('node:assert/strict');
const hash = crypto.createHash('sha256').update(Buffer.from(legacy.indexImage.split(',')[1], 'base64')).digest('hex');
assert.equal(hash, data.mapIndexSha256, 'Geography belongs to a different pixel index.');
assert.deepEqual([legacy.width, legacy.height], data.mapSize);
assert.equal(data.provinces.length, legacy.provinces.length);
const expected = new Set(legacy.provinces.map(p => p.id));
const regionIds = new Set(data.regionDefinitions.map(r => r.id));
assert.equal(regionIds.size, data.regionDefinitions.length);
for (const p of data.provinces) {
  assert(expected.delete(p.id), 'Missing, duplicate or unknown province: ' + p.id);
  assert(typeof p.name === 'string' && p.name.trim() && p.name.length <= 80);
  assert(regionIds.has(p.regionId), 'Unknown named region: ' + p.regionId);
}
assert.equal(expected.size, 0);
require('../packages/core/index.js');
require('../packages/platform/browser.js');
legacy.originalImage = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'assets/original-map.png')).toString('base64');
const project = globalThis.AtlasPlatform.normalize(legacy);
project.saveKey = 'atlas-geography-1936-v1-final';
project.meta = { campaign: { title: 'Мир · 1936' }, nations: { items: {}, owners: {}, wars: {} } };
const history = new globalThis.AtlasCore.History({ mapId: project.map.id, meta: project.meta, params: {} });
history.update(draft => {
  draft.meta.nations.names = Object.fromEntries(data.provinces.map(p => [p.id, p.name]));
  draft.meta.regions = {
    items: Object.fromEntries(data.regionDefinitions.map(r => [r.id, { ...r }])),
    assignments: Object.fromEntries(data.provinces.map(p => [p.id, p.regionId]))
  };
  draft.meta.geography = {
    template: 'geography-1936-v1', referenceDate: data.referenceDate,
    description: 'Игровая географическая основа: ' + data.provinces.length + ' провинций, ' + data.regionDefinitions.length + ' регионов.',
    notes: data.notes, sources: data.sources
  };
}, { source: 'geography-1936', label: 'География 1936: названия провинций и регионы', actionType: 'core.patch', payload: { template: 'geography-1936-v1' } });
project.history = history.toJSON();
delete project.meta; delete project.params;
project.updatedAt = Date.now();
const restored = globalThis.AtlasCore.History.fromJSON(project.history);
assert.equal(Object.keys(restored.snapshot().meta.nations.names).length, legacy.provinces.length);
assert.equal(Object.keys(restored.snapshot().meta.regions.assignments).length, legacy.provinces.length);
restored.undo(); assert.equal(restored.snapshot().meta.regions, undefined);
restored.redo(); assert.deepEqual(restored.snapshot(), history.snapshot());
const files = ['packages/core/metadata.js','packages/core/overlays.js','packages/core/province-topology.js','packages/core/index.js','packages/statistics/basic.js','packages/ui/tree-menu.js','packages/ui/region-clicks.js','packages/ui/region-selection.js','packages/ui/controls.js','packages/ui/windows.js','packages/ui/overlays.js','packages/ui/map-view.js','packages/ui/data-view.js','packages/ui/index.js','packages/platform/browser.js','extensions/nation-relations.js','extensions/nations-model.js','extensions/nation-borders.js','extensions/nations.js','extensions/regions-model.js','extensions/region-geometry.js','extensions/region-overlay.js','extensions/regions.js','extensions/history.js','extensions/files.js','extensions/metadata.js','extensions/resource-flow.js','extensions/resources-model.js','extensions/resource-catalog-data.js','extensions/resource-colors.js','extensions/resource-catalog.js','extensions/resource-catalog-ui.js','extensions/resource-richness.js','extensions/resource-markers.js','extensions/resource-overlay.js','extensions/resource-bonuses.js','extensions/resource-bonus-overlay.js','extensions/resources.js','app.js'];
const code = files.map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n');
assert(!code.toLowerCase().includes('</script'));
const css = ['style.css','packages/ui/data-view.css'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const html = fs.readFileSync(path.join(root, 'page.html'), 'utf8').replace('/*__CSS__*/', () => css).replace('/*__DATA__*/', () => JSON.stringify(project).replaceAll('<', '\\u003c')).replace('/*__JS__*/', () => code);
fs.writeFileSync(path.join(outputs, 'atlas-1936.html'), html);
fs.writeFileSync(path.join(outputs, 'atlas-1936.json'), JSON.stringify(project));
fs.writeFileSync(path.join(root, 'dist/atlas-1936.html'), html);
console.log(`Built ${data.provinces.length} named provinces / ${data.regionDefinitions.length} regions; history undo, redo and JSON roundtrip verified.`);
