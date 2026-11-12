import { chromium } from '@playwright/test';
import { createServer, preview } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { cpus, totalmem, platform, release } from 'node:os';
import { execFileSync } from 'node:child_process';
import { SourceMap } from 'node:module';

// Run against the SAME production build/viewport/browser before and after a change.
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')),
);
const url = args.url ?? 'http://127.0.0.1:1420';
const samples = Number(args.samples ?? 60),
  repeats = Number(args.repeats ?? 3);
const output = resolve(args.output ?? 'test-results/cad-benchmark.json');
const loader = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
const { performanceScene } = await loader.ssrLoadModule(
  '/tests/performanceScene.ts',
);
const { emptyProject, decodeProject } = await loader.ssrLoadModule(
  '/src/domain/model.ts',
);
const requestedSnapModes = args['snap-modes']?.split(',').filter(Boolean);
const snapDefinitions = requestedSnapModes
  ? (await loader.ssrLoadModule('/src/domain/objectSnaps.ts')).snapModeLabels
  : undefined;
if (requestedSnapModes?.some((mode) => !Object.hasOwn(snapDefinitions, mode)))
  throw new Error('Modo de encaixe desconhecido em --snap-modes.');
const scenes = {
  empty: emptyProject(),
  large: performanceScene(),
  'large-no-mask': performanceScene(false),
};
await loader.close();
const buildDir = resolve(args.dist ?? 'dist');
const serving = args.url
  ? null
  : await preview({
      build: { outDir: buildDir },
      preview: { host: '127.0.0.1', port: 1420, strictPort: true },
    });
