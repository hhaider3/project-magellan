import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../world.mjs';

// Synthwave's palms (world.mjs props): fewer where the pines would be, and
// pairs along the paved roads every 48 m. Without it, the world is unchanged.
const world = createWorld(3);
world.prepareRoads(0, 0, 1200, 1e9);
const around = () => { const list = []; for (let cx = -6; cx <= 6; cx++) for (let cz = -6; cz <= 6; cz++) list.push(...world.props(cx, cz)); return list; };
const plain = around();
world.setSynthwave(true);
const synth = around();
world.setSynthwave(false);

test('without synthwave the props are as they were, and switching back restores them', () => {
  assert.equal(plain.filter(p => p.id.startsWith('palm:')).length, 0);
  assert.deepEqual(around().map(p => p.id), plain.map(p => p.id));
});

test('synthwave leaves some pine spots empty, most on open land, and moves nothing else', () => {
  const pines = list => list.filter(p => p.type === 'tree' && !p.id.startsWith('palm:') && (p.variant === undefined || p.variant < 4));
  const share = pines(synth).length / pines(plain).length;
  assert.ok(share > .4 && share < .8, `kept ${share}`);
  const open = list => pines(list).filter(p => world.woodlandAt(p.x, p.z) < .3).length;
  assert.ok(open(synth) < open(plain) * .4, `open land: ${open(synth)} of ${open(plain)}`);
  // An empty spot keeps its room: cherries, dead snags, rocks and bushes stay put.
  const others = list => { const pine = new Set(pines(list)); return list.filter(p => !p.id.startsWith('palm:') && !pine.has(p)).map(p => p.id); };
  assert.deepEqual(others(synth), others(plain));
});

test('tall palms line the paved roads in pairs every 48 m, just past the verge', () => {
  const palms = synth.filter(p => p.id.startsWith('palm:'));
  assert.ok(palms.length > 30, `${palms.length} road palms`);
  assert.equal(new Set(palms.map(p => p.id)).size, palms.length);
  const rows = new Map();
  for (const p of palms) {
    assert.equal(p.variant, 0); assert.equal(p.type, 'tree');
    assert.ok(!world.waterAt(p.x, p.z));
    const road = world.roadAt(p.x, p.z);
    assert.ok(road.d > 7.5 && road.d < 10, `${p.id} ${road.d} m from the road`);
    const [, id, j, side] = /^palm:(.*):(\d+):(-?1)$/.exec(p.id);
    (rows.get(id + side) ?? rows.set(id + side, []).get(id + side)).push({ j: +j, p });
  }
  const gaps = [];
  for (const row of rows.values()) {
    row.sort((a, b) => a.j - b.j);
    for (let i = 1; i < row.length; i++) if (row[i].j === row[i - 1].j + 1) gaps.push(Math.hypot(row[i].p.x - row[i - 1].p.x, row[i].p.z - row[i - 1].p.z));
  }
  gaps.sort((a, b) => a - b);
  assert.ok(gaps.length > 20);
  assert.ok(Math.abs(gaps[gaps.length >> 1] - 48) < 1, `median gap ${gaps[gaps.length >> 1]}`);
  assert.ok(gaps[0] > 40, `closest pair ${gaps[0]}`);
});
