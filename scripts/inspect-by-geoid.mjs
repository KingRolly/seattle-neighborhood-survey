// Look up specific blocks by GEOID
// Run with: node scripts/inspect-by-geoid.mjs 530330001011000 530330001021001

import { readFile } from "fs/promises";

const geoids = process.argv.slice(2);
if (geoids.length === 0) {
  console.log("Usage: node scripts/inspect-by-geoid.mjs <geoid1> <geoid2> ...");
  process.exit(1);
}

const geojson = JSON.parse(
  await readFile("public/seattle-blocks.geojson", "utf-8")
);

for (const geoid of geoids) {
  const f = geojson.features.find((f) => f.properties.GEOID_20 === geoid);
  if (!f) {
    console.log(`${geoid}: not found`);
    continue;
  }
  const p = f.properties;
  console.log(
    `${geoid} | NAME: ${p.NAME} | GEN_ALIAS: ${p.GEN_ALIAS} | POPULATION: ${p.POPULATION} | ACRES_LAND: ${p.ACRES_LAND.toFixed(2)} | ACRES_WATER: ${p.ACRES_WATER.toFixed(2)}`
  );
}