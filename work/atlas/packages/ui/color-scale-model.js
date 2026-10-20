/* Headless value/color points, shared by legends and map projections. */
(function (root) {
  'use strict';
  const modes = Object.freeze(['linear', 'threshold', 'spline']);
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function checkMode(mode) {
    if (!modes.includes(mode)) throw new Error('Неизвестный режим цветовой шкалы: ' + mode);
    return mode;
  }
  function rgb(color) {
    if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color))
      throw new Error('Цвет точки шкалы должен иметь вид #RRGGBB.');
    return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  }
  function hex(channels) {
    return (
      '#' +
      channels
        .map((n) =>
          Math.round(clamp(n, 0, 255))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  }
  // Natural cubic spline, independently for R/G/B, on nonuniform value intervals.
  // Work in a normalized domain to keep large and small physical units stable.
  function secondDerivatives(xs, ys) {
    const n = xs.length,
      diagonal = new Array(n).fill(0),
      rhs = new Array(n).fill(0);
    const result = new Array(n).fill(0);
    diagonal[0] = diagonal[n - 1] = 1;
    for (let i = 1; i < n - 1; i++) {
      const left = xs[i] - xs[i - 1],
        right = xs[i + 1] - xs[i];
      const factor = left / diagonal[i - 1];
      diagonal[i] = 2 * (left + right) - factor * (i === 1 ? 0 : left);
      rhs[i] = 6 * ((ys[i + 1] - ys[i]) / right - (ys[i] - ys[i - 1]) / left) - factor * rhs[i - 1];
    }
    for (let i = n - 2; i > 0; i--)
      result[i] = (rhs[i] - (xs[i + 1] - xs[i]) * result[i + 1]) / diagonal[i];
    return result;
  }
  class ColorScale {
    #points;
    #channels;
    #xs;
    #seconds;
    constructor(points = [], { mode = 'linear' } = {}) {
      if (!Array.isArray(points)) throw new Error('Точки шкалы должны быть массивом.');
      this.mode = checkMode(mode);
      this.#points = Object.freeze(
        points
          .map((point) => {
            if (!point || !finite(point.value))
              throw new Error('Значение точки должно быть конечным числом.');
            rgb(point.color);
            return Object.freeze({ value: point.value, color: point.color.toLowerCase() });
          })
          .sort((a, b) => a.value - b.value),
      );
      for (let i = 1; i < this.#points.length; i++)
        if (this.#points[i].value === this.#points[i - 1].value)
          throw new Error('Значения точек шкалы не должны повторяться.');
      const min = this.#points[0]?.value,
        max = this.#points.at(-1)?.value;
      if (this.#points.length > 1 && !finite(max - min))
        throw new Error('Диапазон цветовой шкалы слишком велик.');
      this.#channels = this.#points.map((point) => rgb(point.color));
      this.#xs = this.#points.map((point) => (min === max ? 0 : (point.value - min) / (max - min)));
      if (this.#xs.some((x, i) => i && x <= this.#xs[i - 1]))
        throw new Error('Точки шкалы слишком близки для расчёта.');
      this.#seconds =
        this.#points.length > 1
          ? [0, 1, 2].map((channel) =>
              secondDerivatives(
                this.#xs,
                this.#channels.map((c) => c[channel]),
              ),
            )
          : [];
      if (this.#seconds.some((channel) => channel.some((value) => !finite(value))))
        throw new Error('Точки шкалы слишком близки для расчёта сплайна.');
      Object.freeze(this);
    }
    get points() {
      return this.#points;
    }
    color(value, mode = this.mode) {
      checkMode(mode);
      const points = this.#points,
        n = points.length;
      if (!finite(value) || !n) return null;
      if (value <= points[0].value) return points[0].color;
      if (value >= points[n - 1].value) return points[n - 1].color;
      let low = 0,
        high = n - 1;
      while (high - low > 1) {
        const mid = (low + high) >> 1;
        if (value < points[mid].value) high = mid;
        else low = mid;
      }
      if (mode === 'threshold' || value === points[low].value) return points[low].color;
      const width = this.#xs[high] - this.#xs[low];
      const b = (value - points[low].value) / (points[high].value - points[low].value),
        a = 1 - b;
      return hex(
        this.#channels[low].map((channel, i) => {
          const linear = a * channel + b * this.#channels[high][i];
          if (mode === 'linear') return linear;
          return (
            linear +
            (((a ** 3 - a) * this.#seconds[i][low] + (b ** 3 - b) * this.#seconds[i][high]) *
              width ** 2) /
              6
          );
        }),
      );
    }
    grades(count = 5) {
      if (!Number.isInteger(count) || count < 2 || count > 100)
        throw new Error('Число делений шкалы должно быть от 2 до 100.');
      if (this.mode === 'threshold' || this.#points.length < 2) return this.points;
      const min = this.#points[0].value,
        max = this.#points.at(-1).value;
      return Object.freeze(
        Array.from({ length: count }, (_, i) => {
          const value = i === count - 1 ? max : min + ((max - min) * i) / (count - 1);
          return Object.freeze({ value, color: this.color(value) });
        }),
      );
    }
  }
  const api = { ColorScale, COLOR_SCALE_MODES: modes };
  Object.assign((root.AtlasUI ||= {}), api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
