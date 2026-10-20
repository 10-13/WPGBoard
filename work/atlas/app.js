/* Composition root only. Editors and history tools live in extensions. */
(async function () {
  'use strict';
  const template = '<!doctype html>\n' + document.documentElement.outerHTML;
  const embedded = JSON.parse(document.getElementById('atlas-data').textContent);
  const state = AtlasCore.getGameState(),
    ui = AtlasUI.getUI(),
    storage = new AtlasPlatform.Storage();
  AtlasStatistics.registerBasicStatistics(state);
  const saveKey = embedded.saveKey || embedded.saveId || 'atlas-default-v1';
  const displayKey = ['overlay-preferences', saveKey];
  try {
    const savedDisplay = await storage.get(displayKey);
    if (savedDisplay) state.overlays.restore(savedDisplay);
  } catch (error) {
    /* Display preferences are optional and local to this browser. */
  }
  await ui.mount({ host: document.getElementById('app'), state });
  let loading = false,
    saveTimer,
    displayTimer,
    revision = 0,
    storageNotice = false;
  const persistDisplay = () => storage.put(displayKey, state.overlays.toJSON()).catch(() => {});
  const snapshot = () => ({ ...state.toJSON(), saveKey });
  async function persist() {
    if (!state.loaded) return;
    const current = ++revision;
    ui.setSaveStatus('Сохраняем…');
    try {
      await storage.put(saveKey, snapshot());
      if (current === revision) ui.setSaveStatus('Сохранено локально');
    } catch (error) {
      if (current === revision) ui.setSaveStatus('Нет автосохранения');
      if (!storageNotice) {
        storageNotice = true;
        ui.notify('Браузер не разрешил автосохранение. Сохраните партию в JSON.');
      }
    }
  }
  async function loadProject(project, save = true) {
    if (loading) throw new Error('Дождитесь завершения текущей загрузки.');
    loading = true;
    ui.setBusy(true, 'Проверяем карту и восстанавливаем историю…');
    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const prepared = await AtlasPlatform.prepare(project, embedded);
      state.load(prepared.project, prepared.regionIndex);
      await ui.renderMap();
      if (save) await persist();
    } finally {
      loading = false;
      ui.setBusy(false);
    }
  }
  function serializeHTML() {
    const doc = new DOMParser().parseFromString(template, 'text/html'),
      data = snapshot();
    data.saveKey = AtlasCore.uid('party');
    doc.getElementById('atlas-data').textContent = JSON.stringify(data).replace(/</g, '\\u003c');
    return '<!doctype html>\n' + doc.documentElement.outerHTML;
  }
  const services = { snapshot, persist, loadProject, serializeHTML };
  window.Atlas = Object.freeze({ state, ui, loadProject, snapshot });
  try {
    let saved;
    try {
      saved = await storage.get(saveKey);
    } catch (e) {}
    if (saved) {
      try {
        await loadProject(saved, false);
      } catch (error) {
        console.warn('Saved party rejected:', error.message);
        await loadProject(embedded, false);
        ui.notify('Автосохранение повреждено; открыта встроенная партия.');
      }
    } else await loadProject(embedded, false);
    ui.extensions.register(AtlasExtensions.createFilesExtension(services));
    ui.extensions.register(AtlasExtensions.nations);
    ui.extensions.register(AtlasExtensions.regions);
    ui.extensions.register(AtlasExtensions.history);
    ui.extensions.register(AtlasExtensions.metadata);
    ui.extensions.register(AtlasExtensions.resources);
    ui.extensions.register(AtlasExtensions.geography);
    await ui.extensions.enable('files');
    await ui.extensions.enable('nations');
    await ui.extensions.enable('regions');
    await ui.extensions.enable('history');
    await ui.extensions.enable('metadata');
    await ui.extensions.enable('resources');
    await ui.extensions.enable('geography');
    state.on('history:change', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 400);
    });
    state.overlays.on('settings:change', () => {
      clearTimeout(displayTimer);
      displayTimer = setTimeout(persistDisplay, 200);
    });
    await persist();
    window.addEventListener('pagehide', persist);
    window.addEventListener('pagehide', persistDisplay);
  } catch (error) {
    console.error(error);
    ui.setBusy(false);
    ui.notify(error.message);
    ui.windows.open({
      id: 'startup:error',
      title: 'Не удалось открыть партию',
      x: 20,
      y: 20,
      width: 360,
      height: 180,
      render(pane) {
        pane.append(AtlasUI.dom.el('p', '', error.message));
      },
    });
  }
})();
