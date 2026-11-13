import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { cpus, platform, release } from 'node:os';
import { execFileSync } from 'node:child_process';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')),
);
const root = resolve(args.root ?? '.');
const output = resolve(args.output ?? 'test-results/cad-interaction.json');
const loader = await createServer({
  root,
  server: { middlewareMode: true },
  appType: 'custom',
});
const fixture = await loader.ssrLoadModule('/tests/performanceScene.ts');
const model = await loader.ssrLoadModule('/src/domain/model.ts');
const masks = await loader.ssrLoadModule('/src/domain/maskManipulation.ts');
const imported = await loader.ssrLoadModule('/src/cad/import.ts');
const transforms = await loader.ssrLoadModule('/src/domain/transforms.ts');
const drawing = await loader.ssrLoadModule('/src/domain/drawingPrimitives.ts');
const prepared = typeof masks.prepareWholeMaskMovePreview === 'function';
const presentation = prepared
  ? await loader.ssrLoadModule('/src/lib/cadPreview.ts')
  : undefined;
await loader.close();
const p = model.decodeProject(JSON.stringify(fixture.performanceScene()));
const mask = p.masks[0],
  context = { key: 'model', detailId: p.hierarchy.objectDetails[mask.id] };
const started = performance.now();
const reach = imported.maskPrimitives(mask);
const preview = prepared
  ? masks.prepareWholeMaskMovePreview(p, mask.id, context)
  : undefined;
const cachedPaths = presentation?.prepareCadPreview(reach);
const preparationMs = performance.now() - started;
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    median: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted.at(-1),
  };
};
const measure = (run) => {
  const series = [];
  for (let r = 0; r < 3; r++) {
    const rawMs = [];
    for (let i = -10; i < 60; i++) {
      const start = performance.now();
      run(i);
      if (i >= 0) rawMs.push(performance.now() - start);
    }
    series.push({ ...stats(rawMs), rawMs });
  }
  return series;
};
const maskMove = measure((i) => {
  const delta = { x: 250 + i * 4, y: -50 + i * 3 };
  if (preview) {
    preview(delta);
    // CadCanvas changes only this pose; its child geometry remains memoized.
    return `translate(${delta.x} ${delta.y})`;
  }
  masks.previewWholeMaskMove(p, mask.id, context, delta);
  return reach.map((q) => ({
    ...q,
    points: q.points.map((a) => ({ x: a.x + delta.x, y: a.y + delta.y })),
  }));
});
const rotation = {};
for (const count of [1, 400]) {
  const ids = p.bars.slice(0, count).map((b) => b.id);
  rotation[count] = measure((i) => {
    const info = transforms.selectionTransformIds(p, ids, true);
    const next = transforms.transformSelection(
      p,
      ids,
      { kind: 'rotate', base: { x: 15000, y: 12000 }, angle: 37 + i * 0.2 },
      { associated: true, layerContext: 'model' },
    );
    const chosen = new Set(info.ids);
    return drawing.drawingPrimitives(
      {
        ...next,
        bars: next.bars.filter((o) => chosen.has(o.id)),
        details: next.details.filter((o) => chosen.has(o.id)),
        masks: next.masks.filter((o) => chosen.has(o.id)),
        annotations: next.annotations.filter((o) => chosen.has(o.id)),
        polylines: next.polylines.filter((o) => chosen.has(o.id)),
        weldedMeshes: (next.weldedMeshes ?? []).filter((o) => chosen.has(o.id)),
      },
      next,
    );
  });
}
const result = {
  label: args.label ?? 'measurement',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
    ? 'modified'
    : 'clean',
  environment: {
    node: process.version,
    system: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
  },
  scope:
    'Node-only steady preview preparation. Excludes React reconciliation, paint, rasterization, GPU, native WebView and physical latency. No FPS claim.',
  scene: { bars: 400, representations: 400, maskPrimitives: 20000 },
  prepared,
  preparationMs,
  temporaryPathCount: cachedPaths
    ? cachedPaths.filter((p) => p.kind === 'path').length
    : reach.filter((p) => !p.text).length,
  maskMove,
  rotation,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      label: result.label,
      prepared,
      preparationMs,
      maskMove: maskMove.map(({ rawMs, ...summary }) => summary),
      rotation: Object.fromEntries(
        Object.entries(rotation).map(([k, v]) => [
          k,
          v.map(({ rawMs, ...summary }) => summary),
        ]),
      ),
      temporaryPathCount: result.temporaryPathCount,
    },
    null,
    2,
  ),
);
