import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  emptyProject,
  newBar,
  schedule,
  createScheduleLock,
} from '../../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
} from '../../src/domain/hierarchy';
import { parseDxf, maskPrimitives } from '../../src/cad/import';
import { placeDrawing } from '../../src/domain/sheets';
import type { Project } from '../../src/domain/types';
const batch = (page: Page) =>
  page.getByRole('dialog', { name: 'Importar máscaras em lote', exact: true });
const receipt = (page: Page) =>
  page.getByRole('dialog', { name: 'Resultado das máscaras', exact: true });
const line = (name: string, unit = 4, length = 1000) => ({
  name,
  mimeType: 'application/dxf',
  buffer: Buffer.from(
    `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${unit}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nFORMA\n10\n0\n20\n0\n11\n${length}\n21\n0\n0\nENDSEC\n0\nEOF\n`,
  ),
});
function fixture() {
  let p = emptyProject();
  p.name = 'Lote CAD';
  p.hierarchy.floors[0].name = 'Térreo';
  p.hierarchy.elements[0].name = 'Vigas';
  p.hierarchy.details[0].name = 'V01';
  const a = p.hierarchy.details[0].id,
    second = createHierarchyNode(
      p,
      'detail',
      'V02',
      p.hierarchy.elements[0].id,
    );
  p = completeOwnership(
    { ...second.project, bars: [{ ...newBar('N1'), quantity: 4 }] },
    a,
  );
  p = { ...p, scheduleLock: createScheduleLock(p) };
  return { p, a, b: second.id };
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'batch.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
}
async function save(page: Page): Promise<Project> {
  const close = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await close.isVisible()) await close.click();
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
}
async function command(page: Page, s: string) {
  const i = page.getByRole('textbox', { name: 'Comando CAD' });
  await i.fill(s);
  await i.press('Enter');
}
async function read(page: Page, n: number) {
  await batch(page)
    .getByRole('button', { name: 'Ler arquivos', exact: true })
    .click();
  await expect(batch(page).getByRole('status')).toContainText(`${n} prontos`);
}
async function closeResult(page: Page) {
  await receipt(page)
    .getByRole('button', { name: 'Fechar', exact: true })
    .click();
}

test('três arquivos, dois destinos, homônimos e unidades; aplicação, histórico, recuperação e origem permanecem coerentes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { p, a, b } = fixture();
  await load(page, p);
  const before = await save(page);
  await page
    .getByTestId('mask-input')
    .setInputFiles([
      line('forma.dxf'),
      line('forma.dxf', 5, 100),
      line('pilar.dxf', 6, 1),
    ]);
  await batch(page)
    .getByLabel('Destino do arquivo 3', { exact: true })
    .selectOption(b);
  await read(page, 3);
  await expect(batch(page)).toContainText('Nome repetido');
  await page.screenshot({ path: 'docs/mask-batch-preparation.png' });
  await batch(page)
    .getByRole('button', { name: 'Aplicar lote', exact: true })
    .dblclick();
  await expect(receipt(page)).toContainText('3 máscara(s) importada(s)');
  await expect(
    receipt(page).getByRole('button', { name: /Abrir resultado:/ }),
  ).toHaveCount(2);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.screenshot({ path: 'docs/mask-batch-results.png' });
  await closeResult(page);
  const after = await save(page);
  expect(after.masks).toHaveLength(3);
  expect(after.masks.map((m) => after.hierarchy.objectDetails[m.id])).toEqual([
    a,
    a,
    b,
  ]);
  expect(after.masks.map((m) => m.scale)).toEqual([1, 10, 1000]);
  expect(schedule(after)).toEqual(schedule(before));
  expect(after.bars).toEqual(before.bars);
  expect(after.scheduleLock).toEqual(before.scheduleLock);
  await page.getByRole('tab', { name: 'Arquivo', exact: true }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Desenho DXF', exact: true }).click();
  const raw = readFileSync((await (await event).path())!, 'utf8');
  const exported = maskPrimitives(parseDxf(raw, 'batch-output.dxf')).filter(
    (q) => q.layer === 'FORMA',
  );
  expect(exported).toHaveLength(3);
  for (const q of exported)
    expect(
      Math.hypot(q.points[1].x - q.points[0].x, q.points[1].y - q.points[0].y),
    ).toBeCloseTo(1000, 7);

  await command(page, 'U');
  expect((await save(page)).masks).toEqual([]);
  await command(page, 'REDO');
  expect((await save(page)).masks).toEqual(after.masks);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect((await save(page)).hierarchy.objectDetails).toEqual(
    after.hierarchy.objectDetails,
  );
  expect(errors).toEqual([]);
});

