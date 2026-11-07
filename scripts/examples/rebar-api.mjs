import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

// Vite loads the TypeScript source in Node; the domain itself has no React/browser imports.
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const { createRebarApiExample } = await server.ssrLoadModule(
    '/docs/examples/rebar-api.ts',
  );
  const { schedule } = await server.ssrLoadModule('/src/domain/model.ts');
  const { project, result } = createRebarApiExample();
  const output = resolve(process.argv[2] ?? 'rebar-example.armstruct.json');
  await writeFile(output, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        output,
        operations: result.receipt.operations.length,
        positions: project.bars.length,
        pieces: schedule(project).reduce((n, r) => n + r.quantity, 0),
        weightKg: schedule(project).reduce((n, r) => n + r.weight, 0),
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
