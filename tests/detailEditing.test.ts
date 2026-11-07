import { describe, expect, it } from 'vitest';
import {
  decodeProject,
  demoProject,
  newBar,
  schedule,
  scheduleChanged,
} from '../src/domain/model';
import { completeOwnership, contentObjects } from '../src/domain/hierarchy';
import {
  assertDetailEdit,
  canEditDetailChange,
  detailEditorView,
  detailObjectIds,
  expandDetailSelection,
  groupInDetail,
  setDetailGrouped,
  toggleDetailSelection,
} from '../src/domain/detailEditing';
import { exportLines, toCsv } from '../src/lib/exports';

function fixture() {
  const p = demoProject();
  p.polylines.push({
    id: 'line',
    points: [
      { x: 100, y: 100 },
      { x: 200, y: 300 },
    ],
    closed: false,
    color: '#112233',
  });
  return completeOwnership(p);
}

function grouped() {
  const p = fixture(),
    result = groupInDetail(
      p,
      [p.bars[0].id, p.annotations[0].id, 'line'],
      'Viga V01',
      p.hierarchy.elements[0].id,
    );
  return { before: p, p: result.project, id: result.id };
}

describe('semantic detail grouping', () => {
  it('groups mixed content and linked rebatimentos without transforming or replacing objects', () => {
    const { before, p, id } = grouped();
    expect(p.bars).toBe(before.bars);
    expect(p.annotations).toBe(before.annotations);
    expect(p.polylines).toBe(before.polylines);
    expect(p.details).toBe(before.details);
    expect(contentObjects(p).map((o) => o.id)).toEqual(
      contentObjects(before).map((o) => o.id),
    );
    expect(detailObjectIds(p, id)).toEqual(
      expect.arrayContaining([
        p.bars[0].id,
        p.details[0].id,
        p.annotations[0].id,
        'line',
      ]),
    );
    expect(physicalSchedule(p)).toEqual(physicalSchedule(before));
    expect(exportLines(p)).toEqual(exportLines(before));
    expect(physicalCsv(p)).toEqual(physicalCsv(before));
    expect(decodeProject(JSON.stringify(p))).toEqual(p);
    expect(before.hierarchy.details).toHaveLength(1);
  });

  it('ungroups visually while retaining hierarchy, physical data and locked schedule', () => {
    const { p, id } = grouped();
    p.scheduleLock = { at: '2026-11-06', bars: structuredClone(p.bars) };
    const loose = setDetailGrouped(p, id, false);
    expect(loose.hierarchy.objectDetails).toBe(p.hierarchy.objectDetails);
    expect(loose.hierarchy.drawings).toBe(p.hierarchy.drawings);
    expect(loose.hierarchy.placements).toBe(p.hierarchy.placements);
    expect(loose.bars).toBe(p.bars);
    expect(physicalSchedule(loose)).toEqual(physicalSchedule(p));
    expect(scheduleChanged(loose)).toBe(false);
    expect(expandDetailSelection(loose, [p.bars[0].id])).toEqual([
      p.bars[0].id,
    ]);
    expect(decodeProject(JSON.stringify(loose))).toEqual(loose);
  });

  it('selects and shift-deselects an entire group, with individual selection in isolation', () => {
    const { p, id } = grouped(),
      member = p.bars[0].id,
      unit = detailObjectIds(p, id);
    expect(new Set(expandDetailSelection(p, [member]))).toEqual(new Set(unit));
    expect(toggleDetailSelection(p, unit, member, true)).toEqual([]);
    expect(toggleDetailSelection(p, [], member, true)).toEqual(
      expandDetailSelection(p, [member]),
    );
    expect(expandDetailSelection(p, [member], id)).toEqual([member]);
    expect(expandDetailSelection(p, [p.bars[1].id], id)).toEqual([]);
  });

  it('regroups a selected unit without duplicating material or nested physical objects', () => {
    const { p, id } = grouped();
    const next = groupInDetail(
      p,
      [p.bars[0].id],
      'Montagem',
      p.hierarchy.elements[0].id,
    );
    expect(detailObjectIds(next.project, id)).toEqual([]);
    expect(detailObjectIds(next.project, next.id)).toEqual(
      detailObjectIds(p, id),
    );
    expect(physicalSchedule(next.project)).toEqual(physicalSchedule(p));
  });

  it('rejects empty/missing selections and retains older schema-3 details with no grouped flag', () => {
    const p = fixture(),
      elementId = p.hierarchy.elements[0].id;
    expect(() => groupInDetail(p, [], 'V1', elementId)).toThrow(/Selecione/);
    expect(() => groupInDetail(p, ['missing'], 'V1', elementId)).toThrow(
      /inexistente/,
    );
    expect(() => groupInDetail(p, [p.bars[0].id], ' ', elementId)).toThrow(
      /nome/,
    );
    expect(decodeProject(JSON.stringify(p))).toEqual(p);
  });
});

