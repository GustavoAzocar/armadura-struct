import { describe, it, expect } from 'vitest';
import { zoomFixture } from './zoomFixture';
import {
  drawingPrimitives,
  physicalBarTextPrimitives,
} from '../src/domain/drawingPrimitives';
import { representationPrimitives } from '../src/domain/representations';
import { placeDrawing, updatePlacement } from '../src/domain/sheets';
import { composeSheet, alignPlacement } from '../src/domain/paper';
import { toPdf, toDxf, toSheetPdf } from '../src/lib/exports';
import { decodeProject, schedule } from '../src/domain/model';
import { parseDxf } from '../src/cad/import';
describe('textos do desenho em unidades físicas', () => {
  it('identificação/cotas usam altura 40mm e posições/rotação comuns ao CAD e exportação', () => {
    const p = zoomFixture();
    const b = { ...p.bars[2], rotation: 37 };
    const labels = physicalBarTextPrimitives(b, p);
    expect(labels).toHaveLength(3);
    expect(
      labels.every((t) => t.textHeight === 40 && t.textRotation === 37),
    ).toBe(true);
    expect(labels[1].textAlign).toBe('center');
    const exported = drawingPrimitives({ ...p, bars: [b] }).filter(
      (t) => t.text,
    );
    for (const label of labels)
      expect(exported).toContainEqual(
        expect.objectContaining({
          ...label,
          layer: expect.any(String),
          role: label.layer,
        }),
      );
  });
  it('rebatimento legado/girado/ampliado preserva alturas e transformação próprias', () => {
    const p = zoomFixture();
    expect(
      representationPrimitives(p.bars[0], p.details[0], p)
        .filter((t) => t.text)
        .every((t) => t.textHeight === 40),
    ).toBe(true);
    const t = representationPrimitives(p.bars[0], p.details[1], p).find(
      (t) => t.layer === 'IDENTIFICACAO',
    )!;
    expect(t.textHeight).toBe(50);
    expect(t.textRotation).toBe(57);
  });
  it.each([20, 50, 100])(
    'papel 1:%s conserva 2,5mm e PDF usa conversão mm→pt sem câmera',
    (scale) => {
      let p = zoomFixture();
      p = { ...p, bars: [p.bars[0]], masks: [], details: [], annotations: [] };
      const placed = placeDrawing(
        p,
        p.sheets[0].id,
        p.hierarchy.drawings[0].id,
      );
      p = updatePlacement(placed.project, placed.id, {
        scale,
        textHeight: 2.5,
        origin: { x: 30, y: 60 },
        frame: { width: 160, height: 100 },
      });
      p = alignPlacement(p, placed.id);
      const c = composeSheet(p, p.sheets[0].id);
      expect(c.issues).toEqual([]);
      const text = c.views[0].content.find((t) => t.text?.startsWith('N1'))!;
      expect(text.textHeight).toBe(2.5);
      const pdf = new TextDecoder('latin1').decode(toSheetPdf(p));
      expect(
        [...pdf.matchAll(/([\d.]+) Tf/g)]
          .map((m) => Number(m[1]))
          .some((v) => Math.abs(v - (2.5 * 72) / 25.4) < 1e-8),
      ).toBe(true);
    },
  );
  it('DXF preserva altura, origem, rotação e alinhamento dos textos; salvar/reabrir não muda aço', () => {
    const p = zoomFixture();
    const q = parseDxf(toDxf(p), 'saida.dxf');
    for (const text of drawingPrimitives(p).filter((t) => t.text)) {
      const found = q.primitives.find(
        (t) =>
          t.text === text.text!.replace(/%%c/gi, 'Ø') &&
          Math.abs(t.points[0].x - text.points[0].x) < 1e-5 &&
          Math.abs(t.points[0].y - text.points[0].y) < 1e-5,
      );
      expect(found).toBeDefined();
      expect(found?.textHeight).toBeCloseTo(text.textHeight!, 6);
      expect(found?.points[0].x).toBeCloseTo(text.points[0].x, 6);
      expect(found?.points[0].y).toBeCloseTo(text.points[0].y, 6);
      expect(found?.textRotation ?? 0).toBeCloseTo(text.textRotation ?? 0, 6);
    }
    const reopened = decodeProject(JSON.stringify(p));
    expect(schedule(reopened)).toEqual(schedule(p));
  });
  it('PDF de modelo remove mínimos/máximos: alturas de 12 e 900mm seguem escala exata', () => {
    const p = zoomFixture();
    p.drawing.scale = 50;
    p.masks[0].primitives[1].textHeight = 900;
    const pdf = new TextDecoder('latin1').decode(toPdf(p));
    const sizes = [...pdf.matchAll(/([\d.]+) Tf/g)].map((m) => Number(m[1]));
    expect(
      sizes.some((v) => Math.abs(v - ((12 / 50) * 72) / 25.4) < 1e-8),
    ).toBe(true);
    expect(
      sizes.some((v) => Math.abs(v - ((900 / 50) * 72) / 25.4) < 1e-8),
    ).toBe(true);
  });
});
