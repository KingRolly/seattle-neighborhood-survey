"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
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
        zoom: 10,
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
