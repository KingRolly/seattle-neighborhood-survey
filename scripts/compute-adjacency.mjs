import { readFile, writeFile } from "fs/promises";
import { bbox as turfBbox, buffer, booleanIntersects } from "@turf/turf";

const geojson = JSON.parse(
  await readFile("public/seattle-blocks.geojson", "utf-8")
);
const features = geojson.features;

const BUFFER_METERS = 100; // treat blocks within this distance as adjacent
const CELL_SIZE = 0.005;

function cellKey(x, y) {
  return `${x},${y}`;
}

function cellsForBbox(bbox) {
  const [minX, minY, maxX, maxY] = bbox;
  const cells = [];
  for (let x = Math.floor(minX / CELL_SIZE); x <= Math.floor(maxX / CELL_SIZE); x++) {
    for (let y = Math.floor(minY / CELL_SIZE); y <= Math.floor(maxY / CELL_SIZE); y++) {
      cells.push(cellKey(x, y));
    }
  }
  return cells;
}

console.log("Buffering block geometries...");
const bufferedFeatures = features.map((f) => buffer(f, BUFFER_METERS, { units: "meters" }));

console.log("Building spatial grid index...");
const grid = new Map();
const bboxes = bufferedFeatures.map((f) => turfBbox(f));

for (let i = 0; i < features.length; i++) {
  for (const cell of cellsForBbox(bboxes[i])) {
    if (!grid.has(cell)) grid.set(cell, []);
    grid.get(cell).push(i);
  }
}

console.log("Checking candidate pairs for proximity...");
const adjacency = {};
for (const f of features) {
  adjacency[f.properties.GEOID_20] = new Set();
}

const checkedPairs = new Set();
let comparisons = 0;

for (let i = 0; i < features.length; i++) {
  const candidates = new Set();
  for (const cell of cellsForBbox(bboxes[i])) {
    for (const j of grid.get(cell)) {
      if (j !== i) candidates.add(j);
    }
  }

  for (const j of candidates) {
    const pairKey = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (checkedPairs.has(pairKey)) continue;
    checkedPairs.add(pairKey);
    comparisons++;

    try {
      if (booleanIntersects(bufferedFeatures[i], bufferedFeatures[j])) {
        const geoidA = features[i].properties.GEOID_20;
        const geoidB = features[j].properties.GEOID_20;
        adjacency[geoidA].add(geoidB);
        adjacency[geoidB].add(geoidA);
      }
    } catch (err) {
      console.warn(`Skipped a pair due to geometry error: ${err.message}`);
    }
  }
}

console.log(`Checked ${comparisons} candidate pairs`);

const output = {};
for (const [geoid, neighbors] of Object.entries(adjacency)) {
  output[geoid] = Array.from(neighbors);
}

await writeFile("public/block-adjacency.json", JSON.stringify(output));
console.log(`Saved adjacency data for ${Object.keys(output).length} blocks`);

const counts = Object.values(output).map((arr) => arr.length);
const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
console.log(`Average neighbors per block: ${avg.toFixed(2)}`);