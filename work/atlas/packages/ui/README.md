# Базовая библиотека интерфейса

Единая точка входа — `components.js` / `AtlasUI.components`. Здесь находятся
общие элементы; игровой singleton, карта и запуск интерфейса не требуются.

В Node/CommonJS:

```js
const UI = require('./packages/ui/components.js');
```

Для браузера последовательно подключаются controls.js, color-scale-model.js,
color-scale.js, data-view.js и components.js. Обычная сборка делает это сама.
Стили общие: style.css, packages/ui/data-view.css и packages/ui/color-scale.css.
`tools/build-components-preview.py` собирает автономную страницу примеров,
включающую эти исходники без ядра и данных игры.

## Состав

| Функции | Назначение |
| --- | --- |
| button, createSwitch, createSelect | Кнопки, переключатели, списки |
| createTextInput, createNumberInput, createTextArea | Однострочный текст, числа, многострочный текст |
| el, field | DOM-примитив и подпись поля |
| createDataRow, createDataGroup, renderDataTree | Строки и деревья данных |
| ColorScale, createColorScale | Модель и отображение цветовой шкалы |

AtlasUI.controls, AtlasUI.dataView и AtlasUI.dom остаются совместимыми ссылками
на те же реализации. Новое предметное окно может получать всё из одного UI.
Библиотека не создаёт действий игры и не подписывается на её состояние сама.

## Поля

```js
const title = UI.createTextInput({
  value: 'Новая область', label: 'Название', maxLength: 80, required: true,
});
const amount = UI.createNumberInput({
  value: 12.5, min: 0, max: 1000, step: 'any', label: 'Выпуск',
  onInput: (value, event) => showDraft(event.currentTarget.valueAsNumber),
  signal: tabScope.signal,
});
const notes = UI.createTextArea({value: '', rows: 3, maxLength: 8000, label: 'Описание'});
pane.append(UI.field('Название', title), UI.field('Выпуск', amount), UI.field('Описание', notes));
```

Поля — нативные input/textarea, без обёртки над value и формами. Поддержаны
value, label (aria-label), title, placeholder, required, disabled, readOnly,
name/id, minLength/maxLength, pattern, list, min/max/step, rows/cols,
autocomplete, inputMode, spellcheck, wrap и className по назначению.
createTextInput также принимает type: text/search/email/url/tel/password.

onInput(value,event) вызывается на input, onChange(value,event) — на change.
Оба получают строковое value. Пустое число остаётся пустым; valueAsNumber даёт
NaN, нативная required/min/max/step-валидация работает как обычно. Диапазон не
зажимает ввод, дроби не округляются. Для целых задаётся step: 1, для произвольных
дробей — step: 'any'; без step остаётся нативный шаг 1.

Программное присваивание input.value не вызывает пользовательские callback.
AbortSignal снимает оба обработчика. Сохранение, сообщения об ошибках и правила
предметной области остаются в расширении. Не использовать Number('') для
обязательного числа без предварительной проверки пустого значения.

Списки сохраняют API createSelect(items,onChange,options) и setItems(items,{value}).
Деревья и шкалы сохраняют прежние контракты. Все элементы используют общую
типографику 10 px, моноширинный шрифт и вертикальный шаг 16 px.

## Экспериментальные диаграммы и таблица

`charts.js` / `AtlasUI.charts` предоставляет независимые компоненты
`createPieChart`, `createBarChart`, `createLineChart`. `table.js` /
`AtlasUI.tables` — многоколоночный `createTable`. Пока они подключены только
в локальном примере, вне фасада components и релизных карт.

```js
const pie = AtlasUI.charts.createPieChart([
  { id: 'a', label: 'Первый', value: 42, color: '#76b6ce' },
  { id: 'b', label: 'Второй', value: 18, color: '#d5b16f' },
], { label: 'Состав', unit: 'ед./ход', signal: scope.signal });
pane.append(pie);
pie.update(nextItems, { donut: true });

const table = AtlasUI.tables.createTable([
  { key: 'name', label: 'Область', width: 2 },
  { key: 'value', label: 'Выпуск', type: 'number' },
], [{ id: 'north', name: 'Северная область', value: 42 }], {
  label: 'Сводка', signal: scope.signal, onSelect: row => inspect(row.id),
});
```

Столбцы принимают те же записи, что круг; `orientation: 'horizontal'` меняет
их на горизонтальные полосы. Линейный график принимает ряды
`{id,label,color,values}` и `labels` в options. `null` в values означает разрыв,
а не ноль. Отрицательные числа поддержаны в столбцах/линиях; доли круга
неотрицательные. Все ряды графика имеют одинаковую длину.