const browser = await chromium.launch({
  executablePath: process.env.ARMSTRUCT_CHROMIUM,
  args: JSON.parse(process.env.ARMSTRUCT_CHROMIUM_ARGS ?? '[]'),
});
const system = await (
  await browser.newBrowserCDPSession()
).send('SystemInfo.getInfo');
const result = {
  label: args.label ?? 'measurement',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  environment: {
    system: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    browser: browser.version(),
    graphics: {
      devices: system.gpu.devices,
      features: system.gpu.featureStatus,
    },
    node: process.version,
    url,
    viewport: { width: 1600, height: 1000 },
    samples,
    repeats,
    snapModes: requestedSnapModes ?? ['endpoint', 'midpoint'],
  },
  scenes: {},
};
const stats = (a) => {
  const s = [...a].sort((a, b) => a - b);
  return {
    count: s.length,
    median: s[Math.floor(s.length * 0.5)] ?? 0,
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? 0,
    max: s.at(-1) ?? 0,
  };
};
const maps = new Map();
async function summarizeProfile(profile) {
  const counts = new Map();
  for (let i = 0; i < (profile.samples?.length ?? 0); i++)
    counts.set(
      profile.samples[i],
      (counts.get(profile.samples[i]) ?? 0) + profile.timeDeltas[i],
    );
  const merged = new Map();
  for (const n of profile.nodes) {
    const frame = n.callFrame;
    let key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').at(-1)}:${frame.lineNumber + 1}`;
    if (frame.url.includes('/assets/')) {
      const file = resolve(
        buildDir,
        `assets/${frame.url.split('/').at(-1)}.map`,
      );
      if (!maps.has(file)) {
        try {
          maps.set(
            file,
            new SourceMap(JSON.parse(await readFile(file, 'utf8'))),
          );
        } catch {
          maps.set(file, null);
        }
      }
      if (maps.get(file)) {
        const p = maps
          .get(file)
          .findEntry(frame.lineNumber, frame.columnNumber);
        if (p.originalSource)
          key = `${p.name ?? frame.functionName} ${p.originalSource}:${p.originalLine + 1}`;
      }
    }
    merged.set(key, (merged.get(key) ?? 0) + (counts.get(n.id) ?? 0) / 1000);
  }
  return [...merged]
    .map(([frame, selfMs]) => ({ frame, selfMs }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 24);
}
try {
  for (const [name, raw] of Object.entries(scenes)) {
    if (args.scene && name !== args.scene) continue;
    const p = decodeProject(JSON.stringify(raw));
    const page = await browser.newPage({
      viewport: result.environment.viewport,
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.locator('.busy-overlay').waitFor({ state: 'hidden' });
    await page.getByTestId('project-input').setInputFiles({
      name: `${name}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(p)),
    });
    await page
      .locator('.document-tabs')
      .getByRole('button', { name: 'Desenho', exact: true })
      .click();
    await page.getByTestId('cad-canvas').waitFor();
    if (requestedSnapModes) {
      await page
        .locator('.status-toggles')
        .getByRole('button', { name: 'Modos de encaixe', exact: true })
        .click();
      const dialog = page.getByRole('dialog', {
        name: 'Modos de encaixe',
        exact: true,
      });
      for (const [mode, label] of Object.entries(snapDefinitions))
        await dialog
          .getByRole('checkbox', { name: label, exact: true })
          .setChecked(requestedSnapModes.includes(mode));
      await dialog
        .getByRole('button', { name: 'Aplicar modos', exact: true })
        .click();
    }
    await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
    await page
      .getByRole('button', { name: 'Ajustar à tela', exact: true })
      .last()
      .click();
    await page.waitForTimeout(1000); // finish import, fonts and autosave before timing interactions
    const canvas = page.getByTestId('cad-canvas'),
      box = await canvas.boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    await page.evaluate(() => {
      window.__cadMeasure = {
        frames: [],
        inputs: [],
        longTasks: [],
        writes: 0,
        running: false,
      };
      const m = window.__cadMeasure;
      let last = performance.now();
      const frame = (now) => {
        if (m.running) m.frames.push(now - last);
        last = now;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      for (const type of ['pointermove', 'wheel', 'pointerdown', 'pointerup'])
        document.querySelector('[data-testid="cad-canvas"]').addEventListener(
          type,
          (e) => {
            if (!m.running) return;
            const start = e.timeStamp;
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                if (m.running) m.inputs.push(performance.now() - start);
              }),
            );
          },
          { capture: true },
        );
      new PerformanceObserver((list) => {
        if (m.running)
          m.longTasks.push(...list.getEntries().map((e) => e.duration));
      }).observe({ type: 'longtask' });
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (m.running) m.writes++;
        return put.apply(this, args);
      };
    });
    const description = {
      bytes: Buffer.byteLength(JSON.stringify(p)),
      bars: p.bars.length,
      representations: p.details.length,
      masks: p.masks.length,
      maskPrimitives: p.masks.reduce((n, m) => n + m.primitives.length, 0),
      maskPoints: p.masks.reduce(
        (n, m) => n + m.primitives.reduce((n, q) => n + q.points.length, 0),
        0,
      ),
      svgElements: await canvas.locator('*').count(),
      actions: {},
      errors,
    };
    result.scenes[name] = description;
    const actions = args.actions?.split(',') ?? [
      'cursor-snap',
      'cursor-no-snap',
      'pan',
      'zoom',
      'marquee',
    ];
    for (const action of actions) {
      if (
        ['click', 'grip'].includes(action) &&
        !p.bars.some((b) => b.kind === 'free')
      )
        continue;
      // Open one drawing outside the timed interval, then measure switching its tab.
      if (action === 'switch-drawing') {
        await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
        await page.locator('.hierarchy-drawing').first().click();
        await page
          .locator('.document-tabs')
          .getByRole('button', { name: 'Desenho', exact: true })
          .click();
      }
      const data = [];
      for (let r = 0; r < repeats; r++) {
        const snap = page
          .locator('.status-toggles button')
          .filter({ hasText: 'ENCAIXES' });
        if (
          ((await snap.getAttribute('class')) === 'active') !==
          (action !== 'cursor-no-snap')
        )
          await snap.click();
        await page.mouse.move(x, y);
        await page.waitForTimeout(100);
        let target;
        if (['click', 'grip'].includes(action)) {
          const bar = p.bars.find((b) => b.kind === 'free');
          await page.getByRole('tab', { name: 'Projeto', exact: true }).click();
          if (action === 'grip') {
            await page
              .locator('.bar-row')
              .filter({ has: page.getByText(bar.mark, { exact: true }) })
              .click();
            const grip = page.locator(`[data-bar-id="${bar.id}"] rect`).first();
            const gripBox = await grip.boundingBox();
            if (!gripBox)
              throw new Error(`No editable grip for ${name}/${bar.id}`);
            target = {
              x: gripBox.x + gripBox.width / 2,
              y: gripBox.y + gripBox.height / 2,
            };
          } else {
            target = await page
              .locator(`[data-bar-id="${bar.id}"] > path`)
              .last()
              .evaluate((path) => {
                const local = path.getPointAtLength(
                  path.getTotalLength() * 0.4,
                );
                const p = new DOMPoint(local.x, local.y).matrixTransform(
                  path.getScreenCTM(),
                );
                return { x: p.x, y: p.y };
              });
          }
          await page.mouse.move(target.x, target.y);
          await page.waitForTimeout(600);
          if (action === 'grip') await page.mouse.down();
        }
        if (action === 'pan') await page.mouse.down({ button: 'middle' });
        if (action === 'marquee') {
          await page.mouse.move(box.x + 10, box.y + 10);
          await page.mouse.down();
        }
        const metricsBefore = Object.fromEntries(
          (await cdp.send('Performance.getMetrics')).metrics.map((v) => [
            v.name,
            v.value,
          ]),
        );
        await page.evaluate(() => {
          const m = window.__cadMeasure;
          m.frames = [];
          m.inputs = [];
          m.longTasks = [];
          m.writes = 0;
          m.running = true;
        });
        await cdp.send('Profiler.start');
        const start = performance.now();
        const dispatchMs = [];
        for (let i = 0; i < samples; i++) {
          const t = performance.now();
          if (action === 'click') await page.mouse.click(target.x, target.y);
          else if (action === 'grip')
            await page.mouse.move(
              target.x + (12 * (i + 1)) / samples,
              target.y + Math.sin(((i + 1) / samples) * Math.PI) * 6,
            );
          else if (action === 'switch-drawing')
            await page
              .locator('.document-tabs')
              .getByRole('button', {
                name: i % 2 ? 'Desenho' : /^Aba desenho /,
              })
              .first()
              .click();
          else if (action === 'zoom')
            await page.mouse.wheel(0, i % 2 ? 20 : -20);
          else
            await page.mouse.move(
              x + Math.sin(i * 0.22) * 150,
              y + Math.cos(i * 0.17) * 110,
            );
          dispatchMs.push(performance.now() - t);
        }
        if (action === 'pan') await page.mouse.up({ button: 'middle' });
        if (action === 'marquee' || action === 'grip') await page.mouse.up();
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const elapsedMs = performance.now() - start;
        const { profile } = await cdp.send('Profiler.stop');
        const m = await page.evaluate(() => {
          window.__cadMeasure.running = false;
          return window.__cadMeasure;
        });
        const metricsAfter = Object.fromEntries(
          (await cdp.send('Performance.getMetrics')).metrics.map((v) => [
            v.name,
            v.value,
          ]),
        );
        const measurement = {
          elapsedMs,
          dispatchMs: stats(dispatchMs),
          frameMs: stats(m.frames),
          inputToTwoFramesMs: stats(m.inputs),
          longTasks: stats(m.longTasks),
          writes: m.writes,
          cpuMs: Object.fromEntries(
            [
              'ScriptDuration',
              'TaskDuration',
              'LayoutDuration',
              'RecalcStyleDuration',
            ].map((k) => [k, (metricsAfter[k] - metricsBefore[k]) * 1000]),
          ),
          profile: await summarizeProfile(profile),
        };
        data.push(measurement);
        console.log(
          JSON.stringify({
            scene: name,
            action,
            repeat: r + 1,
            frames: measurement.frameMs,
            cpu: measurement.cpuMs.ScriptDuration,
            longTasks: measurement.longTasks.count,
          }),
        );
        if (action === 'grip') {
          await page
            .locator('.quick-tools')
            .getByRole('button', { name: 'Desfazer', exact: true })
            .click();
          await page.waitForTimeout(700);
        }
      }
      description.actions[action] = data;
    }
    await page.close();
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  }
} finally {
  await browser.close();
  await new Promise((resolve) =>
    serving ? serving.httpServer.close(resolve) : resolve(),
  );
}
console.log(output);
