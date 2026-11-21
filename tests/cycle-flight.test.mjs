import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicle, stepVehicle, FIXED_DT } from '../world.mjs';
import { toggleFlight, rotate, attitudeFromEuler, FLIGHT_TRANSFORM_SECONDS } from '../flight-motion.mjs';
import { toggleCycleFlight, cycleLift, jetThrust, cycleClearance, CYCLE_FRAME, CYCLE_LAUNCH_SPEED, CYCLE_STALL_SPEED, CYCLE_AIRSPEED, CYCLE_BURNER_AIRSPEED } from '../cycle-flight.mjs';

// The Light Cycle as a jet (cycle-flight.mjs): its launch and landings, its
// envelope, and the momentum in its attitude that the ATLAS's flight has not.
// A level plain (or a slope facing +z), with wind if given; and one with a lake across it.
const plain = (wind, rise = 0) => ({ surface: (x, z) => z * rise, gradient: () => ({ x: 0, z: rise }), roadAt: () => ({ d: 0 }), wind });
const lake = { surface: () => -4, gradient: () => ({ x: 0, z: 0 }), roadAt: () => ({ d: 50 }), waterAt: () => ({ depth: 4, level: 0 }) };
const flat = plain();
function run(land, car, input, seconds, each) {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) { stepVehicle(car, typeof input === 'function' ? input(i * FIXED_DT) : input, land, []); each?.(car, (i + 1) * FIXED_DT); }
  return car;
}
const q = car => [car.qx, car.qy, car.qz, car.qw];
const mastUp = car => rotate(q(car), [0, 1, 0])[1], noseUp = car => rotate(q(car), [0, 0, 1])[1];
const bankOf = car => Math.atan2(rotate(q(car), [1, 0, 0])[1], mastUp(car)); // + right wing down
const bike = (land = flat) => createVehicle(land, 0, 0, 0, 'lightcycle');
// Already the jet: flying north at `speed`, `height` above the plain, engine at idle.
function jet(land = flat, speed = 90, height = 300, extra = {}) {
  return Object.assign(bike(land), { flightMode: true, flight: 1, flying: true, grounded: false, y: height, vz: speed, airspeed: speed, climbOut: false, takeoff: 0, ...extra });
}

test('armed, the bike stays a bike until 180 km/h, then leaps, unfolds in the air and climbs out', () => {
  const car = bike();
  assert.equal(toggleFlight(car), false, 'the ATLAS’s wings are not its own');
  assert.equal(toggleCycleFlight(car), true);
  let leapt = null, rode = 0;
  run(flat, car, { up: true, throttleUp: true }, 1.2, c => { assert.equal(c.flight, 0, 'no wings on the ground: the wheels are wheels'); assert.equal(c.flying, false); rode = c.speed; });
  assert.ok(rode > 25 && rode < CYCLE_LAUNCH_SPEED, `still riding at ${rode} m/s`);
  run(flat, car, { up: true, throttleUp: true }, 2, (c, t) => { if (c.flying && leapt === null) leapt = { speed: c.speed, vy: c.vy, flight: c.flight }; });
  assert.ok(leapt && Math.abs(leapt.speed - CYCLE_LAUNCH_SPEED) < 1.5 && leapt.vy > 8, `leapt at ${leapt?.speed} m/s, rising at ${leapt?.vy}`);
  assert.ok(leapt.flight < .02, 'unfolding starts with the leap');
  run(flat, car, { throttleUp: true }, FLIGHT_TRANSFORM_SECONDS);
  assert.equal(car.flight, 1); assert.equal(car.flying, true); assert.equal(car.flights, 1);
  let lowest = Infinity;
  run(flat, car, { throttleUp: true }, 10, c => { lowest = Math.min(lowest, c.y); });
  assert.ok(lowest > 3, `never sank back: ${lowest} m`);
  assert.ok(car.y > 30 && car.y < 90 && Math.abs(car.climb) < .08, `climbed out and levelled at ${car.y} m (${car.climb})`);
  assert.equal(car.wingCrashes ?? 0, 0);
  // Disarmed before it gets there, it never leaves the ground.
  const stay = bike(); toggleCycleFlight(stay); run(flat, stay, { up: true }, .8); assert.equal(toggleCycleFlight(stay), false);
  run(flat, stay, { up: true }, 4, c => assert.equal(c.flying, false)); assert.equal(stay.flights, 0);
});

