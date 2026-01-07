// src/TradingAreaDistances.jsx
import React, { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import { MapContainer, TileLayer, Marker, Tooltip, Polyline, CircleMarker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/*
Expected CSV / records columns (best to match your existing app):
month, outlet_id, name, trading_area, company, lat, lng, ms, hsd, ms_ly, hsd_ly
*/

const STORAGE_KEY = "fuelmap_records_v4";

// simple fallback icon for markers
function fallbackIcon(company) {
    const initials = (company || "PVT").slice(0, 3).toUpperCase();
    const html = `<div style="width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#243746;color:#fff;font-weight:700;font-size:12px;">${initials}</div>`;
    return L.divIcon({ html, className: "fa-marker", iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36] });
}

// haversine distance in kilometers
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
    const toRad = deg => deg * Math.PI / 180;
    const R = 6371; // km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * (Math.sin(dLon / 2) ** 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

export default function TradingAreaDistances({ initialCenter = [10.913, 75.92], initialZoom = 13 }) {
    const [stations, setStations] = useState([]);
    const [selected, setSelected] = useState(null); // clicked outlet object
    const [connections, setConnections] = useState([]); // { station, distanceKm }
    const mapRef = useRef(null);

    // load CSV from public root OR localStorage
    useEffect(() => {
        const existing = loadFromLocalStorage();
        if (existing && existing.length) {
            setStations(normalizeRecords(existing));
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/stations.csv");
                if (!res.ok) return;
                const txt = await res.text();
                Papa.parse(txt, {
                    header: true, skipEmptyLines: true, complete: parsed => {
                        if (cancelled) return;
                        const rows = parsed.data.map((r, i) => ({
                            month: (r.month || '').toString().trim(),
                            outlet_id: (r.outlet_id || r.id || `row-${i}`).toString().trim(),
                            name: (r.name || '').toString().trim(),
                            trading_area: (r.trading_area || r.tradingArea || r.area || '').toString().trim(),
                            company: (r.company || '').toString().trim(),
                            lat: Number(r.lat), lng: Number(r.lng),
                            ms: Number(r.ms || 0), hsd: Number(r.hsd || 0),
                            ms_ly: Number(r.ms_ly || 0), hsd_ly: Number(r.hsd_ly || 0),
                        }));
                        // optional: save to localStorage so other component can read
                        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch (e) { }
                        setStations(normalizeRecords(rows));
                    }
                });
            } catch (e) { /* ignore */ }
        })();
        return () => { cancelled = true; };
    }, []);

    // normalize to ensure numeric lat/lng and trading_area_norm
    function normalizeRecords(rs) {
        return rs.map(r => ({
            ...r,
            lat: Number(r.lat) || 0,
            lng: Number(r.lng) || 0,
            trading_area: (r.trading_area || r.area || '').toString().trim(),
            trading_area_norm: (r.trading_area || r.area || '').toString().trim().toLowerCase()
        })).filter(r => r.lat && r.lng); // drop invalid coords
    }

    // called when user clicks a marker
    function onMarkerClick(station) {
        setSelected(station);
        computeConnections(station);
    }

    // compute outlets in same trading area that are within current map bounds; then compute distance
    function computeConnections(centerStation) {
        const map = mapRef.current;
        if (!map) return setConnections([]);
        const bounds = map.getBounds();
        const norm = (centerStation.trading_area || '').toString().trim().toLowerCase();

        const sameTA = stations.filter(s => (s.trading_area_norm || '') === norm && s.outlet_id !== centerStation.outlet_id);

        const visible = sameTA.filter(s => bounds.contains([s.lat, s.lng]));
        const conn = visible.map(s => {
            const km = haversineDistanceKm(centerStation.lat, centerStation.lng, s.lat, s.lng);
            return { station: s, distanceKm: km };
        }).sort((a, b) => a.distanceKm - b.distanceKm);

        setConnections(conn);
    }

    // recompute connections when map moves (so "within map area" is dynamic)
    function onMapMoveEnd() {
        if (!selected) return;
        computeConnections(selected);
    }

    // small helper to create icon (we only use fallbackIcon here; you can plug logos)
    function iconFor(company) {
        return fallbackIcon(company);
    }

    return (
        <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
            <div style={{ flex: 1 }}>
                <MapContainer
                    center={initialCenter}
                    zoom={initialZoom}
                    whenCreated={(m) => { mapRef.current = m; }}
                    style={{ height: "100%", width: "100%" }}
                    eventHandlers={{ moveend: onMapMoveEnd, zoomend: onMapMoveEnd }}
                >
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

                    {stations.map(s => (
                        <Marker
                            key={s.outlet_id || `${s.name}-${s.lat}-${s.lng}`}
                            position={[s.lat, s.lng]}
                            icon={iconFor(s.company)}
                            eventHandlers={{ click: () => onMarkerClick(s) }}
                        >
                            <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                                <div style={{ minWidth: 180 }}>
                                    <div style={{ fontWeight: 700 }}>{s.name}</div>
                                    <div style={{ color: '#555' }}>{s.company} • {s.trading_area}</div>
                                    <div style={{ marginTop: 6 }}>{s.ms ? `MS: ${s.ms}` : null} {s.hsd ? ` / HSD: ${s.hsd}` : null}</div>
                                </div>
                            </Tooltip>
                        </Marker>
                    ))}

                    {/* draw polylines from selected to each connected station */}
                    {selected && connections.map((c, i) => (
                        <React.Fragment key={i}>
                            <Polyline positions={[[selected.lat, selected.lng], [c.station.lat, c.station.lng]]} color={"#2563eb"} weight={2} dashArray={"6 4"} />
                            <CircleMarker center={[c.station.lat, c.station.lng]} radius={6} pathOptions={{ color: "#10b981", fill: true, fillOpacity: 1 }}>
                                <Tooltip direction="right" offset={[8, 0]} permanent={false}>
                                    <div style={{ fontSize: 12 }}>{c.station.name}<br />{c.distanceKm.toFixed(2)} km</div>
                                </Tooltip>
                            </CircleMarker>
                        </React.Fragment>
                    ))}

                    {/* highlight selected marker with a larger circle */}
                    {selected && (
                        <CircleMarker center={[selected.lat, selected.lng]} radius={8} pathOptions={{ color: "#ef4444", fill: true, fillOpacity: 1 }}>
                            <Tooltip direction="right" offset={[8, 0]} permanent={false}>
                                <div style={{ fontSize: 12 }}>{selected.name} (selected)</div>
                            </Tooltip>
                        </CircleMarker>
                    )}
                </MapContainer>
            </div>

            <aside style={{ width: 360, borderLeft: "1px solid #eee", padding: 16, overflow: "auto", background: "#fff" }}>
                <h3 style={{ marginTop: 0 }}>Trading Area Distances</h3>
                {!selected ? (
                    <div style={{ color: "#666" }}>Click an outlet on the map to see other outlets in the same trading area that are inside the current map view. Distances shown are great-circle (km).</div>
                ) : (
                    <div>
                        <div style={{ fontWeight: 800 }}>{selected.name}</div>
                        <div style={{ color: "#666", marginBottom: 8 }}>{selected.company} • {selected.trading_area}</div>
                        <div style={{ marginBottom: 12 }}><strong>Visible outlets in trading area:</strong> {connections.length}</div>

                        <div style={{ display: "grid", gap: 8 }}>
                            {connections.length === 0 && <div style={{ color: "#777" }}>No other outlets in this trading area are inside the current map view.</div>}
                            {connections.map((c, i) => (
                                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid #eef2f6" }}>
                                    <div>
                                        <div style={{ fontWeight: 700 }}>{c.station.name}</div>
                                        <div style={{ color: "#666", fontSize: 13 }}>{c.station.company}</div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                        <div style={{ fontWeight: 800 }}>{c.distanceKm.toFixed(2)} km</div>
                                        <div style={{ color: c.distanceKm < 1 ? "#10b981" : "#374151", fontSize: 12 }}>{c.distanceKm < 1 ? "very near" : ""}</div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div style={{ marginTop: 16 }}>
                            <button onClick={() => { if (mapRef.current && selected) mapRef.current.panTo([selected.lat, selected.lng]); }} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e6eef3", background: "#fff" }}>Center on selected outlet</button>
                        </div>
                    </div>
                )}
            </aside>
        </div>
    );
}
