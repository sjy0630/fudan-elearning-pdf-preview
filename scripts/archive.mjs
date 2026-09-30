import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';

// No system zip utility, file timestamps, locale ordering or platform attributes.
export async function archiveDirectory(directory) {
  const files = Object.create(null);
  async function collect(relative = '') {
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await collect(name);
      else if (entry.isFile()) files[name] = await readFile(path.join(directory, name));
      else throw new Error(`Unsupported archive entry: ${name}`);
    }
  }
  await collect();
  return zipSync(files, { level: 6, mtime: new Date(2020, 0, 1), os: 0, attrs: 0 });
}
