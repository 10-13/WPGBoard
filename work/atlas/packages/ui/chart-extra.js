/* Additional renderers share the chart lifecycle, accessibility and color scales. */
(function (root) {
  'use strict';
  const commonJS = typeof module !== 'undefined' && module.exports;
  const { el, button } = commonJS ? require('./controls.js') : root.AtlasUI.controls;
  const model = commonJS ? require('./chart-model.js') : root.AtlasUI.chartModel;
  const { kinds: hierarchyKinds } = commonJS
    ? require('./chart-hierarchy-model.js')
    : root.AtlasUI.hierarchyModel;
  const hierarchyCharts = commonJS ? require('./chart-hierarchy.js') : root.AtlasUI.hierarchyCharts;
  const { createColorScale } = commonJS ? require('./color-scale.js') : root.AtlasUI;
  const palette = ['#76b6ce', '#d5b16f', '#a3bb83', '#b697c0', '#d18c7c', '#7db5a6'];
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  function checkScale(scale) {
    if (!scale || typeof scale.color !== 'function' || typeof scale.grades !== 'function')
      throw new TypeError('Нужен общий экземпляр ColorScale.');
  }
  function prepare(kind, input, options) {
    if (kind === 'histogram') {
      const values = [...input];
      return { items: [], values, bins: model.histogram(values, options.bins ?? 8) };
    }
    if (kind === 'heatmap') {
      checkScale(options.scale);
      if (
        !input ||
        !Array.isArray(input.rows) ||
        !Array.isArray(input.columns) ||
        !Array.isArray(input.values)
      )
        throw new TypeError('Матрица содержит rows, columns и values.');
      const rows = input.rows.map(String),
        columns = input.columns.map(String);
      if (
        input.values.length !== rows.length ||
        input.values.some(
          (row) =>
            !Array.isArray(row) ||
            row.length !== columns.length ||
            row.some((v) => v !== null && !finite(v)),
        )
      )
        throw new TypeError('Размеры матрицы и конечные значения должны соответствовать подписям.');
      return { items: [], rows, columns, values: input.values.map((row) => [...row]) };
    }
    if (hierarchyKinds.includes(kind)) {
      if (options.scale) checkScale(options.scale);
      const orientations =
        kind === 'tree' || kind === 'cluster'
          ? ['horizontal', 'vertical', 'radial']
          : ['horizontal', 'vertical'];
      if (options.orientation !== undefined && !orientations.includes(options.orientation))
        throw new TypeError('Неизвестная ориентация иерархии.');
      return { items: [], tree: model.hierarchy(input) };
    }
    if (!Array.isArray(input)) throw new TypeError('Данные диаграммы — массив.');
    const ids = new Set();
    const items = input.map((item, i) => {
      const id = String(item.id ?? i),
        color = item.color ?? palette[i % palette.length];
      if (ids.has(id) || typeof item.label !== 'string' || !/^#[\da-f]{6}$/i.test(color))
        throw new TypeError('Нужны уникальные ID, подписи и цвета #RRGGBB.');
      ids.add(id);
      if (kind === 'scatter') {
        const size = item.size ?? 1;
        if (![item.x, item.y, size].every(finite) || size < 0)
          throw new TypeError('Точка содержит конечные x, y и неотрицательный size.');
        return { id, label: item.label, color, x: item.x, y: item.y, size };
      }
      if (
        ![item.min, item.max].every(finite) ||
        item.min > item.max ||
        (item.center != null &&
          (!finite(item.center) || item.center < item.min || item.center > item.max))
      )
        throw new TypeError('Интервал: min ≤ center ≤ max. Центр можно опустить.');
      return {
        id,
        label: item.label,
        color,
        min: item.min,
        max: item.max,
        center: item.center ?? null,
      };
    });
    const values = items.flatMap((item) =>
      kind === 'scatter' ? [item.x, item.y] : [item.min, item.max],
    );
    if (values.length && !finite(Math.max(0, ...values) - Math.min(0, ...values)))
      throw new RangeError('Слишком большой диапазон.');
    return { items };
  }
  function axes(ctx, xs, ys) {
    const { plot, svg, domain, width, options, format } = ctx;
    const xScale = domain(xs),
      yScale = domain(ys),
      height = options.height;
    const left = Math.max(32, ...yScale.ticks.map((tick) => String(format(tick)).length * 6 + 8));
    const right = Math.max(left + 16, width - 16),
      top = 16,
      bottom = height - 32;
    const x = (value) => left + xScale.ratio(value) * (right - left);
    const y = (value) => bottom - yScale.ratio(value) * (bottom - top);
    const image = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height });
    image.style.height = height + 'px';
    plot.append(image);
    for (const tick of yScale.ticks) {
      image.append(
        svg('line', { x1: left, x2: right, y1: y(tick), y2: y(tick), class: 'atlas-chart-grid' }),
      );
      image.append(
        svg(
          'text',
          { x: left - 6, y: y(tick) + 3, 'text-anchor': 'end', class: 'atlas-chart-axis' },
          format(tick),
        ),
      );
    }
    const skip = Math.max(
      1,
      Math.ceil(xScale.ticks.length / Math.max(2, Math.floor((right - left) / 48))),
    );
    xScale.ticks.forEach((tick, i) => {
      image.append(
        svg('line', { x1: x(tick), x2: x(tick), y1: top, y2: bottom, class: 'atlas-chart-grid' }),
      );
      if (i % skip === 0 || i === xScale.ticks.length - 1)
        image.append(
          svg(
            'text',
            { x: x(tick), y: height - 12, 'text-anchor': 'middle', class: 'atlas-chart-axis' },
            format(tick),
          ),
        );
    });
    return { image, x, y, left, right, bottom, top };
  }
  function histogram(ctx) {
    const { model: data, options, svg, mark, format } = ctx;
    if (!data.bins.length) return false;
    const axis = axes(
      ctx,
      data.bins.flatMap((bin) => [bin.min, bin.max]),
      data.bins.map((bin) => bin.count),
    );
    data.bins.forEach((bin, i) => {
      const label = `[${format(bin.min)}; ${format(bin.max)}${bin.closed ? ']' : ')'}`;
      const rect = svg('rect', {
        x: axis.x(bin.min),
        y: axis.y(bin.count),
        width: Math.max(0, axis.x(bin.max) - axis.x(bin.min) - 1),
        height: Math.max(0, axis.y(0) - axis.y(bin.count)),
        fill: options.color || palette[0],
      });
      axis.image.append(
        mark(rect, { id: String(i), label }, bin.count, '', {
          min: bin.min,
          max: bin.max,
          count: bin.count,
        }),
      );
    });
    ctx.caption.textContent = `Наблюдений: ${data.values.length} · Интервалов: ${data.bins.length} · Y: частота`;
    return true;
  }
  function scatter(ctx) {
    const { model: data, options, svg, mark, format, legend } = ctx;
    if (!data.items.length) return false;
    const maxSize = Math.max(...data.items.map((item) => item.size));
    const axis = axes(
      ctx,
      data.items.map((item) => item.x),
      data.items.map((item) => item.y),
    );
    // The area is proportional to size: πr² = constant × size, including zero.
    for (const item of [...data.items].sort((a, b) => b.size - a.size)) {
      const r = options.bubble ? (maxSize ? 15 * Math.sqrt(item.size / maxSize) : 0) : 3;
      const point = svg('g');
      point.append(
        svg('circle', {
          cx: axis.x(item.x),
          cy: axis.y(item.y),
          r: Math.max(7, r),
          fill: 'transparent',
        }),
      );
      point.append(
        svg('circle', {
          cx: axis.x(item.x),
          cy: axis.y(item.y),
          r,
          fill: item.color,
          'fill-opacity': options.bubble ? 0.65 : 1,
          stroke: item.color,
          'stroke-width': r ? 1 : 0,
          class: 'atlas-chart-bubble',
        }),
      );
      const description = `${item.label} · X: ${format(item.x)} · Y: ${format(item.y)}${options.bubble ? ' · Площадь: ' + format(item.size) : ''}`;
      axis.image.append(
        mark(point, { ...item, description }, item.y, '', {
          x: item.x,
          y: item.y,
          size: item.size,
        }),
      );
    }
    if (options.bubble && maxSize) {
      const key = el('div', 'atlas-chart-size-key');
      for (const fraction of [0.25, 0.5, 1]) {
        const sample = svg('svg', { viewBox: '0 0 32 32', width: 32, height: 32 });
        sample.append(
          svg('circle', {
            cx: 16,
            cy: 16,
            r: 15 * Math.sqrt(fraction),
            fill: '#76b6ce66',
            stroke: palette[0],
          }),
        );
        const cell = el('span');
        cell.append(sample, el('span', '', format(maxSize * fraction)));
        key.append(cell);
      }
      legend.append(key);
    }
    ctx.caption.textContent = `X: ${options.xLabel || 'показатель 1'} · Y: ${options.yLabel || 'показатель 2'}${options.bubble ? ' · Площадь: ' + (options.sizeLabel || 'показатель 3') : ''}`;
    return true;
  }
  function interval(ctx) {
    const { model: data, options, plot, svg, mark, format, width } = ctx;
    if (!data.items.length) return false;
    const scale = ctx.domain(data.items.flatMap((item) => [item.min, item.max]));
    for (const item of data.items) {
      const row = el('div', 'atlas-chart-interval-row');
      row.append(el('span', '', item.label));
      const image = svg('svg', { viewBox: '0 0 100 16', preserveAspectRatio: 'none', height: 16 });
      const a = 4 + scale.ratio(item.min) * 92,
        b = 4 + scale.ratio(item.max) * 92;
      const group = svg('g');
      group.append(
        svg('rect', {
          x: a - 3,
          y: 0,
          width: Math.max(6, b - a + 6),
          height: 16,
          fill: 'transparent',
        }),
      );
      for (const x of [a, b])
        group.append(
          svg('line', {
            x1: x,
            x2: x,
            y1: 3,
            y2: 13,
            stroke: item.color,
            'vector-effect': 'non-scaling-stroke',
          }),
        );
      group.append(
        svg('line', {
          x1: a,
          x2: b,
          y1: 8,
          y2: 8,
          stroke: item.color,
          'stroke-width': 2,
          'vector-effect': 'non-scaling-stroke',
        }),
      );
      if (options.center !== false && item.center !== null)
        group.append(
          svg('line', {
            x1: 4 + scale.ratio(item.center) * 92,
            x2: 4 + scale.ratio(item.center) * 92,
            y1: 1,
            y2: 15,
            stroke: '#e9e3cc',
            'stroke-width': 2,
            'vector-effect': 'non-scaling-stroke',
          }),
        );
      const description = `${item.label} · ${format(item.min)}…${format(item.max)}${item.center !== null ? ' · Центр: ' + format(item.center) : ''}`;
      image.append(
        mark(group, { ...item, description }, item.center ?? item.max, '', {
          min: item.min,
          max: item.max,
          center: item.center,
        }),
      );
      const value = el(
        'span',
        'atlas-chart-range-value',
        `${format(item.min)}…${format(item.max)}`,
      );
      row.append(image, value);
      plot.append(row);
    }
    const ticks = el('div', 'atlas-chart-range-axis');
    ticks.append(el('span', '', format(scale.lo)), el('span', '', format(scale.hi)));
    if (width) plot.append(ticks);
    ctx.caption.textContent =
      'Минимум — максимум' +
      (options.center !== false ? ' · Светлый штрих: центральное значение' : '') +
      (options.unit ? ' · ' + options.unit : '');
    return true;
  }
  function heatmap(ctx) {
    const { model: data, options, plot, legend, mark, format } = ctx;
    if (!data.rows.length || !data.columns.length) return false;
    const table = el('table', 'atlas-chart-matrix'),
      head = el('thead'),
      tr = el('tr');
    tr.append(el('th', '', options.rowLabel || 'Область'));
    data.columns.forEach((label) => {
      const cell = el('th', '', label);
      cell.scope = 'col';
      tr.append(cell);
    });
    head.append(tr);
    table.append(head);
    const body = el('tbody');
    data.rows.forEach((label, i) => {
      const row = el('tr'),
        name = el('th', '', label);
      name.scope = 'row';
      row.append(name);
      data.columns.forEach((column, j) => {
        const value = data.values[i][j],
          cell = el('td');
        if (value === null) {
          cell.append(el('span', 'atlas-chart-cell-missing', '—'));
          cell.title = `${label} · ${column} · Нет данных`;
        } else {
          const color = options.scale.color(value);
          const control = button('', () => {});
          control.className = 'atlas-chart-cell';
          control.style.backgroundColor = color || 'transparent';
          // Choose text contrast from the actual interpolated cell color.
          const rgb = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color || '');
          if (rgb)
            control.style.color =
              rgb
                .slice(1)
                .reduce((s, c, k) => s + parseInt(c, 16) * [0.2126, 0.7152, 0.0722][k], 0) > 145
                ? '#101c24'
                : '#f0f3ec';
          if (options.values !== false) control.textContent = format(value);
          cell.append(
            mark(control, { id: `${i}:${j}`, label: `${label} · ${column}` }, value, '', {
              row: i,
              column: j,
            }),
          );
        }
        row.append(cell);
      });
      body.append(row);
    });
    table.append(body);
    plot.append(table);
    legend.append(
      createColorScale(options.scale, {
        label: options.label || 'Шкала матрицы',
        formatValue: format,
        steps: 5,
      }),
    );
    ctx.caption.textContent = options.unit || 'Значение → цвет · — нет данных';
    return true;
  }
  const renderers = { histogram, scatter, interval, heatmap };
  const api = Object.freeze({
    prepare,
    render: (kind, ctx) =>
      hierarchyKinds.includes(kind) ? hierarchyCharts.render(kind, ctx) : renderers[kind](ctx),
  });
  Object.assign((root.AtlasUI ||= {}), { chartExtra: api });
  if (commonJS) module.exports = api;
})(globalThis);
