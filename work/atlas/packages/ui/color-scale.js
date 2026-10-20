/* A color scale view. Its model is also the source of colors for map renderers. */
(function (root) {
  'use strict';
  function createColorScale(
    model,
    {
      label = 'Цветовая шкала',
      formatValue = (value) => value.toLocaleString('ru-RU', { maximumFractionDigits: 1 }),
      steps = 5,
      sampleStyle,
      onModeChange,
    } = {},
  ) {
    const element = document.createElement('div');
    element.className = 'atlas-color-scale';
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', label);
    const update = (nextModel) => {
      const points = nextModel.points;
      element.replaceChildren();
      if (onModeChange) {
        const field = document.createElement('label');
        field.className = 'field';
        const caption = document.createElement('span');
        caption.className = 'field-label';
        caption.textContent = 'Режим';
        const select = document.createElement('select');
        select.setAttribute('aria-label', 'Режим: ' + label);
        for (const [value, title] of [
          ['linear', 'Линейный'],
          ['threshold', 'Пороги'],
          ['spline', 'Кубический сплайн'],
        ]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = title;
          select.append(option);
        }
        select.value = nextModel.mode;
        select.onchange = () => onModeChange(select.value);
        field.append(caption, select);
        element.append(field);
      }
      if (!points.length) {
        const empty = document.createElement('span');
        empty.className = 'muted';
        empty.textContent = 'Нет данных для шкалы';
        element.append(empty);
        return;
      }
      const min = points[0].value,
        max = points.at(-1).value;
      const bar = document.createElement('div');
      bar.className = 'atlas-color-scale-bar';
      bar.setAttribute('aria-hidden', 'true');
      if (min === max) bar.style.backgroundColor = points[0].color;
      else if (nextModel.mode === 'threshold') {
        bar.style.backgroundImage =
          'linear-gradient(to right, ' +
          points
            .slice(0, -1)
            .map((point, i) => {
              const start = (100 * (point.value - min)) / (max - min);
              const end = (100 * (points[i + 1].value - min)) / (max - min);
              return point.color + ' ' + start + '%, ' + point.color + ' ' + end + '%';
            })
            .join(', ') +
          ')';
      } else {
        const samples =
          nextModel.mode === 'linear'
            ? points
            : [
                ...new Map(
                  [...nextModel.grades(100), ...points].map((point) => [point.value, point]),
                ).values(),
              ].sort((a, b) => a.value - b.value);
        bar.style.backgroundImage =
          'linear-gradient(to right, ' +
          samples
            .map((point) => point.color + ' ' + (100 * (point.value - min)) / (max - min) + '%')
            .join(', ') +
          ')';
      }
      if (nextModel.mode === 'threshold' && points.length > 1) {
        const end = document.createElement('span');
        end.className = 'atlas-color-scale-end';
        end.style.backgroundColor = points.at(-1).color;
        bar.append(end);
      }
      const grades = document.createElement('div');
      grades.className = 'atlas-color-scale-grades';
      const samples = nextModel.grades(steps);
      grades.style.gridTemplateColumns =
        'repeat(' + Math.min(samples.length, steps) + ', minmax(0, 1fr))';
      const positions = samples.map((point) =>
        max === min ? 0 : (point.value - min) / (max - min),
      );
      const bounds = [0, ...positions.slice(1).map((x, i) => (x + positions[i]) / 2), 1];
      const widths = samples.map((_, i) => bounds[i + 1] - bounds[i]);
      const axis =
        !sampleStyle &&
        samples.length > 1 &&
        samples.length <= steps &&
        widths.every((w) => w >= 0.06);
      if (axis) grades.style.gridTemplateColumns = widths.map((w) => w + 'fr').join(' ');
      for (const [i, point] of samples.entries()) {
        const cell = document.createElement('div');
        cell.className = 'atlas-color-scale-grade';
        if (sampleStyle) {
          const patch = document.createElement('span');
          patch.className = 'atlas-color-scale-patch';
          patch.style.backgroundColor = point.color;
          Object.assign(patch.style, sampleStyle(point.value, point.color));
          patch.setAttribute('aria-hidden', 'true');
          cell.append(patch);
        } else {
          const tick = document.createElement('span');
          tick.className = 'atlas-color-scale-tick';
          tick.style.left =
            point.value === max
              ? 'calc(100% - 1px)'
              : (min === max ? 0 : (100 * (point.value - min)) / (max - min)) + '%';
          bar.append(tick);
        }
        const value = document.createElement('span');
        value.textContent = formatValue(point.value);
        if (axis) {
          if (i === 0) value.style.textAlign = 'left';
          else if (i === samples.length - 1) value.style.textAlign = 'right';
          else {
            const left = positions[i] - bounds[i],
              right = bounds[i + 1] - positions[i];
            const width = 2 * Math.min(left, right);
            value.style.width = (100 * width) / widths[i] + '%';
            value.style.marginLeft = (100 * (left - width / 2)) / widths[i] + '%';
            value.style.textAlign = 'center';
          }
        }
        cell.title = formatValue(point.value) + ' · ' + point.color;
        cell.append(value);
        grades.append(cell);
      }
      if (!sampleStyle) element.append(bar);
      element.append(grades);
    };
    Object.defineProperty(element, 'update', { value: update });
    update(model);
    return element;
  }
  Object.assign((root.AtlasUI ||= {}), { createColorScale });
  root.AtlasUI.controls = Object.freeze({ ...root.AtlasUI.controls, createColorScale });
  if (typeof module !== 'undefined' && module.exports) module.exports = { createColorScale };
})(globalThis);
