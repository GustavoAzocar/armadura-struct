import DxfParser, {
  type ILwpolylineEntity,
  type ITextEntity,
} from 'dxf-parser';
import { describe, expect, it } from 'vitest';
import { completeOwnership } from '../src/domain/hierarchy';
import {
  createScheduleLock,
  decodeProject,
  emptyProject,
  newBar,
  schedule,
} from '../src/domain/model';
import { alignPlacement, composeSheet } from '../src/domain/paper';
import {
  createSheet,
  placeDrawing,
  updatePlacement,
  updateSheet,
} from '../src/domain/sheets';
import {
  defaultSheetSchedule,
  setSheetSchedule,
} from '../src/domain/sheetSchedule';
import {
  applySheetTemplate,
  saveSheetTemplate,
  templateFromSheet,
} from '../src/domain/sheetTemplates';
import { toDxf, toSheetDxf } from '../src/lib/exports';

function fixture() {
  let project = completeOwnership({
    ...emptyProject(),
    name: 'Obra de teste',
    bars: [{ ...newBar('N1'), quantity: 3 }],
  });
  const first = project.sheets[0].id;
  project = updateSheet(project, first, {
    name: 'Prancha A1',
    format: 'A1',
    orientation: 'landscape',
  });
  const second = createSheet(project, 'Prancha personalizada');
  project = updateSheet(second.project, second.id, {
    format: 'custom',
    customSize: { width: 360, height: 260 },
    orientation: 'portrait',
  });
  const drawing = project.hierarchy.drawings[0].id;
  for (const [sheetId, scale, rotation] of [
    [first, 50, 37],
    [second.id, 100, 0],
  ] as const) {
    const placed = placeDrawing(project, sheetId, drawing);
    project = updatePlacement(placed.project, placed.id, {
      origin: { x: rotation ? 100 : 40, y: 130 },
      scale,
      rotation,
      frame: { width: 160, height: 90 },
    });
    project = alignPlacement(project, placed.id);
  }
  project = setSheetSchedule(
    project,
    first,
    defaultSheetSchedule({ x: 25, y: 500 }),
  );
  return { project, first, second: second.id };
}

