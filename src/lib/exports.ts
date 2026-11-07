import { jsPDF } from 'jspdf';
import { bounds, format } from '../domain/geometry';
import { schedule, scheduleChanged } from '../domain/model';
import { annotationError, primitiveBounds } from '../domain/drafting';
import { version as appVersion } from '../../package.json';
import { drawingPrimitives as exportLines } from '../domain/drawingPrimitives';
export { drawingPrimitives as exportLines } from '../domain/drawingPrimitives';
import type { Point, Project } from '../domain/types';
export function assertExportable(p: Project) {
  const annotationIssue = p.annotations.map(annotationError).find(Boolean);
  if (annotationIssue)
    throw new Error(
      `Corrija as anotações antes de exportar: ${annotationIssue}`,
    );
  if (scheduleChanged(p))
    throw new Error(
      'A relação de aço está bloqueada e desatualizada. Use Atualizar RA ou Desbloquear RA antes de exportar.',
    );
  const invalid = schedule({ ...p, scheduleLock: undefined }).filter(
    (r) => r.errors.length,
  );
  if (invalid.length)
    throw new Error(
      `Corrija a geometria de ${invalid.map((r) => r.mark).join(', ')} antes de exportar.`,
    );
}
/** ASCII DXF R12: interoperable primitive geometry, modelspace in millimeters. */
export function toDxf(p: Project): string {
  assertExportable(p);
  const out: (string | number)[] = [];
  const put = (...pairs: (string | number)[]) => out.push(...pairs);
  const clean = (s: string) =>
    s
      .replace(/[\r\n]/g, ' ')
      .replace(/Ø/g, '%%c')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E]/g, '?');
  put(
    0,
    'SECTION',
    2,
    'HEADER',
    9,
    '$ACADVER',
    1,
    'AC1009',
    9,
    '$INSUNITS',
    70,
    4,
    0,
    'ENDSEC',
    0,
    'SECTION',
    2,
    'TABLES',
    0,
    'TABLE',
    2,
    'LAYER',
    70,
    10,
  );
  for (const [name, color] of [
    ['MASCARA', 8],
    ['ARMADURAS', 5],
    ['REBATIMENTOS', 4],
    ['IDENTIFICACAO', 7],
    ['COTAS', 8],
    ['DISTRIBUICAO', 3],
    ['QUADRO_ACO', 7],
    ['DESENHO', 8],
    ['CORTES', 6],
    ['CHAMADAS', 7],
  ])
    put(0, 'LAYER', 2, name, 70, 0, 62, color, 6, 'CONTINUOUS');
  put(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
  for (const item of exportLines(p)) {
    if (item.text) {
      const a = item.points[0];
      put(
        0,
        'TEXT',
        8,
        item.layer,
        10,
        a.x,
        20,
        a.y,
        30,
        0,
        40,
        item.textHeight ?? 40,
        1,
        clean(item.text),
        50,
        item.textRotation ?? 0,
        72,
        item.layer === 'COTAS' || item.layer === 'DISTRIBUICAO' ? 1 : 0,
        11,
        a.x,
        21,
        a.y,
        31,
        0,
      );
      continue;
    }
    const pts = item.closed ? [...item.points, item.points[0]] : item.points;
    for (let i = 0; i < pts.length - 1; i++)
      put(
        0,
        'LINE',
        8,
        item.layer,
        10,
        pts[i].x,
        20,
        pts[i].y,
        30,
        0,
        11,
        pts[i + 1].x,
        21,
        pts[i + 1].y,
        31,
        0,
      );
  }
  const box = bounds(exportLines(p).flatMap((l) => l.points));
  let y = box.y - 400;
  for (const line of [
    'QUADRO DE ACO | comprimentos em metros',
    'POS   ACO   DIAM   QTD   C.UNIT   C.TOTAL   PESO(kg)',
    ...schedule(p).map(
      (r) =>
        `${r.mark}   ${r.steel}   ${r.diameter}   ${r.quantity}   ${format(r.unitLength, 3)}   ${format(r.totalLength, 3)}   ${format(r.weight, 2)}`,
    ),
  ]) {
    put(
      0,
      'TEXT',
      8,
      'QUADRO_ACO',
      10,
      box.x,
      20,
      y,
      30,
      0,
      40,
      45,
      1,
      clean(line),
    );
    y -= 90;
  }
  put(0, 'ENDSEC', 0, 'EOF');
  return out.join('\r\n') + '\r\n';
}
export function toCsv(p: Project) {
  assertExportable(p);
  const safe = (v: unknown) =>
    `"${String(v)
      .replace(/^(?=[=+@\-\t\r])/, "'")
      .replace(/"/g, '""')}"`;
  return (
    '\ufeff' +
    [
      [
        'Posição',
        'Elemento',
        'Aço',
        'Bitola (mm)',
        'Quantidade',
        'Comprimento unitário (m)',
        'Comprimento total (m)',
        'Peso teórico (kg)',
      ],
      ...schedule(p).map((r) => [
        r.mark,
        r.element,
        r.steel,
        r.diameter,
        r.quantity,
        format(r.unitLength, 3),
        format(r.totalLength, 3),
        format(r.weight, 2),
      ]),
    ]
      .map((row) => row.map(safe).join(';'))
      .join('\r\n')
  );
}
export function toPdf(p: Project): Uint8Array {
  assertExportable(p);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  const W = 420,
    H = 297;
  const title = (name: string) => {
    doc.setDrawColor(52, 72, 209);
    doc.setLineWidth(0.5);
    doc.line(14, 24, W - 14, 24);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(25, 36, 66);
    doc.text(name, 14, 17);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`OPENSTRUCT / ARMADURASTRUCT ${appVersion}`, W - 14, 17, {
      align: 'right',
    });
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text(
      doc.splitTextToSize(
        `${p.name} | ${p.author || 'Autor não informado'} | ${p.hierarchy.floors.map((f) => f.name).join(', ')} | Rev. ${p.drawing.revision}`,
        W - 75,
      )[0],
      14,
      H - 12,
    );
    doc.text(`Página ${doc.getNumberOfPages()}`, W - 14, H - 12, {
      align: 'right',
    });
  };
  title('Detalhamento de armaduras');
  const lines = exportLines(p);
  const box = bounds(lines.flatMap(primitiveBounds));
  const fitScale = Math.min(
    (W - 40) / Math.max(box.width, 1),
    (H - 70) / Math.max(box.height + 150, 1),
  );
  const s = p.drawing.scale ? 1 / p.drawing.scale : fitScale;
  if (s > fitScale + 1e-8)
    throw new Error(
      'O desenho não cabe na folha A3 nesta escala. Escolha uma escala menor ou Ajustar à folha nas propriedades do projeto.',
    );
  const map = (a: Point): Point => ({
    x: 20 + (a.x - box.x) * s,
    y: 40 + (box.y + box.height - a.y) * s,
  });
  for (const item of lines) {
    const c =
      item.layer === 'MASCARA'
        ? [165, 170, 180]
        : item.layer === 'ARMADURAS'
          ? [30, 70, 145]
          : [50, 65, 85];
    doc.setDrawColor(c[0], c[1], c[2]);
    doc.setTextColor(c[0], c[1], c[2]);
    doc.setLineWidth(item.layer === 'MASCARA' ? 0.12 : 0.3);
    if (item.text) {
      const a = map(item.points[0]);
      doc.setFontSize(
        Math.max(5, Math.min(12, (item.textHeight ?? 40) * s * 2.83)),
      );
      doc.text(item.text.replace(/%%c/g, 'Ø'), a.x, a.y, {
        angle: item.textRotation ?? 0,
        align:
          item.layer === 'COTAS' || item.layer === 'DISTRIBUICAO'
            ? 'center'
            : 'left',
      });
      continue;
    }
    const pts = item.closed ? [...item.points, item.points[0]] : item.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = map(pts[i]),
        b = map(pts[i + 1]);
      doc.line(a.x, a.y, b.x, b.y);
    }
  }
  doc.setFontSize(7);
  doc.setTextColor(100);
  doc.text(
    `${p.drawing.scale ? `Escala 1:${p.drawing.scale}` : 'Vista ajustada à folha'} · dimensões indicadas em cm · geometria pelo eixo da barra`,
    14,
    279,
  );
  doc.addPage();
  title('Quadro de aço');
  let y = 39;
  const header = () => {
    doc.setFillColor(236, 240, 248);
    doc.rect(14, y - 6, 392, 10, 'F');
    doc.setTextColor(30);
    doc.setFontSize(9);
    [
      'Pos.',
      'Elemento',
      'Aço',
      'Ø mm',
      'Qtd.',
      'C. unit. m',
      'C. total m',
      'Peso kg',
    ].forEach((t, i) =>
      doc.text(t, [18, 44, 170, 205, 240, 275, 323, 370][i], y),
    );
    y += 13;
  };
  header();
  for (const r of schedule(p)) {
    if (y > 258) {
      doc.addPage();
      title('Quadro de aço · continuação');
      y = 39;
      header();
    }
    doc.setTextColor(35);
    doc.setFontSize(9);
    [
      r.mark,
      r.element.slice(0, 55),
      r.steel,
      String(r.diameter),
      String(r.quantity),
      format(r.unitLength, 3),
      format(r.totalLength, 3),
      format(r.weight, 2),
    ].forEach((t, i) =>
      doc.text(t, [18, 44, 170, 205, 240, 275, 323, 370][i], y),
    );
    doc.setDrawColor(225);
    doc.setLineWidth(0.1);
    doc.line(14, y + 3, 406, y + 3);
    y += 11;
  }
  if (y > 240) {
    doc.addPage();
    title('Resumo');
    y = 40;
  }
  const rows = schedule(p);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `Total: ${format(
      rows.reduce((s, r) => s + r.totalLength, 0),
      3,
    )} m  /  ${format(
      rows.reduce((s, r) => s + r.weight, 0),
      2,
    )} kg`,
    18,
    y + 8,
  );
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    'Comprimentos pelo eixo, com arcos de dobra. Massa teórica: 7.850 kg/m³. Perdas e emendas adicionais não incluídas.',
    18,
    y + 20,
  );
  doc.text(
    'Mandris e prolongamentos são parâmetros definidos pelo projetista. O programa não realiza dimensionamento estrutural.',
    18,
    y + 26,
  );
  return new Uint8Array(doc.output('arraybuffer'));
}
