// What the garage shows of each car. The figures are the simulation's own
// (world.mjs, flat ground, full throttle; tests/vehicle-specs.test.mjs checks
// them); the ratings out of 10 compare the two cars on those figures.
export const VEHICLE_ORDER = ['atlas', 'roadster'];
export const VEHICLE_SPECS = {
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
export const PREVIEWS = { atlas: ['plane', 'boat'], roadster: ['boost', 'hover', 'wing'] };
