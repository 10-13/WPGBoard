# АТЛАС: ядро, UI и расширения

Исходники раздельные. `python3 build.py` собирает их, стили и карту в один
`dist/index.html`, который не загружает внешних ресурсов. Для игры достаточно
скачать HTML и открыть его в браузере. npm-зависимостей нет.

## Границы библиотек

| Часть | Файлы | Ответственность |
| --- | --- | --- |
| Ядро | `packages/core/index.js` | Singleton игры, оригинал карты, индекс областей, параметры, метаданные, реестр типов экшенов, исполнение, журнал, ветки, слияния, отмена и повтор. Работает в Node без DOM. |
| UI | `packages/ui/` | Singleton интерфейса, карта, ввод, независимые слои, переносимые и изменяемые по размеру окна, вкладки, публичные деревья меню, жизненный цикл расширений. |
| Адаптеры браузера | `packages/platform/browser.js` | PNG, Web Worker индексатора, файлы, IndexedDB и миграция прежних партий. Не входят в headless-ядро. |
| Нации | `extensions/nations.js` | Типы экшенов наций, их модель, раскраска и редакторы. |
| Просмотр истории | `extensions/history.js` | Только интерфейс к истории ядра: окна, команды меню, импорт/экспорт журналов. |
| Файлы | `extensions/files.js` | Интерфейс импорта/экспорта карт и партий. |
| Запуск | `app.js` | Связывает библиотеки, подключает расширения и сохраняет партию. |

Ядро не зависит от UI, Canvas, браузерных адаптеров или расширений. Ни нации,
ни их цвета не зашиты в него. Библиотека UI не импортирует редактор наций или
просмотрщик истории. Модули подключаются через `ExtensionHost`.

## Singleton состояния игры

```js
const game = AtlasCore.getGameState();

game.regionIndex; // RegionIndex: геометрия, at(x,y), idAt(x,y), маски областей
game.regions;    // ReadonlyMap<number, {id, bbox, anchor, area}>
game.originalMap; // {dataURL, width, height, name}; исходный PNG без перекраски
game.params;     // Обычно неизменяемые параметры игры, readonly JSON-снимок
game.meta;       // Расширяемые данные игры, readonly текущий JSON-снимок
game.actions;    // Реестр типов экшенов ядра
game.history;    // История экшенов и веток, принадлежащая ядру

game.setMeta(['campaign', 'title'], 'Новая партия');
game.updateMeta('resources', draft => { draft.gold = (draft.gold || 0) + 10; });
game.updateParams(draft => { draft.ruleset = 'custom'; });
```

Метаданные доступны расширениям и могут часто меняться. Запись делается через
ядро, чтобы оно автоматически зарегистрировало экшен. Прямое изменение
`game.meta`, `game.params`, оригинала карты или геометрии запрещено: эти объекты
заморожены. Приватный пиксельный массив индекса наружу не выдаётся.

В ядре «регион» — одна индексируемая область карты (провинция). Нации и
пользовательские группы провинций хранятся в `meta.nations`, поскольку это данные
расширения. При миграции прежние группы остаются группами; ID провинций сохраняются.

## Экшены исполняет и регистрирует ядро

Расширение определяет обработчик типа, но не ведёт собственную историю:

```js
const registration = game.actions.register('economy.add', {
  label: 'Начисление ресурсов',
  reduce(draft, payload) {
    draft.meta.economy ||= { gold: 0 };
    draft.meta.economy.gold += payload.amount;
  }
}, { signal: extensionScope.signal });

const commit = game.dispatch('economy.add', { amount: 15 }, { source: 'economy' });

commit.action.id;      // Постоянный ID экшена
commit.action.type;    // 'economy.add'
commit.action.payload; // {amount: 15}
commit.actions;        // Вычисленные ядром изменения before/after
```

`dispatch` берёт снимок выбранной ветки, выполняет синхронный reducer над
черновиком, вычисляет изменения, проверяет данные и атомарно записывает коммит.
Ошибка, асинхронный reducer или вложенная запись состояния отклоняются целиком.
Reducer меняет только переданный черновик. Внешние эффекты и `await` выполняются
до вызова `dispatch`, а не внутри него.

Даже базовые `setMeta`, `updateMeta`, `deleteMeta` и `updateParams` создают
экшены ядра. Если фактических изменений нет, пустая запись не создаётся.