test('falha e unidade não declarada exigem decisão explícita; nenhum arquivo é omitido silenciosamente', async ({
  page,
}) => {
  const { p } = fixture();
  await load(page, p);
  await page.getByTestId('mask-input').setInputFiles([
    line('sem-unidade.dxf', 0),
    {
      name: 'invalido.dwg',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('invalid'),
    },
  ]);
  await read(page, 1);
  await expect(batch(page).getByRole('status')).toContainText('1 falhas');
  await batch(page)
    .getByRole('button', { name: 'Aplicar lote', exact: true })
    .click();
  await expect(batch(page)).toContainText('Confirme explicitamente');
  await batch(page)
    .getByLabel('Confirmar somente arquivos válidos', { exact: true })
    .check();
  await batch(page)
    .getByRole('button', { name: 'Aplicar lote', exact: true })
    .click();
  await expect(batch(page)).toContainText('confirme a unidade');
  await batch(page)
    .getByLabel('Confirmar unidade do arquivo 1', { exact: true })
    .check();
  await batch(page)
    .getByRole('button', { name: 'Aplicar lote', exact: true })
    .click();
  await closeResult(page);
  expect((await save(page)).masks).toHaveLength(1);
});

test('cancelar descarta arquivos, layers e hierarquia em rascunho; pode criar o destino e aplicar depois', async ({
  page,
}) => {
  const { p } = fixture();
  await load(page, p);
  const before = await save(page);
  await page.getByTestId('mask-input').setInputFiles([line('nova.dxf')]);
  await read(page, 1);
  await batch(page)
    .getByText('Criar destino em preparação', { exact: true })
    .click();
  await batch(page)
    .getByLabel('Nome do novo destino', { exact: true })
    .fill('V03');
  await batch(page)
    .getByRole('button', { name: 'Preparar destino', exact: true })
    .click();
  await expect(
    batch(page).getByLabel('Destino do lote', { exact: true }),
  ).toContainText('V03');
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(before);
  await page.getByTestId('mask-input').setInputFiles([line('nova.dxf')]);
  await read(page, 1);
  await batch(page)
    .getByText('Criar destino em preparação', { exact: true })
    .click();
  await batch(page)
    .getByLabel('Nome do novo destino', { exact: true })
    .fill('V03');
  await batch(page)
    .getByRole('button', { name: 'Preparar destino', exact: true })
    .click();
  await batch(page)
    .getByRole('button', { name: 'Aplicar destino a todos', exact: true })
    .click();
  await batch(page)
    .getByRole('button', { name: 'Aplicar lote', exact: true })
    .click();
  await receipt(page)
    .getByRole('button', { name: /Abrir resultado:.*V03/ })
    .click();
  const next = await save(page),
    d = next.hierarchy.details.find((d) => d.name === 'V03')!;
  expect(next.hierarchy.objectDetails[next.masks[0].id]).toBe(d.id);
  expect(
    next.hierarchy.drawings.filter((v) => v.detailId === d.id),
  ).toHaveLength(1);
  expect(next.bars).toEqual(before.bars);
  await page
    .getByRole('button', { name: 'Concluir edição', exact: true })
    .click();
  await command(page, 'U');
  expect(
    (await save(page)).hierarchy.details.find((d) => d.name === 'V03'),
  ).toBeUndefined();
});

