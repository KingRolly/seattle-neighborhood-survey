// One-time script: joins Census population data into seattle-blocks.geojson
// Run with: node scripts/join-population.mjs

import { readFile, writeFile } from "fs/promises";

const geojson = JSON.parse(
  await readFile("public/seattle-blocks.geojson", "utf-8")
);
const popByGeoid = JSON.parse(
  await readFile("scripts/king-county-block-population.json", "utf-8")
);

let matched = 0;
let unmatched = 0;

for (const feature of geojson.features) {
  const geoid = feature.properties.GEOID_20;
  const pop = popByGeoid[geoid];

  if (pop === undefined) {
    unmatched++;
    feature.properties.POPULATION = null;
  } else {
    matched++;
    feature.properties.POPULATION = pop;
  }
}

console.log(`Matched: ${matched}`);
console.log(`Unmatched: ${unmatched}`);
console.log(`Total features: ${geojson.features.length}`);

await writeFile(
  "public/seattle-blocks.geojson",
  JSON.stringify(geojson)
);

console.log("Saved public/seattle-blocks.geojson with POPULATION field added");