```js
game.history.actions;                 // Все записанные экшены
const action = game.history.getAction(commit.action.id);
action.patches;                       // Неизменяемые изменения before/after
game.history.revertAction(action.id); // Новый обратный экшен
game.history.applyAction(action.id);  // Повторное применение записанных изменений
game.history.undo();
game.history.redo();
```

Индивидуальное применение/обращение проверяет предыдущее значение каждого
поля. Если данные уже изменились, ядро возвращает конфликт вместо молчаливой
перезаписи. Отмена и повтор дописывают записи, сохраняя исходный журнал.

Экшен хранит тип, payload и готовые изменения. Поэтому ядро может восстановить
партию, слить ветку, применить или обратить записанный экшен даже после выгрузки
расширения, которое зарегистрировало его тип. Восстановление не исполняет код
расширений из файла журнала.

## Ветки, предложения изменений и слияние

```js
game.history.createBranch('proposal');

// Записать действие в отдельную ветку; актуальная main не меняется:
game.dispatch('economy.add', { amount: 20 }, { branch: 'proposal' });

game.history.snapshot('proposal');
game.history.previewMerge('proposal', { target: 'main' });
game.history.merge('proposal', { target: 'main' });

// Или открыть ветку для интерактивного редактирования на карте:
game.history.checkout('proposal');
game.history.checkout('main');
```

История — DAG коммитов с родителями и указателями веток. Слияние использует
общего предка и трёхстороннее сравнение. Независимые изменения объединяются;
разные изменения одного значения требуют решения. По умолчанию конфликт
ничего не применяет. Явные стратегии — `ours` и `theirs`.

Источник слияния не удаляется. Если целевая ветка не активна, её новая вершина
сохраняется в истории; актуальная игра изменится при переходе на эту ветку.
Слияние в активную ветку сразу обновляет singleton и отрисовку.

```js
const bundle = game.history.exportBranch('proposal');
game.history.importBranch(bundle, { name: 'friend-proposal' });
// Импорт сам по себе не меняет актуальное состояние.
game.history.merge('friend-proposal');
```

Журнал проверяется на принадлежность карте и исходной базе, связи коммитов,
циклы, дубликаты ID и корректность предшествующих значений. Несколько независимых
баз слияния при criss-cross истории явно отклоняются; для них нужна промежуточная
ветка. Массивы считаются атомарными значениями, объекты объединяются по полям.

История полностью принадлежит ядру. Отключение расширения «Ветки и журнал»
убирает только её просмотр и команды меню; запись экшенов продолжает работать.

## Публичные примитивы интерфейса

```js
const ui = AtlasUI.getUI();
ui.viewport; // Карта, камера, выбор области, независимые Canvas-слои
ui.windows;  // WindowManager
ui.mainMenu; // Публичный TreeMenu
ui.tileMenu; // Второй независимый TreeMenu с тем же API
ui.input;    // EventBus ввода
ui.extensions;

const off = ui.input.on('province:click', ({ id, region, x, y }) => {});
ui.input.on('province:hover', event => {});
ui.input.on('province:context', event => {});
ui.input.on('selection:change', event => {});
off();
```

`x,y` — координаты оригинального изображения; `id`/`region` равны `null` на
море и границе. Перетаскивание и масштабирование не вызывают клик по провинции.

### Один API для обоих деревьев меню

```js
const handler = new AtlasUI.ActionHandler(({ id }) => {
  // При изменении игры вызываем game.dispatch(...).
}, { signal: scope.signal });

const entry = ui.tileMenu.register({
  id: 'my-extension.example',
  path: ['Действия', 'Пример'],
  label: 'Выполнить',
  handler,
  when: context => !!context.id,
  enabled: context => context.id !== null
});

handler.disable(); // Удалит все пункты, подписанные на этот обработчик
entry.dispose();   // Удалит только эту регистрацию
```

Удаление последнего пункта автоматически убирает пустые группы. `AbortSignal`
снимает регистрацию; отключение всего расширения снимает все его регистрации.
`enabled: false` показывает недоступную кнопку, а `handler.disable()` завершает
жизненный цикл обработчика и удаляет кнопку. Это разные операции.

Можно создать собственное дерево:

```js
const menu = new AtlasUI.TreeMenu();
menu.register({ id: 'a', label: 'Действие', handler: () => {} });
menu.open({ x: 100, y: 100, context: { id: 42 } });
menu.close();
menu.dispose();
```

