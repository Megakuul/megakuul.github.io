import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
const server = await createServer({
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { powertoolsGroups } = await server.ssrLoadModule('/src/lib/server/powertools/index.ts');
  const { exampleExport } = await server.ssrLoadModule('/src/lib/powertools/environment.ts');
  writeFileSync(process.argv[2],
    JSON.stringify({
      recipes: powertoolsGroups().flatMap(group => group.recipes),
      environmentExample: exampleExport(
        { name: 'EXAMPLE', example: 'Équipe "quoted" O\'Brien $literal' },
        'windows',
      ),
    }),
  );
} finally {
  await server.close();
}