test('it leaves the ground as it was riding: leaning into its turn, and up a slope', () => {
  const turning = bike();
  run(flat, turning, { up: true, left: true }, 3);
  const lean = turning.lean + turning.turnLean; assert.ok(lean > .3);
  toggleCycleFlight(turning); stepVehicle(turning, { up: true, left: true }, flat, []);
  assert.equal(turning.flying, true); assert.ok(Math.abs(bankOf(turning) + lean) < .02, `banked as it leaned: ${bankOf(turning)} for ${lean}`);
  for (const degrees of [10, 17]) {
    const hill = plain(undefined, Math.tan(degrees * Math.PI / 180)), car = bike(hill); toggleCycleFlight(car);
    let clear = Infinity, lifted = false;
    run(hill, car, { up: true, throttleUp: true }, 10, c => { lifted ||= c.flying; if (lifted) { assert.equal(c.flying, true, `${degrees}°: stays airborne`); clear = Math.min(clear, c.y - hill.surface(c.x, c.z)); } });
    assert.ok(lifted && clear > 0, `${degrees}°: clear of the slope by ${clear} m`); assert.equal(car.flights, 1); assert.equal(car.wingCrashes ?? 0, 0);
    assert.ok(car.y - hill.surface(car.x, car.z) > 10);
  }
});

test('off a jump it becomes the jet only when it is fast enough to glide', () => {
  const fast = bike(); run(flat, fast, { up: true }, 1.2); toggleCycleFlight(fast);
  assert.ok(fast.speed > 30 && fast.speed < CYCLE_LAUNCH_SPEED);
  stepVehicle(fast, { up: true, jump: true }, flat, []); run(flat, fast, { throttleUp: true }, 1);
  assert.equal(fast.flying, true); assert.ok(fast.flight > .3);
  const slow = bike(); run(flat, slow, { up: true }, .4); toggleCycleFlight(slow);
  stepVehicle(slow, { up: true, jump: true }, flat, []); run(flat, slow, {}, 1.5, c => assert.equal(c.flying, false));
  assert.equal(slow.grounded, true); assert.equal(slow.flightMode, true, 'still armed');
});

test('the jet: 400 km/h flat out, 500 on the neon afterburner, which burns the boost’s charge', () => {
  const dry = run(flat, jet(), { throttleUp: true }, 40);
  assert.ok(Math.abs(dry.airspeed - CYCLE_AIRSPEED) < 2.5, `level at ${dry.airspeed * 3.6} km/h`); assert.ok(Math.abs(dry.y - 300) < 60 && Math.abs(dry.climb) < .03, 'hands off, it holds its path');
  assert.ok(jetThrust(1, 0, 0) < 9.8 * .6 && jetThrust(1, 0, 110) > jetThrust(1, 0, 0) * .8, 'thrust barely fades with speed');
  assert.ok(jetThrust(1, 1, 100) > jetThrust(1, 0, 100) * 1.5); assert.equal(jetThrust(0, 0, 50), 0);
  // The charge lasts four seconds, as on the ground, and W need not be held.
  const burning = jet(flat, 110); let lit = 0, fastest = 0;
  run(flat, burning, t => ({ boost: t < .1 }), 6, c => { if (c.neonBoost) lit += FIXED_DT; fastest = Math.max(fastest, c.airspeed); });
  assert.ok(Math.abs(lit - 4) < .1, `burned for ${lit} s`); assert.ok(fastest > 118, `to ${fastest} m/s on the burner alone`); assert.ok(burning.neonCharge < .3 && burning.neonCharge > 0, 'recharging');
  const held = jet(flat, 130); run(flat, held, { throttleUp: true }, 12, c => { c.neonBoost = true; c.neonCharge = 1; });
  assert.ok(Math.abs(held.airspeed - CYCLE_BURNER_AIRSPEED) < 2.5, `${held.airspeed * 3.6} km/h on the afterburner`);
  // Hands off it glides and slows; S opens the air brakes; the engine spools.
  const glide = run(flat, jet(), {}, 5), braked = run(flat, jet(), { throttleDown: true }, 5);
  assert.ok(glide.airspeed < 80 && glide.airspeed > 65 && braked.airspeed < glide.airspeed - 15, `glide ${glide.airspeed}, brakes ${braked.airspeed}`);
  const spool = jet(); run(flat, spool, { throttleUp: true }, .2); assert.ok(spool.power > .3 && spool.power < .6);
  run(flat, spool, { throttleUp: true }, 1.5); assert.ok(spool.power > .97); run(flat, spool, {}, 1.5); assert.ok(spool.power < .01);
});

