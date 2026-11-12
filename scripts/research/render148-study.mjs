import { chromium } from '@playwright/test';
import { createServer, preview } from 'vite';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { cpus, totalmem, platform, release } from 'node:os';
import { fixtures } from './render148-scenes.mjs';

const output = 'docs/performance/render148';
const opts = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')),
);
const apps = (opts.apps ?? 'armadura,cadcraft').split(',');
const names = (
  opts.scenes ?? 'small,medium,large,quality,precisionOrigin,precisionFar'
).split(',');
const samples = Number(opts.samples ?? 60),
  repeats = Number(opts.repeats ?? 3),
  dpr = Number(opts.dpr ?? 1);
const resultFile = `${output}/common${opts.label ? '-' + opts.label : ''}.json`;
await mkdir(output, { recursive: true });
const loader = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
const { parseDxf } = await loader.ssrLoadModule('/src/cad/import.ts');
const { emptyProject, decodeProject } = await loader.ssrLoadModule(
  '/src/domain/model.ts',
);
const { completeOwnership } = await loader.ssrLoadModule(
  '/src/domain/hierarchy.ts',
);
const { toDxf, toPdf } = await loader.ssrLoadModule('/src/lib/exports.ts');
const projects = {},
  descriptions = {},
  all = fixtures();
for (const name of names) {
  const text = all[name],
    start = performance.now(),
    mask = parseDxf(text, `${name}.dxf`);
  mask.id = `study:${name}:mask`;
  mask.opacity = 1; // Normalize the common payload, unlike the representative default-mask run.
  const p = emptyProject();
  p.id = `study:${name}`;
  p.name = `Render study ${name}`;
  p.masks = [mask];
  projects[name] = decodeProject(JSON.stringify(completeOwnership(p)));
  descriptions[name] = {
    sha256: createHash('sha256').update(text).digest('hex'),
    bytes: Buffer.byteLength(text),
    primitives: mask.primitives.length,
    points: mask.primitives.reduce((n, p) => n + p.points.length, 0),
    warnings: mask.warnings,
    maskOpacity: mask.opacity,
    nodeParseAndProjectMs: performance.now() - start,
  };
  await writeFile(`${output}/${name}.dxf.gz`, gzipSync(text, { mtime: 0 }));
  if (name === 'quality') {
    await writeFile(
      `${output}/armadura-quality-export.dxf`,
      toDxf(projects[name]),
    );
    await writeFile(
      `${output}/armadura-quality-export.pdf`,
      Buffer.from(toPdf(projects[name])),
    );
    const circles = mask.primitives.filter(
      (p) => p.closed && p.points.length > 30,
    );
    descriptions[name].circleChecks = circles.map((p) => ({
      points: p.points.length,
      analyticChordErrorAtR300:
        300 * (1 - Math.cos(Math.PI / (p.points.length - 1))),
    }));
  }
}
await loader.close();
const server = apps.includes('armadura')
  ? await preview({
      preview: { port: 1420, host: '127.0.0.1', strictPort: true },
    })
  : null;
const browser = await chromium.launch({
  executablePath: process.env.ARMSTRUCT_CHROMIUM ?? '/usr/bin/chromium',
  args: JSON.parse(process.env.ARMSTRUCT_CHROMIUM_ARGS ?? '["--no-sandbox"]'),
});
const system = await (
  await browser.newBrowserCDPSession()
).send('SystemInfo.getInfo');
const result = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  cadcraft: {
    version: '0.20.1',
    commit: '7526dc62c14e71b3c8d46e73bbf1fa29ef506af1',
    webZipSha256:
      '300e870c50b66d371055915ba95e3ddbfd4c45431466d5214743b5dcab95a0e1',
  },
  environment: {
    cpu: cpus()[0].model,
    cpus: cpus().length,
    memory: totalmem(),
    os: `${platform()} ${release()}`,
    browser: browser.version(),
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: dpr,
    gpu: system.gpu,
    flags: process.env.ARMSTRUCT_CHROMIUM_ARGS ?? '["--no-sandbox"]',
    samples,
    repeats,
  },
  fixtures: descriptions,
  runs: [],
};
const stats = (values) => {
  const a = [...values].sort((a, b) => a - b);
  return {
    count: a.length,
    median: a[Math.floor(a.length * 0.5)] ?? null,
    p95: a[Math.min(a.length - 1, Math.floor(a.length * 0.95))] ?? null,
    max: a.at(-1) ?? null,
  };
};
const twoFrames = (page) =>
  page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
