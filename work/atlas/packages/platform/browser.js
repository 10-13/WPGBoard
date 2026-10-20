/* Browser adapters: image decoding/indexing, files, legacy migration and storage. */
(function (root) {
  'use strict';
  const { clone, uid, RegionIndex } = root.AtlasCore;
  function mapId(text, width, height) { let a = 2166136261, b = 5381; for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); } return 'map-' + width + 'x' + height + '-' + (a >>> 0).toString(16) + (b >>> 0).toString(16); }
  function normalize(project, knownLegacy = null) {
    if (project?.schemaVersion === 2) return project;
    if (project?.schemaVersion !== 1 || !Array.isArray(project.provinces) || !Array.isArray(project.nations) || !Array.isArray(project.regions)) throw new Error('Неизвестный формат партии.');
    const originalImage = project.originalImage || (knownLegacy?.indexImage === project.indexImage ? knownLegacy.originalImage : null) || project.baseImage;
    const dict = items => Object.fromEntries(items.map(item => [item.id, clone(item)]));
    return { schemaVersion: 2, saveKey: project.saveId, map: { id: mapId(project.indexImage, project.width, project.height), original: { dataURL: originalImage, width: project.width, height: project.height, name: project.mapName || 'Карта.png' }, displayImage: project.baseImage, indexImage: project.indexImage }, regions: project.provinces.map(({ id, area, bbox, anchor }) => ({ id, area, bbox, anchor })), params: {}, meta: { campaign: { title: project.title || 'Новая кампания' }, nations: { items: dict(project.nations), owners: project.owners || {}, names: project.provinceNames || {} } } };
  }
  async function imageFrom(url) { const image = new Image(); image.src = url; await image.decode(); return image; }
  async function prepare(project, knownLegacy) {
    project = normalize(project, knownLegacy);
    const map = project.map, w = map?.original?.width, h = map?.original?.height;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > 20000000 || !Array.isArray(project.regions)) throw new Error('Некорректная карта или более 20 миллионов пикселей.');
    for (const value of [map.original.dataURL, map.indexImage]) if (typeof value !== 'string' || !/^data:image\/png;base64,[\da-zA-Z+/=]+$/.test(value)) throw new Error('Ожидаются встроенные PNG карты и индекса.');
    const [original, encoded] = await Promise.all([imageFrom(map.original.dataURL), imageFrom(map.indexImage)]);
    if (original.width !== w || original.height !== h || encoded.width !== w || encoded.height !== h) throw new Error('Изображение и индекс имеют разные размеры.');
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(encoded, 0, 0); const rgba = ctx.getImageData(0, 0, w, h).data, pixels = new Uint32Array(w * h);
    for (let i = 0; i < pixels.length; i++) { const j = i * 4; if (rgba[j + 3] !== 255) throw new Error('Индекс должен быть непрозрачным PNG.'); pixels[i] = rgba[j] + rgba[j + 1] * 256 + rgba[j + 2] * 65536; }
    const regionIndex = new RegionIndex({ width: w, height: h, regions: project.regions, pixels }); canvas.width = 1; canvas.height = 1; return { project, regionIndex };
  }
  function download(blob, filename) { const a = document.createElement('a'), url = URL.createObjectURL(blob); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000); }
  const safeName = value => String(value || 'АТЛАС').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 70);
  function chooseFile(accept = '.json', { signal } = {}) { return new Promise(resolve => { if (signal?.aborted) { resolve(null); return; } const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.className = 'file-input-proxy'; input.setAttribute('aria-label', 'Выберите файл'); document.body.append(input); const finish = value => { input.remove(); signal?.removeEventListener('abort', cancel); resolve(value); }, cancel = () => finish(null); input.addEventListener('change', () => finish(input.files[0] || null), { once: true }); input.addEventListener('cancel', cancel, { once: true }); signal?.addEventListener('abort', cancel, { once: true }); input.click(); }); }
  function segmentRGBA(data, width, height, color, tolerance) {
    const total = width * height, mask = new Uint8Array(total), labels = new Uint32Array(total), queue = new Uint32Array(total), regions = [];
    for (let i = 0; i < total; i++) { const j = i * 4; mask[i] = data[j + 3] > 128 && Math.max(Math.abs(data[j] - color[0]), Math.abs(data[j + 1] - color[1]), Math.abs(data[j + 2] - color[2])) <= tolerance ? 1 : 0; }
    for (let start = 0; start < total; start++) {
      if (!mask[start] || labels[start]) continue; const id = regions.length + 1; if (id > 100000) throw new Error('Слишком много областей. Используйте PNG с чёткими границами.');
      let head = 0, tail = 1, sx = 0, sy = 0, minX = width, minY = height, maxX = 0, maxY = 0; queue[0] = start; labels[start] = id;
      while (head < tail) { const p = queue[head++], x = p % width, y = Math.floor(p / width); sx += x; sy += y; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = id; queue[tail++] = p - 1; } if (x < width - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = id; queue[tail++] = p + 1; } if (y > 0 && mask[p - width] && !labels[p - width]) { labels[p - width] = id; queue[tail++] = p - width; } if (y < height - 1 && mask[p + width] && !labels[p + width]) { labels[p + width] = id; queue[tail++] = p + width; } }
      const cx = sx / tail, cy = sy / tail; let nearest = start, distance = Infinity;
      for (let q = 0; q < tail; q++) { const p = queue[q], d = (p % width - cx) ** 2 + (Math.floor(p / width) - cy) ** 2; if (d < distance) { distance = d; nearest = p; } }
      regions.push({ id, area: tail, bbox: [minX, minY, maxX - minX + 1, maxY - minY + 1], anchor: [nearest % width, Math.floor(nearest / width)] }); if (id % 250 === 0) postMessage({ count: id, progress: Math.round(start / total * 100) });
    }
    if (!regions.length) throw new Error('Не найден цвет суши. Проверьте цвет и допуск.'); return { regions, labels };
  }
  async function createProject(file, { color = '#808080', tolerance = 12, onProgress = () => {}, nations = [], signal } = {}) {
    if (signal?.aborted) throw new Error('Загрузка отменена.');
    if (file.size > 30000000) throw new Error('Максимальный размер изображения — 30 МБ.');
    const imageURL = URL.createObjectURL(file); let worker, workerURL, onAbort;
    try {
      const image = await imageFrom(imageURL), width = image.width, height = image.height; if (width * height > 20000000) throw new Error('Максимум 20 миллионов пикселей.');
      const c = document.createElement('canvas'); c.width = width; c.height = height; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0); const originalImage = c.toDataURL('image/png'), pixels = ctx.getImageData(0, 0, width, height).data;
      const code = 'const segment=' + segmentRGBA.toString() + ';onmessage=e=>{try{const d=e.data,r=segment(new Uint8ClampedArray(d.pixels),d.width,d.height,d.color,d.tolerance);postMessage({result:{regions:r.regions,buffer:r.labels.buffer}},[r.labels.buffer]);}catch(error){postMessage({error:error.message});}};';
      workerURL = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); worker = new Worker(workerURL);
      const rgb = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5), 16)];
      const result = await new Promise((resolve, reject) => { onAbort = () => { worker.terminate(); reject(new Error('Загрузка отменена.')); }; signal?.addEventListener('abort', onAbort, { once: true }); if (signal?.aborted) { onAbort(); return; } worker.onmessage = e => { if (e.data.error) reject(new Error(e.data.error)); else if (e.data.result) resolve({ regions: e.data.result.regions, labels: new Uint32Array(e.data.result.buffer) }); else onProgress(e.data); }; worker.onerror = () => reject(new Error('Не удалось запустить обработчик карты.')); worker.postMessage({ pixels: pixels.buffer, width, height, color: rgb, tolerance: Math.max(0, Math.min(80, tolerance)) }, [pixels.buffer]); });
      const encoded = ctx.createImageData(width, height); for (let i = 0; i < result.labels.length; i++) { const id = result.labels[i], j = i * 4; encoded.data[j] = id & 255; encoded.data[j + 1] = (id >> 8) & 255; encoded.data[j + 2] = (id >> 16) & 255; encoded.data[j + 3] = 255; }
      ctx.putImageData(encoded, 0, 0); const indexImage = c.toDataURL('image/png'); c.width = 1;
      return { schemaVersion: 2, saveKey: uid('party'), map: { id: mapId(indexImage, width, height), original: { dataURL: originalImage, width, height, name: file.name }, displayImage: originalImage, indexImage }, regions: result.regions, params: {}, meta: { campaign: { title: file.name.replace(/\.[^.]+$/, '') }, nations: { items: Object.fromEntries(nations.map(n => [n.id, n])), owners: {}, names: {} } } };
    } finally { if (onAbort) signal?.removeEventListener('abort', onAbort); worker?.terminate(); if (workerURL) URL.revokeObjectURL(workerURL); URL.revokeObjectURL(imageURL); }
  }
  class Storage {
    #db;
    constructor() { this.#db = new Promise((resolve, reject) => { try { const request = indexedDB.open('atlas-vpi-v1', 1); request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('parties')) request.result.createObjectStore('parties'); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); } catch (error) { reject(error); } }); this.#db.catch(() => {}); }
    async get(key) { const db = await this.#db; return new Promise((resolve, reject) => { const request = db.transaction('parties').objectStore('parties').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
    async put(key, value) { const db = await this.#db; return new Promise((resolve, reject) => { const tx = db.transaction('parties', 'readwrite'); tx.objectStore('parties').put(value, key); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
  }
  root.AtlasPlatform = { normalize, prepare, imageFrom, createProject, download, safeName, chooseFile, Storage };
})(globalThis);