Общие options диаграмм: label, unit, height (96 px и выше, кратно 16),
formatValue, onSelect(point,event), signal. У линий также grid/points,
у круга donut. Результат — DOM-элемент с update(data,options) и dispose().
ResizeObserver подстраивает геометрию под ширину, сохраняя размер текста.

Каталог восьми типов: `.local/previews/charts-gallery-preview.html`, та же сборка
`python3 -B tools/build-charts-preview.py`. Варианты пока на рассмотрении,
в релизы и фасад components не включены. В браузере перед charts.js подключаются
chart-model.js и chart-extra.js. Численные алгоритмы отделены от DOM.

| Компонент | Данные и настройки |
| --- | --- |
| createBarChart | Прежние `{id,label,value,color}` либо ряды `{id,label,values,color}` и `labels`. Для рядов `mode`: ordinary (первый видимый ряд), grouped, stacked, percent; `orientation`: vertical/horizontal. |
| createLineChart | Ряды и labels; `step: true` — ступени в момент следующей точки, `fill: true` — заливка до нуля. Пропуски разрывают и линию, и заливку. |
| createPieChart | Неотрицательные value; `donut: true` — кольцо. |
| createHistogram | Массив чисел; `bins` — целое 1…100. Частоты по равным интервалам [min; max), последний включает max. |
| createScatterChart | `{id,label,x,y,size?,color?}`; `bubble: true` — площадь пропорциональна size, ноль не рисует пузырёк. Подписи xLabel/yLabel/sizeLabel. |
| createIntervalChart | `{id,label,min,max,center?,color?}`; `center: false` скрывает центральные отметки, все строки используют одну шкалу. |
| createHeatmap | `{rows:[подписи],columns:[подписи],values:[[число или null]]}`; обязательный `scale: ColorScale`, `values: false` скрывает числа. null отмечен штриховкой. |
| createTreeMap | Корень `{id,label,children?}`; листья содержат неотрицательный value, ветви суммируют детей. color наследуется; colorValue + необязательная scale кодируют дополнительный показатель. |

Накопление разделяет положительные и отрицательные значения. Процентный вариант
допускает только неотрицательные, пересчитывает доли после скрытия ряда; нулевая
сумма остаётся пустой. Матрица и её легенда используют переданный экземпляр шкалы.
TreeMap не подписывает тесные сектора; aria-label, фокус и подсказка сохраняют
полное название. Нажатие раскрывает сектор как корень, путь возвращает вверх.
Навигация сохраняется при resize и обновлении существующей ветки.

Все восемь типов возвращают один контракт update/dispose и принимают AbortSignal;
закрытие окна освобождает их ResizeObserver. Невалидное обновление не заменяет
предыдущую картинку. onSelect получает исходные значения: у точек x/y/size,
интервалов min/max/center, матрицы row/column, столбцов category/share,
гистограммы min/max/count, TreeMap path. Компоненты не меняют партию.
AbortSignal/dispose освобождает наблюдатель. Легенда круга и линий скрывает
ряды; проценты круга пересчитываются по видимым долям. Значения доступны по
наведению, фокусу или нажатию. Подписи переносятся, круг поддерживает пустой
набор и одну долю. Исходные данные копируются, не изменяются компонентом.

Таблица принимает столбцы `{key,label,type,width,format}` и строки-объекты.
width — относительная доля ширины. Числовой тип выравнивает значения вправо;
format(value,row) необязателен. Заголовки сортируют по исходным числам/строкам,
null остаётся в конце, равные значения сохраняют порядок. onSelect(row,index,
event) включает выбор строк. update(rows,{columns}) меняет данные/столбцы.
Подписи и значения выводятся текстом, полностью переносятся с шагом 16 px.
Исходный массив не сортируется на месте.

Локальный просмотр: `python3 work/atlas/tools/build-charts-preview.py`.
Страница `.local/previews/charts-preview.html` использует настоящий WindowManager:
перенос/ресайз окон, объединение вкладок, варианты диаграмм, поиск/сортировку
таблицы и тестовые данные. Компоненты не создают игровой singleton или историю.

Тот же сборщик создаёт `.local/previews/charts-tree-preview.html`: единое дерево
из настоящих createDataGroup/createDataRow с тремя таблицами, круговой,
столбчатой и линейной диаграммами на нескольких уровнях вложенности. Ветки
сохраняют свои компоненты и сортировку при сворачивании; закрытие окна снимает
их подписки. Пример показывает композицию UI без новых типов статистик в ядре.
