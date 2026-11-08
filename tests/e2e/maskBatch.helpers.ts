import { expect, type Page } from '@playwright/test';
export async function confirmMaskImport(page: Page) {
  const dialog = page.getByRole('dialog', {
    name: 'Importar máscaras em lote',
    exact: true,
  });
  await dialog
    .getByRole('button', { name: 'Ler arquivos', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toContainText('1 prontos', {
    timeout: 65000,
  });
  for (const checkbox of await dialog
    .getByRole('checkbox', { name: /Confirmar unidade do arquivo/ })
    .all())
    await checkbox.check();
  await dialog
    .getByRole('button', { name: 'Aplicar lote', exact: true })
    .click();
  const receipt = page.getByRole('dialog', {
    name: 'Resultado das máscaras',
    exact: true,
  });
  await receipt
    .getByRole('button', { name: /Abrir resultado:/ })
    .first()
    .click();
}
