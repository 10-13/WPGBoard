'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { getGameState, RegionIndex, Scope, History } = require('../packages/core/index.js');
const { GEOGRAPHY_KEYS, GEOGRAPHY_THEMES } = require('../extensions/geography-data.js');
const {
  GeographyModel,
  GEOGRAPHY_ENTRY,
  validateGeography,
  mapSignature,
  metricValue,
  surfacePressure,
  offsetLabel,
  utcTime,
  localTime,
  solarElevation,
  projectGeography,
  drawGeography,
} = require('../extensions/geography-model.js');
const { geography } = require('../extensions/geography.js');
function stats(lat = 50, lon = 10) {
  return {
    'geo.lat': lat,
    'geo.lon': lon,
    'terrain.elevation': 200,
    'terrain.relief': 100,
    'terrain.type': 'plain',
    'climate.temperature.monthly': [0, 2, 5, 10, 15, 20, 22, 21, 16, 10, 5, 1],
    'climate.pressure.monthly': [
      1010, 1011, 1012, 1013, 1014, 1015, 1016, 1017, 1018, 1019, 1020, 1021,
    ],
    'climate.precipitation.monthly': Array(12).fill(50),
    'climate.belt': 'temperate',
    'climate.soil': 'forest',
    'climate.geographicBelt': 'temperate',
    'climate.naturalZone': 'mixed',
    'time.offsetMinutes': 60,
    'time.zoneName': 'Europe/Berlin',
  };
}
function fixture(t) {
  const state = getGameState(),
    scope = new Scope();
  const index = new RegionIndex({
    width: 4,
    height: 2,
    pixels: [1, 0, 2, 3, 1, 1, 2, 3],
    regions: [
      { id: 1, area: 3, bbox: [0, 0, 2, 2], anchor: [0, 0] },
      { id: 2, area: 2, bbox: [2, 0, 1, 2], anchor: [2, 0] },
      { id: 3, area: 2, bbox: [3, 0, 1, 2], anchor: [3, 0] },
    ],
  });
  state.load(
    {
      schemaVersion: 2,
      map: {
        id: 'geography-test',
        original: { dataURL: 'data:image/png;base64,AAAA', width: 4, height: 2 },
        indexImage: 'data:image/png;base64,AAAA',
      },
      meta: {
        nations: { names: { 1: 'One' } },
        regions: { items: { named: { name: 'Region' } } },
        tiles: {
          1: {
            entries: {
              factory: {
                id: 'factory',
                title: 'Factory',
                description: 'Keep',
                source: 'resources',
                kind: 'production',
                stats: { 'resource.name': 'Steel' },
              },
            },
          },
        },
      },
    },
    index,
  );
  const model = new GeographyModel(state);
  model.registerActions(scope.signal);
  t.after(() => scope.dispose());
  const seed = {
    version: 1,
    mapSignature: mapSignature(index),
    provenance: { period: '1970–2000', sources: [] },
    provinces: [1, 2, 3].map((id) => ({ id, stats: stats(id === 3 ? -50 : 50, id * 10) })),
  };
  return { state, scope, index, model, seed };
}
test('geography is a tree and the headless vocabulary covers all twelve views', () => {
  assert.deepEqual(
    geography.children.map((d) => d.id),
    ['relief', 'climate', 'time'],
  );
  assert.deepEqual(
    geography.children[1].children.map((d) => d.id),
    ['temperature', 'pressure', 'belts', 'precipitation', 'soil', 'zones'],
  );
  assert.equal(Object.keys(GEOGRAPHY_THEMES).length, 12);
  assert.equal(Object.keys(stats()).length, Object.keys(GEOGRAPHY_KEYS).length);
});
test('seed adds complete metadata without replacing factories, province names or named regions; undo and export preserve both', (t) => {
  const { state, index, model, seed, scope } = fixture(t),
    before = state.history.snapshot();
  model.seed(seed);
  assert.equal(state.history.actions.length, 1);
  assert.equal(model.read(3)['geo.lat'], -50);
  assert.deepEqual(state.meta.tiles[1].entries.factory, before.meta.tiles[1].entries.factory);
  assert.deepEqual(state.meta.nations, before.meta.nations);
  assert.deepEqual(state.meta.regions, before.meta.regions);
  const after = state.history.snapshot();
  state.history.undo();
  assert.deepEqual(state.history.snapshot(), before);
  state.history.redo();
  assert.deepEqual(state.history.snapshot(), after);
  const project = JSON.parse(JSON.stringify(state.toJSON()));
  scope.dispose();
  state.load(project, index);
  assert.deepEqual(state.history.snapshot(), after);
  assert.equal(model.read(1)['terrain.type'], 'plain');
  const restored = History.fromJSON(project.history);
  restored.undo();
  assert.deepEqual(restored.snapshot(), before);
});
test('seed fills missing parameters and remains idempotent while preserving authored overrides', (t) => {
  const { state, model, seed } = fixture(t);
  model.update([1], { 'terrain.elevation': 999 });
  model.seed(seed);
  assert.equal(model.read(1)['terrain.elevation'], 999);
  assert.equal(model.read(1)['geo.lat'], 50);
  const n = state.history.actions.length;
  model.seed(seed);
  assert.equal(state.history.actions.length, n);
  model.update([1, 2, 2], { 'climate.soil': 'chernozem' });
  assert.equal(model.read(1)['climate.soil'], 'chernozem');
  assert.equal(model.read(2)['climate.soil'], 'chernozem');
  assert.equal(model.read(3)['climate.soil'], 'forest');
  state.history.undo();
  assert.equal(model.read(1)['climate.soil'], 'forest');
});
test('bad maps, duplicates, out-of-range values and malformed monthly data reject atomically', (t) => {
  const { state, model, seed } = fixture(t),
    before = state.history.toJSON();
  for (const fn of [
    () => model.update([1, 999], { 'terrain.elevation': 1 }),
    () => model.update([1], { 'terrain.type': 'sea' }),
    () => model.update([1], { 'climate.temperature.monthly': [1] }),
    () => model.update([1], { 'time.offsetMinutes': 60.5 }),
    () => model.update([1], { 'geo.lat': 91 }),
    () => model.update([1], { 'climate.pressure.monthly': Array(12).fill(NaN) }),
    () => model.update([1], { unknown: 42 }),
    () => model.seed({ ...seed, mapSignature: 'wrong' }),
    () =>
      model.seed({ ...seed, provinces: [seed.provinces[0], seed.provinces[0], seed.provinces[2]] }),
    () => model.seed({ ...seed, provinces: [...seed.provinces.slice(0, 2), { id: 3, stats: {} }] }),
  ])
    assert.throws(fn);
  assert.deepEqual(state.history.toJSON(), before);
  assert.doesNotThrow(() => validateGeography(stats()));
});
test('monthly norms derive weighted annual means, local seasons, annual rain and pressure at elevation', () => {
  const north = stats(),
    south = stats(-50);
  assert.equal(metricValue(north, 'temperature', { metric: 'range' }), 22);
  assert(metricValue(north, 'temperature', { metric: 'winter' }) < 2);
  assert(metricValue(south, 'temperature', { metric: 'winter' }) > 20);
  assert.equal(metricValue(north, 'temperature', { metric: 'month-6' }), 22);
  assert.equal(metricValue(north, 'precipitation'), 600);
  assert(Math.abs(metricValue(north, 'temperature') - 10.7) < 0.5);
  assert(surfacePressure(1013.25, 1000, 15) < 910);
  assert(surfacePressure(1013.25, 1000, 15) > 890);
  assert.equal(surfacePressure(1013.25, 0, 15), 1013.25);
  assert(metricValue(north, 'pressure', { reference: 'surface' }) < metricValue(north, 'pressure'));
  assert.equal(metricValue(null, 'temperature'), null);
  assert.equal(metricValue({}, 'precipitation'), null);
});
test('map colors cover only exact province pixels including upper/lower rows, never water or holes', (t) => {
  const { state, model, seed, index } = fixture(t);
  model.seed(seed);
  for (const theme of Object.keys(GEOGRAPHY_THEMES)) {
    const data = projectGeography(state.meta, index, theme, { utc: '1936-06-21T12:00:00Z' });
    assert.equal(data.colors.size, 3);
    const pixels = new Map();
    drawGeography(
      {
        clearRect() {
          pixels.clear();
        },
        fillRect(x, y, w, h) {
          assert.equal(h, 1);
          for (let xx = x; xx < x + w; xx++) {
            const id = index.idAt(xx, y);
            assert(id);
            assert.equal(this.fillStyle, data.colors.get(id));
            pixels.set(xx + ',' + y, id);
          }
        },
      },
      index,
      data.colors,
    );
    assert.equal(pixels.size, 7);
    assert(!pixels.has('1,0'));
  }
});
test('geography calculator returns domain trees for arbitrary packs and is released with its library', (t) => {
  const { state, model, seed, scope } = fixture(t);
  model.seed(seed);
  const tree = state.statistics.collect([1, 3]);
  assert.deepEqual(tree.errors, []);
  assert.equal(tree.value(['geography', 'count']), 2);
  assert.equal(tree.value(['geography', 'precipitation']), 600);
  assert.equal(tree.value(['geography', 'terrain', 'plain']), 2);
  const before = state.history.toJSON();
  state.statistics.calculate([1, 2, 3]);
  assert.deepEqual(state.history.toJSON(), before);
  scope.dispose();
  assert(!state.statistics.list.some((s) => s.id === 'geography'));
  assert(!state.actions.has('geography.update'));
  assert(model.read(1));
});
test('timezone arithmetic crosses days and handles fractional offsets independently of host timezone', () => {
  assert.equal(localTime('1936-01-01T23:00:00Z', 330), '1936-01-02 04:30');
  assert.equal(localTime('1936-01-01T01:00:00Z', -240), '1935-12-31 21:00');
  assert.equal(offsetLabel(345), 'UTC+05:45');
  assert.equal(offsetLabel(-210), 'UTC−03:30');
  for (const v of ['bad', '1700-01-01', '2300-01-01']) assert.throws(() => utcTime(v));
  assert.throws(() => localTime('1936-01-01', 1500));
});
test('solar overlay responds to UTC, longitude, seasons, dateline and polar day/night', () => {
  assert(solarElevation('2000-03-20T12:00:00Z', 0, 0) > 85);
  assert(solarElevation('2000-03-20T00:00:00Z', 0, 0) < -85);
  assert(solarElevation('2000-03-20T12:00:00Z', 0, 180) < -85);
  assert(
    Math.abs(
      solarElevation('2000-03-20T12:00:00Z', 30, 180) -
        solarElevation('2000-03-20T12:00:00Z', 30, -180),
    ) < 1e-10,
  );
  for (const hour of [0, 6, 12, 18]) {
    assert(solarElevation(`2000-06-21T${String(hour).padStart(2, '0')}:00:00Z`, 89, 0) > 0);
    assert(solarElevation(`2000-12-21T${String(hour).padStart(2, '0')}:00:00Z`, 89, 0) < 0);
  }
});
test('UTC display options, overlay order and visibility never enter game actions or exports', (t) => {
  const { state, model, seed } = fixture(t);
  model.seed(seed);
  const before = state.history.toJSON(),
    s = state.overlays.register({ id: 'geography:time:daylight', visible: false });
  t.after(() => {
    s.dispose();
    state.overlays.reset();
  });
  state.overlays.setOptions(s.id, { utc: '1936-07-05T08:00:00Z', pins: [1, 2] });
  state.overlays.setVisible(s.id, true);
  assert.deepEqual(state.history.toJSON(), before);
  assert(!JSON.stringify(state.toJSON()).includes('1936-07-05T08:00:00Z'));
});

