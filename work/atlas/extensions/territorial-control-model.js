/* Pixel control is separate from legal ownership and province/resource metadata. */
(function (root) {
  'use strict';
  const SIZE = 64,
    AREA = SIZE * SIZE,
    LIMIT = 1000000;
  const EMPTY = Object.freeze({});
  function controlChunks(meta) {
    const data = meta.territorialControl;
    if (!data) return EMPTY;
    if (
      data.version !== 1 ||
      data.chunkSize !== SIZE ||
      !data.chunks ||
      typeof data.chunks !== 'object' ||
      Array.isArray(data.chunks)
    )
      throw new Error('Неизвестный формат карты контроля.');
    return data.chunks;
  }
  function controlChunkPosition(key, index) {
    if (!/^(0|[1-9]\d*),(0|[1-9]\d*)$/.test(key)) throw new Error('Некорректный блок контроля.');
    const [cx, cy] = key.split(',').map(Number),
      x = cx * SIZE,
      y = cy * SIZE;
    if (
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      x >= index.width ||
      y >= index.height
    )
      throw new Error('Блок контроля выходит за пределы карты.');
    return { x, y };
  }
  function decodeControlChunk(runs = []) {
    if (!Array.isArray(runs) || runs.length > AREA)
      throw new Error('Некорректные полосы контроля.');
    const values = Array(AREA).fill(null);
    let end = 0;
    for (const run of runs) {
      if (!Array.isArray(run) || run.length !== 3) throw new Error('Некорректная полоса контроля.');
      const [start, length, nation] = run;
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(length) ||
        start < end ||
        length < 1 ||
        start + length > AREA ||
        typeof nation !== 'string' ||
        !nation ||
        nation.length > 150
      )
        throw new Error('Некорректная полоса контроля.');
      values.fill(nation, start, start + length);
      end = start + length;
    }
    return values;
  }
  function encodeControlChunk(values) {
    if (values.length !== AREA) throw new Error('Некорректный размер блока контроля.');
    const runs = [];
    for (let p = 0; p < AREA; ) {
      const value = values[p];
      if (value == null) {
        p++;
        continue;
      }
      let end = p + 1;
      while (end < AREA && values[end] === value) end++;
      runs.push([p, end - p, value]);
      p = end;
    }
    return runs;
  }
  class ControlStroke {
    constructor(index, chunks, nations, nationId, radius = 4) {
      if (
        !Number.isInteger(radius) ||
        radius < 0 ||
        radius > 64 ||
        (nationId !== null && !Object.hasOwn(nations.items || {}, nationId))
      )
        throw new Error('Выберите нацию и радиус кисти от 0 до 64 пикселей.');
      Object.assign(this, { index, sourceChunks: chunks, nations, nationId, radius });
      this.buffers = new Map();
      this.masks = new Map();
      this.pixelCount = 0;
      this.last = null;
    }
    move(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new Error('Некорректная позиция кисти.');
      // Captured pointers can leave the canvas; bound the walk and preserve edge clipping.
      const bound = (n, max) => Math.max(-64, Math.min(max + 63, Math.floor(n)));
      x = bound(x, this.index.width);
      y = bound(y, this.index.height);
      let [xx, yy] = this.last || [x, y];
      const dx = Math.abs(x - xx),
        dy = -Math.abs(y - yy),
        sx = xx < x ? 1 : -1,
        sy = yy < y ? 1 : -1;
      let error = dx + dy;
      const dirty = new Set();
      while (true) {
        this.stamp(xx, yy, dirty);
        if (xx === x && yy === y) break;
        const twice = 2 * error;
        if (twice >= dy) {
          error += dy;
          xx += sx;
        }
        if (twice <= dx) {
          error += dx;
          yy += sy;
        }
      }
      this.last = [x, y];
      return dirty;
    }
    stamp(cx, cy, dirty) {
      const { radius: r, index } = this;
      for (let y = Math.max(0, cy - r); y <= Math.min(index.height - 1, cy + r); y++)
        for (let x = Math.max(0, cx - r); x <= Math.min(index.width - 1, cx + r); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          const province = index.idAt(x, y);
          if (!province) continue;
          const key = Math.floor(x / SIZE) + ',' + Math.floor(y / SIZE),
            p = (y % SIZE) * SIZE + (x % SIZE);
          if (!this.buffers.has(key)) {
            this.buffers.set(key, decodeControlChunk(this.sourceChunks[key]));
            this.masks.set(key, new Uint8Array(AREA));
          }
          const values = this.buffers.get(key),
            mask = this.masks.get(key);
          const value = this.nationId === this.nations.owners?.[province] ? null : this.nationId;
          if (values[p] === value) continue;
          values[p] = value;
          if (!mask[p]) {
            mask[p] = 1;
            this.pixelCount++;
          }
          if (this.pixelCount > LIMIT)
            throw new Error('Мазок слишком большой. Разделите его на несколько мазков.');
          dirty.add(key);
        }
    }
    payload() {
      const chunks = [];
      for (const [key, mask] of this.masks) {
        const runs = [];
        for (let p = 0; p < AREA; ) {
          if (!mask[p]) {
            p++;
            continue;
          }
          let end = p + 1;
          while (end < AREA && mask[end]) end++;
          runs.push([p, end - p]);
          p = end;
        }
        if (runs.length) chunks.push({ key, runs });
      }
      return { nationId: this.nationId, chunks };
    }
  }
  class TerritorialControlModel {
    constructor(state) {
      this.state = state;
    }
    get chunks() {
      return controlChunks(this.state.meta);
    }
    begin(nationId, radius) {
      return new ControlStroke(
        this.state.regionIndex,
        this.chunks,
        this.state.meta.nations || EMPTY,
        nationId,
        radius,
      );
    }
    commit(stroke) {
      if (!stroke.pixelCount) return null;
      if (
        stroke.index !== this.state.regionIndex ||
        stroke.sourceChunks !== this.chunks ||
        stroke.nations !== (this.state.meta.nations || EMPTY)
      )
        throw new Error('Карта изменилась во время мазка. Повторите его.');
      return this.state.dispatch('territorial-control.stroke', stroke.payload(), {
        source: 'nations:control',
        label:
          stroke.nationId === null
            ? 'Восстановить юридический контроль'
            : 'Мазок контроля территории',
      });
    }
    registerActions(signal) {
      this.state.actions.register(
        'territorial-control.stroke',
        {
          label: 'Контроль территории',
          reduce(draft, payload, { regionIndex: index }) {
            const { nationId, chunks } = payload;
            if (
              (nationId !== null && !Object.hasOwn(draft.meta.nations?.items || {}, nationId)) ||
              !Array.isArray(chunks) ||
              chunks.length > Math.ceil(index.width / SIZE) * Math.ceil(index.height / SIZE)
            )
              throw new Error('Некорректный мазок контроля.');
            const old = controlChunks(draft.meta),
              next = { ...old },
              seen = new Set();
            let count = 0;
            for (const change of chunks) {
              const { key, runs } = change,
                origin = controlChunkPosition(key, index);
              if (seen.has(key) || !Array.isArray(runs) || runs.length > AREA)
                throw new Error('Некорректный мазок контроля.');
              seen.add(key);
              const values = decodeControlChunk(old[key]);
              let end = 0;
              for (const run of runs) {
                if (!Array.isArray(run) || run.length !== 2)
                  throw new Error('Некорректная полоса кисти.');
                const [start, length] = run;
                if (
                  !Number.isInteger(start) ||
                  !Number.isInteger(length) ||
                  start < end ||
                  length < 1 ||
                  start + length > AREA
                )
                  throw new Error('Некорректная полоса кисти.');
                count += length;
                if (count > LIMIT) throw new Error('Мазок слишком большой.');
                for (let p = start; p < start + length; p++) {
                  const id = index.idAt(origin.x + (p % SIZE), origin.y + Math.floor(p / SIZE));
                  if (!id) throw new Error('Кисть может менять только пиксели суши.');
                  values[p] = nationId === draft.meta.nations?.owners?.[id] ? null : nationId;
                }
                end = start + length;
              }
              const encoded = encodeControlChunk(values);
              if (encoded.length) next[key] = encoded;
              else delete next[key];
            }
            if (count)
              draft.meta.territorialControl = { version: 1, chunkSize: SIZE, chunks: next };
          },
        },
        { signal },
      );
    }
  }
  function controlChunkPixels(index, key, values, nations) {
    const origin = controlChunkPosition(key, index),
      rgba = new Uint8ClampedArray(AREA * 4);
    for (let p = 0; p < AREA; p++) {
      const controller = values[p],
        color = nations.items?.[controller]?.color;
      if (!controller || !/^#[\da-f]{6}$/i.test(color || '')) continue;
      const id = index.idAt(origin.x + (p % SIZE), origin.y + Math.floor(p / SIZE));
      if (!id || nations.owners?.[id] === controller) continue;
      rgba[p * 4] = parseInt(color.slice(1, 3), 16);
      rgba[p * 4 + 1] = parseInt(color.slice(3, 5), 16);
      rgba[p * 4 + 2] = parseInt(color.slice(5, 7), 16);
      rgba[p * 4 + 3] = 255;
    }
    return rgba;
  }
  const api = {
    CONTROL_CHUNK_SIZE: SIZE,
    controlChunks,
    controlChunkPosition,
    decodeControlChunk,
    encodeControlChunk,
    controlChunkPixels,
    ControlStroke,
    TerritorialControlModel,
  };
  Object.assign((root.AtlasExtensions ||= {}), api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
