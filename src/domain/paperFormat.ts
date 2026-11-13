import type { Sheet, SheetFormat } from './types';

export const paper: Record<Exclude<SheetFormat, 'custom'>, [number, number]> = {
  A0: [841, 1189],
  A1: [594, 841],
  A2: [420, 594],
  A3: [297, 420],
  A4: [210, 297],
};
export function sheetSize(
  sheet: Pick<Sheet, 'format' | 'orientation' | 'customSize'>,
) {
  const [short, long] =
    sheet.format === 'custom'
      ? [
          Math.min(sheet.customSize.width, sheet.customSize.height),
          Math.max(sheet.customSize.width, sheet.customSize.height),
        ]
      : paper[sheet.format];
  return sheet.orientation === 'landscape'
    ? { width: long, height: short }
    : { width: short, height: long };
}
export function initialSheet(id: string, revision = '00'): Sheet {
  return {
    id,
    name: 'Folha 1',
    format: 'A3',
    orientation: 'landscape',
    customSize: { width: 210, height: 297 },
    margins: { left: 10, right: 10, top: 10, bottom: 10 },
    seal: { enabled: true, width: 160, height: 40 },
    properties: { revision, notes: '' },
  };
}

export function validateSheetLayout(sheet: Sheet) {
  const values = [
    sheet.customSize.width,
    sheet.customSize.height,
    ...Object.values(sheet.margins),
    sheet.seal.width,
    sheet.seal.height,
  ];
  if (
    !values.every(Number.isFinite) ||
    sheet.customSize.width < 50 ||
    sheet.customSize.height < 50 ||
    sheet.customSize.width > 5000 ||
    sheet.customSize.height > 5000 ||
    Object.values(sheet.margins).some((n) => n < 0) ||
    sheet.seal.width > 5000 ||
    sheet.seal.height > 5000 ||
    sheet.seal.width <= 0 ||
    sheet.seal.height <= 0
  )
    throw new Error('Dimensões de papel, margens ou selo inválidas.');
  const size = sheetSize(sheet);
  if (
    sheet.margins.left + sheet.margins.right >= size.width ||
    sheet.margins.top + sheet.margins.bottom >= size.height
  )
    throw new Error('As margens precisam deixar uma área útil positiva.');
  const template = sheet.paperTemplate;
  if (template) {
    const applied = sheetSize(template);
    const { useful, seal } = template;
    const geometry = [
      size.width - applied.width,
      size.height - applied.height,
      sheet.margins.left - useful.x,
      sheet.margins.bottom - useful.y,
      size.width - sheet.margins.right - useful.x - useful.width,
      size.height - sheet.margins.top - useful.y - useful.height,
      sheet.seal.width - (seal?.width ?? sheet.seal.width),
      sheet.seal.height - (seal?.height ?? sheet.seal.height),
    ];
    if (
      sheet.format !== template.format ||
      sheet.orientation !== template.orientation ||
      sheet.seal.enabled !== Boolean(seal) ||
      geometry.some((n) => Math.abs(n) > 1e-7)
    )
      throw new Error(
        'O papel, as margens e a reserva do selo devem corresponder ao modelo aplicado.',
      );
  }
}
