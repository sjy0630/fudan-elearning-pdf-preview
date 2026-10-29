import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const expectedVersion = '0.4.5';
const before = 'for (; i < t.charProps.length && c >= t.charProps[i].chars; )\n      c = 0, i++;';
const after = 'for (; i < t.charProps.length && c >= t.charProps[i].chars; )\n      c -= t.charProps[i].chars, i++;';

// v0.4.5 counts a paragraph separator after consuming its text. When that
// crosses a character-style boundary, retain the excess consumed characters;
// resetting to zero applies the separator's style to the next visible glyph.
// This fixes cursor accounting, without changing any authored style or color.
export function patchPresentationEngineSource(source, version) {
  if (version !== expectedVersion) throw new Error(`Presentation engine patch requires @web-ppt/core ${expectedVersion}`);
  if (source.split(before).length !== 2) throw new Error('Presentation character cursor patch must match exactly once');
  return source.replace(before, after);
}
export function presentationEnginePatchPlugin() {
  const packagePath = require.resolve('@web-ppt/core/package.json');
  const sourcePath = path.join(path.dirname(packagePath), 'dist/core.js');
  return {
    name: 'presentation-character-style-cursor',
    setup(build) {
      let applied = 0;
      build.onStart(() => { applied = 0; });
      build.onEnd(() => applied === 1 ? undefined : { errors: [{ text: 'Presentation character cursor patch must be applied exactly once' }] });
      build.onLoad({ filter: /[\\/]@web-ppt[\\/]core[\\/]dist[\\/]core\.js$/ }, async ({ path: loadedPath }) => {
        if (path.resolve(loadedPath) !== path.resolve(sourcePath)) throw new Error('Unexpected presentation engine source path');
        const [source, metadata] = await Promise.all([readFile(sourcePath, 'utf8'), readFile(packagePath, 'utf8')]);
        const pkg = JSON.parse(metadata);
        if (pkg.name !== '@web-ppt/core') throw new Error('Unexpected presentation engine package');
        const contents = patchPresentationEngineSource(source, pkg.version);
        applied++;
        return { contents, loader: 'js', resolveDir: path.dirname(sourcePath) };
      });
    },
  };
}