test('capacidade considera máscaras existentes e lista todo excesso antes de ler', async ({
  page,
}) => {
  const { p, a } = fixture();
  const m = parseDxf(line('f.dxf').buffer.toString(), 'f.dxf');
  const full = completeOwnership(
    {
      ...p,
      masks: Array.from({ length: 19 }, (_, i) => ({
        ...m,
        id: `existing-${i}`,
      })),
    },
    a,
  );
  await load(page, full);
  await page
    .getByTestId('mask-input')
    .setInputFiles([line('a.dxf'), line('b.dxf'), line('c.dxf')]);
  await expect(batch(page).getByTestId('mask-batch-row')).toHaveCount(3);
  await expect(batch(page)).toContainText('restam 1 vagas');
  await expect(
    batch(page).getByRole('button', { name: 'Ler arquivos', exact: true }),
  ).toBeDisabled();
  await batch(page)
    .getByRole('button', { name: 'Retirar arquivo 3', exact: true })
    .click();
  await batch(page)
    .getByRole('button', { name: 'Retirar arquivo 2', exact: true })
    .click();
  await read(page, 1);
  await batch(page)
    .getByRole('button', { name: 'Aplicar lote', exact: true })
    .click();
  await closeResult(page);
  expect((await save(page)).masks).toHaveLength(20);
});

test('reassocia várias máscaras e permite cópia explícita sem deslocar geometrias ou aço', async ({
  page,
}) => {
  const { p, a, b } = fixture(),
    masks = ['a.dxf', 'b.dxf'].map((name) =>
      parseDxf(line(name).buffer.toString(), name),
    );
  const base = completeOwnership({ ...p, masks }, a);
  await load(page, base);
  const before = await save(page);
  await page
    .getByRole('button', { name: 'Associar máscaras do projeto', exact: true })
    .click();
  const d = page.getByRole('dialog', {
    name: 'Associar máscaras',
    exact: true,
  });
  await d.getByLabel('Associar a.dxf', { exact: true }).check();
  await d.getByLabel('Associar b.dxf', { exact: true }).check();
  await d.getByLabel('Destino do lote', { exact: true }).selectOption(b);
  await page.screenshot({ path: 'docs/mask-batch-association.png' });
  await d
    .getByRole('button', { name: 'Aplicar associação', exact: true })
    .click();
  await closeResult(page);
  const moved = await save(page);
  expect(moved.masks).toEqual(before.masks);
  expect(moved.bars).toEqual(before.bars);
  expect(moved.hierarchy.objectDetails[masks[0].id]).toBe(b);
  await command(page, 'U');
  expect((await save(page)).hierarchy.objectDetails).toEqual(
    before.hierarchy.objectDetails,
  );
  await command(page, 'REDO');
  await page
    .getByRole('button', { name: 'Associar máscaras do projeto', exact: true })
    .click();
  await d.getByLabel('Associar a.dxf', { exact: true }).check();
  await d
    .getByLabel('Modo de associação', { exact: true })
    .selectOption('copy');
  await d
    .getByRole('button', { name: 'Aplicar associação', exact: true })
    .click();
  await closeResult(page);
  const copied = await save(page);
  expect(copied.masks).toHaveLength(3);
  expect(new Set(copied.masks.map((m) => m.id)).size).toBe(3);
  expect(copied.bars).toEqual(before.bars);
});

