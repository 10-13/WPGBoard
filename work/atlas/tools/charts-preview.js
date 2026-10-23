/* Isolated chart playground. Game state, parties and persistence are not used. */
(function () {
  'use strict';
  const {
    el,
    field,
    button,
    createSwitch,
    createSelect,
    createTextInput,
    createDataRow,
    createDataGroup,
  } = AtlasUI.components;
  const { createPieChart, createBarChart, createLineChart } = AtlasUI.charts;
  const { createTable } = AtlasUI.tables;
  const desktop = document.getElementById('chart-desktop'),
    toolbar = document.getElementById('chart-toolbar');
  const manager = new AtlasUI.WindowManager(desktop),
    views = new Map();
  const colors = ['#76b6ce', '#d5b16f', '#a3bb83', '#b697c0', '#d18c7c', '#7db5a6'];
  const months = [
    'Янв',
    'Фев',
    'Мар',
    'Апр',
    'Май',
    'Июн',
    'Июл',
    'Авг',
    'Сен',
    'Окт',
    'Ноя',
    'Дек',
  ];
  let scenario = 'industry',
    longNames = false;
  function sample() {
    if (scenario === 'empty')
      return { context: 'Пустой набор', unit: 'ед./ход', pie: [], bars: [], lines: [], labels: [] };
    const climate = scenario === 'climate';
    const labels = climate
      ? ['Равнины', 'Леса', 'Горы', 'Пустыни']
      : ['Уголь', 'Сталь', 'Нефть', 'Каучук', 'Алюминий'];
    const pieValues = climate ? [48, 27, 18, 7] : [42, 26, 18, 9, 5];
    const data = {
      context: climate ? 'Температура и типы местности' : 'Промышленный район · 18 провинций',
      unit: climate ? '°C' : 'ед./ход',
      pieUnit: climate ? 'провинций' : 'ед./ход',
      pie: labels.map((label, i) => ({
        id: scenario + '-part-' + i,
        label: longNames
          ? label + ' · промышленная и природная категория выбранной области'
          : label,
        value: pieValues[i],
        color: colors[i],
      })),
      bars: (climate
        ? months
        : ['Рур', 'Ланкашир', 'Лотарингия', 'Верхняя Силезия', 'Север Италии']
      ).map((label, i) => ({
        id: 'bar-' + i,
        label: longNames ? label + ' · большая промышленная область с длинным названием' : label,
        value: (climate ? [-8, -5, 2, 10, 17, 21, 24, 22, 15, 7, 0, -6] : [84, 62, 48, 32, 25])[i],
        color: colors[i % colors.length],
      })),
      lines: climate
        ? [
            {
              id: 'north',
              label: 'Север',
              color: colors[0],
              values: [-15, -13, -7, 1, 8, 14, 17, 15, 8, 1, -7, -12],
            },
            {
              id: 'center',
              label: 'Центр',
              color: colors[1],
              values: [-8, -5, 2, 10, 17, 21, 24, 22, 15, 7, 0, -6],
            },
            {
              id: 'south',
              label: 'Юг',
              color: colors[2],
              values: [4, 6, 9, 14, 19, 24, 27, 27, 22, 16, 10, 6],
            },
          ]
        : [
            {
              id: 'output',
              label: 'Выпуск',
              color: colors[0],
              values: [42, 48, 45, 61, 65, 58, 77, 73, 90, 88, 101, 108],
            },
            {
              id: 'input',
              label: 'Расход',
              color: colors[1],
              values: [29, 32, 30, 40, 44, 43, 50, 49, 62, 60, 68, 72],
            },
            {
              id: 'balance',
              label: 'Остаток',
              color: colors[2],
              values: [13, 16, 15, 21, 21, null, null, 24, 28, 28, 33, 36],
            },
          ],
      labels: months,
    };
    if (longNames) {
      data.lines = data.lines.map((line) => ({
        ...line,
        label: line.label + ' · выбранная промышленная область',
      }));
      data.labels = months.map((month) => month + ' месяц 1936 года');
    }
    return data;
  }
  const status = document.getElementById('chart-status');
  const selected = (point) => {
    status.textContent = [point.xLabel, point.label, point.value]
      .filter((v) => v !== undefined && v !== '')
      .join(' · ');
  };
  function tableData() {
    const data = sample();
    if (scenario === 'climate')
      return {
        columns: [
          { key: 'name', label: 'Месяц', width: 2 },
          { key: 'north', label: 'Север, °C', type: 'number' },
          { key: 'center', label: 'Центр, °C', type: 'number' },
          { key: 'south', label: 'Юг, °C', type: 'number' },
          { key: 'rain', label: 'Осадки, мм', type: 'number' },
        ],
        rows: data.labels.map((name, i) => ({
          id: i,
          name,
          north: data.lines[0].values[i],
          center: data.lines[1].values[i],
          south: data.lines[2].values[i],
          rain: [42, 35, 41, 48, 62, 75, 80, 68, 56, 51, 48, 44][i],
        })),
      };
    return {
      columns: [
        { key: 'name', label: 'Регион', width: 2 },
        { key: 'output', label: 'Выпуск', type: 'number' },
        { key: 'input', label: 'Расход', type: 'number' },
        { key: 'balance', label: 'Баланс', type: 'number' },
        { key: 'load', label: 'Загрузка', type: 'number', format: (n) => n + '%' },
      ],
      rows: data.bars.map((item, i) => ({
        id: item.id,
        name: item.label,
        output: item.value,
        input: Math.round(item.value * 0.7),
        balance: item.value - Math.round(item.value * 0.7),
        load: [92, 87, 79, 68, 74][i],
      })),
    };
  }
  function open(kind, layout) {
    return manager.open({
      id: 'chart-' + kind,
      title: {
        pie: 'Состав / круговая',
        bar: 'Сравнение / столбцы',
        line: 'Динамика / график',
        table: 'Сводка / таблица',
      }[kind],
      ...layout,
      render(pane, scope) {
        const context = createDataRow('Область', sample().context),
          tools = el('div', 'form-actions');
        if (kind === 'table') {
          const initial = tableData();
          const table = createTable(initial.columns, initial.rows, {
            label: 'Сводная таблица',
            signal: scope.signal,
            onSelect: (row) => {
              status.textContent = 'Выбрана строка: ' + row.name;
            },
          });
          const search = createTextInput({
            label: 'Поиск по таблице',
            placeholder: 'Название или число',
            onInput: () => refresh(),
          });
          function refresh() {
            const next = tableData(),
              query = search.value.toLocaleLowerCase('ru').trim();
            context.querySelector('.data-value').textContent = sample().context;
            table.update(
              next.rows.filter((row) =>
                Object.values(row).some((value) =>
                  String(value).toLocaleLowerCase('ru').includes(query),
                ),
              ),
              { columns: next.columns },
            );
          }
          views.set(kind, refresh);
          scope.defer(() => views.delete(kind));
          pane.append(
            context,
            field('Поиск', search),
            table,
            el('p', 'muted', 'Заголовок — сортировка. Строка — выбор.'),
          );
          refresh();
          return;
        }
        let chart;
        const config = {
          label:
            kind === 'pie'
              ? 'Состав выбранной области'
              : kind === 'bar'
                ? 'Сравнение областей'
                : 'Динамика за 12 месяцев',
          onSelect: selected,
          signal: scope.signal,
        };
        const data = sample();
        if (kind === 'pie') {
          chart = createPieChart(data.pie, { ...config, unit: data.pieUnit });
          tools.append(
            createSelect(
              [
                ['pie', 'Круг'],
                ['donut', 'Кольцо'],
              ],
              (value) => chart.update(sample().pie, { donut: value === 'donut' }),
              { value: 'pie', label: 'Вид круговой диаграммы' },
            ),
          );
        } else if (kind === 'bar') {
          chart = createBarChart(data.bars, { ...config, unit: data.unit, height: 128 });
          tools.append(
            createSelect(
              [
                ['vertical', 'Столбцы'],
                ['horizontal', 'Полосы'],
              ],
              (value) => chart.update(sample().bars, { orientation: value }),
              { value: 'vertical', label: 'Вид столбчатой диаграммы' },
            ),
          );
        } else {
          chart = createLineChart(data.lines, {
            ...config,
            unit: data.unit,
            labels: data.labels,
            height: 144,
          });
          tools.append(
            createSwitch(
              'Сетка',
              (grid) => chart.update(sample().lines, { labels: sample().labels, grid }),
              { checked: true },
            ),
            createSwitch(
              'Точки',
              (points) => chart.update(sample().lines, { labels: sample().labels, points }),
              { checked: true },
            ),
          );
        }
        const table = createDataGroup('Таблица данных', { open: false });
        const refresh = () => {
          const next = sample();
          context.querySelector('.data-value').textContent = next.context;
          chart.update(kind === 'pie' ? next.pie : kind === 'bar' ? next.bars : next.lines, {
            unit: kind === 'pie' ? next.pieUnit : next.unit,
            labels: next.labels,
          });
          table.body.replaceChildren();
          if (kind !== 'line')
            for (const item of kind === 'pie' ? next.pie : next.bars)
              table.body.append(createDataRow(item.label, item.value));
          else
            next.labels.forEach((label, i) => {
              table.body.append(
                createDataRow(
                  label,
                  next.lines.map((line) => `${line.label}: ${line.values[i] ?? '—'}`).join(' · '),
                ),
              );
            });
          if (!table.body.childElementCount)
            table.body.append(createDataRow('Значения', 'Нет данных'));
        };
        views.set(kind, refresh);
        scope.defer(() => views.delete(kind));
        pane.append(context, tools, chart, table.element);
        refresh();
      },
    });
  }
  function arrange(compact = false) {
    for (const win of manager.windows) manager.closeWindow(win.id);
    const w = desktop.clientWidth,
      gap = 16;
    const pairWidth = Math.min(448, Math.floor((w - 3 * gap) / 2));
    const widths = compact
      ? [220, 220, 220, 220]
      : w >= 620
        ? [pairWidth, pairWidth, pairWidth, pairWidth]
        : [w - 2 * gap, w - 2 * gap, w - 2 * gap, w - 2 * gap];
    let x = gap,
      y = gap,
      rowHeight = 0;
    const heights = compact ? [480, 464, 432, 432] : [368, 368, 352, 352];
    const positions = [];
    for (let i = 0; i < widths.length; i++) {
      const width = Math.min(widths[i], w - 2 * gap);
      if ((x + width > w - gap || (!compact && i === 2)) && x > gap) {
        x = gap;
        y += rowHeight + gap;
        rowHeight = 0;
      }
      positions.push({ x, y, width, height: heights[i] });
      x += width + gap;
      rowHeight = Math.max(rowHeight, heights[i]);
    }
    desktop.style.height = Math.max(desktop.parentElement.clientHeight, y + rowHeight + gap) + 'px';
    ['pie', 'bar', 'line', 'table'].forEach((kind, i) => open(kind, positions[i]));
  }
  toolbar.append(
    el('strong', '', 'Диаграммы и таблица'),
    button('Четыре окна', () => arrange()),
    button('Окна 220 px', () => arrange(true)),
    button('Объединить вкладки', () => {
      if (manager.windows.length < 4) arrange();
      manager.merge('chart-bar', 'chart-pie');
      manager.merge('chart-line', 'chart-pie');
      manager.merge('chart-table', 'chart-pie');
      manager.resize('chart-pie', Math.min(520, desktop.clientWidth - 32), 528);
    }),
    createSwitch('Длинные подписи', (on) => {
      longNames = on;
      for (const refresh of views.values()) refresh();
    }),
    field(
      'Данные',
      createSelect(
        [
          ['industry', 'Промышленность'],
          ['climate', 'Климат'],
          ['empty', 'Пустой набор'],
        ],
        (value) => {
          scenario = value;
          for (const refresh of views.values()) refresh();
        },
        { value: 'industry', label: 'Набор тестовых данных' },
      ),
    ),
  );
  arrange();
})();
