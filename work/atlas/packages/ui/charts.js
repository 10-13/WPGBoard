/* Experimental, domain-free charts. SVG geometry; shared HTML controls and typography. */
(function (root) {
  'use strict';
  const commonJS = typeof module !== 'undefined' && module.exports;
  const { el, button } = commonJS ? require('./controls.js') : root.AtlasUI.controls;
  const { createDataRow } = commonJS ? require('./data-view.js') : root.AtlasUI.dataView;
  const geometry = commonJS ? require('./chart-model.js') : root.AtlasUI.chartModel;
  const extra = commonJS ? require('./chart-extra.js') : root.AtlasUI.chartExtra;
  const palette = ['#76b6ce', '#d5b16f', '#a3bb83', '#b697c0', '#d18c7c', '#7db5a6'];
  const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
  function svg(tag, attributes = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function prepare(kind, input, options) {
    if (!['bar', 'line', 'pie'].includes(kind)) return extra.prepare(kind, input, options);
    if (!Array.isArray(input)) throw new TypeError('Данные диаграммы должны быть массивом.');
    const series =
      kind === 'line' || (kind === 'bar' && input.some((item) => Array.isArray(item.values)));
    const ids = new Set();
    const items = input.map((item, i) => {
      const id = String(item.id ?? i),
        color = item.color ?? palette[i % palette.length];
      if (ids.has(id) || typeof item.label !== 'string' || !/^#[\da-f]{6}$/i.test(color))
        throw new TypeError('Нужны уникальные ID, подписи и цвета #RRGGBB.');
      ids.add(id);
      const valid = (value) => typeof value === 'number' && Number.isFinite(value);
      if (series) {
        if (!Array.isArray(item.values) || item.values.some((v) => v !== null && !valid(v)))
          throw new TypeError('Ряд графика содержит числа или null для пропусков.');
        return { id, label: item.label, color, values: [...item.values] };
      }
      if (!valid(item.value) || (kind === 'pie' && item.value < 0))
        throw new TypeError('Нужно конечное число; доля круга не может быть отрицательной.');
      return { id, label: item.label, color, value: item.value };
    });
    const count = items[0]?.values?.length || 0;
    if (series && items.some((item) => item.values.length !== count))
      throw new Error('Все ряды должны иметь одинаковое число точек.');
    const labels = options.labels
      ? options.labels.map(String)
      : Array.from({ length: count }, (_, i) => String(i + 1));
    if (series && labels.length !== count)
      throw new Error('Число подписей должно совпадать с числом точек.');
    const values = series
      ? items.flatMap((item) => item.values).filter((v) => v !== null)
      : items.map((item) => item.value);
    const min = Math.min(0, ...values),
      max = Math.max(0, ...values);
    if (
      !Number.isFinite(max - min) ||
      (kind === 'pie' && !Number.isFinite(values.reduce((a, b) => a + b, 0)))
    )
      throw new Error('Слишком большой диапазон чисел.');
    if (kind === 'bar' && series) geometry.barSegments(items, options.mode || 'grouped');
    return { items, labels, series };
  }
  function domain(values) {
    let lo = Math.min(0, ...values),
      hi = Math.max(0, ...values);
    if (lo === hi) hi = lo + 1;
    const raw = (hi - lo) / 4,
      power = 10 ** Math.floor(Math.log10(raw));
    const step = ([1, 2, 5, 10].find((n) => n * power >= raw) || 10) * power;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const ticks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + step * i);
    return { lo, hi, ticks, ratio: (value) => (value - lo) / (hi - lo) };
  }
  function createChart(kind, input, initial = {}) {
    const node = el('figure', 'atlas-chart atlas-chart--' + kind);
    const plot = el('div', 'atlas-chart-plot'),
      legend = el('div', 'atlas-chart-legend');
    const caption = el('figcaption', 'atlas-chart-caption');
    node.append(plot, legend, caption);
    node.setAttribute('role', 'group');
    let options,
      model,
      width = 320,
      disposed = false;
    const hidden = new Set();
    const local = {};
    const format = (value) => (options.formatValue || ((n) => number.format(n)))(value);
    const inspect = (item, value, prefix = '') => {
      caption.textContent =
        item.description ||
        [prefix, item.label, format(value) + (options.unit ? ' ' + options.unit : '')]
          .filter(Boolean)
          .join(' · ');
    };
    function mark(shape, item, value, prefix = '', details = {}, activate) {
      shape.classList.add('atlas-chart-mark');
      shape.setAttribute('tabindex', '0');
      shape.setAttribute('role', 'button');
      shape.setAttribute(
        'aria-label',
        item.description ||
          [prefix, item.label, format(value), options.unit].filter(Boolean).join(' · '),
      );
      if (
        shape.namespaceURI === 'http://www.w3.org/2000/svg' ||
        ['rect', 'g', 'path', 'circle'].includes(shape.tagName)
      )
        shape.append(svg('title', {}, shape.getAttribute('aria-label')));
      else shape.title = shape.getAttribute('aria-label');
      shape.addEventListener('pointerenter', () => inspect(item, value, prefix));
      shape.addEventListener('focus', () => inspect(item, value, prefix));
      const select = (event) => {
        inspect(item, value, prefix);
        options.onSelect?.(
          { id: item.id, label: item.label, value, xLabel: prefix, ...details },
          event,
        );
        activate?.(event);
      };
      shape.addEventListener('click', select);
      if (shape.tagName.toLowerCase() !== 'button')
        shape.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select(event);
          }
        });
      return shape;
    }
    function legendRows(total = null) {
      if (!['pie', 'bar', 'line'].includes(kind)) return;
      if (kind === 'bar' && !model.series && options.orientation === 'horizontal') return;
      const interactive = kind !== 'bar' || model.series;
      model.items.forEach((item, i) => {
        const value = model.series
          ? kind === 'bar'
            ? item.values.reduce((sum, value) => sum + (value || 0), 0)
            : item.values.findLast((v) => v !== null)
          : item.value;
        const text = value == null ? '—' : format(value);
        const suffix =
          kind === 'pie'
            ? ' · ' +
              (hidden.has(item.id)
                ? '—'
                : number.format(total ? (item.value / total) * 100 : 0) + '%')
            : '';
        const label = kind === 'bar' && !model.series ? `${i + 1}. ${item.label}` : item.label;
        const row = !interactive
          ? el('div')
          : button('', () => {
              if (hidden.has(item.id)) hidden.delete(item.id);
              else hidden.add(item.id);
              render();
              legend.children[model.items.findIndex((row) => row.id === item.id)]?.focus?.({
                preventScroll: true,
              });
            });
        row.className = 'atlas-chart-legend-row';
        if (interactive) {
          row.setAttribute('aria-pressed', String(!hidden.has(item.id)));
          row.setAttribute('aria-label', 'Показать ряд «' + item.label + '»');
          row.title = 'Показать или скрыть «' + item.label + '»';
        }
        const swatch = el('span', 'atlas-chart-swatch');
        swatch.style.backgroundColor = item.color;
        row.append(swatch, createDataRow(label, text + suffix));
        legend.append(row);
      });
    }
    function pie(items) {
      const total = items.reduce((sum, item) => sum + item.value, 0);
      const image = svg('svg', {
        viewBox: '0 0 160 160',
        'aria-label': options.label || 'Круговая диаграмма',
      });
      plot.append(image);
      if (!total) {
        plot.append(el('div', 'atlas-chart-empty', 'Нет данных'));
        return total;
      }
      let angle = -Math.PI / 2;
      const r = 70,
        inner = options.donut ? 42 : 0;
      for (const item of items) {
        if (!item.value) continue;
        const next = angle + (item.value / total) * Math.PI * 2;
        let shape;
        if (item.value === total) {
          shape = inner
            ? svg('circle', {
                cx: 80,
                cy: 80,
                r: (r + inner) / 2,
                fill: 'none',
                stroke: item.color,
                'stroke-width': r - inner,
              })
            : svg('circle', { cx: 80, cy: 80, r, fill: item.color });
        } else {
          const point = (a, radius) => `${80 + Math.cos(a) * radius},${80 + Math.sin(a) * radius}`;
          const large = next - angle > Math.PI ? 1 : 0;
          let d = `M${point(angle, r)} A${r},${r} 0 ${large} 1 ${point(next, r)}`;
          d += inner
            ? ` L${point(next, inner)} A${inner},${inner} 0 ${large} 0 ${point(angle, inner)} Z`
            : ' L80,80 Z';
          shape = svg('path', { d, fill: item.color, stroke: '#1b252c', 'stroke-width': 1 });
        }
        image.append(mark(shape, item, item.value));
        angle = next;
      }
      if (inner) {
        const center = el('div', 'atlas-chart-center');
        center.append(el('span', 'muted', 'Всего'), el('span', '', format(total)));
        plot.append(center);
      }
      return total;
    }
    function cartesian(items) {
      const values =
        kind === 'line'
          ? items.flatMap((item) => item.values).filter((v) => v !== null)
          : items.map((item) => item.value);
      if (!values.length) {
        plot.append(el('div', 'atlas-chart-empty', 'Нет данных'));
        return;
      }
      const scale = domain(values),
        height = options.height;
      const left = Math.max(28, ...scale.ticks.map((tick) => String(format(tick)).length * 6 + 8));
      const right = Math.max(left + 16, width - 12),
        top = 12,
        bottom = height - 24;
      const y = (value) => bottom - scale.ratio(value) * (bottom - top);
      const image = svg('svg', {
        viewBox: `0 0 ${width} ${height}`,
        width,
        height,
        'aria-label': options.label || 'Диаграмма',
      });
      image.style.height = height + 'px';
      plot.append(image);
      for (const tick of scale.ticks) {
        if (options.grid || tick === 0)
          image.append(
            svg('line', {
              x1: left,
              x2: right,
              y1: y(tick),
              y2: y(tick),
              class: tick === 0 ? 'atlas-chart-baseline' : 'atlas-chart-grid',
            }),
          );
        image.append(
          svg(
            'text',
            { x: left - 6, y: y(tick) + 3, 'text-anchor': 'end', class: 'atlas-chart-axis' },
            format(tick),
          ),
        );
      }
      if (kind === 'bar') {
        const step = (right - left) / Math.max(1, items.length);
        items.forEach((item, i) => {
          const rect = svg('rect', {
            x: left + step * (i + 0.2),
            y: Math.min(y(0), y(item.value)),
            width: Math.max(1, step * 0.6),
            height: Math.abs(y(item.value) - y(0)),
            fill: item.color,
          });
          image.append(mark(rect, item, item.value));
          image.append(
            svg(
              'text',
              {
                x: left + step * (i + 0.5),
                y: height - 6,
                'text-anchor': 'middle',
                class: 'atlas-chart-axis',
              },
              i + 1,
            ),
          );
        });
        return;
      }
      const count = model.labels.length;
      const x = (i) =>
        count === 1 ? (left + right) / 2 : left + (i / Math.max(1, count - 1)) * (right - left);
      const skip = Math.max(1, Math.ceil(count / Math.max(2, Math.floor((right - left) / 42))));
      const tickIndices = [];
      for (let i = 0; i < count; i++)
        if (i % skip === 0 || i === count - 1) {
          if (i !== 0 && i !== count - 1 && count - 1 - i < skip) continue;
          tickIndices.push(i);
        }
      for (const item of items) {
        let d = '',
          connected = false;
        let segments = [],
          segment = [];
        item.values.forEach((value, i) => {
          if (value === null) {
            connected = false;
            if (segment.length) segments.push(segment);
            segment = [];
            return;
          }
          d +=
            connected && options.step
              ? `H${x(i)} V${y(value)} `
              : `${connected ? 'L' : 'M'}${x(i)},${y(value)} `;
          segment.push({ i, value });
          connected = true;
        });
        if (segment.length) segments.push(segment);
        if (options.fill)
          for (const part of segments) {
            let area = `M${x(part[0].i)},${y(0)} L${x(part[0].i)},${y(part[0].value)} `;
            part
              .slice(1)
              .forEach(
                (point) =>
                  (area += options.step
                    ? `H${x(point.i)} V${y(point.value)} `
                    : `L${x(point.i)},${y(point.value)} `),
              );
            area += `L${x(part.at(-1).i)},${y(0)} Z`;
            image.append(
              svg('path', {
                d: area,
                fill: item.color,
                'fill-opacity': 0.15,
                class: 'atlas-chart-area',
              }),
            );
          }
        image.append(
          svg('path', {
            d,
            fill: 'none',
            stroke: item.color,
            'stroke-width': 1.5,
            class: 'atlas-chart-line',
          }),
        );
        item.values.forEach((value, i) => {
          if (value === null) return;
          const point = svg('g');
          point.append(svg('circle', { cx: x(i), cy: y(value), r: 7, fill: 'transparent' }));
          point.append(
            svg('circle', {
              cx: x(i),
              cy: y(value),
              r: options.points ? 2 : 0,
              fill: item.color,
              class: 'atlas-chart-point',
            }),
          );
          image.append(mark(point, item, value, model.labels[i]));
        });
      }
      const axis = el('div', 'atlas-chart-labels'),
        columns = Math.floor(right - left);
      axis.style.marginLeft = left + 'px';
      axis.style.marginRight = width - right + 'px';
      axis.style.gridTemplateColumns = `repeat(${columns},minmax(0,1fr))`;
      const labelWidth = Math.min(
        48,
        Math.max(16, Math.floor(columns / Math.max(1, tickIndices.length) - 4)),
      );
      for (const i of tickIndices) {
        const label = el('span', '', model.labels[i]);
        const start = Math.max(
          0,
          Math.min(columns - labelWidth, Math.round(x(i) - left - labelWidth / 2)),
        );
        label.style.gridColumn = `${start + 1}/span ${labelWidth}`;
        label.style.textAlign =
          count === 1 ? 'center' : i === 0 ? 'left' : i === count - 1 ? 'right' : 'center';
        axis.append(label);
      }
      plot.append(axis);
    }
    function horizontalBars(items) {
      if (!items.length) {
        plot.append(el('div', 'atlas-chart-empty', 'Нет данных'));
        return;
      }
      const scale = domain(items.map((item) => item.value)),
        zero = scale.ratio(0) * 100;
      for (const item of items) {
        const row = button('', (event) => {
          inspect(item, item.value);
          options.onSelect?.({ id: item.id, label: item.label, value: item.value }, event);
        });
        row.className = 'atlas-chart-bar-row';
        const track = el('span', 'atlas-chart-bar-track'),
          fill = el('span', 'atlas-chart-bar-fill');
        track.style.setProperty('--chart-zero', zero + '%');
        fill.style.left = Math.min(zero, scale.ratio(item.value) * 100) + '%';
        fill.style.width = Math.abs(scale.ratio(item.value) * 100 - zero) + '%';
        fill.style.backgroundColor = item.color;
        track.append(fill);
        row.append(
          el('span', 'atlas-chart-bar-name', item.label),
          track,
          el('span', 'atlas-chart-bar-value', format(item.value)),
        );
        row.addEventListener('pointerenter', () => inspect(item, item.value));
        row.addEventListener('focus', () => inspect(item, item.value));
        plot.append(row);
      }
    }
    function seriesBars(items) {
      const mode = options.mode || 'grouped',
        horizontal = options.orientation === 'horizontal';
      const segments = geometry.barSegments(items, mode);
      if (!segments.length) {
        plot.append(el('div', 'atlas-chart-empty', 'Нет данных'));
        return;
      }
      const scale =
        mode === 'percent'
          ? { lo: 0, hi: 100, ticks: [0, 25, 50, 75, 100], ratio: (v) => v / 100 }
          : domain(segments.flatMap((segment) => [segment.start, segment.end]));
      const axisFormat = (value) =>
        mode === 'percent' ? number.format(value) + '%' : format(value);
      const height = horizontal
        ? Math.max(
            options.height,
            model.labels.length * (mode === 'grouped' ? items.length * 16 + 16 : 32) + 32,
          )
        : options.height;
      const left = horizontal
        ? 24
        : Math.max(32, ...scale.ticks.map((t) => axisFormat(t).length * 6 + 8));
      const right = Math.max(left + 16, width - 20),
        top = 16,
        bottom = height - 32;
      const image = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height });
      image.style.height = height + 'px';
      plot.append(image);
      const position = (v) =>
        horizontal
          ? left + scale.ratio(v) * (right - left)
          : bottom - scale.ratio(v) * (bottom - top);
      for (const tick of scale.ticks) {
        image.append(
          svg(
            'line',
            horizontal
              ? {
                  x1: position(tick),
                  x2: position(tick),
                  y1: top,
                  y2: bottom,
                  class: 'atlas-chart-grid',
                }
              : {
                  x1: left,
                  x2: right,
                  y1: position(tick),
                  y2: position(tick),
                  class: 'atlas-chart-grid',
                },
          ),
        );
        image.append(
          svg(
            'text',
            horizontal
              ? {
                  x: position(tick),
                  y: height - 12,
                  'text-anchor': 'middle',
                  class: 'atlas-chart-axis',
                }
              : {
                  x: left - 6,
                  y: position(tick) + 3,
                  'text-anchor': 'end',
                  class: 'atlas-chart-axis',
                },
            axisFormat(tick),
          ),
        );
      }
      const count = model.labels.length,
        step = (horizontal ? bottom - top : right - left) / Math.max(1, count);
      const grouped = mode === 'grouped',
        seriesCount = grouped ? items.length : 1;
      for (const segment of segments) {
        const { item, category, seriesIndex, value, start, end } = segment;
        const offset =
          step * (category + 0.12) + (grouped ? (seriesIndex * step * 0.76) / seriesCount : 0);
        const thickness = (step * 0.76) / seriesCount;
        const a = Math.min(position(start), position(end)),
          length = Math.abs(position(end) - position(start));
        const shape = svg(
          'rect',
          horizontal
            ? {
                x: a,
                y: top + offset,
                width: length,
                height: Math.max(0.5, thickness - 1),
                fill: item.color,
              }
            : {
                x: left + offset,
                y: a,
                width: Math.max(0.5, thickness - 1),
                height: length,
                fill: item.color,
              },
        );
        const description = `${model.labels[category]} · ${item.label} · ${format(value)}${mode === 'percent' ? ' · ' + number.format(segment.share) + '%' : ''}`;
        image.append(
          mark(shape, { ...item, description }, value, model.labels[category], {
            share: segment.share,
            category,
          }),
        );
      }
      model.labels.forEach((label, i) =>
        image.append(
          svg(
            'text',
            horizontal
              ? {
                  x: left - 8,
                  y: top + step * (i + 0.5) + 3,
                  'text-anchor': 'end',
                  class: 'atlas-chart-axis',
                }
              : {
                  x: left + step * (i + 0.5),
                  y: height - 12,
                  'text-anchor': 'middle',
                  class: 'atlas-chart-axis',
                },
            i + 1,
          ),
        ),
      );
      const labels = el('div', 'atlas-chart-category-key');
      model.labels.forEach((label, i) => labels.append(el('span', '', `${i + 1}. ${label}`)));
      plot.append(labels);
    }
    function render() {
      if (disposed) return;
      width = Math.max(96, Math.floor(node.clientWidth || 320));
      plot.replaceChildren();
      legend.replaceChildren();
      node.setAttribute('aria-label', options.label || 'Диаграмма');
      const horizontal = kind === 'bar' && options.orientation === 'horizontal';
      node.classList.toggle('atlas-chart--horizontal', horizontal);
      node.classList.toggle('atlas-chart--compact', width < 280);
      plot.style.minHeight =
        kind === 'pie' || horizontal || model.tree || ['interval', 'heatmap'].includes(kind)
          ? ''
          : options.height + 'px';
      const items = model.items.filter((item) => !hidden.has(item.id));
      let total = null;
      if (!['pie', 'bar', 'line'].includes(kind)) {
        const hasData = extra.render(kind, {
          node,
          plot,
          legend,
          caption,
          width,
          options,
          model,
          local,
          svg,
          mark,
          format,
          domain,
          redraw: render,
        });
        if (!hasData) {
          plot.style.minHeight = '48px';
          plot.append(el('div', 'atlas-chart-empty', 'Нет данных'));
          caption.textContent = 'Нет данных';
        }
        return;
      }
      if (kind === 'pie') total = pie(items);
      else if (kind === 'bar' && model.series) seriesBars(items);
      else if (horizontal) horizontalBars(items);
      else cartesian(items);
      legendRows(total);
      caption.textContent =
        kind === 'pie'
          ? 'Показано: ' + format(total) + (options.unit ? ' ' + options.unit : '')
          : options.unit || 'Значения';
    }
    node.update = (next, patch = {}) => {
      if (disposed) return node;
      const settings = { height: 160, grid: true, points: true, ...initial, ...options, ...patch };
      if (!Number.isInteger(settings.height) || settings.height < 96 || settings.height % 16 !== 0)
        throw new Error('Высота графика — не менее 96 px, кратна 16 px.');
      if (settings.formatValue !== undefined && typeof settings.formatValue !== 'function')
        throw new TypeError('formatValue должен быть функцией.');
      if (settings.onSelect !== undefined && typeof settings.onSelect !== 'function')
        throw new TypeError('onSelect должен быть функцией.');
      if (
        kind === 'bar' &&
        !['vertical', 'horizontal'].includes(settings.orientation || 'vertical')
      )
        throw new TypeError('Неизвестное направление столбцов.');
      const nextModel = prepare(kind, next, settings);
      options = settings;
      model = nextModel;
      for (const id of hidden) if (!model.items.some((item) => item.id === id)) hidden.delete(id);
      render();
      return node;
    };
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            if (Math.floor(node.clientWidth || 320) !== width) render();
          })
        : null;
    node.dispose = () => {
      disposed = true;
      observer?.disconnect();
      initial.signal?.removeEventListener('abort', node.dispose);
      node.replaceChildren();
    };
    node.update(input, initial);
    observer?.observe(node);
    initial.signal?.addEventListener('abort', node.dispose, { once: true });
    if (initial.signal?.aborted) node.dispose();
    return node;
  }
  const api = Object.freeze({
    createPieChart: (items, options) => createChart('pie', items, options),
    createBarChart: (items, options) => createChart('bar', items, options),
    createLineChart: (series, options) => createChart('line', series, options),
    createHistogram: (values, options) => createChart('histogram', values, options),
    createScatterChart: (points, options) => createChart('scatter', points, options),
    createIntervalChart: (items, options) => createChart('interval', items, options),
    createHeatmap: (matrix, options) => createChart('heatmap', matrix, options),
    createTreeMap: (tree, options) => createChart('treemap', tree, options),
    createIcicleChart: (tree, options) => createChart('icicle', tree, options),
    createSunburstChart: (tree, options) => createChart('sunburst', tree, options),
    createCirclePack: (tree, options) => createChart('pack', tree, options),
    createTreeChart: (tree, options) => createChart('tree', tree, options),
    createClusterChart: (tree, options) => createChart('cluster', tree, options),
  });
  Object.assign((root.AtlasUI ||= {}), { charts: api });
  if (commonJS) module.exports = api;
})(globalThis);