test('the swept wing: a shallow lift slope, no sharp stall, and hard turns that cost speed', () => {
  assert.ok(cycleLift(.2) > cycleLift(.1) && cycleLift(.42) > cycleLift(.3));
  assert.ok(cycleLift(.55) < cycleLift(.42) && cycleLift(.55) > cycleLift(.42) * .8, 'past 24° the lift only sags');
  assert.ok(cycleLift(-.3) < 0);
  // Slower than about 130 km/h it cannot hold itself up: hands off at idle, it sinks faster and faster.
  const slow = jet(flat, CYCLE_STALL_SPEED + 3); let sank = 0;
  run(flat, slow, {}, 6, c => { sank = Math.min(sank, c.vy); });
  assert.ok(sank < -6, `sinking at ${-sank} m/s`); assert.equal(slow.flying, true);
  // A full pull: 7 g at the limit when fast, less and less as it slows, and the speed pays for it.
  const loads = [139, 106, 80, 60].map(speed => { const car = jet(flat, speed); let peak = 0, alpha = 0; run(flat, car, { throttleUp: true, pitchUp: true }, 1.5, c => { peak = Math.max(peak, c.load); alpha = Math.max(alpha, c.alpha); }); return { speed, peak, alpha, left: car.airspeed }; });
  assert.ok(Math.abs(loads[0].peak - 7) < .05 && loads[1].peak > 6.5, `7 g fast: ${loads[0].peak}, ${loads[1].peak}`);
  assert.ok(loads[2].peak < loads[1].peak - 1.5 && loads[3].peak < loads[2].peak - 1 && loads[3].peak > 2, `less when slow: ${loads[2].peak}, ${loads[3].peak}`);
  assert.ok(loads[0].left < 139 - 25, `139 m/s fell to ${loads[0].left} in a second and a half`);
  for (const { speed, alpha } of loads) assert.ok(alpha < .52, `${speed} m/s: the wing is held to just past its stall (${alpha})`);
  // Held into the stall at idle it shakes and mushes, wings level, and flies out with power.
  const mush = jet(flat, 60); let shaken = 0;
  run(flat, mush, { pitchUp: true }, 5, c => { shaken = Math.max(shaken, c.buffet); });
  assert.ok(shaken > .6 && mush.airspeed < 35 && Math.abs(bankOf(mush)) < .02, `buffet ${shaken}, ${mush.airspeed} m/s`);
  run(flat, mush, { throttleUp: true }, 6);
  assert.ok(mush.flying && mush.airspeed > CYCLE_STALL_SPEED + 5 && mush.buffet === 0 && mush.y > 150, `recovered at ${mush.airspeed} m/s, ${mush.y} m`);
  // A sustained turn on the jet alone is gentle; the afterburner holds more.
  const turn = burner => { const car = jet(flat, 90); run(flat, car, { throttleUp: true, rollLeft: true }, .3); run(flat, car, { throttleUp: true, pitchUp: true }, 6, c => { if (burner) { c.neonBoost = true; c.neonCharge = 1; } }); return car.airspeed; };
  assert.ok(turn(false) < 75 && turn(true) > turn(false) + 5, `speed left after a hard turn: ${turn(false)} dry, ${turn(true)} burning`);
});

