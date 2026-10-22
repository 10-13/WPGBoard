/* Independent parties on the approved geography. Temporary data stays in .local/parties. */
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { History } = require('../packages/core/index.js');
const { DEFAULT_RESOURCE_CATALOG: catalog } = require('../extensions/resource-catalog-data.js');
const { readResourceEntry, collectResourceStats } = require('../extensions/resources-model.js');
const root = path.resolve(__dirname, '..'),
  outputs = path.resolve(root, '../../.local/parties');
fs.mkdirSync(outputs, { recursive: true });
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const geography = read(path.join(root, 'assets/geography-1936.json'));
const profiles = read(path.join(root, 'assets/economy-1936-profiles.json'));
const sites = read(path.join(root, 'assets/economy-1936-sites.json'));
const imported = read(path.join(root, 'assets/resource-import-1936.json'));
const base = read(path.join(outputs, 'atlas-1936.json'));
assert.equal(
  crypto
    .createHash('sha256')
    .update(Buffer.from(base.map.indexImage.split(',')[1], 'base64'))
    .digest('hex'),
  geography.mapIndexSha256,
);
const provinces = new Map(geography.provinces.map((p) => [p.id, p]));
assert.equal(provinces.size, base.regions.length);
assert.equal(imported.points.length, 69);
const round = (n) => Math.round(n * 1e4) / 1e4,
  unit = profiles.units;
