import React, { useState, useMemo, useEffect, useRef } from "react";
import Papa from "papaparse";
import { MapContainer, TileLayer, Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ---------- config ---------- */
const STORAGE_KEY = "fuelmap_records_v4";

/* ---------- global styles to ensure full-height map and tooltip layout ---------- */

if (typeof document !== "undefined") {
  const id = "fuel-map-global-style-v4";
  if (!document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.innerHTML = `
      html, body, #root { height: 100%; margin: 0; padding: 0; }
      .leaflet-container { height: 100% !important; width: 100% !important; }
      .tooltip-grid { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: start; }
      .tooltip-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }

      @keyframes fadeInScale {
        from { opacity: 0; transform: scale(0.9); }
        to   { opacity: 1; transform: scale(1); }
      }

      @keyframes pulseGlow {
        0% { transform: scale(0.9); opacity: 0.7; }
        50% { transform: scale(1.1); opacity: 1; }
        100% { transform: scale(0.9); opacity: 0.7; }
      }
        /* Cumulative toggle button */
.cum-toggle {
  display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:8px; border:1px solid rgba(14,165,233,0.12);
  background: #fff; cursor:pointer; transition: transform .14s ease, box-shadow .14s ease;
}
.cum-toggle:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(14,165,233,0.12); }
.cum-toggle.active { background: linear-gradient(90deg,#EEF2FF,#F0F9FF); border-color: rgba(59,130,246,0.3); box-shadow: 0 6px 18px rgba(59,130,246,0.12); }
.cum-toggle .arrow { transition: transform .22s ease; }
.cum-toggle.active .arrow { transform: rotate(180deg); }

    `;
    document.head.appendChild(s);
  }
}



/* ---------- helpers ---------- */
// helper to produce a stable key for an outlet row/object
function outletKeyForRow(r) {
  if (!r) return "";
  if (r.outlet_id || r.id) return String(r.outlet_id || r.id);
  const name = (r.name || "").toString().trim().toLowerCase();
  const lat = Number(r.lat || 0);
  const lng = Number(r.lng || 0);
  const latr = Math.round(lat * 1e5) / 1e5;
  const lngr = Math.round(lng * 1e5) / 1e5;
  return `${name}::${latr}::${lngr}`;
}

function loadRecords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn("loadRecords error", e);
    return [];
  }
}
function saveRecords(records) { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }

function fallbackIcon(company) {
  const initials = (company || "PVT").slice(0, 3).toUpperCase();
  const html = `<div style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:#444;color:#fff;font-weight:700;font-size:11px;">${initials}</div>`;
  return L.divIcon({ html, className: "custom-logo-marker", iconSize: [36, 36], popupAnchor: [0, -18] });
}

function formatMonth(monthStr) {
  if (!monthStr) return "";
  const [y, m] = monthStr.split("-");
  const d = new Date(Number(y), Number(m) - 1);
  return d.toLocaleString("default", { month: "short", year: "numeric" });
}

function calcGrowth(curr, prev) {
  const c = Number(curr || 0);
  const p = Number(prev || 0);
  if (p === 0) return c === 0 ? 0 : 100;
  return ((c - p) / p) * 100;
}

function PercentBadge({ value }) {
  const positive = value >= 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '4px 8px', borderRadius: 8,
      background: positive ? '#DCFCE7' : '#FEE2E2', color: positive ? '#064E3B' : '#7F1D1D', fontWeight: 700, fontSize: 12
    }}>{positive ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%</span>
  );
}

function VolumeChange({ curr, prev }) {
  const diff = Number(curr || 0) - Number(prev || 0);
  const positive = diff >= 0;
  const sign = positive ? "+" : "-";
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 8px', borderRadius: 8, background: positive ? '#ECFDF5' : '#FEF2F2', color: positive ? '#064E3B' : '#7F1D1D', fontWeight: 700 }}>{sign}{Math.abs(diff).toLocaleString()}</span>
  );
}

/* small component used in market share table */
function ShareChange({ value }) {
  const positive = value >= 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 8px', borderRadius: 8, background: positive ? '#ECFDF5' : '#FEE2E2', color: positive ? '#064E3B' : '#7F1D1D', fontWeight: 700 }}>{positive ? '▲' : '▼'} {Math.abs(value).toFixed(2)} pp</span>
  );
}

