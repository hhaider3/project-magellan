import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicle, stepVehicle, FIXED_DT } from '../world.mjs';
import { VEHICLE_ORDER, VEHICLE_SPECS, PREVIEWS } from '../vehicle-specs.mjs';
import { MAX_AIRSPEED } from '../flight-motion.mjs';
import { ROADSTER } from '../roadster-motion.mjs';
const flat = { surface: () => 0, gradient: () => ({ x: 0, z: 0 }), roadAt: (x, z) => ({ d: 0, x, z }), props: () => [] };
const grass = { ...flat, roadAt: () => ({ d: 20 }) }, dirt = { ...flat, roadAt: () => ({ d: 0, kind: 'dirt' }) };
const water = { ...flat, roadAt: () => ({ d: 50 }), surface: () => -4.5, waterAt: () => ({ depth: 5, level: .5 }) };
// Full throttle from rest: the top speed reached (km/h) and seconds to 100 km/h.
function drive(kind, world, input = { up: true }, seconds = 45) {
  const car = createVehicle(world, 0, 0, 0, kind); let to100 = Infinity;
  for (let i = 1; i <= seconds / FIXED_DT; i++) { stepVehicle(car, input, world, []); if (to100 === Infinity && car.speed >= 100 / 3.6) to100 = i * FIXED_DT; }
  return { top: Math.hypot(car.vx, car.vz) * 3.6, to100 };
}
// Degrees per second turned at 100 km/h with the wheel held over.
function turnRate(kind) {
  const car = createVehicle(flat, 0, 0, 0, kind), hold = () => ({ up: car.speed < 100 / 3.6 });
  for (let i = 0; i < 3 / FIXED_DT; i++) stepVehicle(car, hold(), flat, []);
  const start = car.heading;
  for (let i = 0; i < 1 / FIXED_DT; i++) stepVehicle(car, { ...hold(), left: true }, flat, []);
  return (car.heading - start) * 180 / Math.PI;
}
// Times are shown to a tenth of a second, so allow half of one (and a hair).
const near = (actual, shown, tolerance, what) => assert.ok(Math.abs(actual - shown) <= tolerance, `${what}: simulated ${actual.toFixed(2)}, garage shows ${shown}`);

test('the garage’s figures are the simulation’s', () => {
  for (const kind of VEHICLE_ORDER) {
    const f = VEHICLE_SPECS[kind].figures, road = drive(kind, flat);
    near(road.top, f.topSpeed, 3, `${kind} top speed`);
    near(road.to100, f.accel100, .06, `${kind} 0–100 km/h`);
    near(drive(kind, grass).top, f.grassSpeed, 3, `${kind} grass speed`);
    near(drive(kind, dirt).top, f.dirtSpeed, 3, `${kind} dirt speed`);
    near(drive(kind, water).top, f.waterSpeed, 3, `${kind} water speed`);
    near(turnRate(kind), f.turnRate, 1.5, `${kind} turn rate`);
  }
  near(drive('roadster', flat, { up: true, boost: true }, 3).to100, VEHICLE_SPECS.roadster.figures.boost100, .06, 'boosted 0–100 km/h');
  near(ROADSTER.speedLimit * 3.6, VEHICLE_SPECS.roadster.figures.boostSpeed, 1, 'boosted top speed');
  near(MAX_AIRSPEED * 3.6, VEHICLE_SPECS.atlas.figures.airspeed, 2, 'ATLAS airspeed');
});

test('every car has five ratings out of 10 and its previews among its features', () => {
  for (const kind of VEHICLE_ORDER) {
    const spec = VEHICLE_SPECS[kind];
    assert.deepEqual(spec.ratings.map(r => r.key), ['speed', 'accel', 'road', 'offroad', 'steering']);
    for (const { score } of spec.ratings) assert.ok(Number.isInteger(score) && score >= 1 && score <= 10);
    for (const key of PREVIEWS[kind]) assert.ok(spec.features.some(f => f.key === key), `${kind} preview ${key}`);
  }
});
