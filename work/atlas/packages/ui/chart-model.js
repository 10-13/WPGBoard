/* Headless geometry for experimental charts. No game state or DOM. */
(function (root) {
  'use strict';
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  function histogram(values, count = 8) {
    if (!Array.isArray(values) || values.some((value) => !finite(value)))
      throw new TypeError('Гистограмма принимает массив конечных чисел.');
    if (!Number.isInteger(count) || count < 1 || count > 100)
      throw new RangeError('Число интервалов — от 1 до 100.');
    if (!values.length) return [];
    let min = Math.min(...values),
      max = Math.max(...values);
    if (min === max) {
      min -= 0.5;
      max += 0.5;
    }
    const step = (max - min) / count;
    if (!finite(step) || step <= 0) throw new RangeError('Слишком большой диапазон.');
    const bins = Array.from({ length: count }, (_, i) => ({
      min: min + step * i,
      max: i === count - 1 ? max : min + step * (i + 1),
      count: 0,
      closed: i === count - 1,
    }));
    for (const value of values) bins[Math.min(count - 1, Math.floor((value - min) / step))].count++;
    return bins;
  }
  function barSegments(items, mode = 'grouped') {
    if (!['ordinary', 'grouped', 'stacked', 'percent'].includes(mode))
      throw new TypeError('Неизвестный режим столбцов.');
    const count = items[0]?.values.length || 0;
    if (
      items.some(
        (item) => item.values.length !== count || item.values.some((v) => v !== null && !finite(v)),
      )
    )
      throw new TypeError('Столбцы требуют равной длины рядов и конечных чисел.');
    if (mode === 'percent' && items.some((item) => item.values.some((v) => v < 0)))
      throw new RangeError('Доли до 100% требуют неотрицательных значений.');
    const visible = mode === 'ordinary' ? items.slice(0, 1) : items;
    const result = [];
    for (let category = 0; category < count; category++) {
      let positive = 0,
        negative = 0;
      const total = visible.reduce((sum, item) => sum + (item.values[category] || 0), 0);
      if (!finite(total)) throw new RangeError('Слишком большая сумма столбца.');
      visible.forEach((item, seriesIndex) => {
        const value = item.values[category];
        if (value === null) return;
        const amount = mode === 'percent' ? (total ? 100 * (value / total) : 0) : value;
        const stacked = mode === 'stacked' || mode === 'percent';
        const start = stacked ? (amount >= 0 ? positive : negative) : 0;
        const end = start + amount;
        if (!finite(end)) throw new RangeError('Слишком большая сумма столбца.');
        if (stacked) {
          if (amount >= 0) positive = end;
          else negative = end;
        }
        result.push({
          item,
          category,
          seriesIndex,
          value,
          start,
          end,
          share: total ? (value / total) * 100 : 0,
        });
      });
    }
    return result;
  }
  function hierarchy(input) {
    const ids = new Set(),
      ancestors = new Set();
    const visit = (item, path, inheritedColor) => {
      if (!item || typeof item.label !== 'string' || ancestors.has(item))
        throw new TypeError('Нужны подписи и дерево без циклов.');
      const id = String(item.id ?? path.join('.'));
      if (ids.has(id)) throw new TypeError('ID узлов дерева должны быть уникальны.');
      ids.add(id);
      ancestors.add(item);
      const color = item.color ?? inheritedColor;
      if (color !== undefined && !/^#[\da-f]{6}$/i.test(color))
        throw new TypeError('Цвет — #RRGGBB.');
      if (item.colorValue !== undefined && !finite(item.colorValue))
        throw new TypeError('Цветовой показатель — число.');
      if (item.children !== undefined && !Array.isArray(item.children))
        throw new TypeError('children — массив.');
      const children = (item.children || []).map((child, i) => visit(child, [...path, i], color));
      const value = children.length
        ? children.reduce((sum, child) => sum + child.value, 0)
        : (item.value ?? 0);
      if (!finite(value) || value < 0)
        throw new TypeError('Площадь TreeMap — конечное неотрицательное число.');
      ancestors.delete(item);
      return { id, label: item.label, value, color, colorValue: item.colorValue, children };
    };
    return visit(input, [0]);
  }
  // Balanced binary partition: preserves areas, chooses the longer side at every split.
  function treemap(items, width, height) {
    const positive = items.filter((item) => item.value > 0);
    if (!finite(width) || !finite(height) || width < 0 || height < 0)
      throw new RangeError('Размеры TreeMap должны быть неотрицательными.');
    const output = [];
    const split = (nodes, x, y, w, h) => {
      if (!nodes.length) return;
      if (nodes.length === 1) {
        output.push({ item: nodes[0], x, y, width: w, height: h });
        return;
      }
      const total = nodes.reduce((sum, item) => sum + item.value, 0);
      let sum = nodes[0].value,
        index = 1;
      while (
        index < nodes.length - 1 &&
        Math.abs(sum + nodes[index].value - total / 2) < Math.abs(sum - total / 2)
      )
        sum += nodes[index++].value;
      const ratio = sum / total;
      if (w >= h) {
        split(nodes.slice(0, index), x, y, w * ratio, h);
        split(nodes.slice(index), x + w * ratio, y, w * (1 - ratio), h);
      } else {
        split(nodes.slice(0, index), x, y, w, h * ratio);
        split(nodes.slice(index), x, y + h * ratio, w, h * (1 - ratio));
      }
    };
    split(positive, 0, 0, width, height);
    return output;
  }
  const api = Object.freeze({ histogram, barSegments, hierarchy, treemap });
  Object.assign((root.AtlasUI ||= {}), { chartModel: api });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