// small helper to build sorted unique months (descending)
function uniqueSortedMonths(records) {
  const s = new Set(records.map(r => (r.month || '').toString().trim()).filter(Boolean));
  // convert to array and sort descending (newest first)
  return Array.from(s).sort((a,b) => (a > b ? -1 : a < b ? 1 : 0));
}

function MonthSelector({ records, value, onChange }) {
  const months = uniqueSortedMonths(records);
  if (!months.length) return null;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <label style={{ color: '#475569', fontSize: 13, minWidth: 70 }}>Month</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid #E6EEF3',
          background: '#fff',
          fontSize: 13
        }}
      >
        {months.map(m => (
          <option key={m} value={m}>
            { /* human friendly label: "Apr 2025" */ }
            {(() => {
              const [y, mm] = m.split('-');
              if (!y || !mm) return m;
              const d = new Date(Number(y), Number(mm)-1);
              return d.toLocaleString('default', { month: 'short', year: 'numeric' });
            })()}
          </option>
        ))}
      </select>
    </div>
  );
}

// parse YYYY-MM to a comparable number (YYYY*12 + month) for easy month-range checks
function monthToken(monthStr) {
  if (!monthStr) return -Infinity;
  const [y, m] = monthStr.split('-').map(Number);
  if (!y || !m) return -Infinity;
  return y * 12 + (m - 1);
}

// inclusive check if monthStr is between start (YYYY-MM) and end (YYYY-MM)
function monthInRange(monthStr, startStr, endStr) {
  const t = monthToken(monthStr);
  return t >= monthToken(startStr) && t <= monthToken(endStr);
}

// compute cumulative sums for an outlet rows array between startMonth and endMonth (both YYYY-MM inclusive)
function cumulativeForOutletRows(rows, startMonth, endMonth) {
  const sum = { ms: 0, hsd: 0, ms_ly: 0, hsd_ly: 0 };
  rows.forEach(r => {
    const m = (r.month || '').toString();
    if (monthInRange(m, startMonth, endMonth)) {
      sum.ms += Number(r.ms || 0);
      sum.hsd += Number(r.hsd || 0);
      sum.ms_ly += Number(r.ms_ly || 0);
      sum.hsd_ly += Number(r.hsd_ly || 0);
    }
  });
  return sum;
}
function cumulativeForAreaOutlets(areaOutlets, startMonth, endMonth) {
  return areaOutlets.map(o => {
    const sums = cumulativeForOutletRows(o.rows || [], startMonth, endMonth);
    return {
      ...o,
      ms: sums.ms,
      ms_ly: sums.ms_ly,
      hsd: sums.hsd,
      hsd_ly: sums.hsd_ly
    };
  });
}


// compute cumulative market share for a trading area (array of outlet aggregated station objects)
// expects each station to have rows[] (all months)
function computeCumulativeMarketShareForArea(outlets, startMonth, endMonth) {
  const totals = {};
  outlets.forEach(o => {
    const key = (o.company || 'PVT').toString().toUpperCase();
    if (!totals[key]) totals[key] = { ms: 0, ms_ly: 0 };
    const c = cumulativeForOutletRows(o.rows || [], startMonth, endMonth);
    totals[key].ms += c.ms;
    totals[key].ms_ly += c.ms_ly;
  });
  const total_ms = Object.values(totals).reduce((s, c) => s + c.ms, 0);
  const total_ms_ly = Object.values(totals).reduce((s, c) => s + c.ms_ly, 0);
  return Object.entries(totals).map(([company, vals]) => ({
    company,
    ms: vals.ms,
    ms_ly: vals.ms_ly,
    share: total_ms ? (vals.ms / total_ms * 100) : 0,
    share_ly: total_ms_ly ? (vals.ms_ly / total_ms_ly * 100) : 0,
    share_change: (total_ms && total_ms_ly) ? ((vals.ms / total_ms * 100) - (vals.ms_ly / total_ms_ly * 100)) : 0
  })).sort((a,b)=>b.share - a.share);
}


