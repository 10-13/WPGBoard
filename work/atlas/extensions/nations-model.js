/* Headless nation domain and registered kernel actions. */
(function (root) {
  'use strict';
  const { uid } = root.AtlasCore;
  const { warKey, isAtWar, enemyIds } = root.AtlasExtensions;
  const EMPTY = { items: {}, owners: {}, names: {}, wars: {} };
  const validColor = value => /^#[\da-f]{6}$/i.test(value);
  class NationsModel {
    constructor(state) { this.state = state; }
    get data() { return this.state.meta.nations || EMPTY; }
    registerActions(signal) {
      const data = draft => { draft.meta.nations ||= {}; const d = draft.meta.nations; for (const key of Object.keys(EMPTY)) d[key] ||= {}; return d; };
      const register = (type, label, reduce) => this.state.actions.register(type, { label, reduce }, { signal });
      register('nations.save', 'Изменение нации', (draft, p) => { if (!p.id || !String(p.name || '').trim() || !validColor(p.color)) throw new Error('Нужны ID, название и цвет нации.'); data(draft).items[p.id] = { id: p.id, name: String(p.name).trim().slice(0, 80), color: p.color }; });
      register('nations.remove', 'Удаление нации', (draft, p) => { const d = data(draft); delete d.items[p.id]; for (const [id, owner] of Object.entries(d.owners)) if (owner === p.id) delete d.owners[id]; for (const [key, pair] of Object.entries(d.wars)) if (Array.isArray(pair) && pair.includes(p.id)) delete d.wars[key]; });
      register('nations.war.set', 'Дипломатические отношения', (draft, p) => {
        const d = data(draft), { nationId, enemyId, atWar } = p;
        if (typeof nationId !== 'string' || typeof enemyId !== 'string' || nationId === enemyId || !Object.hasOwn(d.items, nationId) || !Object.hasOwn(d.items, enemyId) || typeof atWar !== 'boolean') throw new Error('Выберите две разные существующие нации и состояние войны.');
        const key = warKey(nationId, enemyId);
        if (atWar) d.wars[key] = [nationId, enemyId].sort(); else delete d.wars[key];
      });
      register('nations.assign', 'Назначение территории', (draft, p, { regionIndex }) => { const d = data(draft); if (!Array.isArray(p.ids) || p.ids.some(id => !regionIndex.get(id)) || (p.nationId !== null && !d.items[p.nationId])) throw new Error('Неизвестная провинция или нация.'); for (const id of p.ids) { if (p.nationId) d.owners[id] = p.nationId; else delete d.owners[id]; } });
      register('nations.province.set', 'Свойства провинции', (draft, p, { regionIndex }) => { const d = data(draft); if (!regionIndex.get(p.id)) throw new Error('Неизвестная провинция.'); const value = String(p.name || '').trim().slice(0, 80); if (value) d.names[p.id] = value; else delete d.names[p.id]; });
    }
    dispatch(type, payload, label) { return this.state.dispatch(type, payload, { label, source: 'nations' }); }
    setNation({ id = uid('nation'), name, color }) {
      name = String(name || '').trim().slice(0, 80); if (!name || !validColor(color)) throw new Error('Укажите название и цвет нации.');
      this.dispatch('nations.save', { id, name, color }, 'Нация: ' + name); return id;
    }
    removeNation(id) { this.dispatch('nations.remove', { id }, 'Удаление нации'); }
    atWar(a, b) { return isAtWar(this.data, a, b); }
    enemies(id) { return enemyIds(this.data, id).map(enemyId => this.data.items[enemyId]); }
    setWar(nationId, enemyId, atWar) {
      const a = this.data.items[nationId], b = this.data.items[enemyId];
      return this.dispatch('nations.war.set', { nationId, enemyId, atWar }, (atWar ? 'Война: ' : 'Мир: ') + (a?.name || nationId) + ' — ' + (b?.name || enemyId));
    }
    assign(ids, nationId) {
      if (nationId && !this.data.items[nationId]) throw new Error('Выберите нацию.');
      if (ids.some(id => !this.state.regions.has(Number(id)))) throw new Error('Провинция не найдена.');
      this.dispatch('nations.assign', { ids: [...new Set(ids.map(Number))], nationId: nationId || null }, nationId ? 'Назначение территории' : 'Освобождение территории');
    }
    members(id) { return Object.entries(this.data.owners).filter(([, owner]) => owner === id).map(([province]) => Number(province)); }
    nationsFor(provinceIds) { return [...new Set(provinceIds.map(id => this.data.owners[id]))].filter(id => Object.hasOwn(this.data.items, id)); }
    setProvince(id, { name } = {}) { if (!this.state.regions.has(id)) throw new Error('Провинция не найдена.'); this.dispatch('nations.province.set', { id, name: name || '' }, 'Свойства провинции #' + id); }
  }
  Object.assign(root.AtlasExtensions, { NationsModel, EMPTY_NATIONS: EMPTY, validNationColor: validColor });
  if (typeof module !== 'undefined' && module.exports) module.exports = { NationsModel };
})(globalThis);
