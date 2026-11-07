import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { emptyProject, newBar } from '../../src/domain/model';
import {
  completeOwnership,
  createHierarchyNode,
} from '../../src/domain/hierarchy';
import { previewDetailTransfer } from '../../src/domain/detailTransfer';
import type { Project } from '../../src/domain/types';

function fixtures() {
  let source = emptyProject();
  source.name = 'Revisões de estrutura';
  source.drawing.revision = '01';
  source.hierarchy.floors[0].name = 'Térreo';
  source.hierarchy.elements[0].name = 'V1';
  source.hierarchy.details[0].name = 'Armação V1';
  source = completeOwnership({
    ...source,
    bars: [{ ...newBar('N1'), id: 'source-bar', quantity: 2 }],
    details: [
      { id: 'source-rep', barId: 'source-bar', origin: { x: 0, y: -500 } },
    ],
    annotations: [
      {
        id: 'source-call',
        kind: 'leader',
        barId: 'source-bar',
        points: [
          { x: 500, y: 0 },
          { x: 1000, y: 100 },
          { x: 1200, y: 100 },
        ],
        label: '',
        textHeight: 40,
        color: '#777777',
      },
    ],
  });
  const floor = createHierarchyNode(source, 'floor', 'Superior'),
    element = createHierarchyNode(floor.project, 'element', 'V1', floor.id),
    upper = createHierarchyNode(
      element.project,
      'detail',
      'Armação V1',
      element.id,
    );
  source = completeOwnership(
    {
      ...upper.project,
      bars: [
        ...source.bars,
        { ...newBar('N2'), id: 'upper-bar', quantity: 99 },
      ],
    },
    upper.id,
  );
  let target = emptyProject();
  target.name = 'Pranchas existentes';
  target.hierarchy.details[0].name = 'V2 local';
  target = completeOwnership({
    ...target,
    bars: [{ ...newBar('N1'), id: 'local-bar', quantity: 1 }],
  });
  return {
    source,
    target,
    first: source.hierarchy.details[0].id,
    upper: upper.id,
  };
}
function insert(p: Project, source: Project, id: string) {
  const plan = previewDetailTransfer(p, source, {
    mode: 'insert',
    sourceDetailId: id,
    targetElementId: p.hierarchy.elements[0].id,
    sheetId: p.sheets[0].id,
  });
  if (plan.issues.length) throw Error(plan.issues.join(' '));
  return { p: plan.project!, id: plan.targetDetailId! };
}
async function load(page: Page, p: Project) {
  await page.goto('/');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'destino.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
}
async function save(page: Page) {
  const event = page.waitForEvent('download');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Salvar projeto', exact: true })
    .click();
  return JSON.parse(
    readFileSync((await (await event).path())!, 'utf8'),
  ) as Project;
}
async function openSheet(page: Page, name = 'Folha 1') {
  await page.getByRole('tab', { name: 'Pranchas', exact: true }).click();
  await page
    .getByRole('button', { name: `Abrir ${name}`, exact: true })
    .click();
}
async function transfer(page: Page, p: Project, update = false) {
  const close = page.getByRole('button', { name: 'Fechar aviso', exact: true });
  if (await close.isVisible()) await close.click();
  await page.getByRole('tab', { name: 'Elementos', exact: true }).click();
  const event = page.waitForEvent('filechooser');
  await page
    .getByRole('button', {
      name: update ? 'Atualizar detalhamento' : 'Inserir detalhamento',
      exact: true,
    })
    .click();
  await (
    await event
  ).setFiles({
    name: 'revisao.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(p)),
  });
  const dialog = page.getByRole('dialog', {
    name: 'Comparar detalhamentos',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('insert/cancel and revision preserve the project, update every linked view once, refresh locked RA, undo and reopen', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { source, target } = fixtures();
  await load(page, target);
  await openSheet(page);
  const baseline = await save(page);
  let dialog = await transfer(page, source);
  await expect(
    dialog.getByRole('button', { name: 'Aplicar detalhamento', exact: true }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(await save(page)).toEqual(baseline);
  dialog = await transfer(page, source);
  await dialog
    .getByRole('button', { name: 'Aplicar detalhamento', exact: true })
    .click();
  let p = await save(page);
  const imported = p.hierarchy.details.find(
    (d) => d.source?.origin.projectId === source.id,
  )!;
  const bar = p.bars.find(
    (b) => p.hierarchy.objectDetails[b.id] === imported.id,
  )!;
  expect(p.id).toBe(target.id);
  expect(p.bars).toHaveLength(2);
  expect(bar.quantity).toBe(2);
  expect(p.bars.some((b) => b.quantity === 99)).toBe(false);
  expect(p.bars.find((b) => b.id === 'local-bar')).toEqual(target.bars[0]);
  await page
    .getByRole('button', { name: 'Duplicar layout', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Armaduras', exact: true }).click();
  await page.getByRole('button', { name: 'Bloquear RA', exact: true }).click();
  const before = await save(page);
  expect(before.hierarchy.placements).toHaveLength(2);
  expect(before.scheduleLock).toBeDefined();
  const revision = structuredClone(source);
  revision.bars[0].quantity = 8;
  revision.drawing.revision = '02';
  dialog = await transfer(page, revision, true);
  await expect(
    dialog.getByLabel('Detalhamento de destino', { exact: true }),
  ).toHaveValue(imported.id);
  await expect(
    dialog.getByLabel('Resumo da comparação', { exact: true }),
  ).toContainText('RA bloqueada será desbloqueada');
  await dialog.screenshot({ path: 'docs/detail-transfer.png' });
  await dialog
    .getByRole('button', { name: 'Aplicar detalhamento', exact: true })
    .click();
  const after = await save(page);
  expect(after.bars).toHaveLength(2);
  expect(after.bars.find((b) => b.id === bar.id)?.quantity).toBe(8);
  expect(after.scheduleLock).toBeUndefined();
  expect(after.hierarchy.placements).toEqual(before.hierarchy.placements);
  expect(after.hierarchy.drawings).toEqual(before.hierarchy.drawings);
  expect(after.sheets).toEqual(before.sheets);
  for (const name of ['Folha 1', 'Folha 1 (cópia)']) {
    await openSheet(page, name);
    await expect(
      page.getByTestId('sheet-view').getByText(/8 x Ø/).first(),
    ).toBeVisible();
  }
  await page
    .locator('.document-tabs')
    .getByRole('button', { name: /Quadro de aço/ })
    .click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2);
  await expect(
    page
      .getByRole('table')
      .locator('tbody tr')
      .filter({ has: page.getByText(bar.mark, { exact: true }) })
      .locator('td')
      .nth(4),
  ).toHaveText('8');
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Desfazer', exact: true })
    .click();
  expect(await save(page)).toEqual(before);
  await page
    .locator('.quick-tools')
    .getByRole('button', { name: 'Refazer', exact: true })
    .click();
  expect(await save(page)).toEqual(after);
  await page.getByTestId('project-input').setInputFiles({
    name: 'aplicado.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(after)),
  });
  expect(await save(page)).toEqual(after);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect(await save(page)).toEqual(after);
  expect(errors).toEqual([]);
});

test('homonymous details select destinations by origin, refuse a wrong floor and never insert duplicate steel', async ({
  page,
}) => {
  const { source, target, first, upper } = fixtures(),
    a = insert(target, source, first),
    b = insert(a.p, source, upper);
  await load(page, b.p);
  await openSheet(page);
  const revision = structuredClone(source);
  revision.bars[0].quantity = 8;
  revision.bars[1].quantity = 100;
  let dialog = await transfer(page, revision, true);
  await dialog
    .getByLabel('Detalhamento de origem', { exact: true })
    .selectOption(upper);
  await expect(
    dialog.getByLabel('Detalhamento de destino', { exact: true }),
  ).toHaveValue(b.id);
  await dialog
    .getByLabel('Detalhamento de destino', { exact: true })
    .selectOption(a.id);
  await expect(
    dialog.getByRole('button', { name: 'Aplicar detalhamento', exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('origem é diferente');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(await save(page)).toEqual(b.p);
  dialog = await transfer(page, revision, true);
  await dialog
    .getByLabel('Detalhamento de origem', { exact: true })
    .selectOption(upper);
  await dialog
    .getByRole('button', { name: 'Aplicar detalhamento', exact: true })
    .click();
  const updated = await save(page);
  expect(
    updated.bars.find((b) => updated.hierarchy.objectDetails[b.id] === a.id)
      ?.quantity,
  ).toBe(2);
  expect(
    updated.bars.find((v) => updated.hierarchy.objectDetails[v.id] === b.id)
      ?.quantity,
  ).toBe(100);
  dialog = await transfer(page, source);
  await expect(dialog.getByRole('alert')).toContainText(
    'Esta origem já existe',
  );
  await expect(
    dialog.getByRole('button', { name: 'Aplicar detalhamento', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(await save(page)).toEqual(updated);
});

test('missing and foreign references require decisions; explicit position mapping preserves external links and isolated editing stays protected', async ({
  page,
}) => {
  const { source, target, first } = fixtures(),
    a = insert(target, source, first),
    oldId = a.p.bars.find(
      (b) => a.p.hierarchy.objectDetails[b.id] === a.id,
    )!.id,
    foreignOwner = a.p.hierarchy.details[0].id;
  const p = completeOwnership({
    ...a.p,
    details: [
      ...a.p.details,
      { id: 'foreign-rep', barId: oldId, origin: { x: 3000, y: 0 } },
    ],
    annotations: [
      ...a.p.annotations,
      {
        id: 'foreign-call',
        kind: 'leader',
        barId: oldId,
        points: [
          { x: 3000, y: 0 },
          { x: 3100, y: 100 },
          { x: 3300, y: 100 },
        ],
        label: '',
        textHeight: 40,
        color: '#777777',
      },
    ],
    hierarchy: {
      ...a.p.hierarchy,
      objectDetails: {
        ...a.p.hierarchy.objectDetails,
        'foreign-rep': foreignOwner,
        'foreign-call': foreignOwner,
      },
    },
  });
  const revised = completeOwnership(
    {
      ...source,
      bars: [
        source.bars[1],
        { ...newBar('N1'), id: 'new-source-id', quantity: 6 },
      ],
      details: [],
      annotations: [],
    },
    first,
  );
  await load(page, p);
  await openSheet(page);
  let dialog = await transfer(page, revised, true);
  await expect(
    dialog.getByRole('region', { name: 'Vínculos a reassociar', exact: true }),
  ).toContainText('2 pendentes');
  await expect(
    dialog.getByRole('button', { name: 'Aplicar detalhamento', exact: true }),
  ).toBeDisabled();
  for (const id of ['foreign-rep', 'foreign-call'])
    await dialog
      .getByLabel(`Resolver vínculo existing:${id}`, { exact: true })
      .selectOption('source:new-source-id');
  await expect(
    dialog.getByRole('button', { name: 'Aplicar detalhamento', exact: true }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(await save(page)).toEqual(p);
  dialog = await transfer(page, revised, true);
  await dialog
    .getByLabel('Preservar posição para N1', { exact: true })
    .selectOption(oldId);
  await expect(
    dialog.getByRole('region', { name: 'Vínculos a reassociar', exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole('button', { name: 'Aplicar detalhamento', exact: true })
    .click();
  let after = await save(page);
  expect(after.bars).toHaveLength(2);
  expect(after.bars.find((b) => b.id === oldId)?.quantity).toBe(6);
  expect(after.details.find((d) => d.id === 'foreign-rep')?.barId).toBe(oldId);
  const orphaned = completeOwnership(
    {
      ...revised,
      annotations: [
        { ...source.annotations[0], id: 'missing-call', barId: 'absent-bar' },
      ],
    },
    first,
  );
  dialog = await transfer(page, orphaned, true);
  await expect(
    dialog.getByRole('button', { name: 'Aplicar detalhamento', exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel('Resolver vínculo incoming:missing-call', { exact: true })
    .selectOption('source:new-source-id');
  await dialog
    .getByRole('button', { name: 'Aplicar detalhamento', exact: true })
    .click();
  after = await save(page);
  expect(after.bars).toHaveLength(2);
  expect(
    after.annotations.every(
      (n) => !n.barId || after.bars.some((b) => b.id === n.barId),
    ),
  ).toBe(true);
  const input = page.getByRole('textbox', { name: 'Comando CAD', exact: true });
  await page
    .locator('.document-strip')
    .getByRole('button', { name: 'Desenho', exact: true })
    .click();
  await input.fill('EDITARDETALHE');
  await input.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Edição isolada', exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Elementos', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Inserir detalhamento', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Atualizar detalhamento', exact: true }),
  ).toBeDisabled();
});
