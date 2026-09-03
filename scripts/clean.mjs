import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

try {
  fs.rmSync(dist, { recursive: true, force: true });
  console.log('Removed dist/');
} catch (e) {
  const err = /** @type {NodeJS.ErrnoException} */ (e);
  if (err.code !== 'ENOENT') throw err;
}
