/* An ordinary headless library registering baseline calculators in the kernel. */
(function (root) {
  'use strict';
  function registerBasicStatistics(state, { signal } = {}) {
    const geometry = state.statistics.register('basic.geometry', { title: 'Размер регионов', order: -1000, collect({ regions, allRegions }) {
      const area = regions.reduce((n, r) => n + r.area, 0), totalArea = allRegions.reduce((n, r) => n + r.area, 0);
      return { children: [
        { id: 'count', title: 'Регионов', value: regions.length }, { id: 'area', title: 'Площадь', value: area, unit: 'px²' },
        { id: 'share', title: 'Доля суши карты', value: totalArea ? area / totalArea * 100 : 0, unit: '%' },
        { id: 'minimum', title: 'Минимальный регион', value: regions.length ? regions.reduce((n, r) => Math.min(n, r.area), Infinity) : 0, unit: 'px²' },
        { id: 'maximum', title: 'Максимальный регион', value: regions.reduce((n, r) => Math.max(n, r.area), 0), unit: 'px²' }
      ] };
    } }, { signal });
    const numeric = state.statistics.register('basic.metadata', { title: 'Метаданные и числовые статы', order: 1000, collect({ entries, handledKeys }) {
      const handled = new Set(handledKeys), sums = new Map();
      for (const { entry } of entries) for (const [key, value] of Object.entries(entry.stats)) if (typeof value === 'number' && !handled.has(key)) sums.set(key, (sums.get(key) || 0) + value);
      return { children: [{ id: 'entries', title: 'Записей', value: entries.length }, { id: 'stats', title: 'Числовые статы', children: [...sums].sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => ({ id, title: id, value: Number.isFinite(value) ? value : 'Переполнение числового диапазона' })) }] };
    } }, { signal });
    return { dispose() { geometry.dispose(); numeric.dispose(); } };
  }
  root.AtlasStatistics = { registerBasicStatistics }; if (typeof module !== 'undefined' && module.exports) module.exports = { registerBasicStatistics };
})(globalThis);
