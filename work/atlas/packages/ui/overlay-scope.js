/* Reusable local clipping controls. The chosen area is a snapshot of province IDs. */
(function (root) {
  'use strict';
  const { EventBus, normalizeOverlayScope } = root.AtlasCore || require('../core/index.js');
  class AreaRegistry extends EventBus {
    #providers = new Map();
    register(id, { getAreas }, { signal } = {}) {
      if (
        typeof id !== 'string' ||
        !id ||
        this.#providers.has(id) ||
        typeof getAreas !== 'function'
      )
        throw new Error('Нужен уникальный поставщик областей и getAreas().');
      let active = !signal?.aborted;
      const dispose = () => {
        if (!active) return;
        active = false;
        this.#providers.delete(id);
        signal?.removeEventListener('abort', dispose);
        this.emit('change', {});
      };
      if (active) {
        this.#providers.set(id, getAreas);
        signal?.addEventListener('abort', dispose, { once: true });
        this.emit('change', {});
      }
      return Object.freeze({ dispose });
    }
    get list() {
      const result = [];
      for (const [provider, getAreas] of this.#providers)
        for (const area of getAreas())
          result.push(
            Object.freeze({
              id: provider + ':' + area.id,
              title: String(area.title),
              provinceIds: normalizeOverlayScope(area.provinceIds) || [],
            }),
          );
      return Object.freeze(result);
    }
  }
  function createScopeControl({
    state,
    selection,
    areas,
    readIds,
    onChange,
    signal,
    open = true,
    onToggle,
  } = {}) {
    const { el, field } = root.AtlasUI.dom,
      { button } = root.AtlasUI.controls;
    const { createDataRow, createDataGroup } = root.AtlasUI.dataView;
    const { normalizeOverlayScope } = root.AtlasCore;
    if (!state || !selection || typeof readIds !== 'function' || typeof onChange !== 'function')
      throw new Error('Для области нужны состояние, выделение и обработчики.');
    const group = createDataGroup('Область оверлея', { open, onToggle }),
      select = el('select');
    select.setAttribute('aria-label', 'Регион области оверлея');
    const mode = createDataRow('Область', ''),
      count = createDataRow('Провинций в области', ''),
      tools = el('div', 'form-actions');
    let current = null,
      named = new Map();
    const change = (ids) => {
      onChange(ids);
      refresh();
    };
    const all = button('Весь мир', () => change(null)),
      take = button('Взять выделение', () => change([...selection.ids]));
    tools.append(all, take);
    select.onchange = () => {
      if (select.value === '__world') change(null);
      else if (select.value.startsWith('region:') && named.has(select.value.slice(7)))
        change([...named.get(select.value.slice(7)).ids]);
    };
    function refresh() {
      try {
        current = normalizeOverlayScope(readIds(), state.regionIndex);
      } catch (_) {
        current = null;
      }
      named = new Map(
        (areas?.list || [])
          .map((r) => [
            r.id,
            { name: r.title, ids: [...normalizeOverlayScope(r.provinceIds, state.regionIndex)] },
          ])
          .sort(([, a], [, b]) => a.name.localeCompare(b.name, 'ru')),
      );
      select.replaceChildren(
        new Option('Весь мир', '__world'),
        new Option('Текущая область', '__custom'),
      );
      for (const [id, r] of named) {
        const option = new Option(r.name + ' · ' + r.ids.length, 'region:' + id);
        option.disabled = !r.ids.length;
        select.append(option);
      }
      select.options[1].disabled = true;
      const match =
        current === null || !current.length
          ? null
          : [...named].find(
              ([, r]) =>
                r.ids.length === current.length && r.ids.every((id, i) => id === current[i]),
            );
      select.value = current === null ? '__world' : match ? 'region:' + match[0] : '__custom';
      mode.querySelector('.data-value').textContent =
        current === null ? 'Весь мир' : match ? match[1].name : 'Выбранные провинции';
      count.querySelector('.data-value').textContent = String(
        current === null ? state.regionIndex.size : current.length,
      );
      all.disabled = current === null;
      take.disabled = !selection.ids.length;
      take.title = 'Применить текущее выделение: ' + selection.ids.length + ' провинций';
    }
    group.body.append(
      field('Регион', select),
      mode,
      count,
      tools,
      el(
        'p',
        'muted',
        'Вне области слой прозрачен. Шкала использует только её значения. Состав области фиксируется при выборе.',
      ),
    );
    group.element.classList.add('overlay-scope');
    group.element.refresh = refresh;
    if (signal) {
      areas?.on('change', refresh, { signal });
      selection.on('change', refresh, { signal });
      state.on('change', refresh, { signal });
      state.on('map:loaded', refresh, { signal });
      state.overlays.on('settings:change', refresh, { signal });
    }
    refresh();
    return group.element;
  }
  Object.assign((root.AtlasUI ||= {}), { overlayScope: { AreaRegistry, createScopeControl } });
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { AreaRegistry, createScopeControl };
})(globalThis);
