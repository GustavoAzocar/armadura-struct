import { expect, type Page } from '@playwright/test';

/** Wait for the imported drawing's camera before turning model points into clicks. */
export async function waitForCadViewport(page: Page) {
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByTestId('cad-canvas').evaluate(async (svg) => {
    await document.fonts.ready;
    await new Promise<void>((resolve, reject) => {
      let previous = '';
      let frame = 0;
      let settled = 0;
      const finish = (error?: Error) => {
        window.cancelAnimationFrame(frame);
        window.clearTimeout(settled);
        window.clearTimeout(deadline);
        if (error) reject(error);
        else resolve();
      };
      const deadline = window.setTimeout(
        () => finish(new Error('O enquadramento do CAD não estabilizou.')),
        5000,
      );
      const watch = () => {
        const matrix = svg
          .querySelector<SVGGElement>('g[transform]')
          ?.getScreenCTM();
        const rect = svg.getBoundingClientRect();
        const next =
          svg.isConnected && matrix && rect.width > 0 && rect.height > 0
            ? [
                matrix.a,
                matrix.b,
                matrix.c,
                matrix.d,
                matrix.e,
                matrix.f,
                rect.x,
                rect.y,
                rect.width,
                rect.height,
              ].join(',')
            : '';
        if (next !== previous || !next) {
          previous = next;
          window.clearTimeout(settled);
          // The title is rendered before the 50 ms import fit and the
          // ResizeObserver updates. Each camera/layout change restarts this
          // quiet window, so slow layouts wait for their actual final view.
          if (next) settled = window.setTimeout(() => finish(), 100);
        }
        frame = window.requestAnimationFrame(watch);
      };
      watch();
    });
  });
}