/* ---------- main app ---------- */
export default function FuelMapApp() {
  const [records, setRecords] = useState(() => loadRecords());
  const [stations, setStations] = useState([]);
  const [iconsMap, setIconsMap] = useState({});
  const [selected, setSelected] = useState(null);
// pick latest month from CSV records, falling back to calendar if empty
const [latestMonth, setLatestMonth] = useState(() => {
  const recs = loadRecords();
  if (recs && recs.length > 0) {
    const months = uniqueSortedMonths(recs);
    return months[0]; // newest first
  }
  // fallback to calendar month if no CSV yet
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
});

  const mapRef = useRef(null);
  const [pageIndex, setPageIndex] = useState(0);

  // ref to hold last fetched CSV text for change detection (auto-refresh)
  const lastCsvTextRef = useRef(null);

  // Build stations and include normalized trading_area_norm
  useEffect(() => {
    const byId = {};
    records.forEach(r => {
      const id = r.outlet_id || `${r.name}-${r.trading_area}`;
      if (!byId[id]) byId[id] = [];
      byId[id].push(r);
    });
    const st = Object.entries(byId).map(([id, rows]) => {
      const latest = rows.find(x => x.month === latestMonth) || rows[rows.length - 1] || {};
      const trading_area_raw = (latest.trading_area || latest.tradingArea || latest.area || '').toString().trim();
      return {
        id,
        name: latest.name || "",
        company: (latest.company || "").toString().trim(),
        trading_area: trading_area_raw,
        trading_area_norm: trading_area_raw.toLowerCase(),
        lat: Number(latest.lat) || 0,
        lng: Number(latest.lng) || 0,
        month: latest.month || "",
        ms: Number(latest.ms || 0),
        ms_ly: Number(latest.ms_ly || 0),
        hsd: Number(latest.hsd || 0),
        hsd_ly: Number(latest.hsd_ly || 0),
        rows
      };
    });
    setStations(st);
    saveRecords(records);
  }, [records, latestMonth]);

  // ✅ NEW EFFECT: keep selected RO pinned but refresh its month-specific values
  useEffect(() => {
    if (typeof setCumulativeMode === "function") {
    setCumulativeMode(pageIndex === 1);
  }
    if (!selected) return;
    if (!stations || stations.length === 0) return;

    const selectedKey = outletKeyForRow(selected);
    const match = stations.find(s => outletKeyForRow(s) === selectedKey);

    if (!match) return;

    setSelected(prev => {
      if (!prev) return { ...match, trading_area_norm: match.trading_area_norm || (match.trading_area || '').toLowerCase() };
      return {
        ...prev,
        month: match.month ?? prev.month,
        ms: typeof match.ms === 'number' ? match.ms : prev.ms,
        ms_ly: typeof match.ms_ly === 'number' ? match.ms_ly : prev.ms_ly,
        hsd: typeof match.hsd === 'number' ? match.hsd : prev.hsd,
        hsd_ly: typeof match.hsd_ly === 'number' ? match.hsd_ly : prev.hsd_ly,
        lat: (match.lat || match.lat === 0) ? match.lat : prev.lat,
        lng: (match.lng || match.lng === 0) ? match.lng : prev.lng,
        trading_area_norm: prev.trading_area_norm || match.trading_area_norm || (match.trading_area || '').toLowerCase(),
      };
    });
  }, [latestMonth, stations]);

  // Startup: load public CSV if localStorage empty
  useEffect(() => {
    async function initFromPublicCsv() {
      if (records && records.length > 0) return;
      try {
        const res = await fetch('/stations.csv');
        if (!res.ok) return;
        const text = await res.text();
        // store the raw CSV text so auto-refresh can compare later
        lastCsvTextRef.current = text;
        Papa.parse(text, {
          header: true, skipEmptyLines: true, complete: parsed => {
            const rows = parsed.data.map((r, i) => ({
              month: (r.month || r.MONTH || '').toString().trim(),
              outlet_id: (r.outlet_id || r.id || `row-${i}`).toString().trim(),
              name: (r.name || r.NAME || '').toString().trim(),
              trading_area: (r.trading_area || r.tradingArea || r.area || '').toString().trim(),
              company: (r.company || r.brand || '').toString().trim(),
              lat: r.lat, lng: r.lng, ms: Number(r.ms || 0), ms_ly: Number(r.ms_ly || 0), hsd: Number(r.hsd || 0), hsd_ly: Number(r.hsd_ly || 0)
            }));
            const existing = [...records];
            rows.forEach(nr => {
              const idx = existing.findIndex(er => er.outlet_id === nr.outlet_id && er.month === nr.month);
              if (idx >= 0) existing[idx] = nr; else existing.push(nr);
            });
            setRecords(existing);
          }
        });
      } catch (e) {
        console.warn('Failed to load stations.csv', e);
      }
    }
    initFromPublicCsv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // preload logos (svg/png) into iconsMap
  useEffect(() => {
    const companies = Array.from(new Set(records.map(r => (r.company || '').toString().replace(/\s+/g, '').toUpperCase()).filter(Boolean)));
    if (!companies.length) return;
    let cancelled = false;
    (async () => {
      const m = {};
      for (const c of companies) {
        const svg = `/logos/${c}.svg`;
        const png = `/logos/${c}.png`;
        try {
          const r1 = await fetch(svg, { method: 'HEAD' });
          if (r1.ok) { m[c] = L.icon({ iconUrl: svg, iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36] }); continue; }
          const r2 = await fetch(png, { method: 'HEAD' });
          if (r2.ok) { m[c] = L.icon({ iconUrl: png, iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36] }); continue; }
          m[c] = null;
        } catch (e) { m[c] = null; }
      }
      if (!cancelled) setIconsMap(m);
    })();
    return () => { cancelled = true; };
  }, [records]);

  const center = useMemo(() => [10.913, 75.92], []);

  function outletsInAreaNorm(normArea) {
    if (!normArea) return [];
    return stations.filter(s => (s.trading_area_norm || '') === normArea);
  }

  function computeMarketShare(areaNorm) {
    const outs = outletsInAreaNorm(areaNorm);
    const totals = outs.reduce((acc, o) => {
      const comp = (o.company || 'PVT').toUpperCase();
      acc[comp] = acc[comp] || { ms: 0, ms_ly: 0 };
      acc[comp].ms += Number(o.ms || 0);
      acc[comp].ms_ly += Number(o.ms_ly || 0);
      return acc;
    }, {});
    const total_ms = Object.values(totals).reduce((s, c) => s + c.ms, 0);
    const total_ms_ly = Object.values(totals).reduce((s, c) => s + c.ms_ly, 0);
    return Object.entries(totals).map(([company, vals]) => ({ company, ms: vals.ms, ms_ly: vals.ms_ly, share: total_ms ? (vals.ms / total_ms * 100) : 0, share_ly: total_ms_ly ? (vals.ms_ly / total_ms_ly * 100) : 0, share_change: (total_ms && total_ms_ly) ? ((vals.ms / total_ms * 100) - (vals.ms_ly / total_ms_ly * 100)) : 0 })).sort((a, b) => b.share - a.share);
  }

  function handleCsv(file) {
    Papa.parse(file, {
      header: true, skipEmptyLines: true, complete: res => {
        const rows = res.data.map((r, i) => ({
          month: (r.month || r.MONTH || '').toString().trim(),
          outlet_id: (r.outlet_id || r.id || `row-${i}`).toString().trim(),
          name: (r.name || r.NAME || '').toString().trim(),
          trading_area: (r.trading_area || r.tradingArea || r.area || '').toString().trim(),
          company: (r.company || r.brand || '').toString().trim(),
          lat: r.lat, lng: r.lng, ms: Number(r.ms || 0), ms_ly: Number(r.ms_ly || 0), hsd: Number(r.hsd || 0), hsd_ly: Number(r.hsd_ly || 0)
        }));
        const existing = [...records];
        rows.forEach(nr => {
          const idx = existing.findIndex(er => er.outlet_id === nr.outlet_id && er.month === nr.month);
          if (idx >= 0) existing[idx] = nr; else existing.push(nr);
        });
        setRecords(existing);
      }
    });
  }

  // Auto-refresh: poll /stations.csv every 30s and update map if file changed
  useEffect(() => {
    let canceled = false;
    const intervalMs = 30000;

    async function checkAndUpdate() {
      try {
        const res = await fetch('/stations.csv', { cache: 'no-store' });
        if (!res.ok) return;
        const text = await res.text();
        if (text === lastCsvTextRef.current) return; // no change

        Papa.parse(text, {
          header: true, skipEmptyLines: true, complete: parsed => {
            const rows = parsed.data.map((r, i) => ({
              month: (r.month || '').toString().trim(),
              outlet_id: (r.outlet_id || r.id || `row-${i}`).toString().trim(),
              name: (r.name || '').toString().trim(),
              trading_area: (r.trading_area || '').toString().trim(),
              company: (r.company || '').toString().trim(),
              lat: r.lat, lng: r.lng,
              ms: Number(r.ms || 0), ms_ly: Number(r.ms_ly || 0),
              hsd: Number(r.hsd || 0), hsd_ly: Number(r.hsd_ly || 0)
            }));

            // read latest existing from localStorage to avoid stale closure
            const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            rows.forEach(nr => {
              const idx = existing.findIndex(er => er.outlet_id === nr.outlet_id && er.month === nr.month);
              if (idx >= 0) existing[idx] = nr; else existing.push(nr);
            });

            if (!canceled) {
              setRecords(existing);
              lastCsvTextRef.current = text;
            }
          }
        });
      } catch (e) {
        // ignore network/parse errors silently
      }
    }

      const id = setInterval(checkAndUpdate, intervalMs);
      // also run once shortly after mount to pick up any warm changes
      const t = setTimeout(checkAndUpdate, 2000);
      return () => { canceled = true; clearInterval(id); clearTimeout(t); };
    }, []);

    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
        <div style={{ width: '50%', minWidth: '20%', maxWidth: '80%', display: 'flex', flexDirection: 'column', height: '100vh' }}>
          <div style={{ flex: 1 }}>
            <MapContainer whenCreated={map => { mapRef.current = map; map.invalidateSize(); }} center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
              <TileLayer url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' />
  {stations.map(st => {
  if (!st.lat || !st.lng || isNaN(st.lat) || isNaN(st.lng)) return null;
  const cmp = (st.company || '').toString().replace(/\s+/g, '').toUpperCase();
  const baseIcon = iconsMap[cmp] ? iconsMap[cmp] : fallbackIcon(st.company);

  const isInSelectedArea =
    selected && st.trading_area_norm === selected.trading_area_norm;

  // 🔹 If in selected area → create a highlighted icon
  const icon = isInSelectedArea
    ? L.divIcon({
        html: `<div style="
            position: relative;
            width: 46px; height: 46px;
            display: flex; align-items: center; justify-content: center;
          ">
            <div style="
              position: absolute; width: 46px; height: 46px;
              border-radius: 50%;
              background: rgba(59,130,246,0.25);
              box-shadow: 0 0 12px rgba(59,130,246,0.6);
              animation: pulseGlow 1.5s infinite;
            "></div>
            <img src="/logos/${cmp}.svg" style="width: 36px; height: 36px;" />
          </div>`,
        className: "",
        iconSize: [46, 46],
        iconAnchor: [23, 46],
        popupAnchor: [0, -46],
      })
    : baseIcon;

  return (
    <Marker
      key={st.id}
      position={[st.lat, st.lng]}
      icon={icon}
      eventHandlers={{
        click: () =>
          setSelected({
            ...st,
            trading_area_norm:
              st.trading_area_norm || (st.trading_area || '').toLowerCase(),
          }),
      }}
    >
<Tooltip direction="top" offset={[0, -10]} opacity={1} className="my-tooltip">
  <div style={{ minWidth: 220 }}>
    <div style={{ fontWeight: 700, fontSize: 13 }}>{st.name}</div>
    <div style={{ color: "#64748B", marginTop: 2 }}>
      {st.company} • {st.trading_area}
    </div>

    <div
      style={{
        marginTop: 8,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        textAlign: "center", // central alignment
      }}
    >
      {/* MS */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "#94A3B8" }}>MS</div>
        <div style={{ fontWeight: 700, margin: "2px 0" }}>{st.ms.toLocaleString()}</div>
        <PercentBadge value={calcGrowth(st.ms, st.ms_ly)} />
      </div>

      {/* HSD */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "#94A3B8" }}>HSD</div>
        <div style={{ fontWeight: 700, margin: "2px 0" }}>{st.hsd.toLocaleString()}</div>
        <PercentBadge value={calcGrowth(st.hsd, st.hsd_ly)} />
      </div>
    </div>
  </div>
</Tooltip>

    </Marker>
  );
})}


            </MapContainer>
          </div>
        </div>

