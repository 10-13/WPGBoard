/* Independent original-marker party with the exact Terra Mirabilis resource list.
 * UI rollouts use update-distributions.py instead. Never regenerate user parties.
 */
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { History } = require('../packages/core/index.js');
const { validateCatalog } = require('../extensions/resource-catalog.js');
const { DEFAULT_RESOURCE_CATALOG } = require('../extensions/resource-catalog-data.js');
const { collectResourceBonusSources, projectResourceBonuses } = require('../extensions/resource-bonuses.js');
const root = path.resolve(__dirname, '..'), outputs = path.resolve(root, '../../outputs');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const geography = read(path.join(root, 'assets/geography-1936.json'));
const imported = read(path.join(root, 'assets/resource-import-1936.json'));
const specification = read(path.join(root, 'assets/terra-mirabilis-resources.json'));
validateCatalog(specification.catalog);
assert.equal(Object.keys(specification.catalog.resources).length, 8);
assert.equal(Object.keys(specification.catalog.recipes).length, 0);
assert.equal(Object.keys(DEFAULT_RESOURCE_CATALOG.resources).length, 30);
assert.equal(Object.keys(DEFAULT_RESOURCE_CATALOG.recipes).length, 23);
const filename = 'atlas-1936-resources', jsonPath = path.join(outputs, filename + '.json');
const project = fs.existsSync(jsonPath) ? read(jsonPath) : {
  ...read(path.join(outputs, 'atlas-1936-import.json')),
  saveKey: 'atlas-resource-points-1936-' + crypto.randomUUID()
};
const history = History.fromJSON(project.history), before = history.snapshot();
function checkGeography(snapshot) {
  assert.equal(Object.keys(snapshot.meta.nations.names).length, 4587);
  assert.deepEqual(snapshot.meta.regions.items, Object.fromEntries(geography.regionDefinitions.map(region => [region.id, region])));
  for (const province of geography.provinces) {
    assert.equal(snapshot.meta.nations.names[province.id], province.name);
    assert.equal(snapshot.meta.regions.assignments[province.id], province.regionId);
  }
}
function checkPoints(snapshot, exactResources) {
  const all = Object.values(snapshot.meta.tiles).flatMap(tile => Object.values(tile.entries));
  assert.equal(all.length, 69, 'Refusing to regenerate a party with user-added objects.');
  const sources = collectResourceBonusSources(snapshot.meta.tiles);
  assert.equal(sources.invalid.length, 0); assert.equal(sources.points.length, 69);
  for (const original of imported.points) {
    const point = sources.points.find(point => point.id === original.id);
    assert(point); assert.equal(point.regionId, original.provinceId); assert.equal(point.title, original.name);
    assert(point.description.includes(original.desc)); assert(point.description.includes(original.coords.join(', ')));
    assert.deepEqual(point.bonuses, [imported.bonus]);
    if (exactResources) assert.equal(point.resource, specification.catalog.resources[specification.sourceTypes[original.type]].name);
  }
  return sources;
}
checkGeography(before); checkPoints(before, false);
// Append the correction to the existing import history; do not rewrite past actions.
const corrected = history.update(draft => {
  draft.meta.campaign.title = '1936 · Ресурсные точки Terra Mirabilis';
  draft.meta.resources ||= {}; draft.meta.resources.catalog = structuredClone(specification.catalog);
  draft.meta.economy = {
    template: 'terra-mirabilis-resource-points-v1', sourceFile: imported.sourceFile,
    sourceSha256: imported.sourceSha256, resourceSpecification: structuredClone(specification.source),
    sourceTypes: structuredClone(specification.sourceTypes), bonus: structuredClone(imported.bonus),
    notes: ['Все 69 точек перенесены из ресурсы.html с исходной привязкой к провинциям.', ...specification.source.notes]
  };
  for (const original of imported.points) {
    const entry = draft.meta.tiles[original.provinceId].entries[original.id];
    const resource = specification.catalog.resources[specification.sourceTypes[original.type]]; assert(resource);
    entry.stats['resource.name'] = resource.name;
    entry.description = 'Перенос маркера №' + original.sourceIndex + ' из «ресурсы.html». Ресурс: ' + resource.name + '.\n'
      + 'Условный игровой бонус +100% к местной добыче; численное значение не задано в репозитории. Самостоятельного выпуска нет.\n'
      + 'Текст исходного файла: ' + original.desc + '\nИсходный регион: ' + original.region + '. Координаты: ' + original.coords.join(', ')
      + '\nСписок ресурсов: ' + specification.source.url;
  }
}, {
  source: 'terra-mirabilis-import', label: 'Terra Mirabilis: каталог, цвета 8 ресурсов и соответствие 69 точек',
  actionType: 'core.patch', payload: { template: 'terra-mirabilis-resource-points-v1', revision: specification.source.revision }
});
project.history = history.toJSON(); if (corrected) project.updatedAt = Date.now();
const restored = History.fromJSON(JSON.parse(JSON.stringify(project.history))), snapshot = restored.snapshot();
assert.deepEqual(snapshot, history.snapshot()); checkGeography(snapshot);
assert.deepEqual(snapshot.meta.resources.catalog, specification.catalog);
const sources = checkPoints(snapshot, true), view = projectResourceBonuses(sources, {}, specification.catalog);
assert.equal(view.pointCount, 69); assert.equal(view.byProvince.size, 68); assert.equal(view.legend.length, 8);
if (corrected) {
  restored.undo(); assert.deepEqual(restored.snapshot(), before);
  restored.redo(); assert.deepEqual(restored.snapshot(), snapshot);
}
const serialized = JSON.stringify(project), template = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const html = template.replace(/(<script id="atlas-data" type="application\/json">)[\s\S]*?(<\/script>)/,
  (_, start, end) => start + serialized.replaceAll('<', '\\u003c') + end);
assert.deepEqual(JSON.parse(html.match(/<script id="atlas-data" type="application\/json">([\s\S]*?)<\/script>/)[1]), project);
fs.writeFileSync(jsonPath, serialized);
fs.writeFileSync(path.join(outputs, filename + '.html'), html);
fs.writeFileSync(path.join(root, 'dist', filename + '.html'), html);
console.log(JSON.stringify({ provinces: 4587, namedRegions: 162, points: view.pointCount, provincesWithPoints: view.byProvince.size,
  resources: view.legend.map(row => ({ name: row.resource, points: row.pointCount })), recipes: 0,
  saveKey: project.saveKey, historyCommits: history.commits.length, correctionAdded: !!corrected }));
