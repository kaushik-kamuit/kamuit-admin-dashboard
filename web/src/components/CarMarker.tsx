import { useMemo } from "react";
import L from "leaflet";
import { Marker, Popup } from "react-leaflet";

interface Props {
  position: [number, number];
  heading: number;
  label?: string;
  children?: React.ReactNode;
  onClick?: () => void;
}

const CAR_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <g transform="translate(18,18)">
    <circle r="16" fill="#1e293b" opacity="0.15"/>
    <circle r="13" fill="#ffffff" stroke="#1e293b" stroke-width="1.5"/>
    <g transform="translate(-8,-10)">
      <path d="M8 2 L14 8 L14 18 L2 18 L2 8 Z" fill="#22c55e" stroke="#15803d" stroke-width="0.8" stroke-linejoin="round"/>
      <rect x="3.5" y="8.5" width="9" height="3" rx="0.5" fill="#bbf7d0" opacity="0.7"/>
      <rect x="4" y="14" width="3" height="2" rx="0.5" fill="#fbbf24"/>
      <rect x="9" y="14" width="3" height="2" rx="0.5" fill="#fbbf24"/>
      <rect x="3" y="17" width="2.5" height="1.5" rx="0.5" fill="#374151"/>
      <rect x="10.5" y="17" width="2.5" height="1.5" rx="0.5" fill="#374151"/>
    </g>
  </g>
</svg>`;

function makeCarIcon(heading: number) {
  const svg = `
    <div style="
      transform: rotate(${heading}deg);
      width: 36px; height: 36px;
      transition: transform 0.6s ease;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
    ">${CAR_SVG}</div>`;

  return L.divIcon({
    className: "",
    html: svg,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

export default function CarMarkerComponent({ position, heading, label, children, onClick }: Props) {
  const icon = useMemo(() => makeCarIcon(heading), [heading]);

  return (
    <Marker
      position={position}
      icon={icon}
      eventHandlers={onClick ? { click: onClick } : undefined}
      zIndexOffset={1000}
    >
      {children ?? (label && <Popup><span className="text-xs font-medium">{label}</span></Popup>)}
    </Marker>
  );
}
