import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const { createArmatureQuantityExample } = await server.ssrLoadModule(
    '/docs/examples/armature-quantities.ts',
  );
  const { schedule } = await server.ssrLoadModule('/src/domain/model.ts');
  const { createDetailPackage, readDetailPackage } = await server.ssrLoadModule(
    '/src/domain/detailPackage.ts',
  );
  const { project, detailId } = createArmatureQuantityExample();
  const pack = createDetailPackage(project, detailId, {
    producer: { app: 'OpenStruct quantity example', version: '1.0' },
    exportedAt: '2026-11-07T13:00:00Z',
  });
  if (schedule(readDetailPackage(pack).project)[0].quantity !== 24)
    throw new Error('Package quantity changed.');
  const output = resolve(
      process.argv[2] ?? 'armature-quantities.armstruct.json',
    ),
    packageOutput =
      output.replace(/(?:\.armstruct)?\.json$/, '') + '.osdetail.json';
  await writeFile(output, JSON.stringify(project, null, 2) + '\n', 'utf8');
  await writeFile(packageOutput, JSON.stringify(pack, null, 2) + '\n', 'utf8');
  console.log(
    JSON.stringify(
      {
        output,
        packageOutput,
        base: project.bars[0].quantity,
        multiplier: project.bars[0].multiplier,
        repetitions: 4,
        views: 2,
        effectiveQuantity: schedule(project)[0].quantity,
        weightKg: schedule(project)[0].weight,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
