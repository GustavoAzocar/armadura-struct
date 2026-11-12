// Separate diagnostic run: tracing changes cost, so never pool it with throughput samples.
import { chromium } from '@playwright/test';
import { createServer, preview } from 'vite';
import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
const output = 'docs/performance/render148';
const loader = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
const { performanceScene } = await loader.ssrLoadModule(
  '/tests/performanceScene.ts',
);
const { fixtures } = await import('./render148-scenes.mjs');
const { parseDxf } = await loader.ssrLoadModule('/src/cad/import.ts');
const { emptyProject, decodeProject } = await loader.ssrLoadModule(
  '/src/domain/model.ts',
);
const { completeOwnership } = await loader.ssrLoadModule(
  '/src/domain/hierarchy.ts',
);
const representative = performanceScene();
const precision = emptyProject();
precision.id = 'study:precision-diagnostic';
const mask = parseDxf(fixtures().precisionFar, 'precisionFar.dxf');
mask.id = 'study:precision:mask';
precision.masks = [mask];
const p = decodeProject(JSON.stringify(completeOwnership(precision)));
await loader.close();
const server = await preview({
  preview: { port: 1420, host: '127.0.0.1', strictPort: true },
});
const browser = await chromium.launch({
  executablePath: process.env.ARMSTRUCT_CHROMIUM ?? '/usr/bin/chromium',
  args: JSON.parse(process.env.ARMSTRUCT_CHROMIUM_ARGS ?? '["--no-sandbox"]'),
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
  cdp = await page.context().newCDPSession(page);
const load = async (project) => {
  await page.getByTestId('project-input').setInputFiles({
    name: 'diagnostic.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  const cmd = page.getByRole('textbox', { name: 'Comando CAD' });
  await cmd.fill('F');
  await cmd.press('Enter');
  await page.waitForTimeout(1000);
};
try {
  await page.goto('http://127.0.0.1:1420');
  await page.locator('.busy-overlay').waitFor({ state: 'hidden' });
  await load(p);
  const path = page
    .locator('[data-mask-id="study:precision:mask"] path')
    .first();
  const before = await path.evaluate((el) => ({
    length: el.getTotalLength(),
    bbox: Object.fromEntries(
      ['x', 'y', 'width', 'height'].map((k) => [k, el.getBBox()[k]]),
    ),
    d: el.getAttribute('d'),
    ctm: Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => [k, el.getScreenCTM()[k]]),
    ),
  }));
  await page.screenshot({
    path: `${output}/armadura-precisionFar-original.png`,
  });
  // Rebase derived SVG only; no project update/commit, no new renderer in production.
  await page.evaluate(
    (points) => {
      const path = document.querySelector(
        '[data-mask-id="study:precision:mask"] path',
      );
      const g = path.parentElement.parentElement,
        m = g.transform.baseVal.consolidate().matrix;
      path.setAttribute(
        'd',
        points
          .map((ps) =>
            ps
              .map((p, i) => `${i ? 'L' : 'M'}${p.x - 1e8},${p.y - 1e8}`)
              .join(' '),
          )
          .join(' '),
      );
      g.setAttribute(
        'transform',
        `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e + 1e8 * m.a + 1e8 * m.c} ${m.f + 1e8 * m.b + 1e8 * m.d})`,
      );
    },
    p.masks[0].primitives.map((p) => p.points),
  );
  await page.waitForTimeout(200);
  const after = await path.evaluate((el) => ({
    length: el.getTotalLength(),
    bbox: Object.fromEntries(
      ['x', 'y', 'width', 'height'].map((k) => [k, el.getBBox()[k]]),
    ),
    ctm: Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => [k, el.getScreenCTM()[k]]),
    ),
  }));
  await page.screenshot({
    path: `${output}/armadura-precisionFar-rebased.png`,
  });
  await writeFile(
    `${output}/precision-diagnostic.json`,
    JSON.stringify(
      {
        method: 'DOM-only translation of derived SVG, project unchanged',
        expectedLength: 100 * Math.sqrt(13),
        before,
        after,
      },
      null,
      2,
    ) + '\n',
  );
  await load(representative);
  const canvas = page.getByTestId('cad-canvas'),
    box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'middle' });
  await cdp.send('Tracing.start', {
    categories:
      'devtools.timeline,cc,gpu,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame',
    transferMode: 'ReturnAsStream',
  });
  for (let i = 0; i < 30; i++)
    await page.mouse.move(
      box.x + box.width / 2 + Math.sin(i * 0.22) * 150,
      box.y + box.height / 2 + Math.cos(i * 0.17) * 110,
    );
  await page.mouse.up({ button: 'middle' });
  const done = new Promise((resolve) =>
    cdp.once('Tracing.tracingComplete', resolve),
  );
  await cdp.send('Tracing.end');
  const { stream } = await done;
  let text = '';
  while (true) {
    const r = await cdp.send('IO.read', { handle: stream });
    text += r.base64Encoded ? Buffer.from(r.data, 'base64').toString() : r.data;
    if (r.eof) break;
  }
  await cdp.send('IO.close', { handle: stream });
  await writeFile(`${output}/armadura-pan-trace.json.gz`, gzipSync(text));
  const trace = JSON.parse(text),
    groups = {};
  for (const e of trace.traceEvents ?? [])
    if (e.ph === 'X' && e.dur) {
      const key = `${e.pid}/${e.tid} ${e.name}`;
      groups[key] ??= {
        event: e.name,
        pid: e.pid,
        tid: e.tid,
        count: 0,
        durationMs: 0,
      };
      groups[key].count++;
      groups[key].durationMs += e.dur / 1000;
    }
  await writeFile(
    `${output}/trace-summary.json`,
    JSON.stringify(
      {
        method:
          'sum of complete event durations per process/thread/name; nested and parallel categories must not be summed as wall time',
        events: Object.values(groups).sort(
          (a, b) => b.durationMs - a.durationMs,
        ),
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
