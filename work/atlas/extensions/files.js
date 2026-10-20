(function (root) {
  'use strict';
  const { el, button, field } = root.AtlasUI.dom, { download, chooseFile, safeName, createProject } = root.AtlasPlatform;
  function createFilesExtension(services) {
    return {
      id: 'files', name: 'Карты и файлы', description: 'Импорт карт и партий, экспорт PNG, JSON и автономного HTML.',
      start(ctx) {
        const { ui, state, signal } = ctx;
        const title = () => state.getMeta(['campaign', 'title']) || state.originalMap.name;
        const attempt = fn => (...args) => { try { const value = fn(...args); value?.catch?.(e => ui.notify(e.message)); return value; } catch (e) { ui.notify(e.message); } };
        const exportJSON = () => { download(new Blob([JSON.stringify(services.snapshot())], { type: 'application/json' }), safeName(title()) + '.json'); ui.notify('Партия и полный журнал сохранены'); };
        const exportHTML = () => { download(new Blob([services.serializeHTML()], { type: 'text/html;charset=utf-8' }), safeName(title()) + '.html'); ui.notify('HTML содержит карту, библиотеки, расширения и историю'); };
        async function exportPNG() { const c = ui.viewport.exportCanvas(); try { const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png')); if (signal.aborted) return; if (!blob) throw new Error('Не удалось создать PNG.'); download(blob, safeName(title()) + '.png'); ui.notify('PNG: ' + c.width + ' × ' + c.height); } finally { c.width = 1; c.height = 1; } }
        async function importJSON() { const file = await chooseFile('.json,application/json', { signal }); if (!file || signal.aborted) return; if (file.size > 50000000) throw new Error('Файл больше 50 МБ.'); const data = JSON.parse(await file.text()); if (signal.aborted) return; await services.loadProject(data); ui.notify('Партия открыта; история сохранена'); }
        function campaignSettings() {
          ctx.window({ id: 'campaign', title: 'Партия', x: 300, y: 70, width: 300, height: 180, render(pane, scope, tab) {
            const input = document.createElement('input'); input.value = title(); input.maxLength = 80; input.setAttribute('aria-label', 'Название партии'); pane.append(field('Название партии', input), button('Сохранить', () => { state.setMeta(['campaign', 'title'], input.value.trim() || 'Новая кампания', { label: 'Название партии', source: 'files' }); tab.close(); }, { className: 'accent wide' }), el('p', 'muted small', 'Состояние автоматически сохраняется в этом браузере. Для обмена используйте JSON или HTML.'));
          } });
        }
        function uploadMap() {
          ctx.window({ id: 'upload', title: 'Загрузить карту', x: 300, y: 100, width: 325, height: 320, render(pane, scope, tab) {
            const form = el('form'); const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.required = true; file.setAttribute('aria-label', 'Изображение карты');
            const color = document.createElement('input'); color.type = 'color'; color.value = '#808080'; color.setAttribute('aria-label', 'Цвет суши');
            const tolerance = document.createElement('input'); tolerance.type = 'number'; tolerance.min = 0; tolerance.max = 80; tolerance.value = 12; tolerance.setAttribute('aria-label', 'Допуск цвета');
            const submit = button('Разобрать карту', () => {}, { className: 'accent wide' }); submit.type = 'submit';
            form.append(el('p', 'muted', 'Каждая замкнутая область одного цвета станет регионом ядра. Предпочтителен PNG с чёткими границами.'), field('Изображение', file), field('Цвет суши', color), field('Допуск', tolerance), el('p', 'muted small', 'Сохраните текущую партию в JSON, чтобы вернуться к ней после смены карты.'), submit);
            form.onsubmit = attempt(async event => {
              event.preventDefault(); if (!file.files[0]) return; submit.disabled = true;
              try { await services.persist(); ui.setBusy(true, 'Индексируем карту…'); const project = await createProject(file.files[0], { color: color.value, tolerance: Number(tolerance.value), signal, nations: Object.values(state.meta.nations?.items || {}), onProgress: e => ui.setBusy(true, 'Найдено ' + e.count + ' областей · ' + e.progress + '%') }); if (signal.aborted) return; await services.loadProject(project); tab.close(); ui.notify('Карта готова'); }
              finally { ui.setBusy(false); submit.disabled = false; }
            }); pane.append(form);
          } });
        }
        ctx.menu(ui.mainMenu, { id: 'settings', path: ['Файл'], label: 'Параметры партии', handler: campaignSettings, order: -100 });
        ctx.windowMenu({ id: 'settings', label: 'Параметры партии', handler: campaignSettings });
        ctx.menu(ui.mainMenu, { id: 'save', path: ['Файл'], label: 'Сохранить партию · JSON', handler: exportJSON, order: -90 });
        ctx.menu(ui.mainMenu, { id: 'open', path: ['Файл'], label: 'Открыть партию', handler: importJSON, order: -80 });
        ctx.menu(ui.mainMenu, { id: 'png', path: ['Файл', 'Экспорт'], label: 'Карта · PNG', handler: exportPNG, order: -70 });
        ctx.menu(ui.mainMenu, { id: 'html', path: ['Файл', 'Экспорт'], label: 'Редактор и партия · HTML', handler: exportHTML, order: -60 });
        ctx.menu(ui.mainMenu, { id: 'upload', path: ['Файл'], label: 'Загрузить другую карту', handler: uploadMap, order: -50 });
      }
    };
  }
  Object.assign(root.AtlasExtensions ||= {}, { createFilesExtension });
})(globalThis);
