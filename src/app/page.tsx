"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

export default function Home() {
  const mapContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: any;

    async function createMap() {
      const maplibregl = await import("maplibre-gl");

      if (!mapContainer.current) return;

      map = new maplibregl.Map({
        container: mapContainer.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [-122.3321, 47.6062],
        zoom: 12,
      });

      map.on("load", () => {
        map.addSource("seattle-blocks", {
          type: "geojson",
          data: "/seattle-blocks.geojson",
        });

        map.addLayer({
          id: "seattle-block-fills",
          type: "fill",
          source: "seattle-blocks",
          paint: {
            "fill-color": "#3388ff",
            "fill-opacity": 0.15,
          },
        });

        map.addLayer({
          id: "seattle-block-outlines",
          type: "line",
          source: "seattle-blocks",
          paint: {
            "line-color": "#333333",
            "line-width": 1,
            "line-opacity": 0.7,
          },
        });
      });
    }

    createMap();

    return () => {
      if (map) {
        map.remove();
      }
    };
  }, []);

  return (
    <main style={{ width: "100vw", height: "100vh" }}>
      <div
        ref={mapContainer}
        style={{ width: "100%", height: "100%" }}
      />
    </main>
  );
}