test('independent geography fields merge across branches without replacing resource entries', (t) => {
  const { state, model, seed } = fixture(t);
  model.seed(seed);
  state.history.createBranch('climate-plan');
  state.history.checkout('climate-plan');
  model.update([1], { 'climate.temperature.monthly': Array(12).fill(15) });
  state.history.checkout('main');
  model.update([1], { 'terrain.elevation': 700 });
  state.history.merge('climate-plan');
  assert.equal(model.read(1)['terrain.elevation'], 700);
  assert.deepEqual(model.read(1)['climate.temperature.monthly'], Array(12).fill(15));
  assert.equal(state.meta.tiles[1].entries.factory.title, 'Factory');
});

test('clipping recomputes numeric map scales inside the selected area and can return to the full world', (t) => {
  const { state, model, seed, index } = fixture(t);
  model.seed(seed);
  model.update([1], { 'terrain.elevation': 100 });
  model.update([2], { 'terrain.elevation': 500 });
  model.update([3], { 'terrain.elevation': 5000 });
  const before = state.history.toJSON(),
    world = projectGeography(state.meta, index, 'elevation'),
    area = projectGeography(state.meta, index, 'elevation', { provinceIds: [1, 2, 2, 999] });
  assert.equal(world.min, 100);
  assert.equal(world.max, 5000);
  assert.equal(area.min, 100);
  assert.equal(area.max, 500);
  assert.equal(area.scopeSize, 2);
  assert.deepEqual([...area.colors.keys()], [1, 2]);
  assert.notEqual(area.colors.get(2), world.colors.get(2));
  const one = projectGeography(state.meta, index, 'temperature', { provinceIds: [1] });
  assert.equal(one.min, one.max);
  assert.equal(one.values.size, 1);
  const empty = projectGeography(state.meta, index, 'elevation', { provinceIds: [] });
  assert.equal(empty.values.size, 0);
  assert.equal(empty.min, 0);
  assert.equal(empty.max, 0);
  assert.equal(empty.scopeSize, 0);
  assert.equal(
    projectGeography(state.meta, index, 'elevation', { provinceIds: null }).values.size,
    3,
  );
  assert.deepEqual(state.history.toJSON(), before);
});
test('relief hatching varies density and stays within exact province runs, including holes and edges', () => {
  const { reliefHatchPeriod } = require('../extensions/geography-model.js');
  assert.equal(reliefHatchPeriod(0, 0, 2000), null);
  assert(reliefHatchPeriod(1900, 0, 2000) < reliefHatchPeriod(50, 0, 2000));
  assert.equal(reliefHatchPeriod(100, 100, 100), 6);
  const width = 25,
    height = 20,
    pixels = Array.from({ length: width * height }, (_, i) =>
      i % width >= 24 ? 2 : i % width === 10 && Math.floor(i / width) === 8 ? 0 : 1,
    );
  const index = new RegionIndex({
    width,
    height,
    pixels,
    regions: [
      { id: 1, area: 479, bbox: [0, 0, 24, 20], anchor: [12, 10] },
      { id: 2, area: 20, bbox: [24, 0, 1, 20], anchor: [24, 10] },
    ],
  });
  const painted = [];
  const ctx = {
    globalAlpha: 1,
    clearRect() {},
    fillRect(x, y, w, h) {
      assert.equal(w, 1);
      assert.equal(h, 1);
      assert.equal(index.idAt(x, y), 1);
      painted.push([x, y]);
    },
  };
  drawGeography(
    ctx,
    index,
    new Map([
      [1, '#35434b'],
      [2, '#7c8a8e'],
    ]),
    {
      hatching: true,
      values: new Map([
        [1, 2000],
        [2, 0],
      ]),
      min: 0,
      max: 2000,
    },
  );
  assert(painted.length > 0 && painted.length < 479 / 2);
  assert(painted.some(([x, y]) => x === 12 && y === 10));
  assert.equal(ctx.globalAlpha, 1);
  assert.equal(ctx.imageSmoothingEnabled, false);
  const row = painted.filter(([, y]) => y === 10).map(([x]) => x);
  for (let i = 1; i < row.length; i++) assert.equal(row[i] - row[i - 1], 3);
});