test('prancha exige abertura explícita; isolamento pode ser deixado antes de distribuir em outros destinos', async ({
  page,
}) => {
  const { p, a, b } = fixture(),
    placed = placeDrawing(
      p,
      p.sheets[0].id,
      p.hierarchy.drawings[0].id,
    ).project;
  await load(page, placed);
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', { name: 'Abrir Folha 1', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Máscaras', exact: true }).click();
  await page
    .getByRole('button', { name: 'Importar máscaras em lote', exact: true })
    .click();
  await expect(batch(page)).toContainText('Você está na prancha');
  await expect(
    batch(page).getByRole('button', { name: 'Escolher DXF/DWG', exact: true }),
  ).toBeDisabled();
  await batch(page)
    .getByLabel('Destino do lote', { exact: true })
    .selectOption(a);
  page.once('dialog', (d) => d.accept());
  await batch(page)
    .getByRole('button', {
      name: 'Abrir desenho da vista / destino',
      exact: true,
    })
    .click();
  await expect(batch(page)).toContainText('Edição isolada');
  page.once('dialog', (d) => d.accept());
  await batch(page)
    .getByRole('button', { name: 'Trabalhar no modelo geral', exact: true })
    .click();
  await expect(batch(page)).not.toContainText('Edição isolada:');
  await batch(page)
    .getByTestId('batch-mask-input')
    .setInputFiles([line('destino.dxf')]);
  await batch(page)
    .getByLabel('Destino do arquivo 1', { exact: true })
    .selectOption(b);
  await read(page, 1);
  await batch(page)
    .getByRole('button', { name: 'Aplicar lote', exact: true })
    .click();
  await closeResult(page);
  const next = await save(page);
  expect(next.hierarchy.objectDetails[next.masks[0].id]).toBe(b);
  expect(next.bars).toEqual(placed.bars);
});

test('troca de projeto durante leitura invalida o lote e termina o worker sem callback tardio', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Real = window.Worker;
    (window as any).workerEnds = 0;
    window.Worker = class extends Real {
      postMessage(...args: any[]) {
        setTimeout(() => {
          try {
            super.postMessage(args[0], args[1]);
          } catch {
            /* already terminated */
          }
        }, 600);
      }
      terminate() {
        (window as any).workerEnds++;
        super.terminate();
      }
    } as typeof Worker;
  });
  const { p } = fixture();
  await load(page, p);
  await page.getByTestId('mask-input').setInputFiles([line('late.dxf')]);
  await batch(page)
    .getByRole('button', { name: 'Ler arquivos', exact: true })
    .click();
  await expect(batch(page)).toContainText('Lendo…');
  const next = emptyProject();
  next.name = 'Outro projeto';
  await page.getByTestId('project-input').setInputFiles({
    name: 'outro.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(next)),
  });
  await expect(batch(page)).toHaveCount(0);
  await page.waitForTimeout(900);
  const actual = await save(page);
  expect(actual.id).toBe(next.id);
  expect(actual.masks).toEqual([]);
  expect(await page.evaluate(() => (window as any).workerEnds)).toBeGreaterThan(
    0,
  );
});

test('painel recolhido, Foco, janela menor e teclado mantêm o rascunho isolado e o foco dentro do modal', async ({
  page,
}) => {
  const { p } = fixture();
  await load(page, p);
  const before = await save(page);
  await page.setViewportSize({ width: 900, height: 650 });
  await page.getByRole('button', { name: 'Foco no CAD', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Referências e comandos de máscara',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: 'Importar máscaras em lote', exact: true })
    .click();
  await batch(page)
    .getByTestId('batch-mask-input')
    .setInputFiles([line('compacta.dxf')]);
  await read(page, 1);
  await batch(page)
    .getByLabel('Nome da máscara 1', { exact: true })
    .fill('Formas em CAD');
  await batch(page)
    .getByLabel('Nome da máscara 1', { exact: true })
    .press('Control+s');
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  expect(
    await batch(page).evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  const box = await batch(page).boundingBox();
  expect(box!.width).toBeLessThanOrEqual(900);
  expect(box!.height).toBeLessThanOrEqual(650);
  await batch(page)
    .getByRole('button', { name: 'Cancelar', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/mask-batch-compact.png' });
  await page.keyboard.press('Escape');
  expect(await save(page)).toEqual(before);
});
