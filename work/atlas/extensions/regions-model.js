/* Named province regions are independent from nations and the map's pixel index. */
(function (root) {
  'use strict';
  const { uid } = root.AtlasCore;
  const EMPTY = Object.freeze({ items: Object.freeze({}), assignments: Object.freeze({}) });
  const validId = (id) =>
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 100 &&
    !['__proto__', 'constructor', 'prototype'].includes(id);
  class RegionsModel {
    constructor(state) {
      this.state = state;
    }
    get data() {
      return this.state.meta.regions || EMPTY;
    }
    registerActions(signal) {
      const data = (draft) => {
        const d = (draft.meta.regions ||= { items: {}, assignments: {} });
        d.items ||= {};
        d.assignments ||= {};
        return d;
      };
      const requireRegion = (d, id) => {
        if (!validId(id) || !Object.hasOwn(d.items, id)) throw new Error('Регион не найден.');
      };
      const requireProvinces = (ids, index) => {
        if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id) || !index.get(id)))
          throw new Error('Провинция не найдена.');
      };
      const register = (type, label, reduce) =>
        this.state.actions.register(type, { label, reduce }, { signal });
      register('regions.save', 'Название и состав региона', (draft, p, { regionIndex }) => {
        if (!validId(p.id) || typeof p.name !== 'string' || !p.name.trim())
          throw new Error('Укажите название региона.');
        if (p.provinceIds !== undefined) requireProvinces(p.provinceIds, regionIndex);
        const d = data(draft);
        d.items[p.id] = { id: p.id, name: p.name.trim().slice(0, 80) };
        if (p.provinceIds) for (const id of p.provinceIds) d.assignments[id] = p.id;
      });
      register('regions.assign', 'Состав регионов', (draft, p, { regionIndex }) => {
        requireProvinces(p.provinceIds, regionIndex);
        const d = data(draft);
        if (p.regionId !== null) requireRegion(d, p.regionId);
        for (const id of p.provinceIds) {
          if (p.regionId === null) delete d.assignments[id];
          else d.assignments[id] = p.regionId;
        }
      });
      register('regions.remove', 'Удаление региона', (draft, p) => {
        const d = data(draft);
        requireRegion(d, p.id);
        delete d.items[p.id];
        for (const [id, region] of Object.entries(d.assignments))
          if (region === p.id) delete d.assignments[id];
      });
    }
    save({ id = uid('region'), name, provinceIds } = {}) {
      const payload = { id, name };
      if (provinceIds !== undefined) payload.provinceIds = [...new Set(provinceIds)];
      this.state.dispatch('regions.save', payload, {
        source: 'regions',
        label: 'Регион: ' + String(name || '').trim(),
      });
      return id;
    }
    assign(provinceIds, regionId) {
      return this.state.dispatch(
        'regions.assign',
        { provinceIds: [...new Set(provinceIds)], regionId },
        {
          source: 'regions',
          label:
            regionId === null
              ? 'Исключение провинций из регионов'
              : 'Добавление провинций в регион',
        },
      );
    }
    remove(id) {
      return this.state.dispatch(
        'regions.remove',
        { id },
        { source: 'regions', label: 'Удаление региона' },
      );
    }
    members(id) {
      return Object.entries(this.data.assignments)
        .filter(([province, region]) => region === id && this.state.regions.has(Number(province)))
        .map(([province]) => Number(province));
    }
    forProvince(id) {
      const regionId = this.data.assignments[id];
      return Object.hasOwn(this.data.items, regionId) ? this.data.items[regionId] : null;
    }
  }
  Object.assign((root.AtlasExtensions ||= {}), { RegionsModel });
  if (typeof module !== 'undefined' && module.exports) module.exports = { RegionsModel };
})(globalThis);
