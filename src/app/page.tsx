"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { supabase } from "@/lib/supabaseClient";
import { point, booleanPointInPolygon } from "@turf/turf";

const COLOR_PALETTE = [
  "#d42727ff", // red
  "#2bbb3eff", // green
  "#2644aeff", // blue
  "#cbcb49ff", // yellow
  "#c162c1ff", // pink
];

const BANNER_IMAGES = [
  "/banner1.png",
  "/banner2.png",
  "/banner3.png",
  "/banner4.png",
  "/banner5.png",
  "/banner6.png",
  "/banner7.png",
  "/banner8.png",
  "/banner9.png",
  "/banner10.png",
];

// --- Neighborhood coloring helpers ---

function computeNeighborhoodColors(
  neighborhoods: Record<string, Record<string, number>>,
  blockAdjacency: Record<string, string[]>
): Record<string, string> {
  const majorityName: Record<string, string> = {};
  for (const [geoid, counts] of Object.entries(neighborhoods)) {
    let best = "";
    let bestCount = -1;
    for (const [name, count] of Object.entries(counts)) {
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    if (best) majorityName[geoid] = best;
  }

  const neighborhoodAdjacency: Record<string, Set<string>> = {};
  function ensureNode(name: string) {
    if (!neighborhoodAdjacency[name]) neighborhoodAdjacency[name] = new Set();
  }
  function addEdge(a: string, b: string) {
    ensureNode(a);
    ensureNode(b);
    neighborhoodAdjacency[a].add(b);
    neighborhoodAdjacency[b].add(a);
  }

  // Geometric adjacency — neighborhoods that border each other on the map
  for (const [geoid, name] of Object.entries(majorityName)) {
    ensureNode(name);
    const touchingGeoids = blockAdjacency[geoid] ?? [];
    for (const otherGeoid of touchingGeoids) {
      const otherName = majorityName[otherGeoid];
      if (otherName && otherName !== name) {
        addEdge(name, otherName);
      }
    }
  }

  // Co-occurrence adjacency — names competing for the same block must also differ
  for (const counts of Object.values(neighborhoods)) {
    const namesHere = Object.keys(counts);
    for (let i = 0; i < namesHere.length; i++) {
      for (let j = i + 1; j < namesHere.length; j++) {
        addEdge(namesHere[i], namesHere[j]);
      }
    }
  }

  const orderedNames = Object.keys(neighborhoodAdjacency).sort(
    (a, b) => neighborhoodAdjacency[b].size - neighborhoodAdjacency[a].size
  );

  const assignedColor: Record<string, string> = {};

  for (const name of orderedNames) {
    const neighborColors = new Set(
      Array.from(neighborhoodAdjacency[name])
        .map((n) => assignedColor[n])
        .filter(Boolean)
    );

    const startIndex = hashString(name) % COLOR_PALETTE.length;
    let availableColor: string | undefined;
    for (let offset = 0; offset < COLOR_PALETTE.length; offset++) {
      const candidate = COLOR_PALETTE[(startIndex + offset) % COLOR_PALETTE.length];
      if (!neighborColors.has(candidate)) {
        availableColor = candidate;
        break;
      }
    }

    if (!availableColor) {
      console.warn(
        `Ran out of colors for "${name}" — reusing a color; a same-color adjacency may appear.`
      );
    }

    assignedColor[name] =
      availableColor ?? COLOR_PALETTE[orderedNames.indexOf(name) % COLOR_PALETTE.length];
  }

  return assignedColor;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.substring(0, 2), 16),
    parseInt(clean.substring(2, 4), 16),
    parseInt(clean.substring(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function blendColors(
  counts: Record<string, number>,
  neighborhoodColors: Record<string, string>
): string {
  const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
  if (total === 0) return "#576373";

  let r = 0, g = 0, b = 0;
  for (const [name, count] of Object.entries(counts)) {
    const color = neighborhoodColors[name];
    if (!color) continue;
    const [cr, cg, cb] = hexToRgb(color);
    const weight = count / total;
    r += cr * weight;
    g += cg * weight;
    b += cb * weight;
  }
  return rgbToHex(r, g, b);
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// --- Misc helpers ---

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeName(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  return collapsed
    .split(" ")
    .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join(" ");
}

function capitalizeWords(str: string): string {
  return str.replace(/[a-zA-Z]+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

export default function Home() {
  // --- Refs ---
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const popupRef = useRef<any>(null);
  const prevColoredGeoidsRef = useRef<Set<string>>(new Set());
  const neighborhoodsRef = useRef<Record<string, Record<string, number>>>({});
  const neighborhoodColorsRef = useRef<Record<string, string>>({});
  const selectedBlockIdRef = useRef<string | null>(null);
  const blocksGeoJsonRef = useRef<any>(null);

  // --- State ---
  const [mapReady, setMapReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedGeoid, setSelectedGeoid] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [formVisible, setFormVisible] = useState(false);
  const [neighborhoods, setNeighborhoods] = useState<Record<string, Record<string, number>>>({});
  const [hasLoaded, setHasLoaded] = useState(false);
  const [blockAdjacency, setBlockAdjacency] = useState<Record<string, string[]>>({});
  const [ownSubmission, setOwnSubmission] = useState<{ geoid: string; name: string } | null>(null);
  const [addressInput, setAddressInput] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [bannerIndex, setBannerIndex] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
const [isNarrowScreen, setIsNarrowScreen] = useState(false);
const [suggestionsOpen, setSuggestionsOpen] = useState(false);
const [faqOpen, setFaqOpen] = useState(false);

  const neighborhoodColors = useMemo(
    () => computeNeighborhoodColors(neighborhoods, blockAdjacency),
    [neighborhoods, blockAdjacency]
  );

  const qualifyingNames = useMemo(() => {
  const nameCounts: Record<string, number> = {};
  let total = 0;

  for (const counts of Object.values(neighborhoods)) {
    for (const [name, count] of Object.entries(counts)) {
      nameCounts[name] = (nameCounts[name] ?? 0) + count;
      total += count;
    }
  }

  if (total === 0) return [];

  return Object.entries(nameCounts)
    .filter(([, count]) => count >= 5 && count / total >= 0.01)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}, [neighborhoods]);

const matchingSuggestions = useMemo(() => {
  const typed = nameInput.trim().toLowerCase();
  if (typed.length === 0) return [];
  const limit = isNarrowScreen ? 3 : 10;
  return qualifyingNames
    .filter((name) => name.toLowerCase().includes(typed))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}, [qualifyingNames, nameInput, isNarrowScreen]);

  // --- Session ID (one submission per browser session) ---
  useEffect(() => {
    let id = sessionStorage.getItem("session-id");
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem("session-id", id);
    }
    setSessionId(id);
  }, []);

  // --- Map setup ---
  useEffect(() => {
    let map: any;
    let cancelled = false;

    async function createMap() {
      const maplibregl = await import("maplibre-gl");

      if (cancelled || !mapContainer.current) return;

      map = new maplibregl.Map({
        container: mapContainer.current,
        style: "https://tiles.openfreemap.org/styles/positron",
        center: [-122.3321, 47.6062],
        zoom: 12,
        maxZoom: 18,
        maxBounds: [
          [-122.65, 47.45], // southwest corner [lng, lat]
          [-121.99, 47.78], // northeast corner [lng, lat]
        ],
      });

      map.on("load", () => {
        if (cancelled) return;

        map.addSource("seattle-blocks", {
          type: "geojson",
          data: "/seattle-blocks.geojson",
          promoteId: "GEOID_20",
        });

        map.addLayer({
          id: "seattle-block-fills",
          type: "fill",
          source: "seattle-blocks",
          filter: [">", ["get", "POPULATION"], 0],
          paint: {
            "fill-color": ["coalesce", ["feature-state", "color"], "#576373"],
            "fill-opacity": [
              "case",
              ["!=", ["feature-state", "color"], null],
              0.6,
              0,
            ],
          },
        });

        map.addLayer({
  id: "seattle-block-outlines",
  type: "line",
  source: "seattle-blocks",
  filter: [">", ["get", "POPULATION"], 0],
  paint: {
    "line-color": "#333",
    "line-width": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      2,
      ["boolean", ["feature-state", "hover"], false],
      2,
      0.1,
    ],
    "line-opacity": [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      1,
      ["boolean", ["feature-state", "hover"], false],
      1,
      0,
    ],
  },
});

        map.addSource("seattle-city-limits", {
          type: "geojson",
          data: "/seattle-city-limits.geojson",
        });

        map.addLayer({
          id: "seattle-city-limits-line",
          type: "line",
          source: "seattle-city-limits",
          paint: {
            "line-color": "#8c6262ff",
            "line-width": 2,
            "line-dasharray": [2, 2],
          },
        });

        popupRef.current = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          className: "block-popup",
          anchor: "bottom-left",
          offset: [0, -25],
        });

        // Hide neighborhood/city/town/airport labels from the basemap
        map.setLayoutProperty("label_other", "visibility", "none");
        map.setLayoutProperty("airport", "visibility", "none");
        map.setLayoutProperty("label_city", "visibility", "none");
        map.setLayoutProperty("label_city_capital", "visibility", "none");
        map.setLayoutProperty("label_town", "visibility", "none");
        map.setLayoutProperty("label_village", "visibility", "none");

        // Make street labels more visible
        map.setPaintProperty("highway-name-major", "text-opacity", 1);
        map.setPaintProperty("highway-name-minor", "text-opacity", 1);
        map.setPaintProperty("highway-name-major", "text-halo-width", 3);
        map.setPaintProperty("highway-name-minor", "text-halo-width", 3);
        map.setPaintProperty("highway-name-major", "text-color", "#404040");
        map.setPaintProperty("highway-name-minor", "text-color", "#404040");

        let hoveredBlockId: string | null = null;

        map.on("mousemove", "seattle-block-fills", (e: any) => {
          if (!e.features || e.features.length === 0) return;
          map.getCanvas().style.cursor = "pointer";
          if (hoveredBlockId !== null) {
            map.setFeatureState({ source: "seattle-blocks", id: hoveredBlockId }, { hover: false });
          }
          hoveredBlockId = e.features[0].id;
          map.setFeatureState({ source: "seattle-blocks", id: hoveredBlockId }, { hover: true });

          const counts = neighborhoodsRef.current[hoveredBlockId!];
let html = `<div class="block-popup-title" style="font-family: Crete Round, serif;">Where is this?</div>`;
if (counts && Object.keys(counts).length > 0) {
  const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
  html += Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => {
      const pct = Math.round((count / total) * 100);
      const color = neighborhoodColorsRef.current[name] ?? "#576373";
      return `<div class="block-popup-row" style="font-family: Crete Round, sans-serif;">
  <span class="block-popup-swatch" style="background:${color}"></span>
  <span style="color:${color}">${escapeHtml(capitalizeWords(name))}: ${count} (${pct}%)</span>
</div>`;
    })
    .join("");
  html += `<div class="block-popup-row" style="font-family: Crete Round, serif; color: #888; margin-top: 4px;">${total} response${total === 1 ? "" : "s"}</div>`;
} else {
  html += `<div class="block-popup-row" style="font-family: Crete Round, serif;">No submissions yet</div>`;
}

          popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map);

          const popupEl = popupRef.current.getElement();
          popupEl.style.pointerEvents = "none";
          const contentEl = popupEl.querySelector(".maplibregl-popup-content");
          if (contentEl) {
            (contentEl as HTMLElement).style.pointerEvents = "none";
          }
        });

        map.on("mouseleave", "seattle-block-fills", () => {
          map.getCanvas().style.cursor = "";
          if (hoveredBlockId !== null) {
            map.setFeatureState({ source: "seattle-blocks", id: hoveredBlockId }, { hover: false });
          }
          hoveredBlockId = null;
          popupRef.current?.remove();
        });

        map.on("click", "seattle-block-fills", (e: any) => {
          if (!e.features || e.features.length === 0) return;
          selectBlock(e.features[0].properties.GEOID_20);
        });

        mapRef.current = map;
        setMapReady(true);
      });
    }

    createMap();

    return () => {
      cancelled = true;
      if (mapRef.current === map) {
        mapRef.current = null;
      }
      if (map) {
        map.remove();
      }
    };
  }, []);

  // --- Reset the naming form whenever a new block is selected ---
  useEffect(() => {
    setNameInput("");
    setFormVisible(true);
  }, [selectedGeoid]);

  // --- Load + aggregate submissions from Supabase ---
  async function loadNeighborhoods() {
    const { data, error } = await supabase
      .from("submissions")
      .select("geoid, neighborhood_name");

    if (error) {
      console.error("Failed to load submissions:", error);
      return;
    }

    const aggregated: Record<string, Record<string, number>> = {};
    for (const row of data) {
      const name = normalizeName(row.neighborhood_name);

      if (!aggregated[row.geoid]) aggregated[row.geoid] = {};
      aggregated[row.geoid][name] = (aggregated[row.geoid][name] ?? 0) + 1;
    }

    setNeighborhoods(aggregated);
    setHasLoaded(true);
  }

  useEffect(() => {
    loadNeighborhoods();
  }, []);

  // --- Load block adjacency data (for coloring) ---
  useEffect(() => {
    fetch("/block-adjacency.json")
      .then((res) => res.json())
      .then(setBlockAdjacency)
      .catch((err) => console.error("Failed to load block adjacency:", err));
  }, []);

  // --- Load raw block geometry (for address-search point-in-polygon matching) ---
  useEffect(() => {
    fetch("/seattle-blocks.geojson")
      .then((res) => res.json())
      .then((data) => {
        blocksGeoJsonRef.current = data;
      })
      .catch((err) => console.error("Failed to load blocks for address lookup:", err));
  }, []);

  // --- Recompute + apply block colors whenever submissions/adjacency change ---
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (Object.keys(blockAdjacency).length === 0) return;

    neighborhoodColorsRef.current = neighborhoodColors;

    const currentGeoids = new Set(Object.keys(neighborhoods));

    for (const geoid of prevColoredGeoidsRef.current) {
      if (!currentGeoids.has(geoid)) {
        mapRef.current.removeFeatureState({ source: "seattle-blocks", id: geoid }, "color");
      }
    }

    for (const [geoid, counts] of Object.entries(neighborhoods)) {
      const blended = blendColors(counts, neighborhoodColors);
      mapRef.current.setFeatureState(
        { source: "seattle-blocks", id: geoid },
        { color: blended }
      );
    }

    prevColoredGeoidsRef.current = currentGeoids;
  }, [neighborhoods, blockAdjacency, mapReady, neighborhoodColors]);

  // --- Check whether this session already has a submission elsewhere ---
  useEffect(() => {
    if (!sessionId) return;

    supabase
      .from("submissions")
      .select("geoid, neighborhood_name")
      .eq("session_id", sessionId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error("Failed to check existing submission:", error);
          return;
        }
        if (data) {
          setOwnSubmission({ geoid: data.geoid, name: normalizeName(data.neighborhood_name) });
        }
      });
  }, [sessionId, neighborhoods]);

  // --- Keep a ref mirror of neighborhoods (for use inside map event closures) ---
  useEffect(() => {
    neighborhoodsRef.current = neighborhoods;
  }, [neighborhoods]);

  // --- Escape key closes the naming form ---
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedGeoid && formVisible) {
        handleCancelForm();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedGeoid, formVisible]);

  // --- Sidebar banner image rotation ---
  useEffect(() => {
    const interval = setInterval(() => {
      setBannerIndex((prev) => (prev + 1) % BANNER_IMAGES.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
  const mq = window.matchMedia("(max-width: 700px)");
  setIsNarrowScreen(mq.matches);
  function handleChange(e: MediaQueryListEvent) {
    setIsNarrowScreen(e.matches);
  }
  mq.addEventListener("change", handleChange);
  return () => mq.removeEventListener("change", handleChange);
}, []);

function toggleSidebar() {
  setSidebarOpen((prev) => !prev);
  setTimeout(() => {
    mapRef.current?.resize();
  }, 300);
}

  // --- Shared block-selection logic (used by both map clicks and address search) ---
  function selectBlock(geoid: string) {
    if (!mapRef.current) return;

    if (selectedBlockIdRef.current !== null) {
      mapRef.current.setFeatureState(
        { source: "seattle-blocks", id: selectedBlockIdRef.current },
        { selected: false }
      );
    }

    selectedBlockIdRef.current = geoid;
    mapRef.current.setFeatureState(
      { source: "seattle-blocks", id: geoid },
      { selected: true }
    );

    setSelectedGeoid(geoid);
  }

  // --- Address search: geocode -> find containing block -> select it ---
  async function handleAddressSearch(e: React.FormEvent) {
    e.preventDefault();
    setAddressError(null);

    const query = addressInput.trim();
    if (!query) return;

    setIsSearching(true);
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "json");
      url.searchParams.set("q", query);
      url.searchParams.set("countrycodes", "us");
      url.searchParams.set("viewbox", "-122.4596,47.7341,-122.2244,47.4919");
      url.searchParams.set("bounded", "1");
      url.searchParams.set("limit", "1");

      const res = await fetch(url.toString());
      const results = await res.json();

      if (!results || results.length === 0) {
        setAddressError("Address not found. You may have mispelled something or forgotten a directional designation.");
        return;
      }

      const lng = parseFloat(results[0].lon);
      const lat = parseFloat(results[0].lat);

      if (!mapRef.current) return;
      mapRef.current.flyTo({ center: [lng, lat], zoom: 16 });

      const blocksData = blocksGeoJsonRef.current;
      if (!blocksData) {
        setAddressError("Block data still loading — try again in a moment.");
        return;
      }

      const searchPoint = point([lng, lat]);
      const match = blocksData.features.find((f: any) => booleanPointInPolygon(searchPoint, f));

      if (!match) {
        setAddressError("Try an address within Seattle.");
        return;
      }

      selectBlock(match.properties.GEOID_20);

if (isNarrowScreen && sidebarOpen) {
  setSidebarOpen(false);
  setTimeout(() => {
    mapRef.current?.resize();
  }, 300);
}
      
    } catch (err) {
      console.error("Address search failed:", err);
      setAddressError("Something went wrong searching for that address.");
    } finally {
      setIsSearching(false);
    }
  }

  // --- Save a neighborhood name for the selected block ---
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedGeoid || nameInput.trim() === "" || !sessionId) return;

    const name = normalizeName(nameInput);

    const { error } = await supabase
      .from("submissions")
      .upsert(
        { geoid: selectedGeoid, neighborhood_name: name, session_id: sessionId },
        { onConflict: "session_id" }
      );

    if (error) {
      console.error("Failed to save submission:", error);
      return;
    }

    setNameInput("");
    setFormVisible(false);
    await loadNeighborhoods();
  }

  // --- Cancel out of the naming form (Escape key or × button) ---
  function handleCancelForm() {
    if (selectedBlockIdRef.current !== null && mapRef.current) {
      mapRef.current.setFeatureState(
        { source: "seattle-blocks", id: selectedBlockIdRef.current },
        { selected: false }
      );
    }
    selectedBlockIdRef.current = null;
    setSelectedGeoid(null);
    setFormVisible(false);
    setNameInput("");
  }

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh" }}>
      <aside
  style={{
    width: sidebarOpen ? 320 : 0,
    flexShrink: 0,
    background: "#1a1a1a",
    color: "#eee",
    padding: sidebarOpen ? "20px" : "0px",
    overflowY: "auto",
    overflowX: "hidden",
    boxSizing: "border-box",
    transition: "width 0.3s ease, padding 0.3s ease",
    position: "relative",
  }}