test('its attitude has momentum: it rolls up to speed and coasts to a stop, and the nose settles after a pull', () => {
  // The roll rate builds over a moment rather than appearing at once, and dies away on release.
  const car = jet(flat, 90); let after = [];
  run(flat, car, { throttleUp: true, rollRight: true }, .6, (c, t) => { if (Math.abs(t - .05) < 1e-6 || Math.abs(t - .6) < 1e-6) after.push(c.wz); });
  assert.ok(after[0] > .5 && after[0] < after[1] * .5, `rate after 50 ms ${after[0]}, steady ${after[1]}`);
  assert.ok(Math.abs(after[1] - 3) < .15, `about 170°/s: ${after[1]} rad/s`);
  const banked = bankOf(car);
  run(flat, car, { throttleUp: true }, .1); assert.ok(car.wz > .3 && car.wz < after[1] * .7, `still coasting: ${car.wz}`);
  run(flat, car, { throttleUp: true }, .6); assert.ok(Math.abs(car.wz) < .05 && Math.abs(bankOf(car) - banked) > .1, `stopped, a little further round: ${car.wz}`);
  // A full roll, and it flies on.
  const roller = jet(flat, 90); let lowest = 1; run(flat, roller, { throttleUp: true, rollLeft: true }, 2.2, c => { lowest = Math.min(lowest, mastUp(c)); });
  assert.ok(lowest < -.95 && roller.flying);
  // A pull overshoots its angle of attack a little and settles: a spring and a damper, not a switch.
  const puller = jet(flat, 100); let peak = 0, seen = [];
  run(flat, puller, { throttleUp: true, pitchUp: true }, 1.2, (c, t) => { peak = Math.max(peak, c.alpha); if (t > .9) seen.push(c.alpha); });
  const settled = seen.reduce((a, b) => a + b) / seen.length;
  assert.ok(peak > settled * 1.03 && peak < settled * 1.4, `peak ${peak}, settling at ${settled}`);
  // Released controls keep the bank; hands off it holds its path.
  const turner = jet(flat, 90); run(flat, turner, { throttleUp: true, rollLeft: true }, .25); run(flat, turner, { throttleUp: true }, .6); const held = bankOf(turner);
  run(flat, turner, { throttleUp: true }, 3);
  assert.ok(held < -.4 && held > -1 && Math.abs(bankOf(turner) - held) < .1, `bank ${held} -> ${bankOf(turner)}`); assert.ok(turner.heading > .2, 'and turns');
  // A loop with the stick held, and it flies on.
  const loop = jet(flat, 105); let inverted = false, round = false;
  run(flat, loop, { throttleUp: true, pitchUp: true }, 13, c => { if (mastUp(c) < -.8) inverted = true; if (inverted && mastUp(c) > .9 && noseUp(c) > -.2) round = true; });
  assert.ok(inverted && round && loop.flying, 'looped');
});

test('the rudder skids it and the skid rolls it; it has no flat turn', () => {
  const car = jet(flat, 90); let slip = 0;
  run(flat, car, { throttleUp: true, yawLeft: true }, .8, c => { slip = Math.max(slip, Math.abs(Math.atan2(c.vx, c.vz) - c.heading)); });
  assert.ok(slip > .05 && slip < .25, `nose ${slip} rad out of the airflow`);
  run(flat, car, { throttleUp: true, yawLeft: true }, 2.2);
  assert.ok(bankOf(car) < -.3, `rolled into the turn by its dihedral: ${bankOf(car)}`); assert.ok(car.heading > .2);
  // Out of a sideslip the fins swing the nose back into the airflow.
  const skid = jet(flat, 90); [skid.qx, skid.qy, skid.qz, skid.qw] = attitudeFromEuler(.25, 0, 0);
  run(flat, skid, { throttleUp: true }, 2);
  assert.ok(Math.abs(Math.atan2(skid.vx, skid.vz) - skid.heading) < .02, 'weathervaned');
});

