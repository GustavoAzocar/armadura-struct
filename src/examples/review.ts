import reference from './initial-reference.json';
import type { Project } from '../domain/types';
import { schedule } from '../domain/model';
export { reference as initialReference };
/** Compare stable physical occurrence IDs, independently of views, labels and grouping. */
export function reviewInitialExample(project: Project) {
  const live = schedule({ ...project, scheduleLock: undefined });
  const contributions = new Map(
    live.flatMap((r) =>
      r.contributions.map(
        (c) =>
          [
            c.barId,
            { ...c, steel: r.steel, diameter: r.diameter, mark: r.mark },
          ] as const,
      ),
    ),
  );
  const known = new Set(
    reference.positions.flatMap((r) => r.occurrences.map((o) => o.barId)),
  );
  const rows = reference.positions.map((source) => {
    const current = source.occurrences.flatMap((o) => {
      const c = contributions.get(o.barId);
      return c ? [c] : [];
    });
    const quantity = current.reduce((s, c) => s + c.quantity, 0);
    const totalLengthM = current.reduce((s, c) => s + c.totalLength, 0);
    const weightKg = current.reduce((s, c) => s + c.weight, 0);
    const specMatches =
      current.length === source.occurrences.length &&
      current.every(
        (c) => c.steel === source.steel && c.diameter === source.diameter,
      );
    // Original cut lengths are printed to nearest whole cm (±5 mm).
    const lengthMatches =
      current.length === source.occurrences.length &&
      current.every(
        (c) => Math.abs(c.unitLength * 1000 - source.cutLengthMm) <= 5.00001,
      );
    const quantityMatches = quantity === source.quantity;
    return {
      source,
      quantity,
      totalLengthM,
      weightKg,
      specMatches,
      quantityMatches,
      lengthMatches,
      cutLengthRangeMm: current.length
        ? [
            Math.min(...current.map((c) => c.unitLength * 1000)),
            Math.max(...current.map((c) => c.unitLength * 1000)),
          ]
        : [],
      marks: [...new Set(current.map((c) => c.mark))],
      specifications: [
        ...new Set(current.map((c) => `${c.steel} Ø${c.diameter}`)),
      ],
      deltaLengthM: totalLengthM - source.totalLengthMm / 1000,
    };
  });
  const summaries = reference.sources.map((source) => {
    const ids = reference.positions
      .filter((r) => r.sheetKey === source.key)
      .flatMap((r) => r.occurrences.map((o) => o.barId));
    const current = ids.flatMap((id) => {
      const c = contributions.get(id);
      return c ? [c] : [];
    });
    const specifications = [...source.summary];
    for (const c of current) {
      if (
        !specifications.some(
          (s) => s.steel === c.steel && s.diameter === c.diameter,
        )
      )
        specifications.push({
          steel: c.steel,
          diameter: c.diameter,
          totalLengthM: 0,
          grossWeightKg: 0,
        });
    }
    return {
      source,
      rows: specifications.map((original) => {
        const members = current.filter(
          (c) => c.steel === original.steel && c.diameter === original.diameter,
        );
        const weightKg = members.reduce((s, c) => s + c.weight, 0);
        return {
          original,
          newSpecification: !source.summary.some(
            (s) =>
              s.steel === original.steel && s.diameter === original.diameter,
          ),
          totalLengthM: members.reduce((s, c) => s + c.totalLength, 0),
          weightKg,
          grossWeightKg: weightKg * (1 + source.summaryAllowance),
        };
      }),
    };
  });
  return {
    rows,
    summaries,
    untracked: live
      .flatMap((r) => r.contributions)
      .filter((c) => !known.has(c.barId)),
    errors: live.flatMap((r) => r.errors),
  };
}
export function initialExampleCsv(project: Project) {
  const { rows } = reviewInitialExample(project);
  const csv = (value: unknown) => `"${String(value).replace(/"/g, '""')}"`;
  return (
    '\ufeff' +
    [
      [
        'Prancha',
        'Posição original',
        'Posição atual',
        'Aço',
        'Bitola (mm)',
        'Especificação atual',
        'Qtd original',
        'Qtd atual',
        'C original (mm)',
        'C atual mínimo (mm)',
        'C atual máximo (mm)',
        'Total original (m)',
        'Total atual (m)',
        'Diferença (m)',
        'Massa líquida atual (kg)',
        'Quantidade confere',
        'Especificação confere',
        'C confere (±5 mm)',
      ],
      ...rows.map((r) => [
        r.source.sheetKey,
        r.source.sourceMark,
        r.marks.join(' / '),
        r.source.steel,
        r.source.diameter,
        r.specifications.join(' / '),
        r.source.quantity,
        r.quantity,
        r.source.cutLengthMm,
        ...(r.cutLengthRangeMm.length ? r.cutLengthRangeMm : ['', '']),
        r.source.totalLengthMm / 1000,
        r.totalLengthM,
        r.deltaLengthM,
        r.weightKg,
        r.quantityMatches ? 'sim' : 'não',
        r.specMatches ? 'sim' : 'não',
        r.lengthMatches ? 'sim' : 'não',
      ]),
    ]
      .map((row) => row.map(csv).join(';'))
      .join('\r\n')
  );
}
