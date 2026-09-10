import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('vendor', { recursive: true });
await copyFile('node_modules/three/build/three.module.js', 'vendor/three.module.js');
await copyFile('node_modules/three/LICENSE', 'vendor/THREE-LICENSE.txt');
for (const path of ['loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js', 'environments/RoomEnvironment.js']) {
  await mkdir(`vendor/${path.split('/')[0]}`, { recursive: true });
  await copyFile(`node_modules/three/examples/jsm/${path}`, `vendor/${path}`);
}
