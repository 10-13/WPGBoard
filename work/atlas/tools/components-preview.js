/* A real consumer of the UI foundation, without game core, map or interface startup. */
(function () {
  'use strict';
  const {
    el,
    field,
    button,
    createSwitch,
    createSelect,
    createTextInput,
    createNumberInput,
    createTextArea,
    createDataRow,
    createDataGroup,
    renderDataTree,
    ColorScale,
    createColorScale,
  } = AtlasUI.components;
  const main = document.getElementById('components');
  main.append(createDataRow('Базовая библиотека интерфейса', 'AtlasUI.components'));
  const grid = el('div', 'component-grid');
  main.append(grid);
  const inputs = createDataGroup('Поля ввода', { open: true });
  const result = createDataRow('Последний ввод', '—');
  const show = (value) => {
    result.querySelector('.data-value').textContent = value || 'Пусто';
  };
  const name = createTextInput({
    label: 'Название примера',
    value: 'Северная область',
    maxLength: 80,
    onInput: show,
  });
  const amount = createNumberInput({
    label: 'Количество примера',
    value: 12.5,
    min: -100,
    max: 1000,
    step: 'any',
    onInput: (value, event) =>
      show(Number.isNaN(event.currentTarget.valueAsNumber) ? 'Нет числа' : value),
  });
  const description = createTextArea({
    label: 'Описание примера',
    value: 'Производственная зона\nЗапасы и примечания',
    rows: 3,
    maxLength: 8000,
    onInput: show,
  });
  inputs.body.append(
    field('Название', name),
    field('Количество', amount),
    field('Описание', description),
    result,
    button('Сбросить поля', () => {
      name.value = 'Северная область';
      amount.value = '12.5';
      description.value = 'Производственная зона\nЗапасы и примечания';
      show('Сброс');
    }),
  );
  const controls = createDataGroup('Кнопки и списки', { open: true });
  const modeRow = createDataRow('Выбрано', 'Добыча');
  const choice = createSelect(
    [
      ['extraction', 'Добыча'],
      ['production', 'Производство'],
      { value: 'unavailable', label: 'Недоступный вариант', disabled: true },
    ],
    (value) => {
      modeRow.querySelector('.data-value').textContent =
        value === 'extraction' ? 'Добыча' : 'Производство';
    },
    { label: 'Вид примера', value: 'extraction' },
  );
  const enabled = createDataRow('Подсветка', 'Выключена');
  controls.body.append(
    field('Вид', choice),
    modeRow,
    createSwitch('Подсветка', (checked) => {
      enabled.querySelector('.data-value').textContent = checked ? 'Включена' : 'Выключена';
    }),
    enabled,
    button('Обычная кнопка', () => show('Нажата кнопка')),
  );
  const data = createDataGroup('Деревья и строки', { open: true });
  renderDataTree(data.body, [
    {
      id: 'region',
      type: 'folder',
      title: 'Северная область',
      children: [
        { id: 'production', type: 'value', title: 'Производство', value: 12.5, unit: 'ед./ход' },
        {
          id: 'resources',
          type: 'folder',
          title: 'Ресурсы',
          children: [
            { id: 'coal', type: 'value', title: 'Уголь', value: 8, unit: 'ед./ход' },
            { id: 'steel', type: 'value', title: 'Сталь', value: 4.5, unit: 'ед./ход' },
          ],
        },
      ],
    },
  ]);
  const scales = createDataGroup('Цветовая шкала', { open: true });
  const points = [
    { value: 0, color: '#264caa' },
    { value: 20, color: '#53cbb9' },
    { value: 70, color: '#e8d278' },
    { value: 100, color: '#cb4050' },
  ];
  let scale;
  scale = createColorScale(new ColorScale(points), {
    label: 'Пример шкалы',
    onModeChange: (mode) => scale.update(new ColorScale(points, { mode })),
  });
  scales.body.append(scale);
  grid.append(inputs.element, controls.element, data.element, scales.element);
})();
