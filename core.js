/* Atlas core: model, singleton registry, events, hit testing and transactions.
 * No DOM, canvas, tools or coloring logic lives in this file. */
(function (root) {
  'use strict';
  const colorPattern = /^#[\da-f]{6}$/i;
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
  const cleanName = (value, fallback = '') => String(value ?? fallback).trim().slice(0, 80);
  class Events {
    constructor() { this.listeners = new Map(); }
    on(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
      return () => this.off(type, callback);
    }
    off(type, callback) { this.listeners.get(type)?.delete(callback); }
    emit(type, detail) {
      for (const fn of [...(this.listeners.get(type) || [])]) {
        try { fn(detail); } catch (error) { console.error('Atlas event listener:', error); }
      }
    }
  }
  class MapRegistry extends Events {
    static getInstance() { return this.instance || (this.instance = new MapRegistry()); }
    constructor() {
      super();
      if (MapRegistry.instance) throw new Error('Используйте MapRegistry.getInstance()');
      MapRegistry.instance = this;
      this.provinces = new Map(); this.nations = new Map(); this.regions = new Map();
      this.labels = null; this.width = 0; this.height = 0; this.undoStack = []; this.redoStack = []; this.depth = 0;
    }
    static validate(project) {
      if (!project || project.schemaVersion !== 1) throw new Error('Неизвестный формат партии. Нужен JSON АТЛАС версии 1.');
      const { width, height, provinces, nations, regions } = project;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 20000000) throw new Error('Карта должна содержать не более 20 миллионов пикселей.');
      if (!Array.isArray(provinces) || !provinces.length || provinces.length > 100000) throw new Error('В карте нет провинций или их слишком много.');
      if (!Array.isArray(nations) || !Array.isArray(regions) || nations.length > 500 || regions.length > 5000) throw new Error('Некорректный список наций или регионов.');
      const ids = new Set();
      for (const p of provinces) {
        if (!Number.isInteger(p.id) || p.id < 1 || p.id > 100000 || ids.has(p.id)) throw new Error('Некорректные номера провинций.');
        ids.add(p.id);
        if (!Array.isArray(p.bbox) || p.bbox.length !== 4 || !p.bbox.every(Number.isInteger)) throw new Error('Некорректные границы провинции.');
        const [x,y,w,h] = p.bbox;
        if (x < 0 || y < 0 || w < 1 || h < 1 || x+w > width || y+h > height || !Number.isInteger(p.area) || p.area < 1 || !Array.isArray(p.anchor) || p.anchor.length !== 2 || !p.anchor.every(Number.isInteger) || p.anchor[0] < x || p.anchor[1] < y || p.anchor[0] >= x+w || p.anchor[1] >= y+h) throw new Error('Провинция выходит за границы карты.');
      }
      for (const [items, requireColor] of [[nations,true],[regions,false]]) {
        const seen = new Set();
        for (const item of items) {
          if (!validId(item.id) || seen.has(item.id) || !cleanName(item.name) || (requireColor && !colorPattern.test(item.color))) throw new Error('Некорректные данные нации или региона.');
          seen.add(item.id);
        }
      }
      for (const key of ['baseImage','indexImage']) if (typeof project[key] !== 'string' || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(project[key])) throw new Error('Карта должна содержать встроенные PNG-изображения.');
      const nationIds = new Set(nations.map(n=>n.id)), regionIds = new Set(regions.map(r=>r.id));
      for (const [key, refs] of [['owners', nationIds], ['regionAssignments', regionIds]]) {
        for (const [id, value] of Object.entries(project[key] || {})) if (!ids.has(Number(id)) || !refs.has(value)) throw new Error('Назначение ссылается на отсутствующую провинцию, нацию или регион.');
      }
      return true;
    }
    load(project, labels) {
      MapRegistry.validate(project);
      if (!labels || labels.length !== project.width * project.height) throw new Error('Размер индекса не совпадает с картой.');
      this.project = { ...project, provinces: undefined, nations: undefined, regions: undefined, owners: undefined, regionAssignments: undefined, provinceNames: undefined };
      this.title = cleanName(project.title, 'Новая кампания') || 'Новая кампания';
      this.width = project.width; this.height = project.height; this.labels = labels;
      this.nations = new Map(project.nations.map(n => [n.id, { id:n.id, name:cleanName(n.name), color:n.color.toLowerCase() }]));
      this.regions = new Map(project.regions.map(r => [r.id, { id:r.id, name:cleanName(r.name), metadata:r.metadata || {} }]));
      this.provinces = new Map(project.provinces.map(p => [p.id, { id:p.id, area:p.area, bbox:[...p.bbox], anchor:[...p.anchor], name:cleanName(project.provinceNames?.[p.id]), nationId:project.owners?.[p.id] || null, regionId:project.regionAssignments?.[p.id] || null, metadata:p.metadata || {} }]));
      this.undoStack = []; this.redoStack = []; this.depth = 0;
      this.emit('map:loaded', { index:this });
    }
    at(x, y) {
      x = Math.floor(x); y = Math.floor(y);
      if (!this.labels || x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
      return this.provinces.get(this.labels[y*this.width+x]) || null;
    }
    getProvince(id) { return this.provinces.get(Number(id)) || null; }
    getRegionProvinces(id) { return [...this.provinces.values()].filter(p => p.regionId === id); }
    state() {
      const owners = {}, regionAssignments = {}, provinceNames = {};
      for (const p of this.provinces.values()) {
        if (p.nationId) owners[p.id] = p.nationId;
        if (p.regionId) regionAssignments[p.id] = p.regionId;
        if (p.name) provinceNames[p.id] = p.name;
      }
      return { title:this.title, nations:[...this.nations.values()].map(n=>({...n})), regions:[...this.regions.values()].map(r=>({...r})), owners, regionAssignments, provinceNames };
    }
    _restore(state) {
      this.title = state.title;
      this.nations = new Map(state.nations.map(n => [n.id,{...n}]));
      this.regions = new Map(state.regions.map(r => [r.id,{...r}]));
      for (const p of this.provinces.values()) {
        p.nationId = state.owners[p.id] || null; p.regionId = state.regionAssignments[p.id] || null; p.name = state.provinceNames[p.id] || '';
      }
    }
    transaction(label, callback) {
      if (this.depth) return callback();
      const before = this.state(); this.depth++;
      try { callback(); } catch (error) { this._restore(before); throw error; } finally { this.depth--; }
      const after = this.state();
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      this.undoStack.push({ state:before, label });
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
      this.emit('change', { label, before, after });
    }
    setTitle(title) { this.transaction('Название кампании', () => { this.title = cleanName(title) || 'Новая кампания'; }); }
    setProvince(id, patch) {
      const p = this.getProvince(id);
      if (!p) throw new Error('Провинция не найдена.');
      if (patch.nationId != null && !this.nations.has(patch.nationId)) throw new Error('Нация не найдена.');
      if (patch.regionId != null && !this.regions.has(patch.regionId)) throw new Error('Регион не найден.');
      this.transaction('Изменение провинции', () => {
        if ('name' in patch) p.name = cleanName(patch.name);
        if ('nationId' in patch) p.nationId = patch.nationId || null;
        if ('regionId' in patch) p.regionId = patch.regionId || null;
      });
    }
    setNation(nation) {
      if (!validId(nation.id) || !cleanName(nation.name) || !colorPattern.test(nation.color)) throw new Error('Укажите название и цвет нации.');
      this.transaction('Изменение нации', () => this.nations.set(nation.id,{id:nation.id,name:cleanName(nation.name),color:nation.color.toLowerCase()}));
    }
    removeNation(id) {
      this.transaction('Удаление нации', () => { this.nations.delete(id); for (const p of this.provinces.values()) if (p.nationId === id) p.nationId = null; });
    }
    setRegion(region) {
      if (!validId(region.id) || !cleanName(region.name)) throw new Error('Укажите название региона.');
      this.transaction('Изменение региона', () => this.regions.set(region.id,{id:region.id,name:cleanName(region.name),metadata:region.metadata || {}}));
    }
    removeRegion(id) {
      this.transaction('Удаление региона', () => { this.regions.delete(id); for (const p of this.provinces.values()) if (p.regionId === id) p.regionId = null; });
    }
    undo() { this._travel(this.undoStack, this.redoStack); }
    redo() { this._travel(this.redoStack, this.undoStack); }
    _travel(from, to) {
      const item = from.pop(); if (!item) return;
      const before = this.state(); to.push({state:before,label:item.label}); this._restore(item.state);
      this.emit('change', {label:item.label,before,after:this.state()});
    }
    toJSON() {
      return { ...this.project, ...this.state(), width:this.width, height:this.height,
        provinces:[...this.provinces.values()].map(({id,area,bbox,anchor,metadata})=>({id,area,bbox,anchor,metadata})), updatedAt:Date.now() };
    }
  }
  root.AtlasCore = { Events, MapRegistry };
  root.MapIndex = MapRegistry.getInstance();
})(globalThis);
