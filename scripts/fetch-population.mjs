// One-time script: fetches 2020 Census block population for King County, WA
// Run with: node scripts/fetch-population.mjs

import { writeFile } from "fs/promises";

const API_KEY = "6124e85a5fb94b5475513e808774d33a14c391b6"; // paste your key here, or leave blank to try without one

const url = new URL("https://api.census.gov/data/2020/dec/pl");
url.searchParams.set("get", "P1_001N,NAME");
url.searchParams.set("for", "block:*");
url.searchParams.set("in", "state:53 county:033"); // Washington, King County
if (API_KEY) url.searchParams.set("key", API_KEY);

console.log("Fetching from:", url.toString());

const res = await fetch(url);
const text = await res.text();

console.log("Status:", res.status);
console.log("Content-Type:", res.headers.get("content-type"));

let rows;
try {
  rows = JSON.parse(text);
} catch {
  console.log("Response was not JSON. First 500 chars:");
  console.log(text.slice(0, 500));
  process.exit(1);
}

// rows[0] is the header row, e.g. ["P1_001N","NAME","state","county","tract","block"]
const header = rows[0];
const dataRows = rows.slice(1);

console.log(`Fetched ${dataRows.length} blocks`);
console.log("Sample row:", dataRows[0]);

// Build a lookup: GEOID -> population
const popByGeoid = {};
for (const row of dataRows) {
  const obj = Object.fromEntries(header.map((key, i) => [key, row[i]]));
  const geoid = obj.state + obj.county + obj.tract + obj.block;
  popByGeoid[geoid] = parseInt(obj.P1_001N, 10);
}

await writeFile(
  "scripts/king-county-block-population.json",
  JSON.stringify(popByGeoid, null, 2)
);

console.log("Saved scripts/king-county-block-population.json");