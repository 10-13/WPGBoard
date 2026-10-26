/* Explicit data authoring, never run by an ordinary UI build.
 * The captured province assignments are versioned, so Downloads is not a build dependency.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { History } = require('../packages/core/index.js');
const { mapSignature } = require('../extensions/geography-model.js');
const { validateCatalog } = require('../extensions/resource-catalog.js');
const root = path.resolve(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const placement = read(path.join(root, 'assets/terra-mirabilis-extraction.json'));

function applyTerraExtraction(project, source = placement) {
  const provinces = new Map(project.regions.map((province) => [province.id, province]));
  const index = {
    width: project.map.original.width,
    height: project.map.original.height,
    regions: provinces,
  };
  assert.equal(source.version, 1);
  assert.equal(project.map.id, source.mapId, 'The source and target maps must match.');
  assert.equal(mapSignature(index), source.mapSignature, 'Province geometry must match.');
  assert.equal(source.baseOutput, 1);
  assert.equal(source.unit, 'жила(ы)');
  const history = History.fromJSON(project.history);
  const before = history.snapshot();
  const catalog = structuredClone(before.meta.resources.catalog);
  validateCatalog(catalog);
  const seen = new Set();
  for (const nation of source.nations) {
    assert(catalog.resources[nation.resourceId], 'Unknown resource: ' + nation.resourceId);
    assert(/^#[0-9a-f]{6}$/i.test(nation.color), 'Invalid source color: ' + nation.name);
    catalog.resources[nation.resourceId].color = nation.color;
    for (const id of nation.provinceIds) {
      assert(Number.isInteger(id) && provinces.has(id), 'Unknown province: ' + id);
      assert(!seen.has(id), 'Duplicate province: ' + id);
      seen.add(id);
    }
  }
  for (const resource of Object.values(catalog.resources)) resource.unit = source.unit;
  const commit = history.update(
    (draft) => {
      for (const tile of Object.values(draft.meta.tiles || {})) {
        for (const [id, entry] of Object.entries(tile.entries || {})) {
          if (entry.kind === 'resource-point') delete tile.entries[id];
        }
      }
      draft.meta.tiles ||= {};
      for (const nation of source.nations) {
        const resource = catalog.resources[nation.resourceId];
        for (const provinceId of nation.provinceIds) {
          const id = 'terra-extraction-' + nation.resourceId + '-' + provinceId;
          const tile = (draft.meta.tiles[provinceId] ||= { entries: {} });
          tile.entries[id] = {
            id,
            title: 'Добыча: ' + resource.name,
            description:
              '1 жила(ы). Расстановка из «' +
              source.source.file +
              '», исходная нация: ' +
              nation.name +
              '. Провинция #' +
              provinceId +
              '.',
            source: 'resources',
            kind: 'production',
            stats: {
              'resource.name': resource.name,
              'resource.activity': 'extraction',
              'resource.unit': source.unit,
              'resource.baseOutput': source.baseOutput,
              'resource.inputs': [],
              'resource.priority': 0,
            },
          };
        }
      }
      draft.meta.resources.catalog = catalog;
      draft.meta.campaign.title = 'TerraMirabilis';
      draft.meta.economy = {
        template: 'terra-mirabilis-extraction-v1',
        sourceFile: source.source.file,
        sourceSha256: source.source.sha256,
        mapSignature: source.mapSignature,
        baseOutput: source.baseOutput,
        unit: source.unit,
        resourceSpecification: {
          url: before.meta.economy.resourceSpecification.url,
          revision: before.meta.economy.resourceSpecification.revision,
          sha256: before.meta.economy.resourceSpecification.sha256,
        },
        sourceNations: source.nations.map(({ id, name, resourceId, color }) => ({
          id,
          name,
          resourceId,
          color,
        })),
        notes: [
          'Ресурсные точки удалены. Каждая отмеченная провинция содержит одно добывающее производство с выпуском 1 жила(ы), без расходов и бонусов.',
          ...source.source.notes,
        ],
      };
    },
    {
      source: 'terra-mirabilis-import',
      label:
        before.meta.economy.template === 'terra-mirabilis-extraction-v1'
          ? 'TerraMirabilis: сохранить цвета ресурсов из исходной карты'
          : 'TerraMirabilis: заменить ресурсные точки добычей по расстановке наций',
      actionType: 'core.patch',
      payload: {
        template: 'terra-mirabilis-extraction-v1',
        sourceSha256: source.source.sha256,
        provinces: seen.size,
      },
    },
  );
  const result = { ...project, history: history.toJSON() };
  if (commit) result.updatedAt = Date.now();
  return result;
}

module.exports = { applyTerraExtraction };
if (require.main === module) {
  const input = process.argv[2] || path.join(root, 'releases/atlas-terra-mirabilis.json');
  const output =
    process.argv[3] || path.resolve(root, '../../.local/parties/atlas-terra-extraction.json');
  const result = applyTerraExtraction(read(input));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result));
  console.log(
    JSON.stringify({
      output,
      productions: placement.nations.reduce((n, nation) => n + nation.provinceIds.length, 0),
      unit: placement.unit,
      saveKey: result.saveKey,
    }),
  );
}
