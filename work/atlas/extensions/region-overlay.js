/* One registered screen overlay: sharp raster contours plus fixed-size region names. */
(function (root) {
  'use strict';
  const { equal } = root.AtlasCore;
  const { RegionGeometry, wrapRegionName } = root.AtlasExtensions;
  class RegionOverlay {
    constructor(ctx, model) {
      this.state = ctx.state;
      this.viewport = ctx.ui.viewport;
      this.model = model;
      this.regions = [];
      // This offscreen bitmap is a cache within the one overlay, never a second map plane.
      this.raster = document.createElement('canvas');
      this.raster.width = this.raster.height = 1;
      this.overlay = ctx.overlay({
        id: 'boundaries',
        title: 'Регионы',
        order: 30,
        visible: false,
        space: 'screen',
        exportDraw: (context) => this.exportTo(context),
      });
      this.state.on(
        'change',
        ({ before, after }) => {
          if (!equal(before.meta.regions, after.meta.regions)) this.rebuild();
        },
        { signal: ctx.signal },
      );
      ctx.ui.on('map:ready', () => this.rebuild(), { signal: ctx.signal });
      this.viewport.on('camera:change', () => this.draw(), { signal: ctx.signal });
      this.state.overlays.on('change', () => this.draw(), { signal: ctx.signal });
      ctx.scope.defer(() => {
        this.raster.width = this.raster.height = 1;
        this.geometry = null;
        this.regions = [];
      });
      this.rebuild();
    }
    rebuild() {
      const index = this.state.regionIndex;
      if (!Object.keys(this.model.data.assignments || {}).length) {
        this.regions = [];
        this.raster.width = this.raster.height = 1;
        this.geometry = null;
        this.index = null;
        this.draw();
        return;
      }
      if (this.index !== index) {
        this.raster.width = index.width;
        this.raster.height = index.height;
        const context = this.raster.getContext('2d', { willReadFrequently: true });
        context.drawImage(this.viewport.originalImage, 0, 0);
        this.geometry = new RegionGeometry(
          index,
          context.getImageData(0, 0, index.width, index.height).data,
        );
        this.index = index;
      }
      this.regions = this.geometry.build(this.model.data);
      this.rasterKey = null;
      this.draw();
    }
    #rasterFor(scale) {
      const radius = Math.max(0, Math.ceil(1 / scale) - 1),
        halo = Math.max(1, Math.ceil(0.75 / scale)),
        key = radius + ':' + halo;
      if (key === this.rasterKey) return;
      const context = this.raster.getContext('2d');
      context.clearRect(0, 0, this.raster.width, this.raster.height);
      for (const [padding, color] of [
        [radius + halo, '#182932'],
        [radius, '#f0d58e'],
      ]) {
        context.fillStyle = color;
        for (const region of this.regions)
          for (let i = 0; i < region.runs.length; i += 2) {
            const start = region.runs[i],
              length = region.runs[i + 1];
            context.fillRect(
              (start % this.index.width) - padding,
              Math.floor(start / this.index.width) - padding,
              length + padding * 2,
              padding * 2 + 1,
            );
          }
      }
      this.rasterKey = key;
    }
    #names(context, scale, tx, ty, width, height) {
      const type = getComputedStyle(this.viewport.element),
        step = parseFloat(type.lineHeight),
        size = parseFloat(type.fontSize);
      context.save();
      context.font = size + 'px ' + type.fontFamily;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineJoin = 'round';
      context.strokeStyle = '#13242e';
      context.fillStyle = '#fff0ba';
      context.lineWidth = 3;
      for (const region of this.regions) {
        const x = Math.round(tx + region.anchor[0] * scale),
          y = Math.round(ty + region.anchor[1] * scale);
        const lines = wrapRegionName(
          region.name,
          (text) => context.measureText(text).width,
          Math.max(40, Math.min(180, width - 16)),
        );
        if (
          x < -180 ||
          x > width + 180 ||
          y + lines.length * step < 0 ||
          y - lines.length * step > height
        )
          continue;
        for (const [i, text] of lines.entries()) {
          const yy = y + (i - (lines.length - 1) / 2) * step;
          context.strokeText(text, x, yy);
          context.fillText(text, x, yy);
        }
      }
      context.restore();
    }
    draw() {
      const { canvas, context } = this.overlay,
        dpr = Math.min(2, window.devicePixelRatio || 1),
        width = this.viewport.element.clientWidth,
        height = this.viewport.element.clientHeight;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      if (!this.viewport.ready || !this.overlay.visible || !this.regions.length) return;
      this.#rasterFor(this.viewport.scale);
      context.imageSmoothingEnabled = false;
      context.drawImage(
        this.raster,
        this.viewport.tx,
        this.viewport.ty,
        this.raster.width * this.viewport.scale,
        this.raster.height * this.viewport.scale,
      );
      this.#names(context, this.viewport.scale, this.viewport.tx, this.viewport.ty, width, height);
    }
    exportTo(context) {
      if (!this.regions.length) return;
      this.#rasterFor(1);
      context.imageSmoothingEnabled = false;
      context.drawImage(this.raster, 0, 0);
      this.#names(context, 1, 0, 0, this.index.width, this.index.height);
    }
  }
  Object.assign((root.AtlasExtensions ||= {}), { RegionOverlay });
})(globalThis);
