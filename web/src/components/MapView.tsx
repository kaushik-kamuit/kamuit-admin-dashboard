import { MapContainer, TileLayer, Polyline, Marker, CircleMarker, Popup, Rectangle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

// Leaflet's default marker images break under bundlers unless we rewrite them.
// We sidestep by using pure CircleMarker/Polyline which don't need sprites.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export type LatLng = [number, number];

export function Map({
  center,
  zoom = 12,
  height = 500,
  children,
  bounds,
}: {
  center: LatLng;
  zoom?: number;
  height?: number | string;
  children?: React.ReactNode;
  bounds?: L.LatLngBoundsExpression;
}) {
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (mapRef.current && bounds) {
      mapRef.current.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [20, 20] });
    }
  }, [bounds]);

  return (
    <div style={{ height }}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: "100%", width: "100%" }}
        ref={(m) => {
          if (m) mapRef.current = m;
        }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {children}
      </MapContainer>
    </div>
  );
}

export { Polyline, Marker, CircleMarker, Popup, Rectangle };