describe('DXF de pranchas em milímetros de papel', () => {
  it('separa as folhas na ordem documental e mantém vistas, margem, selo, quadro e texto da composição', () => {
    const { project, first, second } = fixture();
    const original = structuredClone(project);
    const quantities = schedule(project);
    const model = toDxf(project);
    const raw = toSheetDxf(project, [second, first, first]);
    const dxf = new DxfParser().parseSync(raw)!;
    expect(dxf.header.$INSUNITS).toBe(4);
    const polylines = dxf.entities.filter(
      (e): e is ILwpolylineEntity => e.type === 'LWPOLYLINE',
    );
    const borders = polylines.filter((e) => /_PAPEL$/.test(e.layer));
    expect(borders).toHaveLength(2);
    expect(borders[0].vertices.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [841, 0],
      [841, 594],
      [0, 594],
    ]);
    expect(borders[1].vertices.map(({ x, y }) => [x, y])).toEqual([
      [861, 0],
      [1121, 0],
      [1121, 360],
      [861, 360],
    ]);
    expect(raw).toMatch(/2\r\nPRANCHA_001_PAPEL\r\n(?:[^\r]+\r\n){10}290\r\n0/);
    const geometry = (layer: string) =>
      polylines.find((e) => e.layer === layer)!;
    for (const [i, id, offset, expectedLength] of [
      [1, first, 0, 20],
      [2, second, 861, 10],
    ] as const) {
      const page = composeSheet(project, id);
      expect(page.issues).toEqual([]);
      const bar = page.views[0].lines.find((l) => l.layer === 'ARMADURAS')!;
      const actual = geometry(`PRANCHA_00${i}_ARMADURAS`).vertices;
      expect(actual.map(({ x, y }) => ({ x, y }))).toEqual(
        bar.points.map(({ x, y }) => ({ x: x + offset, y })),
      );
      expect(
        Math.hypot(actual[1].x - actual[0].x, actual[1].y - actual[0].y),
      ).toBeCloseTo(expectedLength, 10);
      for (const layer of ['MARGEM', 'SELO'])
        expect(
          geometry(`PRANCHA_00${i}_${layer}`).vertices.length,
        ).toBeGreaterThan(0);
      const texts = dxf.entities.filter(
        (e): e is ITextEntity =>
          e.type === 'TEXT' && e.layer === `PRANCHA_00${i}_TITULO_VISTA`,
      );
      expect(texts).toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining(`Escala 1:${i === 1 ? 50 : 100}`),
          textHeight: 3,
        }),
      );
      if (i === 1) expect(texts[0].rotation).toBe(37);
    }
    expect(raw).toContain('RELAÇÃO DO AÇO');
    expect(raw).toContain('arial.ttf');
    expect(model).not.toContain('PRANCHA_');
    expect(toDxf(project)).toBe(model);
    expect(schedule(project)).toEqual(quantities);
    expect(project).toEqual(original);
  });

  it('exporta contornos, logotipo vetorial e campos estáticos da revisão salva, com fonte e estilo', () => {
    const initial = emptyProject();
    const sheetId = initial.sheets[0].id;
    const template = templateFromSheet(initial.sheets[0]);
    template.geometry = [
      {
        layer: 'Margem do escritório',
        points: [
          { x: 9, y: 9 },
          { x: 410, y: 9 },
          { x: 410, y: 286 },
          { x: 9, y: 286 },
        ],
        closed: true,
      },
      {
        layer: 'Logotipo',
        points: [
          { x: 320, y: 25 },
          { x: 327, y: 28 },
          { x: 320, y: 32 },
        ],
        closed: true,
        resolvedStyle: {
          color: '#122c58',
          fillColor: '#ac3151',
          fill: 'solid',
          lineWidth: 0.35,
          lineScale: 1,
          lineType: { name: 'PONTILHADO', pattern: [1, -2] },
        },
      },
    ];
    template.fields = [
      {
        id: 'campo-fixo',
        label: 'Escritório',
        box: { x: 335, y: 17, width: 50, height: 30 },
        origin: { x: 365, y: 25 },
        text: 'Padrão Ø',
        font: 'times',
        height: 3,
        align: 'right',
        rotation: 15,
      },
    ];
    const reopened = decodeProject(
      JSON.stringify(
        applySheetTemplate(saveSheetTemplate(initial, template), template.id, [
          sheetId,
        ]),
      ),
    );
    const page = composeSheet(reopened, sheetId);
    expect(page.issues).toEqual([]);
    const raw = toSheetDxf(reopened, [sheetId]);
    const dxf = new DxfParser().parseSync(raw)!;
    const field = dxf.entities.find((e) => e.type === 'TEXT');
    expect(field).toMatchObject({
      layer: 'PRANCHA_001_SELO',
      startPoint: { x: 365, y: 25 },
      endPoint: { x: 365, y: 25 },
      text: 'Padrão Ø',
      textHeight: 3,
      halign: 2,
      rotation: 15,
    });
    expect(raw).toContain('AS_TIMES_NEW_ROMAN');
    expect(raw).toContain('times.ttf');
    expect(raw).toContain(
      '0\r\nHATCH\r\n100\r\nAcDbEntity\r\n8\r\nPRANCHA_001_LOGOTIPO',
    );
    expect(raw).toMatch(/49\r\n1\r\n74\r\n0\r\n49\r\n-2/);
    expect(raw).not.toContain('OPENSTRUCT / ARMADURASTRUCT');
  });

  it('sinaliza folhas inválidas, pena incompatível e RA desatualizada antes da gravação', () => {
    const { project, first } = fixture();
    expect(() => toSheetDxf(project, [])).toThrow(/Crie uma folha/);
    expect(() => toSheetDxf(project, ['ausente'])).toThrow(/folha selecionada/);
    const misplaced = updatePlacement(
      project,
      project.hierarchy.placements[0].id,
      {
        origin: { x: -100, y: 130 },
      },
    );
    expect(() => toSheetDxf(misplaced)).toThrow(
      /DXF não exportado: Prancha A1:.*fora da área útil/,
    );
    const unavailableWeight = {
      ...project,
      layers: project.layers.map((layer) =>
        layer.name === 'ARMADURAS'
          ? { ...layer, plot: { ...layer.plot, lineWidth: 0.19 } }
          : layer,
      ),
    };
    expect(() => toSheetDxf(unavailableWeight, [first])).toThrow(
      /Prancha A1 · ARMADURAS: Espessura 0\.19/,
    );
    const stale = {
      ...project,
      scheduleLock: createScheduleLock(project),
      bars: project.bars.map((bar) => ({ ...bar, quantity: 9 })),
    };
    expect(() => toSheetDxf(stale)).toThrow(/bloqueada e desatualizada/);
  });
});
