/* Canvas bindings for the headless registry. Every plane shares one composition order. */
(function (root) {
  'use strict';
  class OverlayRenderer {
    #layers = new Map(); #off; #transform = ''; #width = 1; #height = 1;
    constructor(host, registry) { this.host = host; this.registry = registry; this.#off = registry.on('change', () => this.#sync()); }
    add({ signal, space = 'world', exportDraw, ...definition }) {
      if (!['world', 'screen'].includes(space) || exportDraw !== undefined && typeof exportDraw !== 'function' || space === 'screen' && definition.exportable !== false && !exportDraw) throw new Error('Для экранного оверлея с PNG нужна функция exportDraw.');
      const registration = this.registry.register(definition, { signal });
      const plane = document.createElement('div'); plane.className = 'map-overlay-plane'; plane.dataset.overlay = definition.id;
      const world = document.createElement('div'); world.className = space === 'world' ? 'map-overlay-world' : 'map-overlay-screen';
      const canvas = document.createElement('canvas'); canvas.className = 'map-layer'; canvas.dataset.layer = definition.id;
      canvas.width = space === 'world' ? this.#width : 1; canvas.height = space === 'world' ? this.#height : 1;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.imageSmoothingEnabled = false;
      world.append(canvas); plane.append(world); if (space === 'world') world.style.transform = this.#transform;
      const layer = { id: definition.id, plane, world, canvas, context, space, exportDraw, registration };
      if (registration.current) { this.#layers.set(definition.id, layer); this.host.append(plane); this.#sync(); }
      return Object.freeze({ id: definition.id, canvas, context, dispose: registration.dispose,
        get visible() { return registration.current?.visible || false; },
        setVisible: visible => { if (!registration.current) throw new Error('Оверлей отключён.'); return this.registry.setVisible(definition.id, visible); }
      });
    }
    #sync() {
      for (const [id, layer] of this.#layers) if (!this.registry.has(id)) { layer.plane.remove(); this.#layers.delete(id); }
      for (const overlay of this.registry.list) { const layer = this.#layers.get(overlay.id); if (layer) { layer.plane.hidden = !overlay.visible; layer.plane.style.zIndex = String(overlay.index + 1); } }
    }
    resizeWorld(width, height) {
      this.#width = width; this.#height = height;
      for (const layer of this.#layers.values()) if (layer.space === 'world') { layer.canvas.width = width; layer.canvas.height = height; layer.context.imageSmoothingEnabled = false; }
    }
    transform(value) { this.#transform = value; for (const layer of this.#layers.values()) if (layer.space === 'world') layer.world.style.transform = value; }
    exportTo(context) {
      for (const overlay of this.registry.list) {
        if (!overlay.visible || !overlay.exportable) continue; const layer = this.#layers.get(overlay.id); if (!layer) continue;
        if (layer.exportDraw) layer.exportDraw(context); else context.drawImage(layer.canvas, 0, 0);
      }
    }
    dispose() { for (const layer of [...this.#layers.values()]) layer.registration.dispose(); this.#off(); }
  }
  Object.assign(root.AtlasUI ||= {}, { OverlayRenderer });
  if (typeof module !== 'undefined' && module.exports) module.exports = { OverlayRenderer };
})(globalThis);