try {
  for (const app of apps)
    for (const name of names) {
      const context = await browser.newContext({
        viewport: result.environment.viewport,
        deviceScaleFactor: dpr,
      });
      const page = await context.newPage(),
        errors = [];
      await page.addInitScript(() =>
        window.addEventListener('TrunkApplicationStarted', (e) => {
          window.studyWasm = e.detail?.wasm;
        }),
      );
      page.on('pageerror', (e) => errors.push(e.message));
      if (app === 'cadcraft')
        await page.route('http://127.0.0.1:1421/', async (r) => {
          const response = await r.fetch();
          await r.fulfill({
            response,
            body: (await response.text()).replace(
              '<canvas id="cadcraft_canvas"',
              '<canvas data-host="page" id="cadcraft_canvas"',
            ),
          });
        });
      const boot = performance.now();
      await page.goto(
        app === 'armadura' ? 'http://127.0.0.1:1420' : 'http://127.0.0.1:1421/',
      );
      if (app === 'armadura')
        await page.locator('.busy-overlay').waitFor({ state: 'hidden' });
      else await page.waitForFunction(() => window.cadcraft);
      const startupProxyMs = performance.now() - boot,
        open = performance.now();
      let canvas, box, inspect;
      if (app === 'armadura') {
        await page.getByTestId('project-input').setInputFiles({
          name: `${name}.json`,
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify(projects[name])),
        });
        await page
          .locator(`[data-mask-id="study:${name}:mask"] path`)
          .first()
          .waitFor({ state: 'attached' });
        const cmd = page.getByRole('textbox', { name: 'Comando CAD' });
        await cmd.fill('F');
        await cmd.press('Enter');
        const snap = page
          .locator('.status-toggles button')
          .filter({ hasText: 'ENCAIXES' });
        if ((await snap.getAttribute('class')) === 'active') await snap.click();
        canvas = page.getByTestId('cad-canvas');
        box = await canvas.boundingBox();
        inspect = {
          svgElements: await canvas.locator('*').count(),
          paths: await canvas.locator('path').count(),
          texts: await canvas.locator('text').count(),
        };
      } else {
        await page.evaluate(
          (text) =>
            document.getElementById('cadcraft_canvas').dispatchEvent(
              new CustomEvent('cadcraft:open', {
                detail: {
                  name: 'study.dxf',
                  bytes: new TextEncoder().encode(text),
                },
              }),
            ),
          all[name],
        );
        await page.waitForFunction(
          async () => (await window.cadcraft.docInspect()).entityCount > 0,
        );
        const info = await page.evaluate(async () => ({
          doc: await cadcraft.docInspect({ entities: false }),
          ui: await cadcraft.uiInspect(),
        }));
        const a = info.ui.canvasRect;
        box = { x: a[0], y: a[1], width: a[2], height: a[3] };
        inspect = info;
        canvas = page.locator('#cadcraft_canvas');
      }
      await twoFrames(page);
      const openToReadyProxyMs = performance.now() - open;
      await page.waitForTimeout(1000); // fonts, opening work and recovery writes settle
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await twoFrames(page);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      const heap = await cdp.send('Runtime.getHeapUsage');
      const wasmMemoryBytes = await page.evaluate(
        () => window.studyWasm?.memory?.buffer?.byteLength ?? null,
      );
      const run = {
        app,
        scene: name,
        startupProxyMs,
        openToReadyProxyMs,
        canvas: box,
        inspect,
        heap,
        wasmMemoryBytes,
        errors,
        actions: {},
      };
      result.runs.push(run);
      await page.evaluate(() => {
        const m = (window.study = {
          running: false,
          frames: [],
          events: [],
          longTasks: [],
        });
        let last = performance.now();
        const frame = (now) => {
          if (m.running) m.frames.push(now - last);
          last = now;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        new PerformanceObserver((list) => {
          if (m.running)
            m.longTasks.push(...list.getEntries().map((e) => e.duration));
        }).observe({ type: 'longtask' });
        for (const type of ['pointermove', 'wheel'])
          window.addEventListener(
            type,
            (e) => {
              if (m.running)
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    if (m.running)
                      m.events.push(performance.now() - e.timeStamp);
                  }),
                );
            },
            { capture: true },
          );
      });
      if (['small', 'medium', 'large'].includes(name))
        for (const action of ['pan', 'zoom']) {
          run.actions[action] = [];
          for (let repeat = 0; repeat < repeats; repeat++) {
            await page.mouse.move(
              box.x + box.width * 0.5,
              box.y + box.height * 0.5,
            );
            await page.waitForTimeout(150);
            if (action === 'pan') await page.mouse.down({ button: 'middle' });
            const before = Object.fromEntries(
              (await cdp.send('Performance.getMetrics')).metrics.map((v) => [
                v.name,
                v.value,
              ]),
            );
            await page.evaluate(() =>
              Object.assign(window.study, {
                running: true,
                frames: [],
                events: [],
                longTasks: [],
              }),
            );
            const t = performance.now();
            for (let i = 0; i < samples; i++)
              if (action === 'zoom')
                await page.mouse.wheel(0, i % 2 ? 20 : -20);
              else
                await page.mouse.move(
                  box.x + box.width * 0.5 + Math.sin(i * 0.22) * 150,
                  box.y + box.height * 0.5 + Math.cos(i * 0.17) * 110,
                );
            if (action === 'pan') await page.mouse.up({ button: 'middle' });
            await twoFrames(page);
            const elapsed = performance.now() - t,
              raw = await page.evaluate(() => {
                window.study.running = false;
                return window.study;
              });
            const after = Object.fromEntries(
              (await cdp.send('Performance.getMetrics')).metrics.map((v) => [
                v.name,
                v.value,
              ]),
            );
            const sample = {
              elapsed,
              frameMs: stats(raw.frames),
              inputToTwoFramesMs: stats(raw.events),
              longTasks: stats(raw.longTasks),
              cpuMs: Object.fromEntries(
                [
                  'ScriptDuration',
                  'TaskDuration',
                  'LayoutDuration',
                  'RecalcStyleDuration',
                ].map((k) => [k, (after[k] - before[k]) * 1000]),
              ),
              raw,
            };
            if (app === 'cadcraft')
              sample.perfAfter = (
                await page.evaluate(() => cadcraft.uiInspect())
              ).perf;
            run.actions[action].push(sample);
            console.log(app, name, action, repeat + 1, sample.frameMs.p95);
          }
        }
      if (['quality', 'precisionOrigin', 'precisionFar'].includes(name)) {
        await page.mouse.move(2, 2);
        await twoFrames(page);
        await page.screenshot({
          path: `${output}/${app}-${name}-dpr${dpr}.png`,
        });
        if (name === 'quality') {
          await page.setViewportSize({ width: 1366, height: 768 });
          await twoFrames(page);
          await page.screenshot({
            path: `${output}/${app}-${name}-resize-dpr${dpr}.png`,
          });
        }
      }
      if (name === 'quality') {
        await page.mouse.move(
          box.x + box.width * 0.5,
          box.y + box.height * 0.5,
        );
        for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -1000);
        await twoFrames(page);
        run.extremeZoom =
          app === 'cadcraft'
            ? await page.evaluate(() => cadcraft.uiInspect())
            : await page
                .getByTestId('cad-canvas')
                .locator('g[transform]')
                .first()
                .getAttribute('transform');
      }
      await writeFile(resultFile, JSON.stringify(result, null, 2) + '\n');
      await context.close();
    }
} finally {
  await browser.close();
  if (server) await new Promise((r) => server.httpServer.close(r));
}