<aside style={{ width: '50%', minWidth: '20%', background: '#fff', overflow: 'auto', height: '100vh' }}>
  <div style={{ padding: 16 }}>
    {!selected ? (
      <div style={{ color: '#475569' }}>Select a Retail Outlet</div>
    ) : (
      <div>
        {/* Header: name + nav buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>{selected.name}</h2>
            <div style={{ color: '#64748B', marginTop: 6 }}>{selected.company} • {selected.trading_area}</div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => setPageIndex(0)}
              aria-label="Monthly view"
              title="Monthly view"
              className="nav-btn"
              style={{ width:40, height:40, borderRadius:8, border:'none', background:'#F8FAFC', cursor:'pointer', opacity: pageIndex === 0 ? 1 : 0.7 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <button
              onClick={() => setPageIndex(1)}
              aria-label="Cumulative view"
              title="Cumulative (Apr → latest)"
              className="nav-btn"
              style={{ width:40, height:40, borderRadius:8, border:'none', background:'#F8FAFC', cursor:'pointer', opacity: pageIndex === 1 ? 1 : 0.7 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Month selector */}
        <div style={{ marginTop: 8 }}>
          <MonthSelector records={records} value={latestMonth} onChange={(m) => setLatestMonth(m)} />
        </div>

        {/* Details grid (month-specific values) */}
{/* Details grid */}
<div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12, alignItems: 'center' }}>
  <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>Month</div>
  <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>MS</div>
  <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>MS LY</div>
  <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>MS Change</div>
  <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>HSD</div>
  <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>HSD LY</div>
  <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>HSD Change</div>

  {(() => {
    if (pageIndex === 1) {
      // cumulative mode (Apr -> latestMonth)
      const year = (latestMonth || "").split("-")[0] || new Date().getFullYear();
      const startMonth = `${year}-04`;
      const sums = cumulativeForOutletRows(selected.rows || [], startMonth, latestMonth);

      return (
        <>
          <div style={{ fontWeight: 600 }}>Cumulative</div>
          <div style={{ fontWeight: 700 }}>{sums.ms.toLocaleString()}</div>
          <div>{sums.ms_ly.toLocaleString()}</div>
          <div><VolumeChange curr={sums.ms} prev={sums.ms_ly} /></div>
          <div style={{ fontWeight: 700 }}>{sums.hsd.toLocaleString()}</div>
          <div>{sums.hsd_ly.toLocaleString()}</div>
          <div><VolumeChange curr={sums.hsd} prev={sums.hsd_ly} /></div>
        </>
      );
    } else {
      // normal monthly mode
      return (
        <>
          <div>{formatMonth(selected.month)}</div>
          <div style={{ fontWeight: 700 }}>{selected.ms.toLocaleString()}</div>
          <div>{selected.ms_ly.toLocaleString()}</div>
          <div><VolumeChange curr={selected.ms} prev={selected.ms_ly} /></div>
          <div style={{ fontWeight: 700 }}>{selected.hsd.toLocaleString()}</div>
          <div>{selected.hsd_ly.toLocaleString()}</div>
          <div><VolumeChange curr={selected.hsd} prev={selected.hsd_ly} /></div>
        </>
      );
    }
  })()}
