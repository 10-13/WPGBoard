(function (root) {
  'use strict';
  const { el, button } = root.AtlasUI.dom,
    { download, chooseFile, safeName } = root.AtlasPlatform;
  const definition = {
    id: 'history',
    name: 'Ветки и журнал',
    description: 'Предложения изменений, слияния, конфликты и отмена.',
    start(ctx) {
      const { state, ui, signal } = ctx;
      const attempt =
        (fn) =>
        (...args) => {
          try {
            const result = fn(...args);
            if (result?.catch) result.catch((e) => ui.notify(e.message));
            return result;
          } catch (e) {
            ui.notify(e.message);
          }
        };
      function mergeBranch(name) {
        const preview = state.history.previewMerge(name);
        if (!preview.conflicts.length) {
          state.history.merge(name);
          state.history.checkout('main');
          ui.notify(
            preview.alreadyMerged
              ? 'Ветка уже в основной истории'
              : 'Ветка влита в main; исходный журнал сохранён',
          );
          return;
        }
        ctx.window({
          id: 'conflicts',
          title: 'Конфликты слияния',
          x: 330,
          y: 90,
          width: 380,
          height: 300,
          render(pane, scope, tab) {
            pane.append(
              el(
                'p',
                '',
                'Найдены изменения одних и тех же данных в обеих ветках. Основная ветка пока не изменена.',
              ),
            );
            for (const conflict of preview.conflicts)
              pane.append(
                el('div', 'conflict-path mono', conflict.target + '/' + conflict.path.join('/')),
              );
            const resolve = (strategy) =>
              attempt(() => {
                state.history.merge(name, { strategy });
                state.history.checkout('main');
                tab.close();
                ui.notify('Слияние завершено. Обе ветки остались в истории.');
              });
            const row = el('div', 'form-actions');
            row.append(
              button('Оставить main', resolve('ours')),
              button('Взять изменения ветки', resolve('theirs'), { className: 'accent' }),
            );
            pane.append(row);
          },
        });
      }
      function openBranches() {
        return ctx.window({
          id: 'branches',
          windowId: 'workspace',
          title: 'Ветки',
          x: Math.max(290, ui.workspace.clientWidth - 340),
          y: 18,
          width: 325,
          height: 360,
          render(pane, scope) {
            const draw = () => {
              pane.replaceChildren(
                el(
                  'p',
                  'muted small',
                  'Изменения активной ветки видны на карте. Другие ветки хранятся отдельно; main меняется при слиянии.',
                ),
              );
              for (const branch of state.history.branches) {
                const row = el('div', 'branch-row');
                const text = el('div', 'branch-description');
                text.append(
                  el(
                    'strong',
                    '',
                    (branch.name === state.history.activeBranch ? '● ' : '') + branch.name,
                  ),
                  el(
                    'small',
                    'mono muted',
                    branch.head ? branch.head.slice(-10) : 'исходное состояние',
                  ),
                );
                row.append(text);
                row.append(
                  button(
                    'Открыть',
                    attempt(() => state.history.checkout(branch.name)),
                    { title: 'Перейти в ветку ' + branch.name },
                  ),
                );
                if (branch.name !== 'main')
                  row.append(
                    button(
                      'В main',
                      attempt(() => mergeBranch(branch.name)),
                      { title: 'Влить ' + branch.name + ' в main', className: 'accent' },
                    ),
                  );
                pane.append(row);
              }
              const row = el('form', 'inline-form'),
                name = document.createElement('input');
              name.placeholder = 'Название новой ветки';
              name.maxLength = 80;
              name.setAttribute('aria-label', 'Название новой ветки');
              const create = button('+ Ветка', () => {});
              create.type = 'submit';
              row.append(name, create);
              row.onsubmit = attempt((event) => {
                event.preventDefault();
                state.history.createBranch(name.value.trim());
                state.history.checkout(name.value.trim());
              });
              pane.append(row);
              pane.append(
                el(
                  'p',
                  'muted small',
                  state.history.commits.length +
                    ' записей в журнале · отмена также оставляет запись.',
                ),
              );
            };
            state.on('history:change', draw, { signal: scope.signal });
            state.on('map:loaded', draw, { signal: scope.signal });
            draw();
          },
        });
      }
      function openLog() {
        return ctx.window({
          id: 'log',
          windowId: 'workspace',
          title: 'Журнал',
          x: Math.max(290, ui.workspace.clientWidth - 340),
          y: 18,
          width: 325,
          height: 360,
          render(pane, scope) {
            const draw = () => {
              pane.replaceChildren();
              const tools = el('div', 'tool-row'),
                undo = button(
                  '↶ Отменить',
                  attempt(() => state.history.undo()),
                ),
                redo = button(
                  '↷ Повторить',
                  attempt(() => state.history.redo()),
                );
              undo.disabled = !state.history.canUndo;
              redo.disabled = !state.history.canRedo;
              tools.append(undo, redo);
              pane.append(tools);
              for (const commit of state.history.commits.slice().reverse().slice(0, 200)) {
                const row = el('div', 'log-row');
                row.append(
                  el('strong', '', commit.label),
                  el(
                    'small',
                    'muted mono',
                    commit.action.type +
                      ' · ' +
                      commit.source +
                      ' · ' +
                      commit.actions.length +
                      ' изм. · ' +
                      commit.action.id.slice(-8),
                  ),
                );
                row.append(
                  button(
                    'Обратить экшен',
                    attempt(() => state.history.revertAction(commit.action.id)),
                    { className: 'small' },
                  ),
                );
                pane.append(row);
              }
              if (!state.history.commits.length)
                pane.append(
                  el('p', 'muted', 'Журнал пуст. Исходная партия сохранена как база истории.'),
                );
            };
            state.on('history:change', draw, { signal: scope.signal });
            state.on('map:loaded', draw, { signal: scope.signal });
            draw();
          },
        });
      }
      function openHistory() {
        const branches = openBranches();
        openLog();
        branches.activate();
      }
      function exportBranch() {
        const bundle = state.history.exportBranch();
        download(
          new Blob([JSON.stringify(bundle)], { type: 'application/json' }),
          safeName(bundle.name) + '.atlas-branch.json',
        );
        ui.notify('Журнал ветки экспортирован отдельно от карты');
      }
      async function importBranch() {
        const file = await chooseFile('.json,application/json', { signal });
        if (!file || signal.aborted) return;
        if (file.size > 30000000) throw new Error('Журнал слишком большой.');
        const bundle = JSON.parse(await file.text());
        if (signal.aborted) return;
        ctx.window({
          id: 'import',
          title: 'Импорт журнала',
          x: 320,
          y: 100,
          width: 315,
          height: 185,
          render(pane, scope, tab) {
            const input = document.createElement('input');
            input.setAttribute('aria-label', 'Имя импортируемой ветки');
            input.value = String(bundle.name || 'proposal') + '-импорт';
            pane.append(
              el('p', 'muted', 'Изменения останутся отдельной веткой до слияния в main.'),
              input,
              button(
                'Добавить в историю',
                attempt(() => {
                  state.history.importBranch(bundle, { name: input.value.trim() });
                  tab.close();
                  openHistory();
                }),
                { className: 'accent wide' },
              ),
            );
          },
        });
      }
      ctx.windowMenu({ id: 'branches', label: 'Ветки', handler: openBranches });
      ctx.windowMenu({ id: 'log', label: 'Журнал действий', handler: openLog });
      ctx.menu(ui.mainMenu, {
        id: 'open',
        path: ['Инструменты', 'История'],
        label: 'Ветки и журнал',
        handler: openHistory,
      });
      ctx.menu(ui.mainMenu, {
        id: 'undo',
        path: ['Инструменты', 'История'],
        label: 'Отменить',
        enabled: () => state.history.canUndo,
        handler: () => state.history.undo(),
      });
      ctx.menu(ui.mainMenu, {
        id: 'redo',
        path: ['Инструменты', 'История'],
        label: 'Повторить',
        enabled: () => state.history.canRedo,
        handler: () => state.history.redo(),
      });
      ctx.menu(ui.mainMenu, {
        id: 'export',
        path: ['Инструменты', 'История', 'Обмен журналами'],
        label: 'Экспорт активной ветки',
        handler: exportBranch,
      });
      ctx.menu(ui.mainMenu, {
        id: 'import',
        path: ['Инструменты', 'История', 'Обмен журналами'],
        label: 'Импорт ветки',
        handler: importBranch,
      });
    },
  };
  Object.assign((root.AtlasExtensions ||= {}), { history: definition });
})(globalThis);