>
    <button
  onClick={() => setFaqOpen(true)}
  aria-label="Frequently asked questions"
  style={{
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 30,
    width: 28,
    height: 28,
    background: "white",
    color: "#333",
    border: "1px solid #ccc",
    borderRadius: 0,
    cursor: "pointer",
    fontSize: 14,
    fontFamily: "Crete Round, serif",
  }}
>
  ?
</button>
    <button
  onClick={toggleSidebar}
  aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
  style={{
  position: "fixed",
  top: "50%",
  left: sidebarOpen ? 320 : 8,
  transform: "translateY(-50%)",
  zIndex: 10,
  width: 28,
  height: 48,
  background: "#1a1a1a",
  color: "#eee",
  border: "none",
  cursor: "pointer",
  fontSize: 14,
  transition: "left 0.3s ease",
}}
>
  {sidebarOpen ? "‹" : "›"}
</button>
        <link href="https://fonts.googleapis.com/css2?family=Righteous&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Crete Round&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Radio Canada&display=swap" rel="stylesheet" />

        <div style={{ position: "relative", width: "100%", height: 120, marginBottom: 16, overflow: "hidden" }}>
          {BANNER_IMAGES.map((src, i) => (
            <img
              key={src}
              src={src}
              alt="A series of images showing neighborhoods in Seattle."
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: i === bannerIndex ? 1 : 0,
                transition: "opacity 1s ease-in-out",
              }}
            />
          ))}
        </div>

        <h1
          style={{
            fontSize: 36,
            color: "#ffffff",
            marginTop: 0,
            marginBottom: 8,
            lineHeight: 1,
            fontFamily: "Righteous, sans-serif",
            fontWeight: "bold",
          }}
        >
          Seattle Neighborhoods, According to Seattleites
        </h1>

        <p style={{ fontFamily: "Crete Round, serif", fontSize: 12, color: "#777", lineHeight: 1.5, marginBottom: 10 }}>
          Inspired by the <i>New York Times'</i> ‎ "An Extremely Detailed Map of New York City Neighborhoods."
        </p>
        <p style={{ fontFamily: "Crete Round, serif", fontSize: 16, color: "#ccc", lineHeight: 1.5, marginBottom: 10 }}>
          Click on any block to see previous responses or submit your own neighborhood!
        </p>
        <p style={{ fontFamily: "Crete Round, serif", fontSize: 12, color: "#777", lineHeight: 1.5, marginBottom: 10 }}>
          The block you enter will not be associated with your name or any other personal info, and is only used in aggregate for this project.
        </p>

        <form onSubmit={handleAddressSearch} style={{ display: "flex", flexDirection: "column" }}>
          <label style={{ fontFamily: "Crete Round, serif", fontSize: 16, color: "#ccc", marginTop: 0 }}>
            Find a block by address:
          </label>
          <input
            type="text"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="e.g. 400 Broad St"
            style={{
              fontFamily: "Radio Canada, sans-serif",
              padding: "6px 8px",
              fontSize: 14,
              border: "1px solid #444",
              borderRadius: 0,
              background: "#111",
              color: "#eee",
            }}
          />
          <button
            type="submit"
            disabled={isSearching}
            style={{ fontFamily: "Crete Round, serif", fontSize: 16, cursor: "pointer", borderRadius: 0, marginTop: 5 }}
          >
            {isSearching ? "Searching..." : "Find"}
          </button>
        </form>

        {addressError && (
          <div style={{ fontFamily: "Crete Round, serif", fontSize: 12, color: "#f87171", marginTop: 5 }}>
            {addressError}
          </div>
        )}
      </aside>
{faqOpen && (
  <div
    onClick={() => setFaqOpen(false)}
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.5)",
      zIndex: 40,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: "white",
        padding: 24,
        maxWidth: 480,
        width: "90%",
        maxHeight: "80vh",
        overflowY: "auto",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontFamily: "Righteous, sans-serif", fontSize: 20, margin: 0, color: "#1a1a1a" }}>
          FAQ
        </h2>
        <button
          onClick={() => setFaqOpen(false)}
          aria-label="Close"
          style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#666" }}
        >
          ×
        </button>
      </div>

      <div style={{ fontFamily: "Crete Round, serif", fontSize: 14, color: "#333", lineHeight: 1.6 }}>
        <p><strong>Why are some blocks not clickable or oddly-shaped?</strong><br />Blocks with no population are not available to be clicked. Weird shapes are a result of how blocks are defined in the 2020 US Census data.</p>
        <p><strong>Can I change my answer?</strong><br />Yes, but only while you keep the tab open. After closing, your answer is locked in.</p>
        <p><strong>Is my submission anonymous?</strong><br />No information about you is kept by this website. All I store is a list of blocks and the neighborhoods reported for them.</p>
      </div>
    </div>
  </div>
)}

      <div style={{ position: "relative", flex: 1 }}>
        <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />

        <style jsx global>{`
          .maplibregl-popup.block-popup {
            pointer-events: none;
          }
          .maplibregl-popup.block-popup .maplibregl-popup-content {
            background: white;
            border-radius: 0px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            padding: 10px 14px;
            position: relative;
          }
          .maplibregl-popup.block-popup .maplibregl-popup-content::after {
            content: "";
            position: absolute;
            bottom: -14px;
            left: 0px;
            width: 0;
            height: 0;
            border-right: 20px solid transparent;
            border-top: 30px solid white;
          }
          .block-popup-title {
            font-size: 11px;
            color: #888;
            margin-bottom: 4px;
          }
          .block-popup-row {
            font-size: 12px;
            color: #333;
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 2px;
          }
          .block-popup-swatch {
            display: inline-block;
            width: 10px;
            height: 10px;
          }
          .maplibregl-popup.block-popup .maplibregl-popup-tip {
            display: none;
          }
        `}</style>

        {selectedGeoid && formVisible && (
          <form
  onSubmit={handleSave}
  style={{
    position: "absolute",
    top: isNarrowScreen ? "max(20px, env(safe-area-inset-top))" : 10,
    left: 10,
    background: "white",
    padding: "12px 16px",
    borderRadius: 0,
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 220,
    maxWidth: "calc(100vw - 40px)",
  }}
>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontFamily: "Crete Round, serif", fontSize: 12, color: "#333", fontWeight: "bold" }}>
                What do you call this neighborhood?
              </label>
              <button
                type="button"
                onClick={handleCancelForm}
                aria-label="Cancel"
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 16,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: "0 0 0 8px",
                  color: "#666",
                }}
              >
                ×
              </button>
            </div>

            <div style={{ position: "relative" }}>
  <input
    type="text"
    value={nameInput}
    onChange={(e) => {
      setNameInput(e.target.value);
      setSuggestionsOpen(true);
    }}
    onFocus={() => {
      if (nameInput.trim().length > 0) setSuggestionsOpen(true);
    }}
    onBlur={() => {
      setTimeout(() => setSuggestionsOpen(false), 150);
    }}
    placeholder="e.g. Fremont"
    style={{ fontFamily: "Radio Canada, sans-serif", padding: "6px 8px", fontSize: 16, border: "1px solid #ccc", borderRadius: 0, width: "100%", boxSizing: "border-box" }}
    autoFocus
  />
  {suggestionsOpen && matchingSuggestions.length > 0 && (
    <div
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        background: "white",
        border: "1px solid #ccc",
        borderTop: "none",
        maxHeight: 160,
        overflowY: "auto",
        zIndex: 20,
      }}
    >
      {matchingSuggestions.map((name) => (
        <div
          key={name}
          onMouseDown={() => {
            setNameInput(capitalizeWords(name));
            setSuggestionsOpen(false);
          }}
          style={{
            padding: "6px 8px",
            fontSize: 14,
            fontFamily: "Radio Canada, sans-serif",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f0f0")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
        >
          {capitalizeWords(name)}
        </div>
      ))}
    </div>
  )}
</div>

            {ownSubmission && ownSubmission.geoid !== selectedGeoid && (
              <div style={{ fontFamily: "Crete Round, serif", fontSize: 12, color: "#f87171" }}>
                You've submitted "{capitalizeWords(ownSubmission.name)}" for a different block already. Saving will move your submission to this block.
              </div>
            )}

            <button type="submit" style={{ fontFamily: "Crete Round, serif", padding: "6px 8px", fontSize: 14, cursor: "pointer", borderRadius: 0 }}>
              Save
            </button>
          </form>
        )}
      </div>
    </div>
  );
}