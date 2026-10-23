/* Hierarchy views share navigation, data, labels and the same color scale. */
(function (root) {
  'use strict';
  const commonJS = typeof module !== 'undefined' && module.exports;
  const { el, button } = commonJS ? require('./controls.js') : root.AtlasUI.controls;
  const { createDataRow } = commonJS ? require('./data-view.js') : root.AtlasUI.dataView;
  const { createColorScale } = commonJS ? require('./color-scale.js') : root.AtlasUI;
  const geometry = commonJS ? require('./chart-model.js') : root.AtlasUI.chartModel;
  const layouts = commonJS ? require('./chart-hierarchy-model.js') : root.AtlasUI.hierarchyModel;
  const palette = ['#76b6ce', '#d5b16f', '#a3bb83', '#b697c0', '#d18c7c', '#7db5a6'];
  const tau = Math.PI * 2;
  function color(ctx, item, i = 0) {
    if (ctx.options.scale)
      return item.colorValue === undefined
        ? '#576977'
        : ctx.options.scale.color(item.colorValue) || '#576977';
    return item.color || palette[i % palette.length];
  }
  function description(ctx, item) {
    const metric =
      item.colorValue === undefined
        ? ctx.options.scale
          ? ' · Нет цветового показателя'
          : ''
        : ` · ${ctx.options.colorLabel || 'Показатель'}: ${ctx.format(item.colorValue)}${ctx.options.colorUnit || ''}`;
    return `${item.label} · ${ctx.format(item.value)}${metric}`;
  }
  function view(ctx) {
    const { model, local, plot, redraw } = ctx,
      path = [model.tree];
    for (const id of local.treePath || []) {
      const child = path.at(-1).children.find((item) => item.id === id);
      if (!child) break;
      path.push(child);
    }
    local.treePath = path.slice(1).map((item) => item.id);
    const navigate = (ids) => {
      local.treePath = ids;
      redraw();
      const focus =
        plot.querySelector?.('.atlas-hierarchy-nav button:not(:disabled)') ||
        plot.querySelector?.('.atlas-chart-mark');
      focus?.focus?.({ preventScroll: true });
    };
    const nav = el('nav', 'atlas-treemap-nav atlas-hierarchy-nav');
    nav.setAttribute('aria-label', 'Путь иерархии');
    nav.append(
      button('← Назад', () => navigate(local.treePath.slice(0, -1)), {
        disabled: path.length === 1,
      }),
    );
    path.forEach((item, i) =>
      nav.append(
        button(item.label, () => navigate(path.slice(1, i + 1).map((node) => node.id)), {
          disabled: i === path.length - 1,
        }),
      ),
    );
    plot.append(nav);
    const current = path.at(-1),
      ids = [...local.treePath];
    return {
      current,
      ids,
      navigate,
      nodePath: (node) => [
        ...ids,
        ...node
          .ancestors()
          .reverse()
          .slice(1)
          .map((n) => n.data.id),
      ],
    };
  }
  function mark(ctx, shape, item, ids, view) {
    return ctx.mark(
      shape,
      { ...item, description: description(ctx, item) },
      item.value,
      '',
      { path: ids },
      () => view.navigate(ids),
    );
  }
  function wrapped(text, width, height) {
    const columns = Math.floor(width / 6),
      maxLines = Math.floor(height / 16);
    if (columns < 1 || maxLines < 1) return null;
    const words = String(text).split(/\s+/),
      lines = [];
    let line = '';
    for (let word of words) {
      if (line && line.length + word.length + 1 > columns) {
        lines.push(line);
        line = '';
      }
      // Tight diagram labels are omitted; their full text remains in hover/focus and the table.
      if (word.length > columns) return null;
      line = line ? line + ' ' + word : word;
    }
    if (line) lines.push(line);
    return lines.length <= maxLines ? lines : null;
  }
  function text(ctx, target, label, x, y, width, height, anchor = 'middle', test) {
    const lines = wrapped(label, width, height);
    if (!lines?.length) return false;
    const measured = Math.max(...lines.map((line) => line.length)) * 6,
      h = lines.length * 16;
    const left = anchor === 'start' ? x : anchor === 'end' ? x - measured : x - measured / 2;
    if (test && !test(left, y - h / 2, measured, h)) return false;
    const labelNode = ctx.svg('text', {
      x,
      y,
      'text-anchor': anchor,
      class: 'atlas-hierarchy-label',
      'pointer-events': 'none',
    });
    lines.forEach((line, i) =>
      labelNode.append(ctx.svg('tspan', { x, y: y - (lines.length - 1) * 8 + i * 16 + 3 }, line)),
    );
    target.append(labelNode);
    return true;
  }
  function nested(ctx, v) {
    const { plot, options, width } = ctx;
    const frame = el('div', 'atlas-treemap-frame');
    frame.style.height = options.height + 'px';
    plot.append(frame);
    const draw = (parent, nodes, w, h, ids, depth = 0) => {
      geometry.treemap(nodes, w, h).forEach((box, i) => {
        const item = box.item,
          container = el('div', 'atlas-treemap-tile');
        Object.assign(container.style, {
          left: box.x + 'px',
          top: box.y + 'px',
          width: box.width + 'px',
          height: box.height + 'px',
          backgroundColor: color(ctx, item, i),
        });
        const control = button('', () => {});
        control.className = 'atlas-treemap-target';
        const childPath = [...ids, item.id];
        const children = item.children.length && box.width >= 72 && box.height >= 64 && depth < 5;
        const lines = wrapped(item.label, box.width - 8, children ? 16 : box.height - 4);
        if (options.labels !== false && box.width >= 48 && box.height >= 20 && lines)
          control.textContent = item.label;
        control.classList.toggle('atlas-treemap-heading', !!children);
        container.append(mark(ctx, control, item, childPath, v));
        parent.append(container);
        if (children) {
          const inside = el('div', 'atlas-treemap-children');
          container.append(inside);
          draw(
            inside,
            item.children,
            Math.max(0, box.width - 4),
            Math.max(0, box.height - 20),
            childPath,
            depth + 1,
          );
        }
      });
    };
    if (v.current.children.length) draw(frame, v.current.children, width, options.height, v.ids);
    else {
      const leaf = el(
        'div',
        'atlas-treemap-leaf',
        `${v.current.label} · ${ctx.format(v.current.value)}`,
      );
      leaf.style.backgroundColor = color(ctx, v.current);
      frame.append(leaf);
    }
  }
  function icicle(ctx, v) {
    const { width, options, plot } = ctx,
      height = options.height,
      vertical = options.orientation === 'vertical';
    const { nodes } = layouts.layout('icicle', v.current, {
      width,
      height,
      orientation: options.orientation,
    });
    const frame = el('div', 'atlas-icicle-frame');
    frame.style.height = height + 'px';
    plot.append(frame);
    nodes.forEach((node, i) => {
      if (!node.value) return;
      const x = vertical ? node.x0 : node.y0,
        y = vertical ? node.y0 : node.x0;
      const w = vertical ? node.x1 - node.x0 : node.y1 - node.y0,
        h = vertical ? node.y1 - node.y0 : node.x1 - node.x0;
      const cell = button('', () => {});
      cell.className = 'atlas-icicle-cell';
      Object.assign(cell.style, {
        left: x + 'px',
        top: y + 'px',
        width: w + 'px',
        height: h + 'px',
        backgroundColor: color(ctx, node.data, i),
      });
      if (options.labels !== false && w >= 48 && h >= 20 && wrapped(node.data.label, w - 8, h - 4))
        cell.textContent = node.data.label;
      frame.append(mark(ctx, cell, node.data, v.nodePath(node), v));
    });
  }
  function svgFrame(ctx, height) {
    const image = ctx.svg('svg', {
      width: ctx.width,
      height,
      viewBox: `0 0 ${ctx.width} ${height}`,
      class: 'atlas-hierarchy-svg',
    });
    image.style.height = height + 'px';
    ctx.plot.append(image);
    return image;
  }
  function pack(ctx, v) {
    const { options, width, svg } = ctx,
      height = options.height;
    const { nodes } = layouts.layout('pack', v.current, { width, height });
    const image = svgFrame(ctx, height);
    nodes.forEach((node, i) => {
      if (!node.r) return;
      const group = svg('g');
      group.append(
        svg('circle', {
          cx: node.x,
          cy: node.y,
          r: node.r,
          fill: color(ctx, node.data, i),
          class: 'atlas-hierarchy-circle',
          'fill-opacity': node.children ? 0.35 : 0.85,
        }),
      );
      if (options.labels !== false) {
        const parent = !!node.children;
        text(
          ctx,
          group,
          node.data.label,
          node.x,
          parent ? node.y - node.r + 12 : node.y,
          parent ? node.r * 1.2 : node.r * 1.3,
          parent ? 16 : node.r * 1.3,
        );
      }
      image.append(mark(ctx, group, node.data, v.nodePath(node), v));
    });
  }
  function sector(svg, cx, cy, r0, r1, a0, a1, fill) {
    if (a1 - a0 >= tau - 1e-8)
      return r0 === 0
        ? svg('circle', { cx, cy, r: r1, fill, class: 'atlas-hierarchy-sector' })
        : svg('circle', {
            cx,
            cy,
            r: (r0 + r1) / 2,
            fill: 'none',
            stroke: fill,
            'stroke-width': r1 - r0,
          });
    const point = (r, a) => `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    let d = `M${point(r1, a0)} A${r1},${r1} 0 ${large} 1 ${point(r1, a1)}`;
    d += r0 ? ` L${point(r0, a1)} A${r0},${r0} 0 ${large} 0 ${point(r0, a0)} Z` : ` L${cx},${cy} Z`;
    return svg('path', { d, fill, class: 'atlas-hierarchy-sector' });
  }
  function sunburst(ctx, v) {
    const { options, width, svg } = ctx,
      height = options.height,
      cx = width / 2,
      cy = height / 2;
    const { root, nodes } = layouts.layout('sunburst', v.current, { width, height });
    const image = svgFrame(ctx, height),
      radius = Math.max(1, Math.min(width, height) / 2 - 4),
      unit = radius / (root.height + 1);
    nodes.forEach((node, i) => {
      if (!node.value || node.x1 - node.x0 < 1e-10) return;
      const r0 = node.y0 * unit,
        r1 = node.y1 * unit,
        a0 = node.x0 - Math.PI / 2,
        a1 = node.x1 - Math.PI / 2;
      const group = svg('g');
      group.append(sector(svg, cx, cy, r0, r1, a0, a1, color(ctx, node.data, i)));
      const mid = (a0 + a1) / 2,
        r = (r0 + r1) / 2;
      const x = node.depth ? cx + Math.cos(mid) * r : cx,
        y = node.depth ? cy + Math.sin(mid) * r : cy;
      if (options.labels !== false) {
        const inside = (left, top, w, h) =>
          [0, 0.5, 1].every((px) =>
            [0, 0.5, 1].every((py) => {
              const dx = left + w * px - cx,
                dy = top + h * py - cy,
                distance = Math.hypot(dx, dy);
              const angle = (((Math.atan2(dy, dx) - a0) % tau) + tau) % tau;
              return (
                distance <= r1 - 2 &&
                (!r0 || distance >= r0 + 2) &&
                (a1 - a0 >= tau - 1e-8 || angle <= a1 - a0)
              );
            }),
          );
        for (const w of [120, 96, 72, 48, 24])
          if (text(ctx, group, node.data.label, x, y, w, Math.min(48, r1 - r0), 'middle', inside))
            break;
      }
      const ids = node === root && v.ids.length ? v.ids.slice(0, -1) : v.nodePath(node);
      image.append(mark(ctx, group, node.data, ids, v));
    });
  }
  function nodeTree(kind, ctx, v) {
    const { options, width, svg } = ctx,
      orientation = options.orientation || 'horizontal';
    const radial = orientation === 'radial',
      vertical = orientation === 'vertical';
    const countLeaves = (item) =>
      item.children.length ? item.children.reduce((sum, child) => sum + countLeaves(child), 0) : 1;
    const height =
      radial || vertical
        ? options.height
        : Math.max(options.height, Math.ceil((countLeaves(v.current) * 32 + 32) / 16) * 16);
    const labelReserve =
      options.labels === false ? 16 : width < 400 ? 32 : Math.min(160, width * 0.25);
    const layoutWidth = Math.max(16, width - 32 - (vertical || radial ? 0 : labelReserve));
    const layoutHeight = Math.max(16, height - (vertical ? 64 : radial ? 64 : 32));
    const result = layouts.layout(kind, v.current, {
      width: layoutWidth,
      height: layoutHeight,
      orientation,
    });
    const image = svgFrame(ctx, height);
    const point = (node) =>
      radial
        ? [width / 2 + Math.sin(node.x) * node.y, height / 2 - Math.cos(node.x) * node.y]
        : vertical
          ? [16 + node.x, 16 + node.y]
          : [16 + node.y, 16 + node.x];
    const occupied = [],
      markers = result.nodes.map(point);
    const overlaps = (a, b) =>
      a.left < b.left + b.width + 2 &&
      a.left + a.width + 2 > b.left &&
      a.top < b.top + b.height + 2 &&
      a.top + a.height + 2 > b.top;
    const claimLabel = (left, top, w, h) => {
      const box = { left, top, width: w, height: h };
      if (
        left < 0 ||
        top < 0 ||
        left + w > width ||
        top + h > height ||
        occupied.some((other) => overlaps(box, other)) ||
        markers.some(([x, y]) => overlaps(box, { left: x - 4, top: y - 4, width: 8, height: 8 }))
      )
        return false;
      occupied.push(box);
      return true;
    };
    for (const link of result.links) {
      const [sx, sy] = point(link.source),
        [tx, ty] = point(link.target);
      let d;
      if (radial) {
        const middle = (link.source.y + link.target.y) / 2;
        d = `M${sx},${sy} C${width / 2 + Math.sin(link.source.x) * middle},${height / 2 - Math.cos(link.source.x) * middle} ${width / 2 + Math.sin(link.target.x) * middle},${height / 2 - Math.cos(link.target.x) * middle} ${tx},${ty}`;
      } else
        d = vertical
          ? `M${sx},${sy} C${sx},${(sy + ty) / 2} ${tx},${(sy + ty) / 2} ${tx},${ty}`
          : `M${sx},${sy} C${(sx + tx) / 2},${sy} ${(sx + tx) / 2},${ty} ${tx},${ty}`;
      image.append(svg('path', { d, class: 'atlas-hierarchy-link' }));
    }
    result.nodes.forEach((node, i) => {
      const [x, y] = point(node),
        group = svg('g');
      group.append(svg('circle', { cx: x, cy: y, r: 8, fill: 'transparent' }));
      group.append(
        svg('circle', {
          cx: x,
          cy: y,
          r: node.children ? 4 : 3,
          fill: color(ctx, node.data, i),
          class: 'atlas-hierarchy-node',
        }),
      );
      if (options.labels !== false) {
        if (radial) {
          const right = x >= width / 2,
            maxWidth = Math.max(0, right ? width - x - 12 : x - 12);
          if (
            !text(
              ctx,
              group,
              node.data.label,
              x + (right ? 8 : -8),
              y,
              Math.min(96, maxWidth),
              16,
              right ? 'start' : 'end',
              claimLabel,
            )
          )
            text(
              ctx,
              group,
              String(i + 1),
              x + (right ? 8 : -8),
              y,
              maxWidth,
              16,
              right ? 'start' : 'end',
              claimLabel,
            );
        } else if (vertical) {
          text(
            ctx,
            group,
            node.data.label,
            x,
            y + 16,
            Math.min(120, width / Math.max(2, countLeaves(v.current))),
            32,
            'middle',
            claimLabel,
          ) || text(ctx, group, String(i + 1), x, y + 16, 24, 16, 'middle', claimLabel);
        } else {
          const maxWidth = node.children
            ? layoutWidth / Math.max(1, result.root.height) - 16
            : labelReserve - 8;
          if (
            width < 400 ||
            !text(ctx, group, node.data.label, x + 8, y, maxWidth, 32, 'start', claimLabel)
          )
            text(
              ctx,
              group,
              String(i + 1),
              x + 8,
              y,
              Math.max(12, maxWidth),
              16,
              'start',
              claimLabel,
            );
        }
      }
      image.append(mark(ctx, group, node.data, v.nodePath(node), v));
    });
  }
  function render(kind, ctx) {
    const v = view(ctx),
      structural = kind === 'tree' || kind === 'cluster';
    if (!v.current.value && !(structural && v.current.children.length)) return false;
    if (kind === 'treemap') nested(ctx, v);
    else if (kind === 'icicle') icicle(ctx, v);
    else if (kind === 'pack') pack(ctx, v);
    else if (kind === 'sunburst') sunburst(ctx, v);
    else nodeTree(kind, ctx, v);
    if (ctx.options.scale)
      ctx.legend.append(
        createColorScale(ctx.options.scale, {
          label: ctx.options.colorLabel || 'Дополнительный показатель',
          formatValue: (value) => ctx.format(value) + (ctx.options.colorUnit || ''),
          steps: 5,
        }),
      );
    if (ctx.options.nodeList) {
      const list = el('div', 'atlas-hierarchy-key');
      const queue = [v.current],
        indices = new Map();
      for (let i = 0; i < queue.length; i++) {
        indices.set(queue[i].id, i + 1);
        queue.push(...queue[i].children);
      }
      const visit = (item, depth = 0) => {
        const row = createDataRow(`${indices.get(item.id)}. ${item.label}`, ctx.format(item.value));
        row.style.marginLeft = depth * 21 + 'px';
        list.append(row);
        item.children.forEach((child) => visit(child, depth + 1));
      };
      visit(v.current);
      ctx.legend.append(list);
    }
    ctx.caption.textContent = `${v.current.label} · Всего: ${ctx.format(v.current.value)} · Нажмите узел, чтобы раскрыть`;
    return true;
  }
  const api = Object.freeze({ render });
  Object.assign((root.AtlasUI ||= {}), { hierarchyCharts: api });
  if (commonJS) module.exports = api;
})(globalThis);
