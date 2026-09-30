import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDemoPdf } from './demo-pdf.mjs';

const directory = new URL('../output/playwright/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('demo.pdf', directory), createDemoPdf());
console.log(fileURLToPath(new URL('demo.pdf', directory)));
