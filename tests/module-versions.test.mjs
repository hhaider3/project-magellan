import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { posix } from 'node:path';

// Module URLs carry revision tags (?v=…) so a browser never mixes a cached old
// module with a new release. Every reference to the same file must use the
// same tag: two tags load two copies of the module (the worker URL is the
// cache key for the worker's source, a stylesheet's for the stylesheet).
const root = new URL('../', import.meta.url);
const pages = [
  ...(await readdir(root)).filter(name => /\.(mjs|html)$/.test(name)),
  ...(await readdir(new URL('tests/', root))).filter(name => name.endsWith('.html')).map(name => `tests/${name}`),
];
const reference = /["'`](\.{1,2}\/[\w./-]+\.(?:mjs|js|css|glb|json|webmanifest))(?:\?v=([\w.-]+))?["'`]/g;
const references = [];
for (const page of pages) {
  const text = await readFile(new URL(page, root), 'utf8');
  for (const [, path, tag] of text.matchAll(reference)) references.push({ page, file: posix.normalize(posix.join(posix.dirname(page), path)), tag });
}

test('every reference to a module uses the same revision tag', () => {
  const tags = new Map();
  for (const { page, file, tag } of references) if (tag) (tags.get(file) ?? tags.set(file, new Map()).get(file)).set(tag, [...(tags.get(file).get(tag) ?? []), page]);
  const mixed = [...tags].filter(([, byTag]) => byTag.size > 1).map(([file, byTag]) => `${file}: ${[...byTag].map(([tag, from]) => `${tag} (${from.join(', ')})`).join(' vs ')}`);
  assert.deepEqual(mixed, []);
  assert.ok(tags.size > 30, `${tags.size} tagged files found`);
});

test('the game’s own modules are always referenced with a tag', () => {
  // The bundled Three.js (vendor/) is versioned by its own path; Node tests
  // import modules directly and aren't scanned.
  const untagged = references.filter(({ page, file, tag }) => !tag && !page.startsWith('tests/') && !file.startsWith('vendor/') && /\.(mjs|css)$/.test(file));
  assert.deepEqual(untagged.map(({ page, file }) => `${file} in ${page}`), []);
});
