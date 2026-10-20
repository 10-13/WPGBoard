/* Headless nation domain and registered kernel actions. */
(function (root) {
  'use strict';
  const { uid } = root.AtlasCore;
  const { warKey, isAtWar, enemyIds } = root.AtlasExtensions;
  const EMPTY = { items: {}, owners: {}, groups: {}, groupAssignments: {}, names: {}, wars: {} };
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
      register('nations.group.save', 'Изменение группы', (draft, p) => { if (!p.id || !String(p.name || '').trim()) throw new Error('Укажите название группы.'); data(draft).groups[p.id] = { id: p.id, name: String(p.name).trim().slice(0, 80) }; });
      register('nations.group.remove', 'Удаление группы', (draft, p) => { const d = data(draft); delete d.groups[p.id]; for (const [id, group] of Object.entries(d.groupAssignments)) if (group === p.id) delete d.groupAssignments[id]; });
      register('nations.region.set', 'Свойства провинции', (draft, p, { regionIndex }) => { const d = data(draft); if (!regionIndex.get(p.id) || (p.groupId && !d.groups[p.groupId])) throw new Error('Неизвестная провинция или группа.'); if ('name' in p) { const value = String(p.name).trim().slice(0, 80); if (value) d.names[p.id] = value; else delete d.names[p.id]; } if ('groupId' in p) { if (p.groupId) d.groupAssignments[p.id] = p.groupId; else delete d.groupAssignments[p.id]; } });
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
    setGroup({ id = uid('group'), name }) { name = String(name || '').trim().slice(0, 80); if (!name) throw new Error('Укажите название группы.'); this.dispatch('nations.group.save', { id, name }, 'Группа: ' + name); return id; }
    removeGroup(id) { this.dispatch('nations.group.remove', { id }, 'Удаление группы'); }
    groupMembers(id) { return Object.entries(this.data.groupAssignments).filter(([, group]) => group === id).map(([region]) => Number(region)); }
    assignGroup(id, nationId) { this.assign(this.groupMembers(id), nationId); }
    setRegion(id, { name, groupId } = {}) {
      if (!this.state.regions.has(Number(id))) throw new Error('Провинция не найдена.'); if (groupId && !this.data.groups[groupId]) throw new Error('Группа не найдена.');
      const payload = { id: Number(id) }; if (name !== undefined) payload.name = name; if (groupId !== undefined) payload.groupId = groupId; this.dispatch('nations.region.set', payload, 'Свойства провинции #' + id);
    }
  }
  Object.assign(root.AtlasExtensions, { NationsModel, EMPTY_NATIONS: EMPTY, validNationColor: validColor });
  if (typeof module !== 'undefined' && module.exports) module.exports = { NationsModel };
})(globalThis);
