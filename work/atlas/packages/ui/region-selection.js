/* Temporary UI selection, independent from game data and extension-owned sets. */
(function (root) {
  'use strict';
  const { EventBus } = root.AtlasCore;
  class RegionSelection extends EventBus {
    #ids = new Set();
    constructor({ valid = (id) => Number.isInteger(id) && id > 0 } = {}) {
      super();
      this.valid = valid;
    }
    get ids() {
      return Object.freeze([...this.#ids]);
    }
    get size() {
      return this.#ids.size;
    }
    has(id) {
      return this.#ids.has(id);
    }
    #set(ids) {
      const next = new Set([...ids].filter(this.valid));
      if (next.size === this.size && [...next].every((id) => this.has(id))) return;
      this.#ids = next;
      this.emit('change', { regionIds: this.ids, size: this.size });
    }
    replace(ids) {
      this.#set(ids);
    }
    add(ids) {
      this.#set([...this.#ids, ...ids]);
    }
    remove(ids) {
      const removed = new Set(ids);
      this.#set([...this.#ids].filter((id) => !removed.has(id)));
    }
    toggle(id) {
      if (!this.valid(id)) return;
      if (this.has(id)) this.remove([id]);
      else this.add([id]);
    }
    clear() {
      this.#set([]);
    }
    forContext(id) {
      // Right-clicking a member keeps the group; a different target starts a new selection.
      if (!this.valid(id)) this.clear();
      else if (!this.has(id)) this.replace([id]);
      return this.ids;
    }
  }
  function drawRegionSet(
    context,
    index,
    ids,
    { fill = 'rgba(225,181,88,.27)', edge = '#e8c87c', offsetX = 0, offsetY = 0 } = {},
  ) {
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    if (!index) return;
    const selected = [...new Set(ids)];
    context.fillStyle = fill;
    for (const id of selected)
      index.forEachRun(id, (start, length) =>
        context.fillRect(
          (start % index.width) - offsetX,
          Math.floor(start / index.width) - offsetY,
          length,
          1,
        ),
      );
    context.fillStyle = edge;
    for (const id of selected)
      index.forEachRun(id, (start, length) => {
        const left = start % index.width,
          right = left + length - 1,
          y = Math.floor(start / index.width);
        let edgeStart = null;
        // RLE endpoints cover left/right edges only. Compare the rows above and
        // below too, including concave corners, holes and the image perimeter.
        for (let x = left; x <= right; x++) {
          const boundary =
            x === left || x === right || index.idAt(x, y - 1) !== id || index.idAt(x, y + 1) !== id;
          if (boundary && edgeStart === null) edgeStart = x;
          if (edgeStart !== null && (!boundary || x === right)) {
            context.fillRect(
              edgeStart - offsetX,
              y - offsetY,
              x - edgeStart + (boundary ? 1 : 0),
              1,
            );
            edgeStart = null;
          }
        }
      });
  }
  Object.assign((root.AtlasUI ||= {}), { RegionSelection, drawRegionSet });
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { RegionSelection, drawRegionSet };
})(globalThis);
