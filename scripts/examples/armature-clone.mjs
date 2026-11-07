import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const { createArmatureCloneExample } = await server.ssrLoadModule(
    '/docs/examples/armature-clone.ts',
  );
  const { schedule, decodeProject } = await server.ssrLoadModule(
    '/src/domain/model.ts',
  );
  const { project } = createArmatureCloneExample();
  const reopened = decodeProject(JSON.stringify(project));
  if (
    reopened.bars.length !== 2 ||
    reopened.bars[0].diameter !== 10 ||
    reopened.bars[1].diameter !== 12.5
  )
    throw new Error('A variante alterou o original.');
  const output = resolve(process.argv[2] ?? 'armature-clone.armstruct.json');
  await writeFile(output, JSON.stringify(reopened, null, 2) + '\n', 'utf8');
  console.log(
    JSON.stringify(
      {
        output,
        physicalBars: reopened.bars.length,
        insertions: reopened.details.length,
        positions: schedule(reopened).map((r) => ({
          mark: r.bar.mark,
          quantity: r.quantity,
          weightKg: r.weight,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