test('it flies in the wind and the rough air, and the ground cushions it', () => {
  const tail = plain({ x: 0, z: 12, turbulence: 0 });
  const still = run(flat, jet(flat, 90, 320), { throttleUp: true }, 5), carried = run(tail, jet(tail, 90, 320, { vz: 102 }), { throttleUp: true }, 5);
  assert.ok(Math.abs(carried.airspeed - still.airspeed) < .05 && Math.abs(carried.vz - still.vz - 12) < .1, `carried: ${carried.vz - still.vz} m/s over the ground`);
  const rough = plain({ x: 0, z: 0, turbulence: 1 }), loads = [];
  const shaken = run(rough, jet(rough), { throttleUp: true }, 6, c => loads.push(c.load)), again = run(rough, jet(rough), { throttleUp: true }, 6);
  const spread = Math.max(...loads.slice(120)) - Math.min(...loads.slice(120));
  assert.ok(spread > .4 && spread < 4 && shaken.flying, `bumps of ${spread} g`);
  assert.deepEqual([shaken.x, shaken.y, shaken.z, shaken.qw, shaken.wx], [again.x, again.y, again.z, again.qw, again.wx], 'the same flight meets the same air');
  const low = jet(flat, 60, .6), high = jet(flat, 60, 150);
  for (const car of [low, high]) [car.qx, car.qy, car.qz, car.qw] = attitudeFromEuler(0, -.14, 0);
  run(flat, low, {}, .5); run(flat, high, {}, .5);
  assert.ok(low.flying && low.airspeed > high.airspeed + .015 && low.vy > high.vy + .06, `ground effect: ${low.airspeed} against ${high.airspeed} m/s`);
});

test('it lands by becoming the bike: folded in the air, slowly, or eased onto the ground', () => {
  // G in the air: the wings fold, it falls, and lands on its wheels to ride on.
  const car = run(flat, jet(flat, 90, 120), { throttleUp: true }, 1);
  assert.equal(toggleCycleFlight(car), false);
  const speed = car.airspeed; run(flat, car, { throttleUp: true, rollLeft: true, pitchUp: true }, 1);
  assert.ok(car.flight < .45 && car.airspeed < speed + 9, 'folding: no thrust');
  let landed = null; run(flat, car, {}, 12, (c, t) => { if (!c.flying && c.grounded && landed === null) landed = t; });
  assert.ok(landed !== null && car.flying === false && car.flight === 0 && car.grounded && car.y < .1, `landed after ${landed} s`); assert.equal(car.wingCrashes ?? 0, 0);
  const x = car.z; run(flat, car, { up: true }, 2); assert.ok(car.z - x > 20 && car.speed > 20, 'rides on');
  assert.equal(car.landings, 1);
  // Too slow to fly, it lands where it touches.
  const slow = run(flat, jet(flat, CYCLE_STALL_SPEED + 2, 1.5, { vy: -2 }), {}, 1.5);
  assert.ok(!slow.flying && !slow.flightMode && slow.grounded && slow.speed > 20, 'a slow touchdown lands');
  // Fast, it has no wheels to roll on: it skips off its belly and flies on...
  for (const [label, pitch, vy] of [['skim', -.05, -1], ['hard flat', 0, -15]]) {
    const skip = jet(flat, 80, .3, { vy }); [skip.qx, skip.qy, skip.qz, skip.qw] = attitudeFromEuler(0, pitch, 0);
    run(flat, skip, { throttleUp: true }, .2); assert.ok(skip.flying && skip.flightMode && skip.airspeed > 60 && mastUp(skip) > 0, label);
    run(flat, skip, { throttleUp: true }, 3); assert.ok(skip.flying && skip.y > .5, `${label} flies on`);
  }
  // ...unless the nose is eased down onto the ground: then it lands at speed.
  const eased = run(flat, jet(flat, 80, .6, { vy: -1.5 }), { throttleUp: true, pitchDown: true }, 1);
  assert.ok(!eased.flying && !eased.flightMode && eased.grounded && eased.speed > 55, `landed at ${eased.speed} m/s`); assert.equal(eased.wingCrashes ?? 0, 0);
  run(flat, eased, {}, FLIGHT_TRANSFORM_SECONDS / 3.5 + .05); assert.equal(eased.flight, 0, 'the wings snap away: it needs its wheels');
  // On the water it rides on, it lands the same, and the boost fires as it does for the bike.
  const wet = run(lake, jet(lake, CYCLE_STALL_SPEED + 2, 1.5, { vy: -2 }), {}, 1.5);
  assert.ok(!wet.flying && wet.grounded && wet.skimming && wet.neonBoost && Math.abs(wet.y - .095) < .05, `on the water at ${wet.y} m`);
  // And from the water it takes off: nothing holds the boost on once it is the jet.
  const off = bike(lake); toggleCycleFlight(off); run(lake, off, { up: true, throttleUp: true }, 6);
  assert.ok(off.flying && off.y > 10 && !off.skimming && !off.neonForced, `off the water to ${off.y} m`);
  run(lake, off, { throttleUp: true }, 6); assert.equal(off.neonBoost, false, 'the forced boost ended with the water');
});