const name = (id) => {
  assert(catalog.resources[id], 'Unknown resource: ' + id);
  return catalog.resources[id].name;
};
const entry = (id, title, kind, resourceId, stats, description) => ({
  id,
  title,
  kind,
  source: 'resources',
  description,
  stats: {
    'resource.name': resourceId === '*' ? '*' : name(resourceId),
    'resource.activity': kind === 'production' ? 'extraction' : '*',
    'resource.unit': unit,
    ...stats,
  },
});
function put(draft, provinceId, value) {
  assert(provinces.has(provinceId));
  assert(value.id.length <= 100 && value.title.length <= 100 && value.description.length <= 8000);
  readResourceEntry(value);
  draft.meta.tiles ||= {};
  const tile = (draft.meta.tiles[provinceId] ||= { entries: {} });
  assert(!tile.entries[value.id], 'Duplicate entry: ' + value.id);
  tile.entries[value.id] = value;
}
function action(history, label, mutate) {
  history.update(mutate, {
    source: 'economy-1936',
    label,
    actionType: 'core.patch',
    payload: { template: 'economy-1936-v1' },
  });
}
function point(site, id, percent, description) {
  return entry(
    id,
    site.name,
    'resource-point',
    site.resourceId,
    {
      'resource.activity': 'extraction',
      'resource.bonuses': [{ type: 'province-percent', value: percent }],
      'economy.role': 'deposit',
      'economy.site': site.id,
    },
    description,
  );
}
const seed = {
  coal: 12,
  'iron-ore': 10,
  oil: 10,
  rubber: 6,
  bauxite: 6,
  'alloy-ore': 5,
  'tungsten-ore': 2,
  helium: 0.8,
};
const plans = {
  steel: [
    ['iron-smelting', 5],
    ['steelmaking', 10],
  ],
  tools: [['steel-tools', 20]],
  machines: [['machine-parts', 20]],
  textile: [['weaving', 10]],
  hydro: [['hydro', 0]],
  'hydro-aluminium': [
    ['hydro', 0],
    ['aluminium-smelting', 10],
  ],
  refinery: [['oil-refining', 10]],
  aircraft: [['metal-airframe', 30]],
  food: [['food-processing', 10]],
  sawmill: [['sawmill', 10]],
};
function facility(site, recipeId, priority) {
  const recipe = catalog.recipes[recipeId],
    output = recipe?.outputs[0];
  assert(recipe || recipeId === 'hydro');
  const capacity = recipeId === 'hydro' ? site.capacity * 8 : site.capacity;
  const resourceId = output?.resourceId || 'energy';
  const inputs = (recipe?.inputs || []).map((input) => ({
    resource: name(input.resourceId),
    unit,
    amount: (input.amount * capacity) / output.amount,
  }));
  return entry(
    'industry-' + site.id + '-' + recipeId,
    site.name + ' · ' + (recipe?.name || 'Гидроэнергия'),
    'production',
    resourceId,
    {
      'resource.activity': 'production',
      'resource.baseOutput': capacity,
      'resource.inputs': inputs,
      'resource.priority': priority,
      'economy.role': 'industry',
      'economy.site': site.id,
      'economy.recipe': recipeId,
    },
    'Промышленный центр около 1936 года. Мощность ' +
      capacity +
      ' ' +
      unit +
      '. ' +
      (recipe
        ? 'Расходы рассчитаны по базовому чертежу «' +
          recipe.name +
          '»; мощность предприятия задана отдельно.'
        : 'Добыча гидроэнергии без расхода угля.') +
      '\n' +
      site.note +
      '\nКоординаты: ' +
      site.coords.join(', ') +
      '. ' +
      (site.bindingNote || '') +
      '\nИсточники: ' +
      site.sources.map((key) => sites.sources[key]?.url || key).join(' · '),
  );
}
function build(kind) {
  const project = structuredClone(base),
    history = History.fromJSON(base.history);
  project.saveKey = 'atlas-1936-' + kind + '-v1';
  if (kind === 'import') {
    action(history, 'Импорт: 69 бонусных точек из ресурсы.html', (draft) => {
      draft.meta.campaign.title = '1936 · Точки из ресурсы.html';
      draft.meta.economy = {
        template: 'resource-import-1936-v1',
        sourceFile: imported.sourceFile,
        sourceSha256: imported.sourceSha256,
        notes: imported.notes,
        bonus: imported.bonus,
      };
      for (const site of imported.points)
        put(
          draft,
          site.provinceId,
          point(
            site,
            site.id,
            imported.bonus.value,
            'Перенос маркера №' +
              site.sourceIndex +
              ' из «ресурсы.html». ' +
              name(site.resourceId) +
              ': +100% к добыче в этой провинции. Самостоятельного выпуска не даёт.\nТекст исходного файла (без исторической проверки): ' +
              site.desc +
              '\nИсходный регион: ' +
              site.region +
              '. Координаты: ' +
              site.coords.join(', '),
          ),
        );
    });
  } else {
    action(history, 'Экономика 1936: базовый выпуск всех провинций', (draft) => {
      draft.meta.campaign.title = '1936 · Региональная экономика';
      draft.meta.economy = {
        template: 'economy-1936-v1',
        unit,
        referencePeriod: sites.referencePeriod,
        areaScaling: profiles.areaScaling,
        notes: [...profiles.notes, ...sites.notes],
        sources: sites.sources,
        sourceReview: sites.sourceReview,
      };
      for (const province of provinces.values()) {
        const assigned = profiles.regions[province.regionId];
        assert(assigned && assigned.name === province.region);
        const profile = profiles.profiles[assigned.profile];
        assert(profile);
        const scale = Math.max(
          profiles.areaScaling.minimum,
          Math.min(
            profiles.areaScaling.maximum,
            (province.area / profiles.areaScaling.referencePixels) ** profiles.areaScaling.exponent,
          ),
        );
        for (const [resourceId, amount] of Object.entries(profile.resources))
          put(
            draft,
            province.id,
            entry(
              'base-' + resourceId,
              'Базовый выпуск · ' + name(resourceId),
              'production',
              resourceId,
              {
                'resource.baseOutput': Math.max(0.001, round(amount * scale)),
                'resource.inputs': [],
                'resource.priority': 0,
                'resource.role': 'baseline',
                'economy.role': 'baseline',
                'economy.profile': assigned.profile,
              },
              province.region +
                '. ' +
                profile.description +
                '\nУсловный выпуск по профилю региона с поправкой на площадь провинции. Не историческая статистика.',
            ),
          );
      }
    });
    action(history, 'Экономика 1936: месторождения и плантации', (draft) => {
      for (const site of sites.deposits) {
        const tile = draft.meta.tiles[site.provinceId],
          id = 'base-' + site.resourceId;
        const existing = tile.entries[id],
          rate = seed[site.resourceId];
        assert(rate > 0);
        if (existing)
          existing.stats['resource.baseOutput'] = Math.max(
            existing.stats['resource.baseOutput'],
            rate,
          );
        else
          put(
            draft,
            site.provinceId,
            entry(
              id,
              'Базовый выпуск · ' + name(site.resourceId),
              'production',
              site.resourceId,
              {
                'resource.baseOutput': rate,
                'resource.inputs': [],
                'resource.priority': 0,
                'resource.role': 'baseline',
                'economy.role': 'baseline',
                'economy.site': site.id,
              },
              'Адресная добыча: ' +
                site.name +
                '. Игровая мощность месторождения; не оценка исторической добычи.',
            ),
          );
        put(
          draft,
          site.provinceId,
          point(
            site,
            'deposit-' + site.id,
            sites.depositBonusPercent,
            site.note +
              '\n' +
              name(site.resourceId) +
              ': +100% к добыче в этой провинции; соответствующий базовый выпуск уже создан.\nКоординаты: ' +
              site.coords.join(', ') +
              '\nИсточники: ' +
              site.sources.map((key) => sites.sources[key]?.url || key).join(' · '),
          ),
        );
      }
    });
    action(history, 'Экономика 1936: промышленные узлы и предприятия', (draft) => {
      for (const site of sites.industries) {
        assert(plans[site.specialty], 'Unknown industry: ' + site.specialty);
        for (const [recipeId, priority] of plans[site.specialty])
          put(draft, site.provinceId, facility(site, recipeId, priority));
        put(
          draft,
          site.provinceId,
          entry(
            'industry-' + site.id + '-infrastructure',
            site.name + ' · Инфраструктура',
            'resource-point',
            '*',
            {
              'resource.bonuses': [
                { type: 'province-percent', value: sites.industrialBonusPercent },
                {
                  type: 'province-input-percent',
                  value: sites.industrialInputSavingPercent,
                  inputResource: '*',
                  inputUnit: '*',
                },
              ],
              'economy.role': 'industrial-bonus',
              'economy.site': site.id,
            },
            '+50% к выпуску всех производств провинции и −10% к расходу сырья на единицу продукции. Бонусы нескольких центров в одной провинции складываются.\n' +
              site.note,
          ),
        );
      }
    });
  }
  project.history = history.toJSON();
  project.updatedAt = Date.now();
  const restored = History.fromJSON(project.history);
  assert.deepEqual(restored.snapshot(), history.snapshot());
  const count = kind === 'import' ? 1 : 3;
  for (let i = 0; i < count; i++) restored.undo();
  assert.deepEqual(restored.snapshot(), History.fromJSON(base.history).snapshot());
  for (let i = 0; i < count; i++) restored.redo();
  assert.deepEqual(restored.snapshot(), history.snapshot());
  const snapshot = restored.snapshot(),
    entries = Object.entries(snapshot.meta.tiles).flatMap(([id, tile]) =>
      Object.values(tile.entries).map((entry) => ({ regionId: +id, entry })),
    );
  for (const item of entries) readResourceEntry(item.entry);
  const started = performance.now(),
    report = collectResourceStats({ entries });
  assert.deepEqual(report.invalid, []);
  for (const r of report.resources)
    assert(r.net >= 0 && r.consumption <= r.gross + 1e-6, r.resource + ' has insufficient supply');
  const nodes = (rows) =>
    rows.reduce((n, row) => n + 1 + (row.children ? nodes(row.children) : 0), 0);
  assert(nodes(report.children) < 100000, 'Report exceeds the core tree limit.');
  if (kind === 'import') {
    assert.equal(entries.length, 69);
    assert.equal(report.allocation.length, 0);
  } else {
    assert.equal(Object.keys(snapshot.meta.tiles).length, provinces.size);
    for (const tile of Object.values(snapshot.meta.tiles))
      assert(
        Object.values(tile.entries).some(
          (e) => e.kind === 'production' && e.stats['resource.baseOutput'] > 0,
        ),
      );
    for (const site of sites.deposits)
      assert(
        report.allocation.some(
          (p) =>
            p.regionId === site.provinceId &&
            p.resource === name(site.resourceId) &&
            p.actualOutput > 0,
        ),
      );
    for (const site of sites.industries)
      assert(
        entries.some(
          (p) =>
            p.regionId === site.provinceId &&
            p.entry.kind === 'production' &&
            p.entry.stats['economy.site'] === site.id,
        ),
      );
    assert(report.resources.some((r) => r.resource === 'Сталь' && r.gross > 0));
    assert.deepEqual(snapshot.meta.regions, History.fromJSON(base.history).snapshot().meta.regions);
  }
  const filename = 'atlas-1936-' + kind;
  fs.writeFileSync(path.join(outputs, filename + '.json'), JSON.stringify(project));
  const totals = {
    kind,
    provinces: Object.keys(snapshot.meta.tiles).length,
    entries: entries.length,
    productions: report.allocation.length,
    points: entries.length - report.allocation.length,
    nodes: nodes(report.children),
    calculationMs: Math.round(performance.now() - started),
    resources: report.resources.map(({ resource, base, gross, consumption, net }) => ({
      resource,
      base,
      gross: round(gross),
      consumption: round(consumption),
      net: round(net),
    })),
  };
  console.log(JSON.stringify(totals));
  return totals;
}
const summaries = [build('import'), build('economy')];
const report = path.resolve(root, '../../.local/reports/economy-build.json');
fs.mkdirSync(path.dirname(report), { recursive: true });
fs.writeFileSync(report, JSON.stringify(summaries, null, 2));
