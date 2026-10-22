/* A scoped pixel brush and a sparse, screen-space control overlay. */
(function (root) {
  'use strict';
  const { equal } = root.AtlasCore;
  const {
    CONTROL_CHUNK_SIZE: SIZE,
    controlChunkPosition,
    decodeControlChunk,
    controlChunkPixels,
    TerritorialControlModel,
  } = root.AtlasExtensions;
  const { el, field, button, createSwitch, createSelect, createNumberInput } =
    root.AtlasUI.components;
  class TerritorialControlPainter {
    constructor(ctx, model) {
      Object.assign(this, {
        ctx,
        model,
        viewport: ctx.ui.viewport,
        cache: new Map(),
        stroke: null,
      });
      this.overlay = ctx.overlay({
        id: 'control',
        title: 'Контроль территорий',
        order: 12,
        visible: true,
        space: 'screen',
        exportDraw: (context) => this.drawTo(context, false),
      });
      this.viewport.on('camera:change', () => this.requestDraw(), { signal: ctx.signal });
      ctx.state.overlays.on(
        'change',
        () => {
          if (!this.overlay.visible) ctx.ui.regionClicks.cancelStroke();
          this.requestDraw();
        },
        { signal: ctx.signal },
      );
      ctx.state.on(
        'change',
        ({ before, after }) => {
          ctx.ui.regionClicks.cancelStroke();
          if (
            !equal(before.meta.nations?.owners, after.meta.nations?.owners) ||
            !equal(before.meta.nations?.items, after.meta.nations?.items)
          )
            this.clearCache();
          this.requestDraw();
        },
        { signal: ctx.signal },
      );
      ctx.ui.on(
        'map:ready',
        () => {
          ctx.ui.regionClicks.cancelStroke();
          this.clearCache();
          this.requestDraw();
        },
        { signal: ctx.signal },
      );
      ctx.scope.defer(() => {
        this.disposed = true;
        cancelAnimationFrame(this.frame);
        this.clearCache();
        this.overlay.canvas.width = this.overlay.canvas.height = 1;
      });
      this.requestDraw();
    }
    invalidate(keys) {
      for (const key of keys) {
        const tile = this.cache.get(key);
        if (tile) tile.canvas.width = tile.canvas.height = 1;
        this.cache.delete(key);
      }
      this.requestDraw();
    }
    clearCache() {
      this.invalidate([...this.cache.keys()]);
    }
    setStroke(stroke) {
      if (this.stroke) this.invalidate(this.stroke.buffers.keys());
      this.stroke = stroke;
      this.requestDraw();
    }
    moveStroke(event) {
      if (this.stroke) this.invalidate(this.stroke.move(event.x, event.y));
    }
    requestDraw() {
      if (this.disposed || this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        if (!this.disposed) this.draw();
      });
    }
    tile(key, chunks, preview) {
      const buffer = preview ? this.stroke?.buffers.get(key) : null,
        runs = chunks[key] || [];
      const old = this.cache.get(key);
      if (old && (buffer ? old.buffer === buffer : !old.buffer && equal(old.runs, runs)))
        return old;
      const index = this.ctx.state.regionIndex,
        origin = controlChunkPosition(key, index);
      const canvas = old?.canvas || document.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      const context = canvas.getContext('2d'),
        image = context.createImageData(SIZE, SIZE);
      image.data.set(
        controlChunkPixels(
          index,
          key,
          buffer || decodeControlChunk(runs),
          this.ctx.state.meta.nations || {},
        ),
      );
      context.putImageData(image, 0, 0);
      const tile = { canvas, runs, buffer, ...origin };
      this.cache.set(key, tile);
      return tile;
    }
    drawTo(context, preview, camera = null) {
      let chunks;
      try {
        chunks = this.model.chunks;
      } catch (error) {
        if (this.lastError !== error.message) {
          this.lastError = error.message;
          this.ctx.ui.notify(error.message);
        }
        return;
      }
      const keys = new Set(Object.keys(chunks));
      if (preview && this.stroke) for (const key of this.stroke.buffers.keys()) keys.add(key);
      context.imageSmoothingEnabled = false;
      for (const key of keys) {
        try {
          const origin = controlChunkPosition(key, this.ctx.state.regionIndex);
          if (
            camera &&
            (origin.x + SIZE < camera.left ||
              origin.x > camera.right ||
              origin.y + SIZE < camera.top ||
              origin.y > camera.bottom)
          )
            continue;
          const tile = this.tile(key, chunks, preview);
          if (camera) {
            // Adjacent tiles share device-pixel edges even at fractional zoom.
            const round = (value) => Math.round(value * camera.dpr) / camera.dpr;
            const x = round(camera.tx + tile.x * camera.scale);
            const y = round(camera.ty + tile.y * camera.scale);
            const right = round(camera.tx + (tile.x + SIZE) * camera.scale);
            const bottom = round(camera.ty + (tile.y + SIZE) * camera.scale);
            context.drawImage(tile.canvas, x, y, right - x, bottom - y);
          } else context.drawImage(tile.canvas, tile.x, tile.y);
        } catch (error) {
          if (this.lastError !== error.message) {
            this.lastError = error.message;
            this.ctx.ui.notify(error.message);
          }
        }
      }
      for (const key of [...this.cache.keys()]) if (!keys.has(key)) this.invalidate([key]);
    }
    draw() {
      const { canvas, context } = this.overlay,
        view = this.viewport;
      if (
        !this.overlay.visible ||
        !view.ready ||
        (!Object.keys(this.ctx.state.meta.territorialControl?.chunks || {}).length &&
          !this.stroke?.pixelCount)
      ) {
        canvas.width = canvas.height = 1;
        return;
      }
      const width = view.element.clientWidth,
        height = view.element.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      this.drawTo(context, true, {
        tx: view.tx,
        ty: view.ty,
        scale: view.scale,
        dpr,
        left: -view.tx / view.scale,
        top: -view.ty / view.scale,
        right: (width - view.tx) / view.scale,
        bottom: (height - view.ty) / view.scale,
      });
    }
  }
  const definition = {
    id: 'control',
    name: 'Контроль территорий',
    description: 'Кисть фактического контроля без изменения юридических владений и ресурсов.',
    start(ctx) {
      const { ui, state } = ctx,
        parent = ctx.require('nations');
      const model = new TerritorialControlModel(state);
      model.registerActions(ctx.signal);
      const painter = new TerritorialControlPainter(ctx, model);
      let nationId = null,
        radius = 4;
      function open(options = {}) {
        if (options.nationId) nationId = options.nationId;
        if (!state.meta.nations?.items?.[nationId])
          nationId = parent.activeNation || Object.keys(state.meta.nations?.items || {})[0] || '';
        return ctx.window({
          id: 'brush',
          title: 'Контроль территорий',
          x: 285,
          y: 36,
          width: 310,
          height: 250,
          render(pane, scope, tab) {
            const pick = createSelect(
              [],
              (value) => {
                ui.regionClicks.cancelStroke();
                nationId = value;
                refresh();
              },
              { label: 'Нация контроля' },
            );
            const size = createNumberInput({
              value: radius,
              min: 0,
              max: 64,
              step: 1,
              label: 'Радиус кисти, пиксели карты',
              onChange: () => {
                ui.regionClicks.cancelStroke();
                if (size.validity.valid && Number.isInteger(size.valueAsNumber))
                  radius = size.valueAsNumber;
              },
            });
            const hooks = (erase) => ({
              start(event) {
                const stroke = model.begin(erase ? null : nationId, size.valueAsNumber);
                painter.setStroke(stroke);
                painter.moveStroke(event);
              },
              move: (event) => painter.moveStroke(event),
              end(event) {
                painter.moveStroke(event);
                const stroke = painter.stroke;
                painter.setStroke(null);
                if (stroke) model.commit(stroke);
              },
              cancel: () => painter.setStroke(null),
            });
            const paint = tab.onRegionClick(() => {}, {
              id: ctx.id + ':paint',
              mode: 'active',
              label: 'Кисть контроля',
              enabled: () => !!state.meta.nations?.items?.[nationId] && painter.overlay.visible,
              stroke: hooks(false),
            });
            const erase = tab.onRegionClick(() => {}, {
              id: ctx.id + ':erase',
              mode: 'active',
              label: 'Ластик контроля',
              enabled: () => painter.overlay.visible,
              stroke: hooks(true),
            });
            const choose = (listener, enabled) => {
              if (enabled) {
                painter.overlay.setVisible(true);
                listener.activate();
              } else listener.deactivate();
            };
            const paintSwitch = createSwitch('Кисть', (on) => choose(paint, on));
            const eraseSwitch = createSwitch('Вернуть владельцу', (on) => choose(erase, on));
            const visible = createSwitch('Слой контроля', (on) => {
              if (!on) {
                paint.deactivate();
                erase.deactivate();
              }
              painter.overlay.setVisible(on);
            });
            const tools = el('div', 'form-actions');
            tools.append(paintSwitch, eraseSwitch, visible);
            const info = el('div');
            pane.append(
              field('Нация', pick),
              field('Радиус, пкс', size),
              tools,
              el(
                'p',
                'muted',
                '0 — один пиксель. Мазок — одно действие истории. Юридические владения и ресурсы не меняются.',
              ),
              el(
                'p',
                'muted',
                'Левой кнопкой или одним пальцем — рисовать. Средней кнопкой или двумя пальцами — двигать карту.',
              ),
              button('Нации', parent.openNations),
              info,
            );
            function refresh() {
              const nations = Object.values(state.meta.nations?.items || {});
              if (!nations.some((n) => n.id === nationId)) {
                nationId = nations[0]?.id || '';
                paint.deactivate();
              }
              pick.setItems(
                nations.length
                  ? nations.map((n) => [n.id, n.name])
                  : [['', 'Сначала создайте нацию']],
                { value: nationId },
              );
              paintSwitch.disabled = !nationId;
              paintSwitch.checked = paint.selected;
              eraseSwitch.checked = erase.selected;
              visible.checked = painter.overlay.visible;
              info.replaceChildren(
                root.AtlasUI.components.createDataRow(
                  'Режим',
                  paint.selected ? 'Кисть' : erase.selected ? 'Возврат владельцу' : 'Просмотр',
                ),
              );
            }
            ui.regionClicks.on('change', refresh, { signal: scope.signal });
            state.on('change', refresh, { signal: scope.signal });
            state.on('map:loaded', refresh, { signal: scope.signal });
            state.overlays.on('change', refresh, { signal: scope.signal });
            refresh();
          },
        });
      }
      ctx.windowMenu({ id: 'brush', label: 'Контроль территорий', handler: () => open() });
      ctx.menu(ui.mainMenu, {
        id: 'brush',
        path: ['Мир', 'Нации'],
        label: 'Кисть контроля территорий',
        handler: () => open(),
      });
      ui.on('territorial-control:open', open, { signal: ctx.signal });
      ctx.provide({ model, open });
    },
  };
  Object.assign((root.AtlasExtensions ||= {}), {
    TerritorialControlPainter,
    territorialControl: definition,
  });
})(globalThis);
