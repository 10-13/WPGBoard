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
