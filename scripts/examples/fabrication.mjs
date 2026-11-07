import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const { createFabricationExample } = await server.ssrLoadModule(
    '/docs/examples/fabrication.ts',
  );
  const { schedule, decodeProject } = await server.ssrLoadModule(
    '/src/domain/model.ts',
  );
  const { project } = createFabricationExample();
  const reopened = decodeProject(JSON.stringify(project));
  const output = resolve(
    process.argv[2] ?? 'fabrication-example.armstruct.json',
  );
  await writeFile(output, JSON.stringify(reopened, null, 2) + '\n', 'utf8');
  console.log(
    JSON.stringify(
      {
        output,
        occurrences: reopened.bars.length,
        positions: schedule(reopened).length,
        pieces: schedule(reopened)[0].quantity,
        totalLengthM: schedule(reopened)[0].totalLength,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
