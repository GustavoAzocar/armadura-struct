import { describe, it, expect } from 'vitest';
import {
  emptyProject,
  newBar,
  schedule,
  decodeProject,
  createScheduleLock,
} from '../src/domain/model';
import { completeOwnership } from '../src/domain/hierarchy';
import { newNativeMask, validateNativeMask } from '../src/domain/nativeMasks';
import { maskPoint, maskPrimitives, parseDxf } from '../src/cad/import';
import {
  appendFreeText,
  editFreeText,
  freeTextDefaults,
  freeTextDraftOf,
  freeTextPreview,
  freeTextWorldPoint,
  type FreeTextDraft,
} from '../src/domain/freeText';
import {
  resolveTextFont,
  textFontNotice,
  unsupportedTextChars,
} from '../src/domain/textStyle';
import { layerId } from '../src/domain/layers';
import { factoryCadDefaults } from '../src/domain/cadDefaults';
import { setLayerState } from '../src/domain/layerProfiles';
import { hideObjects } from '../src/domain/visibility';
import {
  createDetailPackage,
  readDetailPackage,
} from '../src/domain/detailPackage';
import { transformMaskPrimitive } from '../src/domain/maskManipulation';
import {
  bakeMaskPrimitives,
  transformSymbolPrimitive,
} from '../src/domain/symbols';
import { composeSheet } from '../src/domain/paper';
import { placeDrawing, updatePlacement } from '../src/domain/sheets';
import { toCsv, toDxf, toPdf, toSheetPdf } from '../src/lib/exports';
import type { Mask, Project } from '../src/domain/types';

const CONTENT = 'Ø12 c/15 ± 2 - viga ação';
function fixture() {
  let p = emptyProject();
  const detailId = p.hierarchy.details[0].id;
  const mask: Mask = {
    ...newNativeMask('Fôrma'),
    id: 'imported',
    format: 'DXF',
    sourceUnit: 'cm',
    scale: 10,
    rotation: 30,
    origin: { x: 800, y: -300 },
    layers: { FORMA: true },
    primitives: [
      {
        layer: 'FORMA',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      },
    ],
  };
  p = completeOwnership(
    {
      ...p,
      bars: [{ ...newBar('N1'), quantity: 2 }],
      masks: [mask],
      hierarchy: {
        ...p.hierarchy,
        objectDetails: { ...p.hierarchy.objectDetails, [mask.id]: detailId },
      },
    },
    detailId,
  );
  p = { ...p, scheduleLock: createScheduleLock(p) };
  return { p, detailId, context: { key: 'model', detailId } };
}
const draft = (p: Project, d: Partial<FreeTextDraft> = {}): FreeTextDraft => ({
  ...freeTextDefaults(p),
  text: CONTENT,
  height: 80,
  rotation: 45,
  align: 'center',
  font: { family: 'serif', weight: 'bold', style: 'italic' },
  ...d,
});
const at = { x: 1234.5, y: -678.25 };

