/* Region input: any number of observers, at most one selected editing handler. */
(function (root) {
  'use strict';
  const { EventBus, uid } = root.AtlasCore;
  class RegionClicks extends EventBus {
    #listeners = new Map();
    #activeId = null;
    #generation = 0;
    constructor({ onError = (error) => console.error(error) } = {}) {
      super();
      this.onError = onError;
    }
    get activeId() {
      return this.#activeId;
    }
    get active() {
      return this.list.find((item) => item.id === this.#activeId) || null;
    }
    get list() {
      return [...this.#listeners.values()].map(({ id, label, mode, cursor }) =>
        Object.freeze({ id, label, mode, cursor }),
      );
    }
    subscribe(
      handler,
      {
        id = uid('region-click'),
        label = '',
        mode = 'passive',
        cursor = 'crosshair',
        enabled = () => true,
        signal,
      } = {},
    ) {
      if (
        typeof handler !== 'function' ||
        typeof id !== 'string' ||
        !id ||
        this.#listeners.has(id) ||
        !['passive', 'active'].includes(mode) ||
        typeof label !== 'string' ||
        typeof enabled !== 'function' ||
        typeof cursor !== 'string'
      )
        throw new Error('Нужны уникальный ID, режим и обработчик клика по региону.');
      let registered = !signal?.aborted;
      const record = { id, label, mode, cursor, handler, enabled },
        owner = this;
      const dispose = () => {
        if (!registered) return;
        registered = false;
        this.#listeners.delete(id);
        signal?.removeEventListener('abort', dispose);
        if (this.#activeId === id) this.clearActive();
      };
      if (registered) {
        this.#listeners.set(id, record);
        signal?.addEventListener('abort', dispose, { once: true });
      }
      return Object.freeze({
        id,
        mode,
        get selected() {
          return registered && owner.activeId === id;
        },
        activate: () => this.activate(id),
        deactivate: () => {
          if (this.#activeId === id) this.clearActive();
        },
        dispose,
      });
    }
    activate(id) {
      const listener = this.#listeners.get(id);
      if (!listener || listener.mode !== 'active' || !listener.enabled())
        throw new Error('Активный обработчик недоступен.');
      if (this.#activeId === id) return;
      const previousId = this.#activeId;
      this.#activeId = id;
      this.#generation++;
      this.emit('change', { activeId: id, previousId });
    }
    clearActive() {
      if (this.#activeId === null) return;
      const previousId = this.#activeId;
      this.#activeId = null;
      this.#generation++;
      this.emit('change', { activeId: null, previousId });
    }
    #invoke(record, event) {
      try {
        const result = record.handler(event);
        result?.catch?.((error) => this.onError(error));
      } catch (error) {
        this.onError(error);
      }
    }
    dispatch(event, { active: allowActive = true } = {}) {
      // Freeze the candidate before observers run; an observer cannot enable an editor for this same click.
      const generation = this.#generation,
        active = this.#listeners.get(this.#activeId),
        passive = [...this.#listeners.values()].filter((record) => record.mode === 'passive');
      for (const record of passive) {
        if (this.#listeners.get(record.id) !== record) continue;
        try {
          if (record.enabled()) this.#invoke(record, event);
        } catch (error) {
          this.onError(error);
        }
      }
      if (
        !allowActive ||
        !active ||
        event.id == null ||
        generation !== this.#generation ||
        this.#listeners.get(active.id) !== active
      )
        return;
      try {
        if (active.enabled()) this.#invoke(active, event);
        else this.clearActive();
      } catch (error) {
        this.clearActive();
        this.onError(error);
      }
    }
  }
  Object.assign((root.AtlasUI ||= {}), { RegionClicks });
  if (typeof module !== 'undefined' && module.exports) module.exports = { RegionClicks };
})(globalThis);
