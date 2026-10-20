/* Two synchronous passes over an immutable tile snapshot; exact pixel-mask painting. */
(function (root) {
  'use strict';
  const { EventBus, Scope, ReadonlyMap, clone, freeze, equal, normalizeOverlayScope } =
    root.AtlasCore || require('../core/index.js');
  const emptyTile = freeze({ entries: {} });
  const snapshot = (value) => (Object.isFrozen(value) ? value : freeze(clone(value)));
  const mod = (n, d) => ((n % d) + d) % d;
  function sync(value) {
    if (value && typeof value.then === 'function')
      throw new Error('Функции раскрашивалки должны быть синхронными.');
    return value;
  }
  function callbacks({ paint, aggregate, createState }) {
    if (typeof paint !== 'function') throw new Error('Оверлею нужна функция paint.');
    if (aggregate !== undefined && typeof aggregate !== 'function')
      throw new Error('aggregate должна быть функцией или отсутствовать.');
    if (createState !== undefined && typeof createState !== 'function')
      throw new Error('createState должна быть функцией или отсутствовать.');
  }
  function provincePaint(value) {
    if (value == null) return null;
    if (typeof value === 'string') value = { color: value };
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.color !== 'string' ||
      !value.color.trim()
    )
      throw new Error('paint должна вернуть цвет, параметры раскраски или null.');
    const {
      color,
      opacity = 1,
      fill = 'solid',
      spacing = 3,
      width = 1,
      direction = 'diagonal',
    } = value;
    if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1)
      throw new Error('Прозрачность оверлея должна быть от 0 до 1.');
    if (!['solid', 'hatch'].includes(fill)) throw new Error('Тип раскраски: solid или hatch.');
    if (
      fill === 'hatch' &&
      (!Number.isInteger(spacing) ||
        spacing < 1 ||
        !Number.isInteger(width) ||
        width < 1 ||
        width > spacing ||
        !['diagonal', 'reverse', 'horizontal', 'vertical'].includes(direction))
    )
      throw new Error('Проверьте шаг, толщину и направление штриховки.');
    return Object.freeze(
      fill === 'solid'
        ? { color, opacity, fill }
        : { color, opacity, fill, spacing, width, direction },
    );
  }
  function buildSimpleOverlay(meta, index, definition) {
    callbacks(definition);
    if (!index) throw new Error('Для раскраски нужен индекс карты.');
    const provinceIds = normalizeOverlayScope(definition.provinceIds, index);
    const ids = provinceIds === null ? [...index.regions.keys()] : provinceIds;
    const base = Object.freeze({
      meta: snapshot(meta),
      index,
      provinceIds,
      scopeSize: ids.length,
      params: snapshot(definition.params || {}),
      options: snapshot(definition.options || {}),
    });
    const tiles = ids.map((provinceId) => ({
      meta: base.meta.tiles?.[provinceId] || emptyTile,
      context: Object.freeze({ ...base, provinceId, province: index.get(provinceId) }),
    }));
    const state = definition.createState
      ? sync(definition.createState(base))
      : definition.aggregate
        ? {}
        : undefined;
    if (definition.aggregate)
      for (const tile of tiles) sync(definition.aggregate(tile.meta, state, tile.context));
    const paints = new Map();
    for (const tile of tiles) {
      const paint = provincePaint(sync(definition.paint(tile.meta, state, tile.context)));
      if (paint && paint.opacity > 0) paints.set(tile.context.provinceId, paint);
    }
    return Object.freeze({
      state,
      paints: new ReadonlyMap(paints),
      provinceIds,
      scopeSize: ids.length,
    });
  }
  function drawProvincePaints(context, index, paints) {
    // Validate first: a bad descriptor cannot leave a partly redrawn frame.
    const entries = [...paints]
      .map(([id, paint]) => [id, provincePaint(paint)])
      .filter(([id, paint]) => paint && paint.opacity > 0 && index.get(id));
    const previousAlpha = context.globalAlpha ?? 1,
      previousColor = context.fillStyle;
    context.save?.();
    try {
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, index.width, index.height);
      for (const [id, paint] of entries) {
        context.fillStyle = paint.color;
        context.globalAlpha = paint.opacity;
        const { spacing, width, direction } = paint;
        const [ax, ay] = index.get(id).anchor;
        index.forEachRun(id, (start, length) => {
          const x = start % index.width,
            y = Math.floor(start / index.width),
            end = x + length;
          if (paint.fill === 'solid') {
            context.fillRect(x, y, length, 1);
            return;
          }
          if (direction === 'horizontal') {
            if (mod(y - ay, spacing) < width) context.fillRect(x, y, length, 1);
            return;
          }
          const coordinate =
            direction === 'vertical'
              ? x - ax
              : direction === 'reverse'
                ? x - y - ax + ay
                : x + y - ax - ay;
          const first = x - mod(coordinate, spacing);
          for (let stripe = first; stripe < end; stripe += spacing) {
            const left = Math.max(x, stripe),
              right = Math.min(end, stripe + width);
            if (right > left) context.fillRect(left, y, right - left, 1);
          }
        });
      }
    } finally {
      if (context.restore) context.restore();
      else {
        context.globalAlpha = previousAlpha;
        context.fillStyle = previousColor;
      }
      context.imageSmoothingEnabled = false;
    }
  }
  class SimpleOverlay extends EventBus {
    #scope = new Scope();
    #definition;
    #initialIds;
    constructor(ctx, definition) {
      super();
      callbacks(definition);
      if (ctx.signal.aborted) throw new Error('Расширение отключено.');
      const { createState, aggregate, paint, watch, provinceIds = null, ...overlay } = definition;
      if (watch !== undefined && typeof watch !== 'function')
        throw new Error('watch должна быть функцией.');
      this.#initialIds = normalizeOverlayScope(provinceIds, ctx.state.regionIndex);
      this.#definition = { createState, aggregate, paint, watch };
      this.ctx = ctx;
      this.dirty = true;
      this.result = null;
      this.painted = null;
      this.overlay = ctx.overlay({ visible: false, lazy: true, ...overlay });
      this.options = ctx.state.overlays.getOptions(this.overlay.id);
      const dispose = () => this.dispose();
      ctx.signal.addEventListener('abort', dispose, { once: true });
      this.#scope.defer(() => ctx.signal.removeEventListener('abort', dispose));
      this.#scope.defer(() => this.overlay.dispose?.());
      const signal = this.#scope.signal;
      ctx.state.on(
        'change',
        ({ before, after }) => {
          const changed = watch
            ? watch(before, after)
            : !equal(before.meta, after.meta) || !equal(before.params, after.params);
          if (changed) this.invalidate();
          else this.emit('change', {});
        },
        { signal },
      );
      ctx.ui.on('map:ready', () => this.invalidate(), { signal });
      ctx.state.overlays.on(
        'change',
        () => {
          if (!this.overlay.visible) this.painted = null;
          this.draw();
          this.emit('change', {});
        },
        { signal },
      );
      ctx.state.overlays.on(
        'settings:change',
        () => {
          const options = ctx.state.overlays.getOptions(this.overlay.id);
          if (equal(options, this.options)) return;
          this.options = options;
          this.invalidate();
        },
        { signal },
      );
      try {
        this.draw();
      } catch (error) {
        this.dispose();
        throw error;
      }
    }
    get disposed() {
      return this.#scope.disposed;
    }
    get id() {
      return this.overlay.id;
    }
    get visible() {
      return this.overlay.visible;
    }
    setVisible(value) {
      if (this.disposed) throw new Error('Оверлей отключён.');
      return this.overlay.setVisible(value);
    }
    invalidate() {
      if (this.disposed) return;
      this.dirty = true;
      this.painted = null;
      this.draw();
      this.emit('change', {});
    }
    setOptions(patch) {
      if (this.disposed) throw new Error('Оверлей отключён.');
      if (Object.hasOwn(patch, 'provinceIds'))
        patch = {
          ...patch,
          provinceIds: normalizeOverlayScope(patch.provinceIds, this.ctx.state.regionIndex),
        };
      this.ctx.state.overlays.setOptions(this.overlay.id, {
        ...this.ctx.state.overlays.getOptions(this.overlay.id),
        ...patch,
      });
    }
    setProvinceIds(provinceIds) {
      this.setOptions({ provinceIds });
    }
    ensure() {
      if (this.disposed) throw new Error('Оверлей отключён.');
      if (this.dirty) {
        let provinceIds = Object.hasOwn(this.options, 'provinceIds')
          ? this.options.provinceIds
          : this.#initialIds;
        try {
          provinceIds = normalizeOverlayScope(provinceIds, this.ctx.state.regionIndex);
        } catch (_) {
          provinceIds = null;
        }
        this.result = buildSimpleOverlay(this.ctx.state.meta, this.ctx.state.regionIndex, {
          ...this.#definition,
          provinceIds,
          options: this.options,
          params: this.ctx.state.params,
        });
        this.dirty = false;
      }
      return this.result;
    }
    draw() {
      if (this.disposed || !this.ctx.ui.viewport.ready || !this.overlay.visible) return;
      // Do not call an overridden public ensure(): domain wrappers may expose only the accumulator.
      let result;
      try {
        result = SimpleOverlay.prototype.ensure.call(this);
      } catch (error) {
        this.overlay.context.clearRect(
          0,
          0,
          this.ctx.state.regionIndex.width,
          this.ctx.state.regionIndex.height,
        );
        this.result = null;
        throw error;
      }
      if (this.painted === result) return;
      drawProvincePaints(this.overlay.context, this.ctx.state.regionIndex, result.paints);
      this.painted = result;
    }
    dispose() {
      if (this.disposed) return;
      this.#scope.dispose();
      this.result = null;
      this.painted = null;
    }
  }
  const api = { buildSimpleOverlay, drawProvincePaints, SimpleOverlay };
  Object.assign((root.AtlasUI ||= {}), api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