test('a wingtip, a fin or the rider in the ground ends the flight, except while it unfolds', () => {
  for (const side of ['rollLeft', 'rollRight']) {
    const car = jet(flat, 80, 1.2, { vy: -1 }); let lowest = Infinity;
    run(flat, car, { [side]: true, throttleUp: true }, .8, c => { if (c.flightMode) lowest = Math.min(lowest, -cycleClearance(c, flat).depth); });
    assert.equal(car.wingCrashes, 1, side); assert.ok(lowest > -1e-6, `${side}: never buried (${lowest})`);
    assert.equal(car.flying, false); assert.equal(car.flightMode, false);
    run(flat, car, {}, 3); assert.ok(car.grounded && car.flight === 0 && Math.abs(car.roll) < .05, `${side}: lands as the bike, upright`);
  }
  const inverted = jet(flat, 80, 2, { vy: -1 }); [inverted.qx, inverted.qy, inverted.qz, inverted.qw] = attitudeFromEuler(0, 0, Math.PI);
  run(flat, inverted, {}, .6); assert.equal(inverted.flightMode, false, 'upside down, the fins and the rider touch first');
  // The measured outline: wingtips 2.31 m out, fins 1.68 m up, the nose 2.4 m ahead.
  const span = CYCLE_FRAME.span(1); assert.ok(Math.abs(span - 2.31) < .01 && Math.abs(CYCLE_FRAME.wing(span)[1] - .88) < .02 && Math.abs(CYCLE_FRAME.wing(span)[2] + 1.24) < .02);
  assert.ok(CYCLE_FRAME.span(0) < .25, 'folded, the wings are inside the bike');
  // While it unfolds after the leap a touch is shrugged off.
  const young = jet(flat, 60, .9, { vy: -1, takeoff: 3 }); run(flat, young, { rollLeft: true, throttleUp: true }, .5);
  assert.equal(young.wingCrashes ?? 0, 0); assert.equal(young.flying, true);
});

