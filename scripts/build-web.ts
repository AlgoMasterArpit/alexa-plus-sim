import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const source = new URL('web/', root);
const output = new URL('build/web/', root);

await mkdir(output, { recursive: true });

await build({
  entryPoints: [fileURLToPath(new URL('main.ts', source))],
  outfile: fileURLToPath(new URL('app.js', output)),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  legalComments: 'none',
});

await Promise.all(
  ['index.html', 'styles.css', 'favicon.svg'].map((file) =>
    copyFile(new URL(file, source), new URL(file, output)),
  ),
);

process.stdout.write('Built build/web\n');