</div>



{/* Trading Area — Outlets */}
<div style={{ marginTop: 20 }}>
  <h3 style={{ margin: '0 0 8px 0' }}>
    Trading Area — Outlets {pageIndex === 1 && "(Cumulative Apr → " + formatMonth(latestMonth) + ")"}
  </h3>
  <div style={{ background: '#fff', borderRadius: 8, padding: 8, boxShadow: '0 1px 2px rgba(2,6,23,0.04)' }}>
    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
      <thead style={{ color: '#94A3B8', textAlign: 'left' }}>
        <tr>
          <th style={{ padding: '8px 6px' }}>Outlet</th>
          <th style={{ padding: '8px 6px' }}>Company</th>
          <th style={{ padding: '8px 6px' }}>MS</th>
          <th style={{ padding: '8px 6px' }}>MS LY</th>
          <th style={{ padding: '8px 6px' }}>Volume Change</th>
          <th style={{ padding: '8px 6px' }}>HSD</th>
          <th style={{ padding: '8px 6px' }}>HSD LY</th>
          <th style={{ padding: '8px 6px' }}>Volume Change</th>
        </tr>
      </thead>
      <tbody>
        {(() => {
          const areaNorm = (selected && (selected.trading_area_norm || (selected.trading_area || '').toLowerCase())) || "";
          let outlets = outletsInAreaNorm(areaNorm);

          if (pageIndex === 1) {
            // cumulative mode
            const year = latestMonth.split("-")[0];
            const startMonth = `${year}-04`;
            outlets = cumulativeForAreaOutlets(outlets, startMonth, latestMonth);
          }

          if (!outlets || outlets.length === 0) {
            return (<tr><td colSpan={8} style={{ padding: 16, color: '#64748B' }}>No outlets found in this trading area.</td></tr>);
          }

          return outlets.map((o, i) => (
            <tr key={i} style={{ borderTop: '1px solid #F1F5F9' }}>
              <td style={{ padding: '8px 6px' }}>{o.name}</td>
              <td style={{ padding: '8px 6px' }}>{o.company}</td>
              <td style={{ padding: '8px 6px' }}>{o.ms.toLocaleString()}</td>
              <td style={{ padding: '8px 6px' }}>{o.ms_ly.toLocaleString()}</td>
              <td style={{ padding: '8px 6px' }}><VolumeChange curr={o.ms} prev={o.ms_ly} /></td>
              <td style={{ padding: '8px 6px' }}>{o.hsd.toLocaleString()}</td>
              <td style={{ padding: '8px 6px' }}>{o.hsd_ly.toLocaleString()}</td>
              <td style={{ padding: '8px 6px' }}><VolumeChange curr={o.hsd} prev={o.hsd_ly} /></td>
            </tr>
          ));
        })()}
      </tbody>
    </table>
  </div>