`ActionHandler` — обработчик UI, а не запись игрового экшена. Он вызывает
`game.dispatch` или базовые методы ядра; запись игры выполняется уже ядром.

### Окна и вкладки

```js
const tab = ui.windows.open({
  id: 'my-tab', windowId: 'my-window', title: 'Инструмент',
  x: 20, y: 20, width: 280, height: 320,
  signal: extensionScope.signal,
  render(pane, tabScope, handle) {
    pane.textContent = 'Содержимое';
    ui.input.on('province:click', event => {
      pane.textContent = 'Провинция #' + event.id;
    }, { signal: tabScope.signal });
  }
});

tab.activate();
ui.windows.moveTab(tab.id, anotherTab.windowId);
ui.windows.merge(tab.windowId, anotherTab.windowId);
ui.windows.resize(tab.windowId, 400, 300);
tab.close();
```

Окна перемещаются за заголовок или `⠿`, меняют размер за нижний правый угол.
При отпускании окна над другим окном их вкладки объединяются. Отдельную вкладку
можно перетащить в другое окно или вынести на карту. Содержимое при переносе
остаётся тем же DOM-узлом и не подписывается на события повторно.

Закрытие вкладки освобождает её локальный `tabScope`. Закрытие последней вкладки
автоматически удаляет окно. Если в одном окне смешаны вкладки разных расширений,
выгрузка расширения закрывает только принадлежащие ему вкладки.

## Контракт расширения

```js
ui.extensions.register({
  id: 'example', name: 'Пример', description: 'Мой модуль',
  start(ctx) {
    ctx.state.actions.register('example.note', {
      label: 'Заметка к провинции',
      reduce(draft, { id }) {
        draft.meta.example ||= { notes: {} };
        draft.meta.example.notes[id] = 'Отмечено';
      }
    }, { signal: ctx.signal });

    ctx.menu(ctx.ui.tileMenu, {
      id: 'note', path: ['Пример'], label: 'Отметить',
      when: event => !!event.id,
      handler: ({ id }) => ctx.state.dispatch('example.note', { id })
    });

    ctx.on('province:click', event => console.log(event.id));
    ctx.window({ id: 'tool', title: 'Мой инструмент', render: pane => {
      pane.textContent = 'Панель расширения';
    }});
    // return () => ...; // Необязательная дополнительная очистка
  }
});

await ui.extensions.enable('example');
ui.extensions.disable('example');
```

Контекст даёт `state`, `ui`, `signal`, `scope`, `on`, `action`, `menu`, `window`,
`layer`. Регистрации меню, окна, слои и подписки, созданные через контекст,
автоматически принадлежат расширению. ID меню/вкладок получают его префикс.
Ручные регистрации в ядре и публичных объектах нужно привязывать к `ctx.signal`.

Камера, положение окон и вкладки — состояние интерфейса, а не игровые экшены.
Данные партии, включая исходный PNG и журнал, сохраняются через `state.toJSON()`.

## Сборка и проверки

```sh
python3 build.py
node --test tests/*.test.cjs
```

Для обычной сборки достаточно Python: оригинал включён в `assets/`.
Необязательная повторная подготовка карты через `preprocess.py` требует Pillow,
NumPy и SciPy. Новые карты в интерфейсе разбираются локально в Web Worker.

Исходная карта содержит 4587 отдельных четырёхсвязных областей серой суши.
Разрыв границы объединяет области, а несвязанные острова получают разные ID.
Географическое распознавание и сетевой multiplayer в эту архитектуру не входят.

Проверено: headless singleton, неизменяемость состояния, экшены и их адресация,
атомарность reducer-ов, ветки, конфликты и слияния, обмен журналами, отмена/повтор,
отключение обработчиков меню и миграция прежних партий. В браузере проверены
слияние и разделение окон, ресайз, закрытие последней вкладки, выгрузка и повторный
запуск модулей, запись экшенов с отключённым просмотрщиком, контекстное дерево,
экспорт PNG/JSON/HTML. Проверены точные цвета PNG и сохранность байтов оригинала.
Автоматический браузер не разрешает `file://`; прямое открытие автономного файла
им не проверялось. Собранный HTML не содержит внешних скриптов, стилей или изображений.
