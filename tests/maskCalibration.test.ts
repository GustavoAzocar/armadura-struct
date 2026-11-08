import { describe, it, expect } from 'vitest';
import { schedule, decodeProject } from '../src/domain/model';
import { createHierarchyNode } from '../src/domain/hierarchy';
import {
  calibrationTarget,
  calibratedMask,
  calibrationDistance,
  applyMaskCalibration,
  CALIBRATION_TOLERANCE,
} from '../src/domain/maskCalibration';
import { maskPoint, maskPrimitives, parseDxf } from '../src/cad/import';
import { parseLength } from '../src/domain/segments';
import { setLayerState } from '../src/domain/layerProfiles';
import { hideObjects } from '../src/domain/visibility';
import { layerId } from '../src/domain/layers';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import { composeSheet, alignPlacement } from '../src/domain/paper';
import { placeDrawing } from '../src/domain/sheets';
import { toCsv, toDxf, toPdf, toSheetPdf } from '../src/lib/exports';
import type { Project } from '../src/domain/types';
import { calibrationFixture } from './fixtures/maskCalibration';
describe('calibração física de uma única máscara por dois pontos', () => {
  it('500→2000mm fixa P1, aplica fator4 em toda a máscara e preserva aço, outra máscara e cotas externas', () => {
    const { p, m, context } = calibrationFixture(),
      before = JSON.stringify(p);
    const result = applyMaskCalibration(
        p,
        m,
        { x: 100, y: 100 },
        { x: 600, y: 100 },
        2000,
        context,
      ),
      q = result.project;
    expect(result.factor).toBe(4);
    expect(q.masks[0].scale).toBe(4);
    expect(q.masks[0].origin).toEqual({ x: -300, y: -300 });
    expect(maskPoint({ x: 100, y: 100 }, q.masks[0])).toEqual({
      x: 100,
      y: 100,
    });
    expect(maskPoint({ x: 600, y: 100 }, q.masks[0])).toEqual({
      x: 2100,
      y: 100,
    });
    expect(q.masks[0].primitives).toBe(m.primitives);
    expect(q.masks[0].id).toBe(m.id);
    expect(q.masks[0].sourceUnit).toBe(m.sourceUnit);
    expect(q.bars).toBe(p.bars);
    expect(q.annotations).toBe(p.annotations);
    expect(q.masks[1]).toBe(p.masks[1]);
    expect(q.scheduleLock).toBe(p.scheduleLock);
    expect(schedule(q)).toEqual(schedule(p));
    expect(toCsv(q)).toBe(toCsv(p));
    expect(JSON.stringify(p)).toBe(before);
    expect(decodeProject(JSON.stringify(q)).masks).toEqual(q.masks);
  });
  it.each([
    ['cm', 10],
    ['m', 1000],
  ] as const)(
    'referência %s inclinada e transformada não duplica a unidade',
    (sourceUnit, scale) => {
      const { m } = calibrationFixture('DXF'),
        source = {
          ...m,
          scale,
          sourceUnit,
          rotation: 37,
          origin: { x: 1234.5, y: -876.25 },
        };
      const local1 = { x: 1, y: 2 },
        local2 = { x: 4, y: 6 },
        p1 = maskPoint(local1, source),
        p2 = maskPoint(local2, source);
      const result = calibratedMask(source, p1, p2, 2000);
      const actual1 = maskPoint(local1, result.mask),
        actual2 = maskPoint(local2, result.mask);
      expect(actual1.x).toBeCloseTo(p1.x, 9);
      expect(actual1.y).toBeCloseTo(p1.y, 9);
      expect(
        Math.hypot(actual2.x - actual1.x, actual2.y - actual1.y),
      ).toBeCloseTo(2000, 8);
      expect(result.mask.scale).toBeCloseTo(400, 8);
      expect(result.mask.rotation).toBe(37);
      expect(result.mask.sourceUnit).toBe(sourceUnit);
    },
  );
  it('círculo analítico e texto conservam dados locais, proporções e orientação; DXF/PDF usam a nova medida', () => {
    const { p, m, context } = calibrationFixture('DWG');
    const q = applyMaskCalibration(
      p,
      m,
      { x: 100, y: 100 },
      { x: 600, y: 100 },
      2000,
      context,
    ).project;
    const circle = q.masks[0].primitives[1].native!;
    expect(circle.kind).toBe('circle');
    if (circle.kind !== 'circle') throw Error('circle');
    expect(circle.radius * q.masks[0].scale).toBe(200);
    const text = maskPrimitives(q.masks[0]).find((q) => q.text)!;
    expect(text.textHeight).toBe(100);
    expect(text.textRotation).toBe(30);
    expect(text.textAlign).toBe('center');
    expect(text.points[0]).toEqual({ x: 100, y: 300 });
    const reimported = parseDxf(toDxf(q), 'calibrado.dxf');
    expect(
      maskPrimitives(reimported)
        .filter((q) => !q.text)
        .some(
          (q) =>
            Math.abs(
              Math.hypot(
                q.points[1].x - q.points[0].x,
                q.points[1].y - q.points[0].y,
              ) - 2000,
            ) < 1e-7,
        ),
    ).toBe(true);
    expect(toPdf(q).length).toBeGreaterThan(100);
    const back = readDetailPackage(
      JSON.stringify(
        createDetailPackage(q, context.detailId, {
          producer: { app: 'test', version: '1' },
        }),
      ),
    ).project;
    expect(back.masks[0].scale).toBe(4);
    expect(back.masks[0].origin).toEqual(q.masks[0].origin);
    expect(back.masks[0].primitives[1].native).toEqual(circle);
  });
  it('medida igual à atual devolve o próprio projeto, sem histórico artificial', () => {
    const { p, m, context } = calibrationFixture();
    expect(
      applyMaskCalibration(
        p,
        m,
        { x: 100, y: 100 },
        { x: 600, y: 100 },
        500,
        context,
      ).project,
    ).toBe(p);
  });
  it('neutralidade também tolera apenas erro de máquina na distância inclinada', () => {
    const { m } = calibrationFixture('DXF');
    const transformed = {
      ...m,
      scale: 10,
      rotation: 37,
      origin: { x: 1234.5, y: -876.25 },
    };
    const p1 = maskPoint({ x: 1, y: 2 }, transformed),
      p2 = maskPoint({ x: 4, y: 6 }, transformed);
    expect(calibratedMask(transformed, p1, p2, 50).mask).toBe(transformed);
    expect(calibratedMask(transformed, p1, p2, 50.000001).mask).not.toBe(
      transformed,
    );
  });
  it('inválidos, tolerância, overflow de escala/coordenadas e perda de precisão não deixam alteração parcial', () => {
    const { p, m, context } = calibrationFixture(),
      before = JSON.stringify(p),
      p1 = { x: 100, y: 100 },
      p2 = { x: 600, y: 100 };
    for (const value of [0, -1, NaN, Infinity, 1e10, 1e-100])
      expect(() =>
        applyMaskCalibration(p, m, p1, p2, value, context),
      ).toThrow();
    expect(() => calibrationDistance(p1, p1)).toThrow(/P2/);
    expect(() =>
      calibrationDistance(
        { x: 0, y: 0 },
        { x: CALIBRATION_TOLERANCE / 2, y: 0 },
      ),
    ).toThrow();
    expect(() => calibrationDistance({ x: NaN, y: 0 }, p2)).toThrow(/finitos/);
    expect(() => calibratedMask({ ...m, scale: 1e6 }, p1, p2, 2000)).toThrow(
      /escala/,
    );
    expect(() =>
      calibratedMask(
        { ...m, origin: { x: 9e8, y: 0 } },
        { x: 0, y: 0 },
        { x: 500, y: 0 },
        2000,
      ),
    ).toThrow(/limites/);
    expect(() =>
      calibratedMask(
        m,
        { x: 999999000, y: 0 },
        { x: 999999500, y: 0 },
        0.000001,
      ),
    ).toThrow(/precisão/);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('rejeita alvo ausente, contexto errado, proteção, captura desligada e entidades ocultas', () => {
    const { p, m, context } = calibrationFixture('DXF');
    expect(() => calibrationTarget(p, 'physical-bar', context)).toThrow(
      /máscara/,
    );
    expect(() =>
      calibrationTarget(p, m.id, { ...context, key: 'sheet:x' }),
    ).toThrow(/prancha/);
    const d = createHierarchyNode(
      p,
      'detail',
      'V02',
      p.hierarchy.elements[0].id,
    );
    expect(() =>
      calibrationTarget(d.project, m.id, { ...context, detailId: d.id }),
    ).toThrow(/detalhamento/);
    const maskLayer = m.layerId ?? layerId('MASCARA'),
      entityLayer = m.primitives[0].layerId!;
    const blocked: Project[] = [
      hideObjects(p, 'model', [m.id]),
      setLayerState(p, 'model', maskLayer, { editable: false }),
      setLayerState(p, 'model', entityLayer, { capture: false }),
      {
        ...p,
        masks: p.masks.map((o) =>
          o.id === m.id ? { ...o, layers: { FORMA: false } } : o,
        ),
      },
    ];
    for (const q of blocked)
      expect(() => calibrationTarget(q, m.id, context)).toThrow(
        /ocult|layer|captura/i,
      );
    expect(() =>
      applyMaskCalibration(
        { ...p, masks: [{ ...m, rotation: 1 }, p.masks[1]] },
        m,
        { x: 100, y: 100 },
        { x: 600, y: 100 },
        2000,
        context,
      ),
    ).toThrow(/mudou/);
  });
  it('duas vistas mantêm 1:50/1:100: linha calibrada 2000mm ocupa 40/20mm, sem mudar escala do papel', () => {
    let { p, m, context } = calibrationFixture('DXF');
    const drawing = p.hierarchy.drawings[0].id;
    p = placeDrawing(p, p.sheets[0].id, drawing).project;
    p = placeDrawing(p, p.sheets[0].id, drawing).project;
    p = {
      ...p,
      hierarchy: {
        ...p.hierarchy,
        placements: p.hierarchy.placements.map((v, i) => ({
          ...v,
          scale: i ? 100 : 50,
        })),
      },
    };
    const q = applyMaskCalibration(
      p,
      m,
      { x: 100, y: 100 },
      { x: 600, y: 100 },
      2000,
      context,
    ).project;
    const lengths = composeSheet(q, p.sheets[0].id).views.map((v) =>
      v.lines
        .filter((q) => !q.text && q.layer === 'FORMA')
        .map((q) =>
          Math.hypot(
            q.points[1].x - q.points[0].x,
            q.points[1].y - q.points[0].y,
          ),
        ),
    );
    expect(lengths[0][0]).toBeCloseTo(40, 9);
    expect(lengths[1][0]).toBeCloseTo(20, 9);
    // Recenter explicitly for export, without changing either paper scale.
    const aligned = q.hierarchy.placements.reduce(
      (project, view) => alignPlacement(project, view.id),
      q,
    );
    expect(aligned.hierarchy.placements.map((v) => v.scale)).toEqual([50, 100]);
    expect(toSheetPdf(aligned).length).toBeGreaterThan(100);
    expect(q.hierarchy.placements).toBe(p.hierarchy.placements);
    expect(schedule(q)).toEqual(schedule(p));
  });
  it('usa o parser comum de mm/cm/m com decimal pt-BR e rejeita separadores ambíguos/coordenadas', () => {
    expect(parseLength('2,5 m')).toBe(2500);
    expect(parseLength('200,5 cm')).toBe(2005);
    expect(parseLength('2000')).toBe(2000);
    for (const value of [
      '1.000,0 mm',
      '1,2,3',
      'Infinity',
      'NaN',
      '0',
      '-20',
      '100;200',
    ])
      expect(() => parseLength(value)).toThrow();
  });
});