describe('isolated editing writes and history', () => {
  it('shows only owned objects while keeping the full source available for quantities and references', () => {
    const { p, id } = grouped(),
      view = detailEditorView(p, id);
    expect(view.bars.map((b) => b.id)).toEqual([p.bars[0].id]);
    expect(view.annotations.map((a) => a.id)).toEqual([p.annotations[0].id]);
    expect(view.polylines.map((l) => l.id)).toEqual(['line']);
    expect(view.masks).toEqual([]);
    expect(view.details.map((d) => d.id)).toEqual([p.details[0].id]);
    expect(p.bars).toHaveLength(3);
    expect(detailEditorView(p)).toBe(p);
  });

  it('allows owned physical edits and insertion while quantities always come from the full project', () => {
    const { p, id } = grouped(),
      bar = p.bars[0];
    const next = completeOwnership(
      {
        ...p,
        bars: p.bars.map((b) =>
          b.id === bar.id ? { ...b, diameter: 16, quantity: 7 } : b,
        ),
      },
      id,
    );
    expect(() => assertDetailEdit(p, next, id)).not.toThrow();
    const oldRows = schedule(p),
      rows = schedule(next);
    expect(rows[0].quantity).toBe(7);
    expect(rows[0].weight).not.toBe(oldRows[0].weight);
    expect(rows.slice(1)).toEqual(oldRows.slice(1));
    expect(next.details[0].barId).toBe(bar.id);
    const inserted = completeOwnership(
      { ...next, bars: [...next.bars, newBar('N4')] },
      id,
    );
    expect(() => assertDetailEdit(next, inserted, id)).not.toThrow();
    expect(decodeProject(JSON.stringify(inserted))).toEqual(inserted);
  });

  it.each([
    'bar',
    'annotation',
    'mask',
    'owner',
    'delete',
    'new-outside',
    'hierarchy',
    'drawing',
    'project',
    'lock',
  ])('rejects writes outside the editing scope: %s', (route) => {
    const { p, id } = grouped();
    let next = structuredClone(p);
    if (route === 'bar') next.bars[1].quantity++;
    if (route === 'annotation') next.annotations[1].points[0].x++;
    if (route === 'mask') next.masks[0].origin.x++;
    if (route === 'owner') next.hierarchy.objectDetails[p.bars[1].id] = id;
    if (route === 'delete') next.bars.splice(1, 1);
    if (route === 'new-outside')
      next = completeOwnership(
        { ...next, bars: [...next.bars, newBar('N4')] },
        p.hierarchy.details[0].id,
      );
    if (route === 'hierarchy') next.hierarchy.elements[0].name = 'Outro';
    if (route === 'drawing') next.hierarchy.placements[0].origin.x++;
    if (route === 'project') next.id = 'other-project';
    if (route === 'lock')
      next.scheduleLock = { at: 'now', bars: structuredClone(next.bars) };
    expect(() => assertDetailEdit(p, next, id)).toThrow(/edição isolada/);
    expect(canEditDetailChange(p, next, id)).toBe(false);
  });

  it('permits undo/redo of owned edits and keeps the history boundary protected until leaving isolation', () => {
    const { before, p, id } = grouped();
    const next = {
      ...p,
      bars: p.bars.map((b, i) => (i ? b : { ...b, quantity: 10 })),
    };
    expect(canEditDetailChange(p, next, id)).toBe(true);
    expect(canEditDetailChange(next, p, id)).toBe(true);
    expect(canEditDetailChange(p, before, id)).toBe(false);
    expect(canEditDetailChange(p, before)).toBe(true);
    expect(canEditDetailChange(p, undefined, id)).toBe(false);
    const reopened = decodeProject(JSON.stringify(next));
    expect(reopened.hierarchy.objectDetails).toEqual(p.hierarchy.objectDetails);
    expect(reopened.bars[0].quantity).toBe(10);
  });
});

function physicalSchedule(p: Parameters<typeof schedule>[0]) {
  return schedule(p).map(({ contributions, ...r }) => ({
    ...r,
    contributions: contributions.map(
      ({ origin: _origin, detailId: _detail, ...c }) => c,
    ),
  }));
}

function physicalCsv(p: Parameters<typeof toCsv>[0]) {
  return toCsv(p)
    .split('\r\n')
    .map((r) => r.split(';').slice(0, 10).join(';'));
}
