/* Headless geography metadata/actions, projections, statistics and solar time. */
(function (root) {
  'use strict';
  const { clone, normalizeOverlayScope } = root.AtlasCore || require('../packages/core/index.js');
  const { ColorScale, COLOR_SCALE_MODES } =
    typeof module !== 'undefined' && module.exports
      ? require('../packages/ui/color-scale-model.js')
      : root.AtlasUI;
  const { buildSimpleOverlay, drawProvincePaints } =
    typeof module !== 'undefined' && module.exports
      ? require('../packages/ui/simple-overlay.js')
      : root.AtlasUI;
  const {
    GEOGRAPHY_KEYS: keys,
    GEOGRAPHY_TYPES: types,
    GEOGRAPHY_THEMES: themes,
  } = root.AtlasExtensions?.GEOGRAPHY_KEYS ? root.AtlasExtensions : require('./geography-data.js');
  const ENTRY = 'geography.environment';
  const DAYS = [31, 28 + 8 / 31, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const finite = (n) => typeof n === 'number' && Number.isFinite(n);
  const mean = (values, months = values.map((_, i) => i)) =>
    months.reduce((n, i) => n + values[i] * DAYS[i], 0) / months.reduce((n, i) => n + DAYS[i], 0);
  function validateGeography(stats, patch = false) {
    if (!stats || typeof stats !== 'object' || Array.isArray(stats))
      throw new Error('Нужен объект географических статов.');
    for (const [key, value] of Object.entries(stats)) {
      const spec = keys[key];
      if (!Object.hasOwn(keys, key)) {
        if (patch) throw new Error('Неизвестный параметр: ' + key);
        continue;
      }
      if (Array.isArray(spec)) {
        const values = spec[2] ? value : [value];
        if (
          !Array.isArray(values) ||
          (spec[2] && values.length !== spec[2]) ||
          values.some((n) => !finite(n) || n < spec[0] || n > spec[1])
        )
          throw new Error('Недопустимое значение: ' + key + ' (' + spec[0] + '…' + spec[1] + ').');
        if (key === 'time.offsetMinutes' && !Number.isInteger(value))
          throw new Error('Смещение пояса задаётся целыми минутами.');
      } else if (spec === 'text') {
        if (typeof value !== 'string' || !value.trim() || value.length > 100)
          throw new Error('Укажите название часового пояса.');
      } else if (typeof value !== 'string' || !Object.hasOwn(types[spec], value))
        throw new Error('Неизвестный тип: ' + key);
    }
    return stats;
  }
  function mapSignature(index) {
    const text = JSON.stringify([
      index.width,
      index.height,
      [...index.regions.values()]
        .sort((a, b) => a.id - b.id)
        .map((r) => [r.id, r.area, ...r.bbox, ...r.anchor]),
    ]);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  function geographyEntry(stats) {
    return {
      id: ENTRY,
      title: 'География и климат',
      description:
        'Климат: среднемесячная норма 1970–2000, NOAA 20CRv3. Рельеф: GMT/SRTM15+. Почвы и зоны — игровая оценка. Источники: Мир → География → Данные и источники.',
      source: 'geography',
      kind: 'geography',
      stats: clone(stats),
    };
  }
  function readGeography(meta, id) {
    return readTileGeography(meta.tiles?.[id]);
  }
  function readTileGeography(tile) {
    const entry = tile?.entries?.[ENTRY];
    if (!entry || entry.kind !== 'geography' || entry.source !== 'geography') return null;
    try {
      return validateGeography(entry.stats);
    } catch (_) {
      return null;
    }
  }
  function metricValue(stats, theme, options = {}) {
    if (!stats) return null;
    if (theme === 'daylight') return null;
    const value = stats[themes[theme].key];
    if (value === undefined) return null;
    if (theme === 'precipitation') return value.reduce((sum, n) => sum + n, 0);
    if (!themes[theme].monthly) return value;
    let values = value;
    if (theme === 'pressure' && options.reference === 'surface') {
      if (!finite(stats['terrain.elevation']) || !stats['climate.temperature.monthly']) return null;
      values = value.map((p, i) =>
        surfacePressure(p, stats['terrain.elevation'], stats['climate.temperature.monthly'][i]),
      );
    }
    const metric = options.metric || 'annual';
    if (metric === 'range') return Math.max(...values) - Math.min(...values);
    if (/^month-\d+$/.test(metric)) {
      const i = Number(metric.slice(6));
      return i >= 0 && i < 12 ? values[i] : null;
    }
    const seasons = {
      winter: [11, 0, 1],
      spring: [2, 3, 4],
      summer: [5, 6, 7],
      autumn: [8, 9, 10],
    };
    if (seasons[metric])
      return mean(
        values,
        seasons[metric].map((i) => (i + (stats['geo.lat'] < 0 ? 6 : 0)) % 12),
      );
    return mean(values);
  }
  function surfacePressure(seaLevel, elevation, temperature) {
    return (
      seaLevel *
      Math.exp((-9.80665 * elevation) / (287.05 * (273.15 + temperature + 0.00325 * elevation)))
    );
  }
  function offsetLabel(minutes) {
    return (
      'UTC' +
      (minutes < 0 ? '−' : '+') +
      String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0') +
      ':' +
      String(Math.abs(minutes) % 60).padStart(2, '0')
    );
  }
  function utcTime(value) {
    const ms = typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isFinite(ms) || ms < Date.UTC(1800, 0, 1) || ms >= Date.UTC(2201, 0, 1))
      throw new Error('Укажите UTC-время между 1800 и 2200 годами.');
    return ms;
  }
  function localTime(value, offset) {
    if (!Number.isInteger(offset) || Math.abs(offset) > 840)
      throw new Error('Недопустимый часовой пояс.');
    return new Date(utcTime(value) + offset * 60000).toISOString().slice(0, 16).replace('T', ' ');
  }
  // NOAA fractional-year approximation. East longitudes are positive.
  function solarElevation(value, latitude, longitude) {
    const ms = utcTime(value);
    if (
      !finite(latitude) ||
      Math.abs(latitude) > 90 ||
      !finite(longitude) ||
      Math.abs(longitude) > 180
    )
      throw new Error('Нужны широта и долгота.');
    const date = new Date(ms),
      year = date.getUTCFullYear(),
      days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
    const day = Math.floor((ms - Date.UTC(year, 0, 1)) / 86400000) + 1,
      hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    const gamma = ((2 * Math.PI) / days) * (day - 1 + (hour - 12) / 24);
    const equation =
      229.18 *
      (0.000075 +
        0.001868 * Math.cos(gamma) -
        0.032077 * Math.sin(gamma) -
        0.014615 * Math.cos(2 * gamma) -
        0.040849 * Math.sin(2 * gamma));
    const declination =
      0.006918 -
      0.399912 * Math.cos(gamma) +
      0.070257 * Math.sin(gamma) -
      0.006758 * Math.cos(2 * gamma) +
      0.000907 * Math.sin(2 * gamma) -
      0.002697 * Math.cos(3 * gamma) +
      0.00148 * Math.sin(3 * gamma);
    const angle = (((hour * 60 + equation + 4 * longitude) / 4 - 180) * Math.PI) / 180,
      lat = (latitude * Math.PI) / 180;
    return (
      (Math.asin(
        Math.max(
          -1,
          Math.min(
            1,
            Math.sin(lat) * Math.sin(declination) +
              Math.cos(lat) * Math.cos(declination) * Math.cos(angle),
          ),
        ),
      ) *
        180) /
      Math.PI
    );
  }
  function colorMix(a, b, ratio) {
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return (
      '#' +
      rgb(a)
        .map((n, i) =>
          Math.round(n + (rgb(b)[i] - n) * Math.max(0, Math.min(1, ratio)))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  }
  function geographyScale(theme, min, max, mode = 'linear') {
    const palette = themes[theme]?.palette;
    if (!palette) return null;
    if (min === max) {
      const middle = (palette.length - 1) / 2,
        i = Math.min(palette.length - 2, Math.floor(middle));
      return new ColorScale(
        [{ value: min, color: colorMix(palette[i], palette[i + 1], middle - i) }],
        { mode: COLOR_SCALE_MODES.includes(mode) ? mode : 'linear' },
      );
    }
    return new ColorScale(
      palette.map((color, i) => ({
        value: i === palette.length - 1 ? max : min + ((max - min) * i) / (palette.length - 1),
        color,
      })),
      { mode: COLOR_SCALE_MODES.includes(mode) ? mode : 'linear' },
    );
  }
  function geographyColor(theme, value, min, max) {
    const spec = themes[theme];
    if (spec.category) return types[spec.category][value]?.color || null;
    if (spec.timezone) return 'hsl(' + (((((value / 60) * 37) % 360) + 360) % 360) + ',48%,57%)';
    return geographyScale(theme, min, max).color(value);
  }
  function daylightColor(elevation) {
    const t = Math.max(0, Math.min(1, (elevation + 12) / 30));
    const rgb = [24, 49, 135].map((n, i) => Math.round(n + ([255, 218, 77][i] - n) * t));
    return 'rgba(' + rgb.join(',') + ',' + (0.43 - 0.23 * t).toFixed(3) + ')';
  }
  function geographyOverlay(theme) {
    if (!themes[theme]) throw new Error('Неизвестный оверлей географии.');
    return {
      createState({ options, provinceIds, scopeSize }) {
        let utc = options.utc || '1936-01-01T12:00:00Z';
        if (theme === 'daylight') {
          try {
            utcTime(utc);
          } catch (_) {
            utc = '1936-01-01T12:00:00Z';
          }
        }
        return {
          values: new Map(),
          colors: new Map(),
          counts: new Map(),
          min: 0,
          max: 0,
          scale: null,
          numericCount: 0,
          utc,
          provinceIds,
          scopeSize,
        };
      },
      aggregate(tile, data, { provinceId, options }) {
        const stats = readTileGeography(tile);
        let value;
        if (theme === 'daylight') {
          if (!stats || !finite(stats['geo.lat']) || !finite(stats['geo.lon'])) return;
          value = solarElevation(data.utc, stats['geo.lat'], stats['geo.lon']);
        } else value = metricValue(stats, theme, options);
        if (value === null || value === undefined) return;
        data.values.set(provinceId, value);
        data.counts.set(value, (data.counts.get(value) || 0) + 1);
        if (finite(value)) {
          if (!data.numericCount++) data.min = data.max = value;
          else {
            data.min = Math.min(data.min, value);
            data.max = Math.max(data.max, value);
          }
        }
      },
      paint(_tile, data, { provinceId, options }) {
        if (!data.scale) data.scale = geographyScale(theme, data.min, data.max, options.scaleMode);
        if (!data.values.has(provinceId)) return null;
        const value = data.values.get(provinceId);
        const color =
          theme === 'daylight'
            ? daylightColor(value)
            : data.scale
              ? data.scale.color(value)
              : geographyColor(theme, value, data.min, data.max);
        data.colors.set(provinceId, color);
        if (!themes[theme].hatching) return color;
        const spacing = reliefHatchPeriod(value, data.min, data.max);
        return spacing ? { color, fill: 'hatch', spacing, opacity: 0.7 } : null;
      },
    };
  }
  function projectGeography(meta, index, theme, options = {}) {
    let provinceIds;
    try {
      provinceIds = normalizeOverlayScope(options.provinceIds, index);
    } catch (_) {
      provinceIds = null;
    }
    return buildSimpleOverlay(meta, index, { ...geographyOverlay(theme), provinceIds, options })
      .state;
  }
  function reliefHatchPeriod(value, min, max) {
    if (!finite(value) || value <= 0) return null;
    if (min === max) return 6;
    const ratio = Math.sqrt(Math.max(0, Math.min(1, (value - min) / (max - min))));
    return [12, 9, 6, 4, 3][Math.min(4, Math.floor(ratio * 5))];
  }
  function drawGeography(
    context,
    index,
    colors,
    { hatching = false, values = new Map(), min = 0, max = 0 } = {},
  ) {
    const paints = new Map();
    for (const [id, color] of colors) {
      if (!color || !index.get(id)) continue;
      if (hatching) {
        const period = reliefHatchPeriod(values.get(id), min, max);
        if (!period) continue;
        paints.set(id, { color, fill: 'hatch', spacing: period, opacity: 0.7 });
        continue;
      }
      paints.set(id, color);
    }
    drawProvincePaints(context, index, paints);
  }
  const requireIds = (ids, index) => {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.some((id) => !Number.isInteger(id) || !index.get(id))
    )
      throw new Error('Выберите существующие провинции.');
  };
  function applyGeographySeed(draft, seed, regionIndex) {
    if (
      !seed ||
      seed.version !== 1 ||
      seed.mapSignature !== mapSignature(regionIndex) ||
      !Array.isArray(seed.provinces) ||
      seed.provinces.length !== regionIndex.size
    )
      throw new Error('Набор географии предназначен для другой карты.');
    const seen = new Set();
    for (const record of seed.provinces) {
      requireIds([record.id], regionIndex);
      if (seen.has(record.id)) throw new Error('Повторная провинция в наборе.');
      seen.add(record.id);
      validateGeography(record.stats, true);
      if (Object.keys(keys).some((k) => record.stats[k] === undefined))
        throw new Error('В наборе не хватает параметров.');
      draft.meta.tiles ||= {};
      const entries = (draft.meta.tiles[record.id] ||= { entries: {} }).entries,
        previous = entries[ENTRY];
      if (previous && (previous.kind !== 'geography' || previous.source !== 'geography'))
        throw new Error('ID географии занят другой записью.');
      entries[ENTRY] = previous
        ? { ...previous, stats: { ...clone(record.stats), ...previous.stats } }
        : geographyEntry(record.stats);
      validateGeography(entries[ENTRY].stats);
    }
    draft.meta.geography ||= {};
    draft.meta.geography.environment = clone(seed.provenance);
  }
  class GeographyModel {
    constructor(state) {
      this.state = state;
    }
    read(id) {
      return readGeography(this.state.meta, id);
    }
    registerActions(signal) {
      this.state.actions.register(
        'geography.update',
        {
          label: 'География провинций',
          reduce(draft, p, { regionIndex }) {
            requireIds(p.provinceIds, regionIndex);
            validateGeography(p.patch, true);
            for (const id of new Set(p.provinceIds)) {
              draft.meta.tiles ||= {};
              const entries = (draft.meta.tiles[id] ||= { entries: {} }).entries;
              if (
                entries[ENTRY] &&
                (entries[ENTRY].kind !== 'geography' || entries[ENTRY].source !== 'geography')
              )
                throw new Error('ID географии занят другой записью.');
              const previous = entries[ENTRY] || geographyEntry({}),
                stats = { ...previous.stats, ...clone(p.patch) };
              validateGeography(stats);
              entries[ENTRY] = { ...previous, stats };
            }
          },
        },
        { signal },
      );
      this.state.actions.register(
        'geography.seed.apply',
        {
          label: 'Заполнение географии',
          reduce(draft, p, { regionIndex }) {
            applyGeographySeed(draft, p.seed, regionIndex);
          },
        },
        { signal },
      );
      this.state.statistics.register(
        'geography',
        {
          title: 'География и климат',
          order: 100,
          keys: Object.keys(keys),
          collect: ({ regionIds, meta }) => {
            const valid = regionIds.map((id) => readGeography(meta, id)).filter(Boolean),
              children = [{ id: 'count', title: 'Провинций с географией', value: valid.length }];
            for (const [id, title, unit] of [
              ['elevation', 'Средняя высота', 'м'],
              ['temperature', 'Среднегодовая температура', '°C'],
              ['pressure', 'Среднее давление у уровня моря', 'гПа'],
              ['precipitation', 'Средние годовые осадки', 'мм/год'],
            ]) {
              const values = valid.map((s) => metricValue(s, id)).filter(finite);
              children.push({
                id,
                title,
                value: values.length
                  ? values.reduce((a, b) => a + b, 0) / values.length
                  : 'Нет данных',
                unit,
              });
            }
            for (const [id, spec] of Object.entries(themes).filter(([, v]) => v.category))
              children.push({
                id,
                title: spec.title,
                children: Object.entries(types[spec.category]).map(([id, type]) => ({
                  id,
                  title: type.label,
                  value: valid.filter((s) => s[spec.key] === id).length,
                })),
              });
            return {
              children: [
                ...children,
                {
                  id: 'method',
                  title: 'Усреднение',
                  value:
                    'По провинциям, без весов по площади; сезонный размах — разница среднемесячных норм.',
                },
              ],
            };
          },
        },
        { signal },
      );
    }
    update(provinceIds, patch) {
      return this.state.dispatch(
        'geography.update',
        { provinceIds: [...new Set(provinceIds)], patch },
        { source: 'geography', label: 'География: ' + provinceIds.length + ' провинций' },
      );
    }
    seed(seed) {
      return this.state.dispatch(
        'geography.seed.apply',
        { seed },
        { source: 'geography', label: 'География: заполнение отсутствующих параметров' },
      );
    }
  }
  const api = {
    GeographyModel,
    GEOGRAPHY_ENTRY: ENTRY,
    validateGeography,
    geographyEntry,
    applyGeographySeed,
    readGeography,
    mapSignature,
    metricValue,
    surfacePressure,
    offsetLabel,
    utcTime,
    localTime,
    solarElevation,
    geographyColor,
    geographyScale,
    geographyOverlay,
    daylightColor,
    projectGeography,
    drawGeography,
    reliefHatchPeriod,
  };
  Object.assign((root.AtlasExtensions ||= {}), api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