</div>


        {/* Trading Area — Market Share */}
 <div style={{ marginTop: 20 }}>
  <h3 style={{ margin: '0 0 8px 0' }}>Trading Area — Market Share</h3>
  <div style={{ background: '#fff', borderRadius: 8, padding: 12, boxShadow: '0 1px 2px rgba(2,6,23,0.04)' }}>
    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
      <thead style={{ color: '#94A3B8', textAlign: 'left' }}>
        <tr>
          <th style={{ padding: '8px 6px' }}>Company</th>
          <th style={{ padding: '8px 6px' }}>Market Share</th>
          <th style={{ padding: '8px 6px' }}>Market Share (LY)</th>
          <th style={{ padding: '8px 6px' }}>Change</th>
        </tr>
      </thead>
      <tbody>
        {(() => {
          // safe area norm
          const areaNorm = (selected && (selected.trading_area_norm || (selected.trading_area || '').toLowerCase())) || "";
          // choose computation based on pageIndex (0 = monthly, 1 = cumulative)
          let rows = [];
          if (!areaNorm) {
            rows = [];
          } else if (pageIndex === 1) {
            // cumulative from April of selected year -> latestMonth
            const year = (latestMonth || "").split("-")[0] || new Date().getFullYear();
            const startMonth = `${year}-04`;
            rows = computeCumulativeMarketShareForArea(outletsInAreaNorm(areaNorm), startMonth, latestMonth);
          } else {
            rows = computeMarketShare(areaNorm);
          }

          if (!rows || rows.length === 0) {
            return (
              <tr>
                <td colSpan={4} style={{ padding: 16, color: '#64748B' }}>
                  No market-share data available for this trading area.
                </td>
              </tr>
            );
          }

          return rows.map((m, i) => (
            <tr key={i} style={{ borderTop: '1px solid #F1F5F9' }}>
              <td style={{ padding: '8px 6px' }}>{m.company}</td>
              <td style={{ padding: '8px 6px' }}>{(m.share || 0).toFixed(2)}%</td>
              <td style={{ padding: '8px 6px' }}>{(m.share_ly || 0).toFixed(2)}%</td>
              <td style={{ padding: '8px 6px' }}><ShareChange value={m.share_change || 0} /></td>
            </tr>
          ));
        })()}
      </tbody>
    </table>
  </div>
</div>
      </div>
    )}
  </div>
</aside>


    </div>
  );
}
