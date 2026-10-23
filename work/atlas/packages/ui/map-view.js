(function (root) {
  'use strict';
  const { EventBus } = root.AtlasCore;
  class MapViewport extends EventBus {
    #loadGeneration = 0;
    constructor(host, state, input, regionClicks = null) {
      super();
      this.host = host;
      this.state = state;
      this.input = input;
      this.regionClicks = regionClicks;
      this.scale = 1;
      this.tx = 0;
      this.ty = 0;
      this.selectedId = null;
      this.hoverId = null;
      this.pointers = new Map();
      this.ready = false;
      this.panOnly = false;
      this.baseStyle = 'original';
      this.element = document.createElement('div');
      this.element.className = 'map-viewport';
      this.element.tabIndex = 0;
      this.element.setAttribute('aria-label', 'Карта провинций');
      this.stage = document.createElement('div');
      this.stage.className = 'map-stage';
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'map-base';
      this.stage.append(this.canvas);
      this.element.append(this.stage);
      this.overlays = new root.AtlasUI.OverlayRenderer(this.element, state.overlays);
      this.hoverCanvas = this.addOverlay({
        id: 'ui:hover',
        title: 'Наведение на провинцию',
        source: 'ui',
        order: 90,
        exportable: false,
      }).canvas;
      this.numbersCanvas = this.addOverlay({
        id: 'ui:province-ids',
        title: 'Номера провинций',
        source: 'ui',
        order: 100,
        visible: false,
        space: 'screen',
        exportDraw: (context) =>
          this.#drawIds(context, 1, 0, 0, this.canvas.width, this.canvas.height),
      }).canvas;
      this.numbersCanvas.classList.add('map-numbers');
      host.append(this.element);
      this.ctx = this.canvas.getContext('2d');
      state.overlays.on('change', () => this.drawNumbers());
      this.element.addEventListener(
        'wheel',
        (e) => {
          if (!this.ready) return;
          e.preventDefault();
          const p = this.local(e);
          this.zoom(Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.004), p.x, p.y);
        },
        { passive: false },
      );
      this.element.addEventListener('pointerdown', (e) => this.down(e));
      this.element.addEventListener('pointermove', (e) => this.move(e));
      this.element.addEventListener('pointerup', (e) => this.up(e));
      this.element.addEventListener('pointercancel', () => this.cancel());
      window.addEventListener('blur', () => this.cancel());
      window.addEventListener('pagehide', () => this.cancel());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.cancel();
      });
      this.element.addEventListener('lostpointercapture', (e) => {
        if (this.pointers.has(e.pointerId)) this.cancel();
      });
      this.element.addEventListener('pointerleave', () => {
        if (!this.pointers.size) this.setHover(null);
      });
      this.element.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!this.ready) return;
        const p = this.world(this.local(e)),
          region = state.regionIndex.at(p.x, p.y);
        this.input.emit('province:context', {
          id: region?.id || null,
          region,
          province: region,
          x: p.x,
          y: p.y,
          clientX: e.clientX,
          clientY: e.clientY,
          originalEvent: e,
        });
      });
      new ResizeObserver(() => {
        if (this.ready) {
          this.constrain();
          this.transform();
        }
      }).observe(this.element);
    }
    async load() {
      const generation = ++this.#loadGeneration;
      this.ready = false;
      this.topology = null;
      this.topologyIndex = null;
      const map = this.state.map,
        original = new Image();
      original.src = map.original.dataURL;
      const image = this.baseStyle === 'light' && map.displayImage ? new Image() : original;
      if (image !== original) image.src = map.displayImage;
      await Promise.all([original.decode(), image === original ? null : image.decode()]);
      if (generation !== this.#loadGeneration) return;
      this.originalImage = original;
      this.image = image;
      this.canvas.width = map.original.width;
      this.canvas.height = map.original.height;
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.drawImage(image, 0, 0);
      this.stage.style.width = image.width + 'px';
      this.stage.style.height = image.height + 'px';
      this.overlays.resizeWorld(image.width, image.height);
      this.selectedId = null;
      this.hoverId = null;
      this.hoverCanvas.width = 1;
      this.cancel();
      this.ready = true;
      this.fit();
      this.emit('ready', { viewport: this });
      this.input.emit('selection:change', { id: null, region: null });
    }
    async setBaseStyle(style) {
      this.baseStyle = style;
      const camera = [this.scale, this.tx, this.ty],
        selected = this.selectedId;
      await this.load();
      [this.scale, this.tx, this.ty] = camera;
      this.transform();
      this.select(selected);
    }
    addOverlay(options) {
      return this.overlays.add(options);
    }
    addLayer(options) {
      return this.addOverlay(options);
    }
    getTopology() {
      if (!this.ready) throw new Error('Дождитесь загрузки карты.');
      const index = this.state.regionIndex;
      if (this.topologyIndex !== index) {
        const source = document.createElement('canvas');
        source.width = index.width;
        source.height = index.height;
        try {
          const context = source.getContext('2d', { willReadFrequently: true });
          context.drawImage(this.originalImage, 0, 0);
          this.topology = new root.AtlasCore.ProvinceTopology(
            index,
            context.getImageData(0, 0, index.width, index.height).data,
          );
          this.topologyIndex = index;
        } finally {
          source.width = source.height = 1;
        }
      }
      return this.topology;
    }
    get showIds() {
      return this.state.overlays.get('ui:province-ids')?.visible || false;
    }
    set showIds(visible) {
      this.state.overlays.setVisible('ui:province-ids', visible);
    }
    exportCanvas() {
      const out = document.createElement('canvas');
      out.width = this.canvas.width;
      out.height = this.canvas.height;
      const ctx = out.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.canvas, 0, 0);
      this.overlays.exportTo(ctx);
      return out;
    }
    local(e) {
      const r = this.element.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    world(p) {
      return { x: (p.x - this.tx) / this.scale, y: (p.y - this.ty) / this.scale };
    }
    fitScale() {
      return Math.max(
        0.01,
        Math.min(
          (this.element.clientWidth - 28) / this.canvas.width,
          (this.element.clientHeight - 56) / this.canvas.height,
        ),
      );
    }
    fit() {
      if (!this.ready) return;
      this.scale = this.fitScale();
      this.tx = (this.element.clientWidth - this.canvas.width * this.scale) / 2;
      this.ty = (this.element.clientHeight - this.canvas.height * this.scale) / 2;
      this.transform();
    }
    zoom(factor, x = this.element.clientWidth / 2, y = this.element.clientHeight / 2) {
      if (!this.ready) return;
      const old = this.scale;
      this.scale = Math.min(15, Math.max(this.fitScale() * 0.5, old * factor));
      this.tx = x - ((x - this.tx) * this.scale) / old;
      this.ty = y - ((y - this.ty) * this.scale) / old;
      this.constrain();
      this.transform();
      this.setHover(null);
    }
    constrain() {
      const w = this.element.clientWidth,
        h = this.element.clientHeight,
        sw = this.canvas.width * this.scale,
        sh = this.canvas.height * this.scale;
      this.tx = sw < w ? (w - sw) / 2 : Math.min(w * 0.7, Math.max(w * 0.3 - sw, this.tx));
      this.ty = sh < h ? (h - sh) / 2 : Math.min(h * 0.7, Math.max(h * 0.3 - sh, this.ty));
    }
    transform() {
      this.stage.style.transform = `translate(${this.tx}px,${this.ty}px) scale(${this.scale})`;
      this.overlays.transform(this.stage.style.transform);
      this.drawNumbers();
      this.emit('camera:change', { scale: this.scale, x: this.tx, y: this.ty });
    }
    down(e) {
      if (!this.ready || ![0, 1].includes(e.button)) return;
      const p = this.local(e);
      this.pointers.set(e.pointerId, p);
      this.element.setPointerCapture(e.pointerId);
      if (this.pointers.size === 1)
        this.gesture = { start: p, last: p, moved: false, multi: false, stroke: false };
      if (this.pointers.size === 1 && e.button === 0 && !this.panOnly && !e.shiftKey) {
        if (this.regionClicks?.beginStroke(this.regionEvent(e))) {
          this.gesture.stroke = true;
          this.select(this.regionEvent(e).id, { fromClick: true });
        }
      }
      if (this.pointers.size === 2) {
        this.regionClicks?.cancelStroke();
        this.gesture.stroke = false;
        this.gesture.multi = true;
        const [a, b] = [...this.pointers.values()];
        this.pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          scale: this.scale,
          world: this.world({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
        };
      }
      this.setHover(null);
    }
    regionEvent(e, position = this.local(e)) {
      const p = this.world(position),
        region = this.state.regionIndex.at(p.x, p.y);
      return {
        id: region?.id || null,
        region,
        province: region,
        x: p.x,
        y: p.y,
        clientX: e.clientX,
        clientY: e.clientY,
        originalEvent: e,
      };
    }
    move(e) {
      if (!this.ready) return;
      const p = this.local(e),
        world = this.world(p);
      this.input.emit('pointer:move', { ...world, clientX: e.clientX, clientY: e.clientY });
      if (this.pointers.has(e.pointerId)) {
        if (this.gesture?.stroke && e.pointerType !== 'touch' && e.buttons === 0) {
          // A release may be reported by a move before pointerup (or without it).
          // Finish at the last held position; the new hover point is not paint.
          this.up(e, this.pointers.get(e.pointerId));
          return;
        }
        this.pointers.set(e.pointerId, p);
        if (this.gesture?.stroke) {
          this.regionClicks?.moveStroke(this.regionEvent(e));
          return;
        }
        if (this.pointers.size === 2 && this.pinch) {
          const [a, b] = [...this.pointers.values()],
            cx = (a.x + b.x) / 2,
            cy = (a.y + b.y) / 2;
          this.scale = Math.max(
            this.fitScale() * 0.5,
            Math.min(
              15,
              (this.pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) /
                Math.max(1, this.pinch.distance),
            ),
          );
          this.tx = cx - this.pinch.world.x * this.scale;
          this.ty = cy - this.pinch.world.y * this.scale;
        } else if (this.pointers.size === 1 && !this.gesture.multi) {
          if (Math.hypot(p.x - this.gesture.start.x, p.y - this.gesture.start.y) > 4)
            this.gesture.moved = true;
          if (this.gesture.moved) {
            this.tx += p.x - this.gesture.last.x;
            this.ty += p.y - this.gesture.last.y;
            this.element.classList.add('dragging');
          }
          this.gesture.last = p;
        }
        this.constrain();
        this.transform();
        return;
      }
      this.setHover(this.state.regionIndex.idAt(world.x, world.y), {
        ...world,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    }
    up(e, position) {
      if (!this.pointers.has(e.pointerId)) return;
      const gesture = this.gesture;
      if (gesture?.stroke) this.regionClicks?.endStroke(this.regionEvent(e, position));
      this.pointers.delete(e.pointerId);
      if (this.element.hasPointerCapture(e.pointerId))
        this.element.releasePointerCapture(e.pointerId);
      if (!this.pointers.size) {
        this.element.classList.remove('dragging');
        this.pinch = null;
      }
      if (!gesture.stroke && !gesture.moved && !gesture.multi && !this.panOnly && e.button === 0) {
        const p = this.world(this.local(e)),
          region = this.state.regionIndex.at(p.x, p.y);
        this.select(region?.id || null, { fromClick: true });
        const event = {
          id: region?.id || null,
          region,
          province: region,
          x: p.x,
          y: p.y,
          clientX: e.clientX,
          clientY: e.clientY,
          originalEvent: e,
        };
        this.input.emit('province:click', event);
        window.dispatchEvent(new CustomEvent('province:click', { detail: event }));
      }
    }
    cancel() {
      this.regionClicks?.cancelStroke();
      this.pointers.clear();
      this.gesture = null;
      this.pinch = null;
      this.element.classList.remove('dragging');
      this.setHover(null);
    }
    setHover(id, position = {}) {
      if (this.hoverId === id) return;
      this.hoverId = id;
      this.#highlight(this.hoverCanvas, id);
      const event = { id, region: this.state.regionIndex?.get(id) || null, ...position };
      this.input.emit('province:hover', event);
    }
    select(id, { fromClick = false } = {}) {
      this.selectedId = id;
      this.input.emit('selection:change', {
        id,
        region: this.state.regionIndex?.get(id) || null,
        fromClick,
      });
    }
    focusRegion(id) {
      const r = this.state.regionIndex.get(id);
      if (!r) return;
      this.scale = Math.min(
        6,
        Math.max(
          this.scale,
          Math.min(
            this.element.clientWidth / (r.bbox[2] * 2.8),
            this.element.clientHeight / (r.bbox[3] * 2.8),
          ),
        ),
      );
      this.tx = this.element.clientWidth / 2 - r.anchor[0] * this.scale;
      this.ty = this.element.clientHeight / 2 - r.anchor[1] * this.scale;
      this.constrain();
      this.transform();
      this.select(id);
    }
    #highlight(canvas, id) {
      const index = this.state.regionIndex,
        region = index?.get(id);
      if (!region) {
        canvas.width = 1;
        canvas.height = 1;
        return;
      }
      const [x, y, w, h] = region.bbox;
      canvas.width = w;
      canvas.height = h;
      canvas.style.left = x + 'px';
      canvas.style.top = y + 'px';
      const ctx = canvas.getContext('2d');
      root.AtlasUI.drawRegionSet(ctx, index, [id], {
        fill: 'rgba(225,237,241,.32)',
        edge: '#d8e9ef',
        offsetX: x,
        offsetY: y,
      });
    }
    #drawIds(ctx, scale, tx, ty, width, height) {
      const type = getComputedStyle(this.element);
      ctx.font = type.fontSize + ' ' + type.fontFamily;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#162832';
      ctx.fillStyle = '#e1e8eb';
      ctx.lineWidth = 3;
      for (const r of this.state.regions.values()) {
        if (r.area * scale * scale < 800 || r.bbox[2] * scale < 24 || r.bbox[3] * scale < 12)
          continue;
        const x = r.anchor[0] * scale + tx,
          y = r.anchor[1] * scale + ty;
        if (x < 0 || y < 0 || x > width || y > height) continue;
        ctx.strokeText(String(r.id), x, y);
        ctx.fillText(String(r.id), x, y);
      }
    }
    drawNumbers() {
      const c = this.numbersCanvas,
        dpr = Math.min(2, window.devicePixelRatio || 1),
        w = this.element.clientWidth,
        h = this.element.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        c.style.width = w + 'px';
        c.style.height = h + 'px';
      }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (this.ready && this.showIds) this.#drawIds(ctx, this.scale, this.tx, this.ty, w, h);
    }
  }
  Object.assign((root.AtlasUI ||= {}), { MapViewport });
  if (typeof module !== 'undefined' && module.exports) module.exports = { MapViewport };
})(globalThis);