test('wings break scenery and are dragged round by it', () => {
  const tree = { id: 'cf:tree', type: 'tree', x: 1.6, z: 30, y: 0, size: 1, r: .3, h: 8 };
  const land = { ...plain(), brokenProps: new Set(), breakProp: prop => land.brokenProps.add(prop.id) };
  const car = jet(land, 80, 2); let struck = 0;
  for (let i = 0; i < .6 / FIXED_DT; i++) { stepVehicle(car, { throttleUp: true }, land, [tree]); struck = car.wingStrikes ?? 0; }
  assert.equal(struck, 1); assert.ok(land.brokenProps.has(tree.id)); assert.ok(car.airspeed < 80 && car.flying);
  assert.ok(Math.abs(bankOf(car)) > .02 || Math.abs(car.heading) > .02, 'the struck wing is dragged back');
});

test('simple controls: it banks to turn and levels when released, climbs and dives gently, and holds level hands off', () => {
  const simple = input => ({ simpleFlight: true, ...input });
  const car = jet(flat, 90); const y = car.y;
  run(flat, car, simple({ up: true, left: true }), 3);
  assert.ok(bankOf(car) < -.6 && car.heading > 1.2, `banked ${bankOf(car)}, turned ${car.heading}`);
  run(flat, car, simple({ up: true }), 3);
  assert.ok(Math.abs(bankOf(car)) < .03 && Math.abs(car.y - y) < 15, `levelled at ${car.y - y} m`);
  let peak = 0; run(flat, car, simple({ up: true, jump: true }), 3, c => { peak = Math.max(peak, c.load); });
  assert.ok(car.y - y > 40 && peak < 4.5, `climbed ${car.y - y} m at no more than ${peak} g`);
  run(flat, car, simple({ up: true }), 4); const top = car.y; run(flat, car, simple({ up: true }), 3); assert.ok(Math.abs(car.y - top) < 6, 'level');
  run(flat, car, simple({ up: true, brake: true }), 2); assert.ok(car.y - top < -25, `dived ${car.y - top}`);
  const upside = jet(flat, 90); [upside.qx, upside.qy, upside.qz, upside.qw] = attitudeFromEuler(0, 0, 3);
  run(flat, upside, simple({ up: true }), 4); assert.ok(mastUp(upside) > .99, 'rolls upright');
  // And they take it off the ground with W alone.
  const off = bike(); toggleCycleFlight(off); run(flat, off, simple({ up: true }), 9);
  assert.ok(off.flying && off.y > 20, `climbed out to ${off.y} m`);
});

test('nothing it can be flown into makes the numbers run away', () => {
  for (const [name, speed, height, input, extra] of [['never-exceed, everything held', 165, 100, { throttleUp: true, pitchUp: true, rollLeft: true, yawRight: true, boost: true }, {}],
    ['standing still in the air', 0, 300, { pitchUp: true, rollRight: true }, {}], ['thin air', 80, 850, { throttleUp: true, pitchDown: true, rollRight: true }, {}],
    ['flying backwards', -40, 300, { pitchUp: true }, {}], ['folded and tumbling', 80, 300, { rollRight: true }, { flightMode: false, wx: 3, wy: 2, wz: 5 }]]) {
    const car = jet(flat, speed, height, extra); let worst = 0;
    run(flat, car, input, 10, c => { for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'qx', 'qy', 'qz', 'qw', 'wx', 'wy', 'wz', 'airspeed', 'alpha', 'load', 'heading', 'pitch', 'roll']) assert.ok(Number.isFinite(c[key]), `${name}: ${key}`); worst = Math.max(worst, Math.abs(c.wx), Math.abs(c.wy), Math.abs(c.wz)); });
    assert.ok(worst < 8, `${name}: turning at up to ${worst} rad/s`); assert.ok(Math.hypot(car.vx, car.vy, car.vz) <= 165.01);
  }
  // Fixed steps: the same flight at any frame rate.
  const a = jet(flat, 90), b = jet(flat, 90), input = { throttleUp: true, pitchUp: true, rollLeft: true };
  run(flat, a, input, 2); for (let i = 0; i < 2 / FIXED_DT; i++) stepVehicle(b, input, flat, []);
  assert.deepEqual([a.x, a.y, a.z, a.qw], [b.x, b.y, b.z, b.qw]);
});
