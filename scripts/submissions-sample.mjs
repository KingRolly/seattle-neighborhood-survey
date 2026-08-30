// One-time script: geocodes a list of (address, neighborhood name) pairs,
// matches each to a block, and inserts them as submissions.
// Run with: node scripts/seed-submissions.mjs

import { readFile } from "fs/promises";
import { createClient } from "@supabase/supabase-js";
import { point, booleanPointInPolygon } from "@turf/turf";

const SUPABASE_URL = "https://absbgwkhzteowvnjowms.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_zTHfBs5Zc3ATAzesXc4YGw_OPblsV9n";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const entries = [
  ["332 NW 74th St", "Greenwood"],
  ["1608 NW 67th St", "Ballard"],
  ["404 NW 72nd St", "Greenwood"],
  ["2633 NW 63rd St", "Ballard"],
  ["2859 29th Ave W", "Southeast Magnolia"],
  ["102 NW 73rd St", "Phinney Ridge"],
  ["6508 17th Ave NW", "Ballard"],
  ["2137 N 133rd St", "Northgate"],
  ["3626 Arapahoe Place W", "Magnolia"],
  ["332 NW 74th St", "Greenwood"],
  ["145 NW 77th St", "Greenwood"],
  ["6701 26th Ave NW", "Ballard"],
  ["333 NW 84th St", "Greenwood"],
  ["536 N 82nd St", "Greenwood"],
  ["530 N 102nd St", "Greenwood"],
  ["540 N 82nd st", "Greenwood"],
  ["342 NW 74th St", "Phinney Ridge"],
  ["6018 NE 61st Street", "Windermere"],
  ["336 NW 75th Street", "Greenwood"],
  ["145 NW 77th St", "Greenwood"],
  ["7006 2nd Ave NW", "Phinney Ridge"],
  ["136 N 81st St", "Greenwood"],
  ["5804 17th Ave NE", "Ravenna"],
  ["2506 E Ward St", "Arboretum"],
  ["4215 55th Ave NE", "Laurelhurst"],
  ["7038 20th Pl NE", "Ravenna"],
  ["330 NW 75th St Seattle WA", "Greenwood"],
  ["5827 McKinley Place N", "Tangletown"],
  ["322 NW 74th St", "Greenwood Phinney"],
  ["127 N 84th Street, seattle", "Greenwood"],
  ["336 NW 75th St", "Phinneywood"],
  ["333 NW 84th St", "Greenwood"],
  ["114 NW 81st St", "Greenwood"],
  ["1130 NW 54th St", "Ballard"],
  ["153 NW 82nd Street", "Greenwood/Phinneywood"],
  ["5210 11th Ave NE", "U District"],
  ["9046 18th Ave SW", "White Center"],
  ["539 N 80th St", "Phinney Ridge"],
  ["136 N 81st St", "Greenwood"],
  ["124 N 80th St", "Greenwood"],
  ["13521 Sherman Rd NE", "Broadview"],
  ["9517 Phinney Ave N", "Greenwood"],
  ["8617 3rd Ave NW", "Greenwood"],
  ["117 NW 82nd St", "Greenwood"],
  ["3643 38th Ave W", "Magnolia"],
  ["540 N 82nd St", "Greenwood"],
  ["8725 Evanston Ave N", "Greenwood"],
  ["544 N 77th St", "Greenwood"],
  ["8741 Palatine Ave N", "Greenwood"],
  ["7034 5th Ave NW", "Greenwood"],
  ["331 NW 75th St Seattle, WA 98118", "Phinney"],
  ["1914 E Aloha St", "Capitol Hill"],
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocode(address) {
  const query = /seattle/i.test(address) ? address : `${address}, Seattle, WA`;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("q", query);
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("viewbox", "-122.4596,47.7341,-122.2244,47.4919");
  url.searchParams.set("bounded", "1");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "seattle-neighborhoods-app-seed-script/1.0" },
  });
  const results = await res.json();

  if (!results || results.length === 0) return null;
  return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
}

console.log("Loading block geometries...");
const geojson = JSON.parse(await readFile("public/seattle-blocks.geojson", "utf-8"));

let succeeded = 0;
let geocodeFailed = 0;
let matchFailed = 0;

for (const [address, name] of entries) {
  try {
    const coords = await geocode(address);
    if (!coords) {
      console.warn(`GEOCODE FAILED: "${address}"`);
      geocodeFailed++;
      await sleep(1100);
      continue;
    }

    const searchPoint = point([coords.lng, coords.lat]);
    const match = geojson.features.find((f) => {
      try {
        return booleanPointInPolygon(searchPoint, f);
      } catch {
        return false;
      }
    });

    if (!match) {
      console.warn(`NO BLOCK MATCH: "${address}" (${coords.lat}, ${coords.lng})`);
      matchFailed++;
      await sleep(1100);
      continue;
    }

    const geoid = match.properties.GEOID_20;
    const sessionId = crypto.randomUUID();

    const { error } = await supabase
      .from("submissions")
      .insert({ geoid, neighborhood_name: name.trim(), session_id: sessionId });

    if (error) {
      console.error(`INSERT FAILED for "${address}":`, error.message);
    } else {
      console.log(`OK: "${address}" -> ${name.trim()} (block ${geoid})`);
      succeeded++;
    }
  } catch (err) {
    console.error(`ERROR processing "${address}":`, err.message);
  }

  await sleep(1100); // Nominatim's usage policy asks for max ~1 request/second
}

console.log(`\nDone. Succeeded: ${succeeded}, geocode failures: ${geocodeFailed}, no block match: ${matchFailed}`);