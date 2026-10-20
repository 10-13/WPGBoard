/* A priority scheduler with a resource ledger; it never borrows future inputs. */
(function (root) {
  'use strict';
  function planResourceFlow(facilities) {
    const rows = facilities.map((p, index) => ({ ...p, index, load: 0 }));
    rows.sort(
      (a, b) =>
        a.priority - b.priority ||
        a.regionId - b.regionId ||
        (a.sequence ?? a.index) - (b.sequence ?? b.index),
    );
    const balances = new Map(),
      add = (key, amount) => {
        const next = (balances.get(key) || 0) + amount;
        if (!Number.isFinite(next)) throw new Error('Переполнение ресурсного баланса.');
        balances.set(key, next);
      };
    for (const p of rows)
      if (!p.inputs.length && p.capacity > 0) {
        p.load = 1;
        add(p.key, p.capacity);
      }
    const consumers = rows.filter((p) => p.inputs.length && p.capacity > 0);
    const availableLoad = (p) => {
      let load = 1 - p.load;
      for (const input of p.inputs)
        if (input.amount > 0)
          load = Math.min(load, Math.max(0, balances.get(input.key) || 0) / input.amount);
      return load;
    };
    let operations = 0;
    while (true) {
      // Restart at the highest priority whenever a supplier releases new output.
      const p = consumers.find((p) => availableLoad(p) > 1e-12);
      if (!p) break;
      if (++operations > 50000)
        throw new Error(
          'Слишком длинная циклическая цепочка производства. Измените рецепты или приоритеты.',
        );
      const load = availableLoad(p);
      for (const input of p.inputs) {
        const before = balances.get(input.key) || 0,
          used = input.amount * load;
        if (used > before + Math.max(used, before) * 1e-12)
          throw new Error('Недостаточно ресурса для производства.');
        balances.set(input.key, Math.max(0, before - used));
      }
      p.load = Math.min(1, p.load + load);
      add(p.key, p.capacity * load);
    }
    return rows.map((p) => ({
      ...p,
      actualOutput: p.capacity * p.load,
      consumption: p.inputs.map((input) => ({ ...input, actualAmount: input.amount * p.load })),
    }));
  }
  Object.assign((root.AtlasExtensions ||= {}), { planResourceFlow });
  if (typeof module !== 'undefined' && module.exports) module.exports = { planResourceFlow };
})(globalThis);
