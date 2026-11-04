// What the garage shows of each car. The figures are the simulation's own
// (world.mjs, flat ground, full throttle; tests/vehicle-specs.test.mjs checks
// them); the ratings out of 10 compare the vehicles on those figures.
export const VEHICLE_ORDER = ['atlas', 'roadster', 'lightcycle'];
export const SYNTH_VEHICLE_ORDER = ['lightcycle', 'atlas', 'roadster']; // the bike comes first in its home mode
export const vehicleOrder = synth => synth ? SYNTH_VEHICLE_ORDER : VEHICLE_ORDER;
export const vehicleForTheme = (kind, synth) => vehicleOrder(synth).includes(kind) ? kind : vehicleOrder(synth)[0];
export const VEHICLE_SPECS = {
  lightcycle: {
    name: 'Light Cycle', model: 'Light Cycle + Grid Rider',
    tagline: 'A neon electric bike with a suited rider and a wall of light behind it.',
    figures: { topSpeed: 301, boostSpeed: 500, accel100: .9, boost100: .2, grassSpeed: 236, dirtSpeed: 265, waterSpeed: 500, turnRate: 61, leanTurnRate: 83 },
    ratings: [
      { key: 'speed', label: 'Max speed', score: 10, detail: '301 km/h · 500 km/h neon boost' },
      { key: 'accel', label: 'Acceleration', score: 9, detail: '0–100 km/h in 0.9 s · 0.2 s boosted' },
      { key: 'road', label: 'On-road', score: 7, detail: 'The ATLAS’s grip, and it leans into corners' },
      { key: 'offroad', label: 'Off-road', score: 9, detail: '236 km/h on grass · 265 km/h on dirt' },
      { key: 'steering', label: 'Steering', score: 7, detail: '61°/s at 100 km/h · 83°/s leaning in' },
    ],
    features: [
      { key: 'boost', title: 'Neon boost', keys: 'F', text: 'A charged burst up to 500 km/h for four seconds, refilling in eight. The trail turns black with neon edges.' },
      { key: 'lean', title: 'Leans', keys: 'Q / E', text: 'It leans into every turn by itself. Q and E bank it further, and leaning into a turn tightens it by a third.' },
      { key: 'wheelie', title: 'Front wheel lift', keys: '↓ / ↑', text: 'Hold down for a wheelie, up to set the front wheel back down. W / S accelerate and brake.' },
      { key: 'jump', title: 'Jump and drift', keys: 'Space / Shift', text: 'Jump off the ground or launch from ramps. Hold Shift to slide through corners.' },
      { key: 'water', title: 'Skips water', keys: 'auto', text: 'Reach water and the neon boost fires, however little is left, and holds to the far shore: you skip across at up to 500 km/h.' },
    ],
  },
  atlas: {
    name: 'ATLAS', model: 'ATLAS Amphibious', tagline: 'An expedition 4×4 that sails across lakes and unfolds wings to fly.',
    figures: { topSpeed: 301, accel100: .9, grassSpeed: 236, dirtSpeed: 265, turnRate: 47, climb: 50, waterSpeed: 55, airspeed: 340 },
    ratings: [
      { key: 'speed', label: 'Max speed', score: 7, detail: '301 km/h on tarmac' },
      { key: 'accel', label: 'Acceleration', score: 8, detail: '0–100 km/h in 0.9 s' },
      { key: 'road', label: 'On-road', score: 6, detail: 'Sure-footed, slides wide in fast corners' },
      { key: 'offroad', label: 'Off-road', score: 9, detail: '236 km/h on grass · 265 km/h on dirt' },
      { key: 'steering', label: 'Steering', score: 5, detail: '47°/s at 100 km/h' },
    ],
    features: [
      { key: 'plane', title: 'Flies', keys: 'F', text: 'Past 115 km/h, wings unfold and a propeller carries it up to 340 km/h. Loops and barrel rolls welcome.' },
      { key: 'boat', title: 'Sails', keys: 'auto', text: 'Deep water deploys pontoons and a jet drive: about 55 km/h afloat, back on its wheels at the shore.' },
      { key: 'climb', title: 'Climbs', keys: null, text: 'Big tyres and ground clearance: holds its pace on grass and climbs faces up to about 50°.' },
    ],
  },
  roadster: {
    name: 'Roadster', model: 'Roadster Rocket', tagline: 'A 1 MW electric hypercar with cold-gas thrusters and suction fans.',
    figures: { topSpeed: 370, boostSpeed: 402, accel100: 1.7, boost100: .6, grassSpeed: 180, dirtSpeed: 252, turnRate: 84, climb: 70, waterSpeed: 163 },
    ratings: [
      { key: 'speed', label: 'Max speed', score: 9, detail: '370 km/h · 402 km/h boosted' },
      { key: 'accel', label: 'Acceleration', score: 10, detail: '0–100 km/h in 1.7 s · 0.6 s boosted' },
      { key: 'road', label: 'On-road', score: 10, detail: 'Fan-assisted grip, twice the ATLAS’s' },
      { key: 'offroad', label: 'Off-road', score: 6, detail: '180 km/h on grass · 252 km/h on dirt' },
      { key: 'steering', label: 'Steering', score: 9, detail: '84°/s at 100 km/h' },
    ],
    features: [
      { key: 'boost', title: 'Boost', keys: 'E', text: 'Four rear thrusters: 0–100 km/h in 0.6 s and on to 402 km/h. 5.5 s of gas that refills as you drive.' },
      { key: 'hover', title: 'Hovers', keys: 'F', text: 'Corner nozzles lift it 5 m off the ground or water; flank nozzles turn it in mid-air.' },
      { key: 'water', title: 'Skims water', keys: 'auto', text: 'The thrusters hold it on a cushion over lakes and the sea at up to 163 km/h.' },
      { key: 'fans', title: 'Suction fans', keys: 'G', text: 'Grip through corners and up faces of about 70°. Switch them off for big jumps off crests.' },
      { key: 'wing', title: 'Air-brake wing', keys: null, text: 'Braking, the rear wing swings up into the airflow and triples the drag.' },
    ],
  },
};
// Features the garage can show on the model: ATLAS forms and Roadster thrusters.
export const PREVIEWS = { atlas: ['plane', 'boat'], roadster: ['boost', 'hover', 'wing'], lightcycle: [] };