describe('texto CAD livre na máscara', () => {
  it('insere em máscara girada/escalada aplicando o referencial uma única vez, sem tocar aço/RA', () => {
    const { p, context } = fixture(),
      before = JSON.stringify(p),
      m = p.masks[0];
    const { project: q, id } = appendFreeText(
      p,
      m.id,
      at,
      draft(p),
      context,
      m,
      'txt-1',
    );
    expect(id).toBe('txt-1');
    const local = q.masks[0].primitives.at(-1)!;
    expect(local).toMatchObject({
      id: 'txt-1',
      native: { kind: 'text' },
      layer: 'AS_DESENHO_LOCAL',
      text: CONTENT,
      textAlign: 'center',
      textFont: { family: 'serif', weight: 'bold', style: 'italic' },
    });
    expect(local.textHeight).toBeCloseTo(8, 12);
    expect(local.textRotation).toBeCloseTo(15, 12);
    const world = maskPrimitives(q.masks[0]).at(-1)!;
    expect(world.points[0].x).toBeCloseTo(at.x, 9);
    expect(world.points[0].y).toBeCloseTo(at.y, 9);
    expect(world.textHeight).toBeCloseTo(80, 12);
    expect(world.textRotation).toBeCloseTo(45, 12);
    expect(q.masks[0].primitives[0]).toBe(m.primitives[0]);
    expect(q.bars).toBe(p.bars);
    expect(q.scheduleLock).toBe(p.scheduleLock);
    expect(schedule(q)).toEqual(schedule(p));
    expect(toCsv(q)).toBe(toCsv(p));
    expect(JSON.stringify(p)).toBe(before);
    expect(() => validateNativeMask(q.masks[0])).not.toThrow();
  });
  it('prévia não altera o projeto e reproduz a entidade confirmada', () => {
    const { p, context } = fixture(),
      before = JSON.stringify(p),
      m = p.masks[0];
    const preview = freeTextPreview(p, m, at, draft(p));
    expect(JSON.stringify(p)).toBe(before);
    const q = appendFreeText(p, m.id, at, draft(p), context, m).project;
    const world = maskPrimitives(q.masks[0]).at(-1)!;
    expect(preview.points[0].x).toBeCloseTo(world.points[0].x, 9);
    expect(preview.textHeight).toBeCloseTo(world.textHeight!, 12);
    expect(preview.textRotation).toBeCloseTo(world.textRotation!, 12);
  });
  it('usa padrões CAD de texto e de entidade de máscara', () => {
    const { p } = fixture();
    const c = factoryCadDefaults();
    c.texts.height = 65;
    c.texts.align = 'right';
    const d = freeTextDefaults({ ...p, cadDefaults: c });
    expect(d.height).toBe(65);
    expect(d.align).toBe('right');
    expect(d.font).toEqual({
      family: 'sans',
      weight: 'normal',
      style: 'normal',
    });
    expect(freeTextDefaults(p).height).toBe(50);
  });
  it('acentos, Ø e ± persistem em salvar/reabrir e no autosave (mesmo JSON)', () => {
    const { p, context } = fixture(),
      m = p.masks[0];
    const q = appendFreeText(p, m.id, at, draft(p), context, m).project;
    expect(q.schema).toBe('armadurastruct/35');
    const restored = decodeProject(JSON.stringify(q));
    expect(restored).toEqual(q);
    expect(restored.masks[0].primitives.at(-1)!.text).toBe(CONTENT);
  });
  it('recusa conteúdo, altura, fonte e caracteres inválidos atomicamente', () => {
    const { p, context } = fixture(),
      m = p.masks[0],
      before = JSON.stringify(p);
    const bad: Partial<FreeTextDraft>[] = [
      { text: '' },
      { text: '   ' },
      { text: 'linha\nquebra' },
      { text: 'a ≥ b' },
      { text: 'x'.repeat(501) },
      { height: 0 },
      { height: -5 },
      { height: NaN },
      { size: 'paper', height: 300, paperScale: 50 },
      { size: 'paper', height: 2.5, paperScale: 0 },
      { rotation: Infinity },
      { font: { family: '', weight: 'normal', style: 'normal' } },
      { font: { family: 'Arial<x>', weight: 'normal', style: 'normal' } },
      {
        font: {
          family: 'sans',
          weight: 'heavy' as never,
          style: 'normal',
        },
      },
    ];
    for (const d of bad)
      expect(() =>
        appendFreeText(p, m.id, at, draft(p, d), context, m),
      ).toThrow();
    expect(() =>
      appendFreeText(p, m.id, { x: NaN, y: 0 }, draft(p), context, m),
    ).toThrow();
    expect(unsupportedTextChars('Ø ± ° ² µ ç ã é')).toEqual([]);
    expect(unsupportedTextChars('a — b')).toEqual(['—']);
    expect(unsupportedTextChars('≥∑')).toEqual(['≥', '∑']);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('confirmação repetida com o mesmo ID não duplica', () => {
    const { p, context } = fixture(),
      m = p.masks[0];
    const q = appendFreeText(p, m.id, at, draft(p), context, m, 'once').project;
    expect(() =>
      appendFreeText(q, m.id, at, draft(p), context, q.masks[0], 'once'),
    ).toThrow(/duplicado/);
    expect(() =>
      appendFreeText(q, m.id, at, draft(p), context, m, 'other'),
    ).toThrow(/mudou/);
    expect(
      q.masks[0].primitives.filter((v) => v.native?.kind === 'text'),
    ).toHaveLength(1);
  });
  it('edita mantendo ID, ponto, layer e posição na lista; sem mudança não gera histórico', () => {
    const { p, context } = fixture(),
      m = p.masks[0];
    let q = appendFreeText(p, m.id, at, draft(p), context, m, 'ed').project;
    q = {
      ...q,
      masks: q.masks.map((o) => ({
        ...o,
        primitives: [
          ...o.primitives,
          { layer: 'FORMA', points: [at, { x: 0, y: 0 }] },
        ],
      })),
    };
    const target = q.masks[0];
    const original = target.primitives[1];
    const values = freeTextDraftOf(original, target);
    expect(values.text).toBe(CONTENT);
    expect(values.height).toBeCloseTo(80, 10);
    expect(values.rotation).toBeCloseTo(45, 10);
    const same = editFreeText(q, m.id, 'ed', values, context, target);
    expect(same.changed).toBe(false);
    expect(same.project).toBe(q);
    const edited = editFreeText(
      q,
      m.id,
      'ed',
      {
        ...values,
        text: 'Corte A-A ±',
        font: { family: 'mono', weight: 'normal', style: 'normal' },
        align: 'right',
      },
      context,
      target,
    );
    expect(edited.changed).toBe(true);
    const after = edited.project.masks[0].primitives;
    expect(after).toHaveLength(target.primitives.length);
    expect(after[1]).toMatchObject({
      id: 'ed',
      layer: original.layer,
      layerId: original.layerId,
      text: 'Corte A-A ±',
      textAlign: 'right',
    });
    expect(freeTextWorldPoint(after[1], target).x).toBeCloseTo(at.x, 9);
    expect(after[0]).toBe(target.primitives[0]);
    expect(after[2]).toBe(target.primitives[2]);
    // History keeps the previous state untouched for Desfazer.
    expect(q.masks[0].primitives[1].text).toBe(CONTENT);
    const moved = editFreeText(q, m.id, 'ed', values, context, target, {
      x: 0,
      y: 0,
    }).project.masks[0].primitives[1];
    expect(maskPoint(moved.points[0], target).x).toBeCloseTo(0, 9);
    expect(() =>
      editFreeText(q, m.id, 'missing', values, context, target),
    ).toThrow(/inexistente/);
  });
  it('respeita contexto, visibilidade, isolamento, prancha e layers bloqueados', () => {
    const { p, context } = fixture(),
      m = p.masks[0];
    const cases: [Project, typeof context][] = [
      [p, { key: `sheet:${p.sheets[0].id}`, detailId: context.detailId }],
      [p, { key: 'model', detailId: 'outro' }],
      [hideObjects(p, 'model', [m.id]), context],
      [
        setLayerState(p, 'model', layerId('DESENHO'), { editable: false }),
        context,
      ],
      [
        setLayerState(p, 'model', layerId('MASCARA'), { capture: false }),
        context,
      ],
      [
        {
          ...p,
          masks: p.masks.map((o) => ({ ...o, visible: false })),
        },
        context,
      ],
    ];
    for (const [project, ctx] of cases)
      expect(() =>
        appendFreeText(project, m.id, at, draft(p), ctx, project.masks[0]),
      ).toThrow();
  });
  it('texto de folha converte papel × escala para o modelo e compõe a prancha com essa altura', () => {
    const { p, context, detailId } = fixture(),
      m = p.masks[0];
    const q = appendFreeText(
      p,
      m.id,
      at,
      draft(p, { size: 'paper', height: 5, paperScale: 50, rotation: 0 }),
      context,
      m,
      'sheet-text',
    ).project;
    const local = q.masks[0].primitives.at(-1)!;
    expect(local.textPaperScale).toBe(50);
    expect(maskPrimitives(q.masks[0]).at(-1)!.textHeight).toBeCloseTo(250, 10);
    const values = freeTextDraftOf(local, q.masks[0]);
    expect(values).toMatchObject({ size: 'paper', paperScale: 50 });
    expect(values.height).toBeCloseTo(5, 10);
    const drawingId = q.hierarchy.drawings.find(
      (d) => d.detailId === detailId,
    )!.id;
    const placed = placeDrawing(q, q.sheets[0].id, drawingId);
    for (const [scale, expected] of [
      [50, 5],
      [100, 2.5],
    ] as const) {
      const r = updatePlacement(placed.project, placed.id, {
        scale,
      });
      const text = composeSheet(r, r.sheets[0].id)
        .views.flatMap((v) => v.lines)
        .find((v) => v.text === CONTENT)!;
      expect(text.textHeight).toBeCloseTo(expected, 9);
      expect(text.textFont).toEqual({
        family: 'serif',
        weight: 'bold',
        style: 'italic',
      });
    }
    const pdf = new TextDecoder('latin1').decode(toSheetPdf(placed.project));
    expect(pdf).toContain('Times-BoldItalic');
  });
  it('DXF e PDF mantêm conteúdo, posição, altura, rotação, alinhamento e fonte declarada', () => {
    const { p, context } = fixture(),
      m = p.masks[0];
    let q = appendFreeText(p, m.id, at, draft(p), context, m, 'a').project;
    q = appendFreeText(
      q,
      m.id,
      { x: 0, y: 0 },
      draft(q, {
        text: 'Nota ç',
        align: 'left',
        rotation: 0,
        font: { family: 'ISOCPEUR', weight: 'normal', style: 'normal' },
      }),
      context,
      q.masks[0],
      'b',
    ).project;
    const dxf = toDxf(q).replace(/\r\n/g, '\n');
    expect(dxf).toContain('AcDbTextStyleTableRecord');
    expect(dxf).toMatch(/\n2\nAS_TIMES_NEW_ROMAN_B_I\n/);
    expect(dxf).toMatch(/\n3\ntimes\.ttf\n/);
    expect(dxf).toMatch(/\n7\nAS_ISOCPEUR\n/);
    expect(dxf).toContain('%%c12 c/15 ± 2 - viga ação');
    const pdf = new TextDecoder('latin1').decode(toPdf(q));
    expect(pdf).toContain('Times-BoldItalic');
    expect(
      resolveTextFont(q.masks[0].primitives.at(-1)!.textFont),
    ).toMatchObject({ pdf: 'helvetica', pdfSubstituted: true });
    expect(
      textFontNotice(
        { family: 'ISOCPEUR', weight: 'normal', style: 'normal' },
        () => false,
      ),
    ).toMatch(/Não encontrada.*Helvetica.*ISOCPEUR/);
    expect(
      textFontNotice({ family: 'mono', weight: 'bold', style: 'normal' }),
    ).toBe('');
    const reopened = parseDxf(toDxf(q), 'saida.dxf');
    const texts = reopened.primitives.filter((v) => v.text === CONTENT);
    expect(texts).toHaveLength(1);
    expect(texts[0].textHeight).toBeCloseTo(80, 6);
    expect(texts[0].textRotation).toBeCloseTo(45, 6);
    expect(texts[0].points[0].x).toBeCloseTo(at.x, 6);
    expect(texts[0].points[0].y).toBeCloseTo(at.y, 6);
    // The DXF importer does not read TEXT justification (existing limitation).
  });
  it('pacote v17 converte unidades e versões antigas recusam o novo contrato', () => {
    const { p, context, detailId } = fixture(),
      m = p.masks[0];
    const q = appendFreeText(p, m.id, at, draft(p), context, m).project;
    for (const unit of ['mm', 'cm', 'm'] as const) {
      const pack = createDetailPackage(q, detailId, {
        producer: { app: 'Test', version: '1' },
        unit,
      });
      expect(pack.schema).toBe('openstruct.detail/23');
      const r = readDetailPackage(pack).project;
      const a = maskPrimitives(q.masks[0]).at(-1)!,
        b = maskPrimitives(r.masks[0]).at(-1)!;
      expect(b.text).toBe(CONTENT);
      expect(b.textHeight).toBeCloseTo(a.textHeight!, 8);
      expect(b.points[0].x).toBeCloseTo(a.points[0].x, 8);
      expect(b.textFont).toEqual(a.textFont);
      const old = { ...structuredClone(pack), schema: 'openstruct.detail/16' };
      expect(() => readDetailPackage(old as never)).toThrow(/v17/);
    }
    const legacy = {
      ...JSON.parse(JSON.stringify(q)),
      schema: 'armadurastruct/27',
    };
    expect(() => decodeProject(JSON.stringify(legacy))).toThrow(/formato 28/);
    const broken = JSON.parse(JSON.stringify(q));
    broken.masks[0].primitives.at(-1).text = undefined;
    expect(() => decodeProject(JSON.stringify(broken))).toThrow();
  });
  it('projetos antigos sem texto livre continuam abrindo como formato 28', () => {
    const { p } = fixture();
    const old = {
      ...JSON.parse(JSON.stringify(p)),
      schema: 'armadurastruct/27',
    };
    expect(decodeProject(JSON.stringify(old)).schema).toBe('armadurastruct/35');
  });
  it('mover/espelhar e símbolos mantêm o ponto nativo coerente com a entidade', () => {
    const { p, context } = fixture(),
      m = p.masks[0];
    const q = appendFreeText(p, m.id, at, draft(p), context, m, 't').project,
      mask = q.masks[0],
      text = mask.primitives.at(-1)!;
    const moved = transformMaskPrimitive(text, mask, {
      kind: 'translate',
      delta: { x: 100, y: 50 },
    });
    expect(maskPoint(moved.points[0], mask).x).toBeCloseTo(at.x + 100, 8);
    const mirrored = transformMaskPrimitive(text, mask, {
      kind: 'mirror',
      base: { x: 0, y: 0 },
      axisEnd: { x: 0, y: 100 },
    });
    const rotated = transformMaskPrimitive(text, mask, {
      kind: 'rotate',
      base: at,
      angle: 90,
    });
    expect(maskPoint(rotated.points[0], mask).x).toBeCloseTo(at.x, 8);
    expect(rotated.textRotation).toBeCloseTo(
      (text.textRotation! + 90) % 360,
      8,
    );
    for (const r of [moved, mirrored, rotated])
      expect(() =>
        validateNativeMask({ ...mask, primitives: [r] }),
      ).not.toThrow();
    const baked = bakeMaskPrimitives(mask, [text], at);
    expect(baked[0].native).toMatchObject({ kind: 'text' });
    expect(baked[0].textFont).toEqual(text.textFont);
    const placed = transformSymbolPrimitive(baked[0], {
      origin: { x: 10, y: 20 },
      rotation: 90,
      scale: 2,
    });
    expect(placed.native).toMatchObject({ kind: 'text', at: { x: 10, y: 20 } });
    expect(placed.textHeight).toBeCloseTo(160, 8);
  });
});
