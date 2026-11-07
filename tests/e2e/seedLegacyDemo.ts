/** Small, explicit fixture for existing CAD interaction tests. */
import { expect, type Page } from '@playwright/test';
import { demoProject } from '../../src/domain/model';
export async function seedLegacyDemo(page: Page) {
  const fixture = demoProject();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('project-input').setInputFiles({
    name: 'cad-interaction-fixture.armstruct.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
  // Some navigation tests reload immediately; wait for this fixture's actual recovery write.
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const request = indexedDB.open('armadurastruct', 1);
          request.onsuccess = () => resolve(request.result);
        });
        const raw = await new Promise<string | undefined>((resolve) => {
          const request = db
            .transaction('projects')
            .objectStore('projects')
            .get('current');
          request.onsuccess = () => resolve(request.result);
        });
        db.close();
        return raw ? JSON.parse(raw).id === id : false;
      }, fixture.id),
    )
    .toBe(true);
}
