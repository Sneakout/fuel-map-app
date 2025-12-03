import React, { useState, useMemo, useEffect, useRef } from "react";
import Papa from "papaparse";
import { MapContainer, TileLayer, Marker, Tooltip, useMapEvents } from "react-leaflet";
import { motion, AnimatePresence } from "framer-motion";
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

/* Circular AI button (already added earlier) remains */

/* Close button (top-right in chat mode) */
.ai-close{
  position:absolute; top:8px; right:8px;
  width:36px; height:36px; border-radius:50%;
  border:1px solid #E5E7EB; background:#FFF; cursor:pointer;
  display:flex; align-items:center; justify-content:center;
  box-shadow: 0 4px 14px rgba(0,0,0,0.08);
}

/* Bottom-centered input bar */
.ai-inputbar{
  position:absolute; left:50%; bottom:12px; transform:translateX(-50%);
  width:min(740px, 90%); display:flex; gap:8px;
  background:rgba(255,255,255,0.9); backdrop-filter: blur(8px);
  border:1px solid #E5E7EB; border-radius:999px; padding:8px 10px;
  box-shadow: 0 10px 30px rgba(2, 6, 23, 0.12);
}
.ai-inputbar input{
  flex:1; border:none; outline:none; background:transparent;
  padding:8px 10px; font-size:14px; color:#0F172A;
}
.ai-send{
  border:none; border-radius:999px; padding:8px 14px;
  background:#0EA5E9; color:#fff; font-weight:700; cursor:pointer;
}

/* Reply bubble above input */
.ai-reply{
  position:absolute; left:50%; bottom:72px; transform:translateX(-50%);
  width:min(760px, 92%);
  background:#FFF; border:1px solid #E5E7EB; border-radius:16px;
  padding:12px 14px; box-shadow: 0 12px 36px rgba(2,6,23,0.12);
  max-height:55vh; overflow:auto; white-space:pre-wrap; font-size:13px; color:#0F172A;
}


    `;
    document.head.appendChild(s);
  }
}

function upsertMsg(setter, newMsg) {
  setter((prev = []) => {
    const i = prev.findIndex(m => m.id === newMsg.id);
    if (i >= 0) {
      const next = prev.slice();
      next[i] = newMsg;
      return next;
    }
    return [...prev, newMsg];
  });
}

const prettyHeader = (h) => {
  const k = (h || "").toString().trim().toLowerCase();

  if (k === "ms" || k === "total_ms") return "MS (KL)";
  if (k === "hsd" || k === "total_hsd") return "HSD (KL)";
  if (k === "name") return "RO name";
  if (k === "outlet_id") return "RO code";
  if (k === "trading_area") return "Trading area";
  if (k === "company") return "Company";

  return h;
};

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

// Clean, brand-aligned AI reply
function AIReply({ text }) {
  // strip common markdown noise quickly
  const cleaned = (text || "")
    .replace(/\*\*/g, "")            // remove bold markers
    .replace(/^-\s+/gm, "")          // remove leading dash bullets
    .trim();

  // naive sectionization: split on "This month" / "Cumulative"
  const sections = cleaned.split(/\n\s*\n/).map(s => s.trim());

  return (
    <div style={{
      fontFamily: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue"`,
      fontSize: 14,
      lineHeight: 1.6,
      color: '#0F172A'
    }}>
      {sections.map((block, i) => {
        // make compact title if first line looks like a question
        const lines = block.split('\n');
        const head = lines[0] || '';
        const rest = lines.slice(1);

        return (
          <div key={i} style={{ marginBottom: 10 }}>
            {/* section header if it looks like a label */}
            {/^this month/i.test(head) || /^cumulative/i.test(head) ? (
              <>
                <div style={{ fontSize: 12, letterSpacing: .2, color: '#64748B', textTransform: 'uppercase', marginBottom: 4 }}>
                  {head.replace(/:$/, '')}
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {rest.map((ln, j) => {
                    // e.g. "IOC leads with 43.99% ... (down by 1.80% YoY)."
                    const m = ln.match(/^([A-Za-z&.\s]+)\s+(.*)$/);
                    const brand = m ? m[1].trim().replace(/:$/, '') : null;
                    const detail = m ? m[2].trim() : ln.trim();
                    return (
                      <div key={j} style={{
                        display:'grid',
                        gridTemplateColumns: '140px 1fr',
                        gap: 8,
                        padding: '6px 8px',
                        borderRadius: 8,
                        background: 'rgba(241,245,249,.5)' // slate-100-ish
                      }}>
                        <div style={{ fontWeight: 700 }}>{brand || '—'}</div>
                        <div>{detail.replace(/^\-\s*/, '')}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              // fallback paragraph
              <div style={{ whiteSpace: 'pre-wrap' }}>{block}</div>
            )}
          </div>
        );
      })}
    </div>
  );
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

// === NEW: growth utilities for MS & HSD ===
function buildMonthlyGrowthRowsMS(stations) {
  return (stations || []).map(s => {
    const thisYear = Number(s.ms || 0);
    const lastYear = Number(s.ms_ly || 0);
    const growth = thisYear - lastYear;
    const growthPct = lastYear === 0 ? (thisYear === 0 ? 0 : 100) : ((growth / lastYear) * 100);
    return { name: s.name || "", company: s.company || "", area: s.trading_area || "", thisYear, lastYear, growth, growthPct };
  });
}

function buildMonthlyGrowthRowsHSD(stations) {
  return (stations || []).map(s => {
    const thisYear = Number(s.hsd || 0);
    const lastYear = Number(s.hsd_ly || 0);
    const growth = thisYear - lastYear;
    const growthPct = lastYear === 0 ? (thisYear === 0 ? 0 : 100) : ((growth / lastYear) * 100);
    return { name: s.name || "", company: s.company || "", area: s.trading_area || "", thisYear, lastYear, growth, growthPct };
  });
}

function buildCumulativeGrowthRowsMS(stations, startMonth, endMonth) {
  return (stations || []).map(s => {
    const sums = cumulativeForOutletRows(s.rows || [], startMonth, endMonth);
    const thisYear = Number(sums.ms || 0);
    const lastYear = Number(sums.ms_ly || 0);
    const growth = thisYear - lastYear;
    const growthPct = lastYear === 0 ? (thisYear === 0 ? 0 : 100) : ((growth / lastYear) * 100);
    return { name: s.name || "", company: s.company || "", area: s.trading_area || "", thisYear, lastYear, growth, growthPct };
  });
}

function buildCumulativeGrowthRowsHSD(stations, startMonth, endMonth) {
  return (stations || []).map(s => {
    const sums = cumulativeForOutletRows(s.rows || [], startMonth, endMonth);
    const thisYear = Number(sums.hsd || 0);
    const lastYear = Number(sums.hsd_ly || 0);
    const growth = thisYear - lastYear;
    const growthPct = lastYear === 0 ? (thisYear === 0 ? 0 : 100) : ((growth / lastYear) * 100);
    return { name: s.name || "", company: s.company || "", area: s.trading_area || "", thisYear, lastYear, growth, growthPct };
  });
}


function sortRowsByGrowth(rows, direction) {
  const copy = [...(rows || [])];
  copy.sort((a, b) => direction === 'asc' ? (a.growth - b.growth) : (b.growth - a.growth));
  return copy;
}

// Simple reusable table (columns fixed per your spec)
function GrowthTable({ rows, label }) {
  return (
    <div style={{ marginTop: 10 }}>
      <h4 style={{ margin: '0 0 6px 0' }}>{label}</h4>
      <div style={{ background: '#fff', borderRadius: 8, padding: 12, boxShadow: '0 1px 2px rgba(2,6,23,0.04)' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
<thead style={{ color: '#94A3B8', textAlign: 'left' }}>
  <tr>
    <th style={{ padding: '8px 6px' }}>RO name</th>
    <th style={{ padding: '8px 6px' }}>Company</th>
    <th style={{ padding: '8px 6px' }}>Trading area</th>
    <th style={{ padding: '8px 6px' }}>This year sales</th>
    <th style={{ padding: '8px 6px' }}>Last year sales</th>
    <th style={{ padding: '8px 6px' }}>Growth</th>
    <th style={{ padding: '8px 6px' }}>Growth %</th>
  </tr>
</thead>

          <tbody>
            {(!rows || rows.length === 0) ? (
              <tr><td colSpan={6} style={{ padding: 16, color: '#64748B' }}>No matching ROs.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid #F1F5F9' }}>
                <td style={{ padding: '8px 6px' }}>{r.name}</td>
                <td style={{ padding: '8px 6px' }}>{r.company}</td> {/* NEW */}
                <td style={{ padding: '8px 6px' }}>{r.area}</td>
                <td style={{ padding: '8px 6px', fontWeight: 700 }}>{Number(r.thisYear || 0).toLocaleString()}</td>
                <td style={{ padding: '8px 6px' }}>{Number(r.lastYear || 0).toLocaleString()}</td>
                <td style={{ padding: '8px 6px' }}>{(Number(r.growth) >= 0 ? '+' : '') + Number(r.growth).toLocaleString()}</td>
                <td style={{ padding: '8px 6px' }}>{Number(r.growthPct).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
// === NEW: company summary helpers for growth pages ===
function summarizeByCompany(rows) {
  const map = {};
  (rows || []).forEach(r => {
    const company = (r.company || 'PVT').toString().trim() || 'PVT';
    const hasBase = Number(r.lastYear || 0) > 0;
    if (!map[company]) map[company] = { company, total: 0, withBase: 0, withoutBase: 0 };
    map[company].total += 1;
    if (hasBase) map[company].withBase += 1; else map[company].withoutBase += 1;
  });
  return Object.values(map).sort((a, b) => b.total - a.total);
}

function SummaryTable({ rows, label }) {
  return (
    <div style={{ marginTop: 10 }}>
      <h4 style={{ margin: '0 0 6px 0' }}>{label}</h4>
      <div style={{ background: '#fff', borderRadius: 8, padding: 12, boxShadow: '0 1px 2px rgba(2,6,23,0.04)' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead style={{ color: '#94A3B8', textAlign: 'left' }}>
            <tr>
              <th style={{ padding: '8px 6px' }}>Company</th>
              <th style={{ padding: '8px 6px' }}>Number of ROs</th>
              <th style={{ padding: '8px 6px' }}>ROs without base</th>
              <th style={{ padding: '8px 6px' }}>ROs with base</th>
            </tr>
          </thead>
          <tbody>
            {(!rows || rows.length === 0) ? (
              <tr><td colSpan={4} style={{ padding: 16, color: '#64748B' }}>No data.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid #F1F5F9' }}>
                <td style={{ padding: '8px 6px' }}>{r.company}</td>
                <td style={{ padding: '8px 6px' }}>{r.total}</td>
                <td style={{ padding: '8px 6px' }}>{r.withoutBase}</td>
                <td style={{ padding: '8px 6px' }}>{r.withBase}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// === NEW: Market share helpers (All stations) ===

// Monthly (single selected month across all stations)
function marketShareRowsAllMonthly_MS(stations) {
  const by = {};
  let total = 0, total_ly = 0;
  (stations || []).forEach(s => {
    const comp = (s.company || 'PVT').toString().trim().toUpperCase();
    const ms = Number(s.ms || 0), ms_ly = Number(s.ms_ly || 0);
    by[comp] = by[comp] || { company: comp, curr: 0, last: 0 };
    by[comp].curr += ms; by[comp].last += ms_ly;
    total += ms; total_ly += ms_ly;
  });
  return Object.values(by).map(r => {
    const growth = r.curr - r.last;
    const growthPct = r.last === 0 ? (r.curr === 0 ? 0 : 100) : (growth / r.last) * 100;
    const share = total ? (r.curr / total) * 100 : 0;
    const share_ly = total_ly ? (r.last / total_ly) * 100 : 0;
    const share_change = share - share_ly;
    // Mop-up volume: volume needed to bring current share to last year's share at current total
    const target_curr = (share_ly / 100) * total;
    const mop_up = target_curr - r.curr; // +ve needs volume; -ve has surplus
    return { company: r.company, curr: r.curr, last: r.last, growth, growthPct, share, share_ly, share_change, mop_up };
  }).sort((a,b)=>b.share - a.share);
}

function marketShareRowsAllMonthly_HSD(stations) {
  const by = {};
  let total = 0, total_ly = 0;
  (stations || []).forEach(s => {
    const comp = (s.company || 'PVT').toString().trim().toUpperCase();
    const v = Number(s.hsd || 0), vly = Number(s.hsd_ly || 0);
    by[comp] = by[comp] || { company: comp, curr: 0, last: 0 };
    by[comp].curr += v; by[comp].last += vly;
    total += v; total_ly += vly;
  });
  return Object.values(by).map(r => {
    const growth = r.curr - r.last;
    const growthPct = r.last === 0 ? (r.curr === 0 ? 0 : 100) : (growth / r.last) * 100;
    const share = total ? (r.curr / total) * 100 : 0;
    const share_ly = total_ly ? (r.last / total_ly) * 100 : 0;
    const share_change = share - share_ly;
    const target_curr = (share_ly / 100) * total;
    const mop_up = target_curr - r.curr;
    return { company: r.company, curr: r.curr, last: r.last, growth, growthPct, share, share_ly, share_change, mop_up };
  }).sort((a,b)=>b.share - a.share);
}

// Cumulative (Apr → latest across all stations)
function marketShareRowsAllCumulative_MS(stations, startMonth, endMonth) {
  const by = {};
  let total = 0, total_ly = 0;
  (stations || []).forEach(s => {
    const comp = (s.company || 'PVT').toString().trim().toUpperCase();
    const sums = cumulativeForOutletRows(s.rows || [], startMonth, endMonth);
    const ms = Number(sums.ms || 0), ms_ly = Number(sums.ms_ly || 0);
    by[comp] = by[comp] || { company: comp, curr: 0, last: 0 };
    by[comp].curr += ms; by[comp].last += ms_ly;
    total += ms; total_ly += ms_ly;
  });
  return Object.values(by).map(r => {
    const growth = r.curr - r.last;
    const growthPct = r.last === 0 ? (r.curr === 0 ? 0 : 100) : (growth / r.last) * 100;
    const share = total ? (r.curr / total) * 100 : 0;
    const share_ly = total_ly ? (r.last / total_ly) * 100 : 0;
    const share_change = share - share_ly;
    const target_curr = (share_ly / 100) * total;
    const mop_up = target_curr - r.curr;
    return { company: r.company, curr: r.curr, last: r.last, growth, growthPct, share, share_ly, share_change, mop_up };
  }).sort((a,b)=>b.share - a.share);
}

function marketShareRowsAllCumulative_HSD(stations, startMonth, endMonth) {
  const by = {};
  let total = 0, total_ly = 0;
  (stations || []).forEach(s => {
    const comp = (s.company || 'PVT').toString().trim().toUpperCase();
    const sums = cumulativeForOutletRows(s.rows || [], startMonth, endMonth);
    const v = Number(sums.hsd || 0), vly = Number(sums.hsd_ly || 0);
    by[comp] = by[comp] || { company: comp, curr: 0, last: 0 };
    by[comp].curr += v; by[comp].last += vly;
    total += v; total_ly += vly;
  });
  return Object.values(by).map(r => {
    const growth = r.curr - r.last;
    const growthPct = r.last === 0 ? (r.curr === 0 ? 0 : 100) : (growth / r.last) * 100;
    const share = total ? (r.curr / total) * 100 : 0;
    const share_ly = total_ly ? (r.last / total_ly) * 100 : 0;
    const share_change = share - share_ly;
    const target_curr = (share_ly / 100) * total;
    const mop_up = target_curr - r.curr;
    return { company: r.company, curr: r.curr, last: r.last, growth, growthPct, share, share_ly, share_change, mop_up };
  }).sort((a,b)=>b.share - a.share);
}

// === NEW: Market share table ===
function MarketShareTable({ rows, label }) {
  return (
    <div style={{ marginTop: 10 }}>
      <h4 style={{ margin: '0 0 6px 0' }}>{label}</h4>
      <div style={{ background: '#fff', borderRadius: 8, padding: 12, boxShadow: '0 1px 2px rgba(2,6,23,0.04)' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead style={{ color: '#94A3B8', textAlign: 'left' }}>
            <tr>
              <th style={{ padding: '8px 6px' }}>Company</th>
              <th style={{ padding: '8px 6px' }}>Current year sales</th>
              <th style={{ padding: '8px 6px' }}>Last year sales</th>
              <th style={{ padding: '8px 6px' }}>Growth</th>
              <th style={{ padding: '8px 6px' }}>Growth %</th>
              <th style={{ padding: '8px 6px' }}>Current share</th>
              <th style={{ padding: '8px 6px' }}>Last year share</th>
              <th style={{ padding: '8px 6px' }}>Change</th>
              <th style={{ padding: '8px 6px' }}>Mop up volume</th>
            </tr>
          </thead>
          <tbody>
            {(!rows || rows.length === 0) ? (
              <tr><td colSpan={9} style={{ padding: 16, color: '#64748B' }}>No data.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid #F1F5F9' }}>
                <td style={{ padding: '8px 6px' }}>{r.company}</td>
                <td style={{ padding: '8px 6px', fontWeight: 700 }}>{Number(r.curr || 0).toLocaleString()}</td>
                <td style={{ padding: '8px 6px' }}>{Number(r.last || 0).toLocaleString()}</td>
                <td style={{
                  padding: '8px 6px',
                  background: (r.growth || 0) >= 0 ? '#ECFDF5' : '#FEF2F2',
                  color: (r.growth || 0) >= 0 ? '#064E3B' : '#7F1D1D',
                  fontWeight: 700
                }}>{(r.growth >= 0 ? '+' : '') + Number(r.growth || 0).toLocaleString()}</td>
                <td style={{
                  padding: '8px 6px',
                  background: (r.growthPct || 0) >= 0 ? '#ECFDF5' : '#FEF2F2',
                  color: (r.growthPct || 0) >= 0 ? '#064E3B' : '#7F1D1D',
                  fontWeight: 700
                }}>{Number(r.growthPct || 0).toFixed(1)}%</td>
                <td style={{ padding: '8px 6px' }}>{Number(r.share || 0).toFixed(2)}%</td>
                <td style={{ padding: '8px 6px' }}>{Number(r.share_ly || 0).toFixed(2)}%</td>
                <td style={{
                  padding: '8px 6px',
                  background: (r.share_change || 0) >= 0 ? '#ECFDF5' : '#FEE2E2',
                  color: (r.share_change || 0) >= 0 ? '#064E3B' : '#7F1D1D',
                  fontWeight: 700
                }}>{(r.share_change >= 0 ? '+' : '') + Number(r.share_change || 0).toFixed(2)} pp</td>
                <td style={{
                  padding: '8px 6px',
                  background: (r.mop_up || 0) >= 0 ? '#ECFDF5' : '#FEF2F2',
                  color: (r.mop_up || 0) >= 0 ? '#064E3B' : '#7F1D1D',
                  fontWeight: 700
                }}>{Number(r.mop_up || 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeselectOnMapClick({ onDeselect }) {
  useMapEvents({
    click: () => onDeselect(), // fires when clicking anywhere on the map background/tiles
  });
  return null; // no UI
}

function RenderSummary({ text }) {

  if (!text) return null;

  // strip any leaked <think>…</think>
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  // If the model wrote "Here is a summary ...:" keep only what follows the colon once
  const colonIdx = t.indexOf(":");
  if (colonIdx !== -1 && colonIdx < 120) t = t.slice(colonIdx + 1).trim();

  // Normalize to line-based bullets: turn inline "* foo * bar" into separate lines
  // and keep real markdown bullets if already line-separated.
  const hasLineBullets = /^\s*[-*•]\s+/m.test(t);
  const items = hasLineBullets
    ? t.split(/\n+/).map(s => s.trim()).filter(s => /^\s*[-*•]\s+/.test(s)).map(s => s.replace(/^\s*[-*•]\s+/, ""))
    : t.split(/\s*\*\s+/).map(s => s.trim()).filter(Boolean);

  if (items.length === 0) {
    // fallback: just show the paragraph
    return <p style={{ margin: "0 0 8px", color: "#475569", fontSize: 13 }}>{t}</p>;
  }

  return (
    <ul style={{ margin: "0 0 8px 16px", padding: 0, color: "#475569", fontSize: 13 }}>
      {items.map((it, i) => (
        <li key={i} style={{ marginBottom: 4 }}>{it.replace(/\s*\.$/, ".")}</li>
      ))}
    </ul>
  );
}

const SHOW_SQL = false; // <- keep false to hide SQL



function SQLResult({ sql, columns = [], rows = [], summary = "" }) {
  const stringCols = new Set(
    columns.map(c => (c || "").toString().trim().toLowerCase()).filter(Boolean)
  );
  const isStringCol = (colName) => {
    const k = (colName || "").toString().trim().toLowerCase();
    // treat these as text (no toLocaleString)
    return k === "ro code" || k === "outlet_id" || k === "ro name" || k === "name" || k === "month";
  };

  return (
    <div style={{ fontSize: 13, color: "#0F172A" }}>
      {summary && <RenderSummary text={summary} />}

      {SHOW_SQL && (
        <div style={{
          background: "#0B1020", color: "#E5E7EB", padding: 10, borderRadius: 8,
          fontFamily: "ui-monospace, Menlo, Monaco, Consolas, 'Courier New', monospace",
          fontSize: 12, marginBottom: 10, overflowX: "auto"
        }}>
          {sql}
        </div>
      )}

      <div style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 8, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, background: "#F8FAFC" }}>
            <tr>
              {columns.map((c, i) => (
                <th key={i} style={{ padding: "8px 10px", textAlign: "left", fontSize: 12, color: "#64748B", borderBottom: "1px solid #E5E7EB" }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} style={{ padding: 12, color: "#64748B" }}>No results.</td></tr>
            ) : rows.map((r, ri) => (
              <tr key={ri} style={{ borderTop: "1px solid #F1F5F9" }}>
                {r.map((cell, ci) => {
                  const header = columns[ci] || "";
                  const showAsText = isStringCol(header);
                  return (
                    <td key={ci} style={{ padding: "8px 10px", fontSize: 13 }}>
                      {showAsText
                        ? String(cell ?? "")
                        : (typeof cell === "number" ? cell.toLocaleString("en-IN") : String(cell ?? ""))
                      }
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}



function buildInsightsPayload({ latestMonth, stations }) {
  // months (descending: newest first)
  const months = Array.from(
    new Set(
      stations.flatMap(s => (s.rows || []).map(r => (r.month || '').toString().trim()).filter(Boolean))
    )
  ).sort((a,b)=> a > b ? -1 : a < b ? 1 : 0);

  const year = (latestMonth || "").split("-")[0];
  const startMonth = `${year}-04`;

  // compact outlet object to keep payload small but complete
  const outlets = stations.map(s => ({
    id: s.outlet_id || s.id || s.name,
    name: s.name,
    company: s.company,
    area: s.trading_area,
    lat: s.lat, lng: s.lng,
    latest: { month: s.month, ms: s.ms, ms_ly: s.ms_ly, hsd: s.hsd, hsd_ly: s.hsd_ly },
    rows: (s.rows || []).map(r => ({
      month: r.month, ms: r.ms, ms_ly: r.ms_ly, hsd: r.hsd, hsd_ly: r.hsd_ly
    }))
  }));

  // indices for easy lookups
  const indexByArea = {};
  const indexByCompany = {};
  const indexByOutlet = {};

  for (const o of outlets) {
    // by outlet
    indexByOutlet[o.id] = o;

    // by area
    const areaKey = (o.area || 'UNKNOWN').toString();
    (indexByArea[areaKey] ||= { outlets: [] }).outlets.push(o);

    // by company
    const compKey = (o.company || 'PVT').toString().toUpperCase();
    (indexByCompany[compKey] ||= { outlets: [] }).outlets.push(o);
  }

  // helpers reused from your app (monthly + cumulative market share across ALL stations)
  const msMonthly  = marketShareRowsAllMonthly_MS(stations);
  const hsdMonthly = marketShareRowsAllMonthly_HSD(stations);
  const msCum      = marketShareRowsAllCumulative_MS(stations, startMonth, latestMonth);
  const hsdCum     = marketShareRowsAllCumulative_HSD(stations, startMonth, latestMonth);

  // growth (ro-wise) you already had
  const monthlyMS  = buildMonthlyGrowthRowsMS(stations);
  const monthlyHSD = buildMonthlyGrowthRowsHSD(stations);
  const cumMS      = buildCumulativeGrowthRowsMS(stations, startMonth, latestMonth);
  const cumHSD     = buildCumulativeGrowthRowsHSD(stations, startMonth, latestMonth);

  return {
    context: { latestMonth, startMonth, months },
    // easy global views
    marketShare: { msMonthly, hsdMonthly, msCum, hsdCum },
    growth: {
      monthlyMS, monthlyHSD, cumMS, cumHSD
    },
    // powerful indexes for arbitrary Q&A
    indexes: {
      byArea: indexByArea,
      byCompany: indexByCompany,
      byOutlet: indexByOutlet
    }
  };
}

/* ---------- main app ---------- */
export default function FuelMapApp() {
  const [records, setRecords] = useState(() => loadRecords());
  const [stations, setStations] = useState([]);
  const [iconsMap, setIconsMap] = useState({});
  const [selected, setSelected] = useState(null);
  const [animState, setAnimState] = useState({ mode: 'idle', key: 0 });
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
  // safe memoized cumulative sums for currently selected RO
const cumulativeSums = useMemo(() => {
  if (!selected) return null;
  const year = (latestMonth || "").split("-")[0] || new Date().getFullYear();
  const startMonth = `${year}-04`;
  return cumulativeForOutletRows(selected.rows || [], startMonth, latestMonth);
}, [selected, latestMonth]);

// Add near other useState hooks in FuelMapApp
const [searchQuery, setSearchQuery] = useState('');
const [suggestions, setSuggestions] = useState([]);

// === AI view restore helpers ===
const rightPaneRef = useRef(null);
const prevViewRef = useRef(null);

function openAI() {
  // snapshot the current view so we can restore later
  prevViewRef.current = {
    selected,
    pageIndex,
    scrollTop: rightPaneRef.current?.scrollTop ?? 0,
  };
  setAiMode(true);
  setAiInput("");
}

function closeAI() {
  const prev = prevViewRef.current;
  setAiMode(false);
  setAiInput("");

  if (prev) {
    // restore previous selection and page
    setSelected(prev.selected ?? null);
    setPageIndex(typeof prev.pageIndex === "number" ? prev.pageIndex : 0);

    // restore scroll after the panel re-renders
    setTimeout(() => {
      if (rightPaneRef.current) {
        rightPaneRef.current.scrollTop = prev.scrollTop ?? 0;
      }
    }, 0);
  }
}


const [aiMode, setAiMode] = useState(false);
const [aiInput, setAiInput] = useState("");
const [chatHistory, setChatHistory] = useState([]); 
const [aiBusy, setAiBusy] = useState(false);

async function handleAISubmit(e) {
  e.preventDefault();
  const q = aiInput.trim();
  if (!q) return;

  const reqId = crypto.randomUUID();

  // show user bubble
  upsertMsg(setChatHistory, { id: reqId + "-user", role: "user", content: q });

  setAiInput("");
  setAiBusy(true);

  try {
    const res = await fetch("http://127.0.0.1:3001/api/sql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // if you add summarize:true on backend, include it here
      body: JSON.stringify({ question: q, print_sql: true })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} ${errText}`);
    }

    const data = await res.json();

    // one assistant message with table (no duplicates)
    const assistantMsg = {
      id: reqId + "-answer",
      role: "assistant",
      content: {
        type: "sql_result",
        sql: data.sql,
        columns: Array.isArray(data.columns) ? data.columns : [],
        rows: Array.isArray(data.rows) ? data.rows : [],
        summary: "" // will be filled below via /api/insights
      }
    };
    upsertMsg(setChatHistory, assistantMsg);

    // optional: 1–2 sentence summary via /api/insights
    try {
      const ins = await fetch("http://127.0.0.1:3001/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: { sql: data.sql, columns: data.columns, rows: data.rows },
          context: { question: q }
        })
      });
      const jj = await ins.json();
      const summary = jj?.text || "";

      // update same bubble
      upsertMsg(setChatHistory, {
        ...assistantMsg,
        content: { ...assistantMsg.content, summary }
      });
    } catch {
      // ignore insights errors
    }

  } catch (err) {
    upsertMsg(setChatHistory, {
      id: reqId + "-error",
      role: "assistant",
      content: `Failed: ${err.message || String(err)}`
    });
  } finally {
    setAiBusy(false);
  }
}


const [insights, setInsights] = useState("");
const [loadingInsights, setLoadingInsights] = useState(false);

async function generateInsights() {
  setLoadingInsights(true);
  try {
    const payload = buildInsightsPayload({ latestMonth, stations });
    const res = await fetch("http://localhost:3001/api/insights", { // <— absolute URL
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { text } = await res.json();
    setInsights(text || "(No text returned)");
  } catch (e) {
    console.error("Insights error:", e);
    setInsights(`Failed to generate insights: ${e.message}`);
  } finally {
    setLoadingInsights(false);
  }
}

// small helper to create suggestion objects
function makeSuggestion(label, type, lat = null, lng = null, station = null) {
  return { label, type, lat, lng, station };
}

// fuzzy search function — simple substring match (case-insensitive)
function updateSuggestions(q) {
  const value = (q || '').toString().trim().toLowerCase();
  if (!value) { setSuggestions([]); return; }

  const ss = [];
  // match by exact/contains on RO name
  for (const s of stations) {
    const name = (s.name || '').toString().toLowerCase();
    if (name.includes(value)) {
      ss.push(makeSuggestion(s.name, 'Outlet', s.lat, s.lng, s));
      if (ss.length >= 12) break;
    }
  }
  // if not many matches, include trading area matches
  if (ss.length < 12) {
    for (const s of stations) {
      const area = (s.trading_area || '').toString().toLowerCase();
      if (area && area.includes(value)) {
        // label uses trading area and an example outlet name
        ss.push(makeSuggestion(`${s.trading_area} · ${s.name}`, 'Trading area', s.lat, s.lng, s));
        if (ss.length >= 20) break;
      }
    }
  }
  // company matches last
  if (ss.length < 20) {
    const companiesSeen = new Set();
    for (const s of stations) {
      const comp = (s.company || '').toString().toLowerCase();
      if (comp && comp.includes(value) && !companiesSeen.has(comp)) {
        companiesSeen.add(comp);
        ss.push(makeSuggestion(`${s.company} · ${s.name}`, 'Company', s.lat, s.lng, s));
        if (ss.length >= 20) break;
      }
    }
  }
  setSuggestions(ss);
}

// when user chooses a suggestion
function selectSuggestion(sug) {
  setSearchQuery(sug.label);
  setSuggestions([]);

  // center map
  if (mapRef.current && sug.lat && sug.lng) {
    try {
      // performance: use a tighter zoom for outlets
      const zoom = sug.type === 'Outlet' ? 16 : 14;
      mapRef.current.setView([Number(sug.lat), Number(sug.lng)], zoom, { animate: true });
    } catch (e) { /* ignore */ }
  }

  // if we have a station object (exact outlet), pre-select it
  if (sug.station) {
    setSelected(prev => ({
      ...sug.station,
      trading_area_norm: sug.station.trading_area_norm || (sug.station.trading_area || '').toLowerCase()
    }));
  } else if (sug.type === 'Trading area') {
    // if only area, pick first station in that area and select
    const pick = stations.find(st => (st.trading_area || '').toLowerCase() === (sug.label.split(' · ')[0] || '').toLowerCase());
    if (pick) {
      setSelected(prev => ({ ...pick, trading_area_norm: pick.trading_area_norm || (pick.trading_area || '').toLowerCase() }));
    }
  }
}


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
              outlet_id: ((r.outlet_id || r.id || `row-${i}`) + '')
  .replace(/,/g, '')  // remove commas
  .trim(),

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

 function Badge({ children, tone = "neutral" }) {
  const tones = {
    neutral: { bg: "rgba(241,245,249,0.9)", fg: "#0F172A" },
    up:      { bg: "rgba(220,252,231,0.9)", fg: "#065F46" },
    down:    { bg: "rgba(254,226,226,0.9)", fg: "#7F1D1D" },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 8px", borderRadius: 999,
      fontWeight: 700, fontSize: 12, background: t.bg, color: t.fg
    }}>{children}</span>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 12, letterSpacing: .3, color: '#64748B',
      textTransform: 'uppercase', margin: '10px 0 6px'
    }}>{children}</div>
  );
}

function RowLine({ left, right }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '180px 1fr',
      gap: 8, padding: '8px 10px', borderRadius: 10,
      background: 'rgba(248,250,252,0.9)'
    }}>
      <div style={{ fontWeight: 700 }}>{left}</div>
      <div>{right}</div>
    </div>
  );
}

// --- Parser & pretty renderer ---
function AIReplyPro({ text }) {
  // 1) normalize (kill <think>, bullets, fix missing newlines before "1.", "2.", ...)
  let t = (text || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/\*\*/g, "")
    .replace(/ +\| +/g, " | ")
    .replace(/(\d+)\.\s/g, "\n$1. ")         // ensure newline before any "n. "
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // A) Ranked negatives: "Negative growth in MS (YYYY-MM)"
  if (/^Negative growth in MS\s*\(/i.test(t)) {
    const lines = t.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const title = lines.shift();
    const items = lines.map(ln => {
      const m = ln.match(
        /^\d+\.\s*(.+?)\s+—\s+(.+?)\s+—\s+(.+?)\s+\|\s*MS\s+(-?\d+)\s+vs\s+LY\s+(-?\d+)\s+\(Δ\s+(-?\d+)\)/i
      );
      if (!m) return null;
      return { name: m[1], company: m[2], area: m[3], ms: +m[4], ly: +m[5], delta: +m[6] };
    }).filter(Boolean);

    return (
      <div style={{ fontSize: 14, lineHeight: 1.6, color: "#0F172A" }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{title}</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {items.map((it, i) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '28px 1fr auto',
              gap: 10, alignItems: 'center',
              padding: '10px 12px', borderRadius: 12,
              background: '#FFF', boxShadow: '0 1px 2px rgba(2,6,23,0.06)'
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: 6, display:'flex',
                alignItems:'center', justifyContent:'center',
                background: 'rgba(241,245,249,1)', fontWeight: 800
              }}>{i+1}</div>
              <div>
                <div style={{ fontWeight: 800 }}>{it.name}</div>
                <div style={{ color:'#64748B', fontSize: 12 }}>{it.company} • {it.area}</div>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <Badge tone="down">Δ {it.delta}</Badge>
                <span style={{ fontSize: 12, color:'#475569' }}>
                  MS {it.ms.toLocaleString()} • LY {it.ly.toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // B) Two-section market share ("This month" + "Cumulative")
  if (/^This month/i.test(t) && /\n\s*Cumulative/i.test(t)) {
    const [mPart, cPart] = t.split(/\n\s*Cumulative\s*\n/i);
    const monthLines = mPart.replace(/^This month\s*\n?/i, "").split("\n").map(s=>s.trim()).filter(Boolean);
    const cumLines   = cPart.split("\n").map(s=>s.trim()).filter(Boolean);
    const parseLine = ln => {
      const m = ln.match(/^(.+?)\s+(\d+(?:\.\d+)?)%\s*(?:\((?:YoY|yoy)\s*([+\-]?\d+(?:\.\d+)?)\))?/i);
      if (!m) return null;
      return { brand: m[1].trim(), pct: +m[2], yoy: m[3] ? +m[3] : null };
    };

    const Section = ({ title, items }) => (
      <>
        <SectionTitle>{title}</SectionTitle>
        <div style={{ display:'grid', gap:6 }}>
          {items.map((x, i) => (
            <RowLine
              key={i}
              left={x.brand}
              right={
                <>
                  <span style={{ fontWeight: 800 }}>{x.pct.toFixed(2)}%</span>{" "}
                  {x.yoy != null && (
                    <Badge tone={x.yoy >= 0 ? "up" : "down"}>
                      YoY {x.yoy >= 0 ? "+" : ""}{x.yoy.toFixed(2)}
                    </Badge>
                  )}
                </>
              }
            />
          ))}
        </div>
      </>
    );

    return (
      <div style={{ fontSize: 14, lineHeight: 1.6, color: "#0F172A" }}>
        <Section title="This month" items={monthLines.map(parseLine).filter(Boolean)} />
        <div style={{ height: 8 }} />
        <Section title="Cumulative" items={cumLines.map(parseLine).filter(Boolean)} />
      </div>
    );
  }

  // Fallback
  return <div style={{ whiteSpace:'pre-wrap', fontSize:14, lineHeight:1.6 }}>{t}</div>;
}

// --- Helper: turn the assistant's raw text into a structured shape we can render nicely
function parseAssistant(text = "") {
  const t0 = (text || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "") // strip any leaked think blocks
    .replace(/\*\*/g, "")                     // remove markdown bold markers
    .replace(/^\s*[-*•]+\s*/gm, "")           // strip bullet chars at line starts
    .replace(/(\d+)\.\s/g, "\n$1. ")          // ensure newline before "1. ", "2. ", ...
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // A) Ranked negatives block
  if (/^Negative growth in MS\s*\(/i.test(t0)) {
    const lines = t0.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const title = lines.shift() || "Negative growth in MS";
    const items = lines.map(ln => {
      const m = ln.match(
        /^\d+\.\s*(.+?)\s+—\s+(.+?)\s+—\s+(.+?)\s+\|\s*MS\s+(-?\d+)\s+vs\s+LY\s+(-?\d+)\s+\(Δ\s+(-?\d+)\)/i
      );
      if (!m) return null;
      return { name: m[1], company: m[2], area: m[3], ms: +m[4], ly: +m[5], delta: +m[6] };
    }).filter(Boolean);

    return { type: "negatives", title, items };
  }

  // B) Two-section market share block
  if (/^This month/i.test(t0) && /\n\s*Cumulative/i.test(t0)) {
    const [mPart, cPart] = t0.split(/\n\s*Cumulative\s*\n/i);
    const monthLines = (mPart || "").replace(/^This month\s*\n?/i, "")
      .split("\n").map(s => s.trim()).filter(Boolean);
    const cumLines   = (cPart || "")
      .split("\n").map(s => s.trim()).filter(Boolean);

    const parseLine = (ln) => {
      // "IOC 43.99% (YoY -1.80)"
      const m = ln.match(/^(.+?)\s+(\d+(?:\.\d+)?)%\s*(?:\((?:YoY|yoy)\s*([+\-]?\d+(?:\.\d+)?)\))?/i);
      if (!m) return null;
      return { brand: m[1].trim(), pct: +m[2], yoy: m[3] ? +m[3] : null };
    };

    return {
      type: "marketshare",
      month: monthLines.map(parseLine).filter(Boolean),
      cum:   cumLines.map(parseLine).filter(Boolean),
    };
  }

  // Fallback
  return { type: "plain", text: t0 };
}


/** ChatGPT-like pretty reply */
function AIReplyPro({ text }) {
  const data = parseAssistant(text);

  if (data.type === "negatives") {
    return (
      <div style={{ fontSize: 14, lineHeight: 1.6, color: "#0F172A" }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{data.title}</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {data.items.map((it, i) => (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '28px 1fr auto',
              gap: 10, alignItems: 'center',
              padding: '10px 12px', borderRadius: 12,
              background: '#FFF', boxShadow: '0 1px 2px rgba(2,6,23,0.06)'
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: 6, display:'flex',
                alignItems:'center', justifyContent:'center',
                background: 'rgba(241,245,249,1)', fontWeight: 800
              }}>{i+1}</div>
              <div>
                <div style={{ fontWeight: 800 }}>{it.name}</div>
                <div style={{ color:'#64748B', fontSize: 12 }}>{it.company} • {it.area}</div>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <Badge tone="down">Δ {it.delta}</Badge>
                <span style={{ fontSize: 12, color:'#475569' }}>
                  MS {it.ms.toLocaleString()} • LY {it.ly.toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (data.type === "marketshare") {
    const Section = ({ title, items }) => (
      <>
        <SectionTitle>{title}</SectionTitle>
        <div style={{ display:'grid', gap:6 }}>
          {items.map((x, i) => (
            <RowLine
              key={i}
              left={x.brand}
              right={
                <>
                  <span style={{ fontWeight: 800 }}>{x.pct.toFixed(2)}%</span>{" "}
                  {x.yoy != null && (
                    <Badge tone={x.yoy >= 0 ? "up" : "down"}>
                      YoY {x.yoy >= 0 ? "+" : ""}{x.yoy.toFixed(2)}
                    </Badge>
                  )}
                </>
              }
            />
          ))}
        </div>
      </>
    );

    return (
      <div style={{ fontSize: 14, lineHeight: 1.6, color: "#0F172A" }}>
        <Section title="This month" items={data.month} />
        <div style={{ height: 8 }} />
        <Section title="Cumulative" items={data.cum} />
      </div>
    );
  }

  // Fallback plain
  return <div style={{ whiteSpace:'pre-wrap', fontSize:14, lineHeight:1.6 }}>{data.text}</div>;
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
{/* LEFT COLUMN: Map + Search (replace prior inner `div style={{ flex: 1 }}`) */}
<div style={{ flex: 1, position: 'relative' }}>
  {/* Search box overlay */}
<div style={{
  position: 'absolute',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',   // center horizontally
  zIndex: 999,
  width: 260,
  borderRadius: 5,
  background: 'rgba(255,255,255,0.4)',   // transparent
  backdropFilter: 'blur(6px)',           // frosted glass
  padding: 5,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  transition: 'box-shadow 0.2s ease, background 0.2s ease',
}}
onMouseEnter={e => {
  e.currentTarget.style.background = 'rgba(255,255,255,0.9)';
  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
}}
onMouseLeave={e => {
  e.currentTarget.style.background = 'rgba(255,255,255,0.4)';
  e.currentTarget.style.boxShadow = 'none';
}}>


    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        aria-label="Search outlets, trading area or company"
        placeholder="Search outlet, trading area - e.g. Alkos, Valanchery"
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          updateSuggestions(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (suggestions.length > 0) selectSuggestion(suggestions[0]);
          } else if (e.key === 'Escape') {
            setSearchQuery('');
            setSuggestions([]);
          }
        }}
style={{
  flex: 1,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid transparent',
  fontSize: 12,
  background: 'transparent',
  outline: 'none'
}}
onFocus={e => e.currentTarget.style.border = '1px solid #38bdf8'}   // sky-blue highlight
onBlur={e => e.currentTarget.style.border = '1px solid transparent'}

      />
      <button
        title="Clear"
        onClick={() => { setSearchQuery(''); setSuggestions([]); }}
        style={{ width: 36, height: 36, borderRadius: 8, border: 'none', background: '#F8FAFC', cursor: 'pointer' }}
      >✕</button>
    </div>

    {suggestions.length > 0 && (
      <div style={{ maxHeight: 220, overflowY: 'auto', borderTop: '1px solid #F1F5F9', paddingTop: 6 }}>
        {suggestions.slice(0, 20).map((s, idx) => (
          <div
            key={idx}
            role="button"
            onClick={() => selectSuggestion(s)}
            style={{
              padding: '8px 6px',
              borderRadius: 8,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: idx === 0 ? 'rgba(14,165,233,0.03)' : 'transparent'
            }}
          >
            <div style={{ fontSize: 13, color: '#0F172A', fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 12, color: '#64748B' }}>{s.type}</div>
          </div>
        ))}
      </div>
    )}
  </div>

  {/* Map */}
<MapContainer
  whenCreated={map => { mapRef.current = map; map.invalidateSize(); }}
  center={center}
  zoom={13}
  style={{ height: '100%', width: '100%' }}
>
    <TileLayer url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' />
    {/* Deselect when clicking anywhere on map that is not a Marker */}
    <DeselectOnMapClick onDeselect={() => setSelected(null)} />
    {stations.map(st => {
      if (!st.lat || !st.lng || isNaN(st.lat) || isNaN(st.lng)) return null;
      const cmp = (st.company || '').toString().replace(/\s+/g, '').toUpperCase();
      const baseIcon = iconsMap[cmp] ? iconsMap[cmp] : fallbackIcon(st.company);

      const isInSelectedArea =
        selected && st.trading_area_norm === selected.trading_area_norm;

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
            {/* .. existing tooltip content (unchanged) .. */}
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
                  textAlign: "center",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ fontSize: 11, color: "#94A3B8" }}>MS</div>
                  <div style={{ fontWeight: 700, margin: "2px 0" }}>{st.ms.toLocaleString()}</div>
                  <PercentBadge value={calcGrowth(st.ms, st.ms_ly)} />
                </div>

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

      <aside ref={rightPaneRef}style={{ width: '50%', minWidth: '20%', background: '#fff', overflow: 'auto', height: '100vh' }}>
<div style={{ position:'relative', padding: 16, height: '100%' }}>
  {aiMode ? (
    /* ================= AI CHAT ONLY ================ */
    <div style={{ position:'relative', height:'calc(100vh - 32px)' }}>
      {/* Close (top-right) */}
      <button
        aria-label="Close AI"
        className="ai-close"
        onClick={closeAI}
      >✕</button>

      {/* Center hint (only if no chat yet) */}
{chatHistory.length === 0 && (
  <div style={{
    position:'absolute',
    inset:0,
    display:'flex',
    alignItems:'center',
    justifyContent:'center',
    padding:'24px',
    pointerEvents:'none'
  }}>
    <div style={{ color:'#64748B', textAlign:'center', maxWidth:520 }}>
      Ask about biggest movers,
      market-share shifts, or mop-up guidance.
    </div>
  </div>
)}


  {/* Reply bubble list */}
<div style={{ overflowY: "auto", paddingBottom: 60, height: "calc(100% - 60px)" }}>
{chatHistory.map((msg) => {
  const isUser = msg.role === "user";
  const isSqlResult = !isUser && msg.content && typeof msg.content === "object" && msg.content.type === "sql_result";
  return (
    <div
      key={msg.id || JSON.stringify(msg)}   // <- stable key (prefers msg.id)
      style={{
        maxWidth: "80%",
        margin: isUser ? "8px 0 8px auto" : "8px auto 8px 0",
        padding: "10px 14px",
        borderRadius: 12,
        background: isUser ? "#E0F2FE" : "#FFFFFF",
        boxShadow: isUser ? "none" : "0 1px 2px rgba(2,6,23,0.06)"
      }}
    >
      {isUser
        ? msg.content
        : (isSqlResult
            ? <SQLResult
                sql={msg.content.sql}
                columns={msg.content.columns}
                rows={msg.content.rows}
                summary={msg.content.summary}     // <- new
              />
            : <AIReplyPro text={msg.content} />
          )
      }
    </div>
  );
})}


</div>


      {/* Bottom-centered input */}
      <form className="ai-inputbar" onSubmit={handleAISubmit}>
        <input
          autoFocus
          value={aiInput}
          onChange={(e)=>setAiInput(e.target.value)}
          placeholder="Ask your question…"
          aria-label="Ask AI"
        />
        <button type="submit" className="ai-send" disabled={aiBusy}>
          {aiBusy ? "…" : "Send"}
        </button>
      </form>
    </div>
  ) : (
    /* ============ NON-AI: EVERYTHING ELSE ============ */
    <>
      {/* Top-right AI open button (same spot as ✕) */}
      <button
        aria-label="Open AI"
        className="ai-close"
        onClick={openAI}
      >AI</button>

      {/* Month selector (hidden in AI mode) */}
      <div style={{ marginBottom: 8 }}>
        <MonthSelector
          records={records}
          value={latestMonth}
          onChange={(m) => setLatestMonth(m)}
        />
      </div>

      {/* Right pane content */}
      {!selected ? (
        <div>
          {/* Buttons visible when NO RO is selected */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setPageIndex(2)}
              title="Positive growth (selected month)"
              style={{ padding: '8px 10px', borderRadius: 8, border: 'none', background:'#F0F9FF', cursor:'pointer' }}
            >+M</button>
            <button
              onClick={() => setPageIndex(3)}
              title="Positive growth (cumulative Apr → selected)"
              style={{ padding: '8px 10px', borderRadius: 8, border: 'none', background:'#ECFDF5', cursor:'pointer' }}
            >+C</button>
            <button
              onClick={() => setPageIndex(4)}
              title="Negative growth (selected month)"
              style={{ padding: '8px 10px', borderRadius: 8, border: 'none', background:'#FEF2F2', cursor:'pointer' }}
            >−M</button>
            <button
              onClick={() => setPageIndex(5)}
              title="Negative growth (cumulative Apr → selected)"
              style={{ padding: '8px 10px', borderRadius: 8, border: 'none', background:'#FFE4E6', cursor:'pointer' }}
            >−C</button>
          </div>

          <button
            onClick={() => setPageIndex(6)}
            title="Market share (selected month)"
            style={{ padding: '8px 10px', borderRadius: 8, border: 'none', background:'#F8FAFC', cursor:'pointer' }}
          >Market share</button>

          <button
            onClick={() => setPageIndex(7)}
            title="Cumulative Market share (Apr → selected)"
            style={{ padding: '8px 10px', borderRadius: 8, border: 'none', background:'#FFF7ED', cursor:'pointer' }}
          >Cumulative Market share</button>

          {/* Growth/MarketShare pages when no RO is selected */}
          {pageIndex >= 2 && (() => {
            const year = (latestMonth || "").split("-")[0] || new Date().getFullYear();
            const startMonth = `${year}-04`;

            // Build data for Growth pages
            const monthlyMS  = buildMonthlyGrowthRowsMS(stations);
            const monthlyHSD = buildMonthlyGrowthRowsHSD(stations);
            const cumMS      = buildCumulativeGrowthRowsMS(stations, startMonth, latestMonth);
            const cumHSD     = buildCumulativeGrowthRowsHSD(stations, startMonth, latestMonth);

            // Build data for Market share pages (All stations)
            const msMonthly  = marketShareRowsAllMonthly_MS(stations);
            const hsdMonthly = marketShareRowsAllMonthly_HSD(stations);
            const msCum      = marketShareRowsAllCumulative_MS(stations, startMonth, latestMonth);
            const hsdCum     = marketShareRowsAllCumulative_HSD(stations, startMonth, latestMonth);

            // Decide which page to show
            if (pageIndex === 6) {
              return (
                <div style={{ marginTop: 14 }}>
                  <h3 style={{ margin: '0 0 8px 0' }}>Market share | Selected Month</h3>
                  <MarketShareTable rows={msMonthly}  label="MS | Company-wise Market Share" />
                  <MarketShareTable rows={hsdMonthly} label="HSD | Company-wise Market Share" />
                </div>
              );
            }
            if (pageIndex === 7) {
              return (
                <div style={{ marginTop: 14 }}>
                  <h3 style={{ margin: '0 0 8px 0' }}>
                    Cumulative Market share | Apr → {formatMonth(latestMonth)}
                  </h3>
                  <MarketShareTable rows={msCum}  label="MS | Company Market Share (Cumulative)" />
                  <MarketShareTable rows={hsdCum} label="HSD | Company Market Share (Cumulative)" />
                </div>
              );
            }

            // Existing Growth pages (+M/+C/−M/−C)
            let rowsMS = [], rowsHSD = [];
            if (pageIndex === 2) {
              rowsMS  = sortRowsByGrowth(monthlyMS.filter(r => r.growth > 0), 'desc');
              rowsHSD = sortRowsByGrowth(monthlyHSD.filter(r => r.growth > 0), 'desc');
            } else if (pageIndex === 3) {
              rowsMS  = sortRowsByGrowth(cumMS.filter(r => r.growth > 0), 'desc');
              rowsHSD = sortRowsByGrowth(cumHSD.filter(r => r.growth > 0), 'desc');
            } else if (pageIndex === 4) {
              rowsMS  = sortRowsByGrowth(monthlyMS.filter(r => r.growth < 0), 'asc');
              rowsHSD = sortRowsByGrowth(monthlyHSD.filter(r => r.growth < 0), 'asc');
            } else if (pageIndex === 5) {
              rowsMS  = sortRowsByGrowth(cumMS.filter(r => r.growth < 0), 'asc');
              rowsHSD = sortRowsByGrowth(cumHSD.filter(r => r.growth < 0), 'asc');
            }

            const title =
              pageIndex === 2 ? 'Selected Month | Positive Growth' :
              pageIndex === 3 ? 'Cumulative (Apr → Selected) | Positive Growth' :
              pageIndex === 4 ? 'Selected Month | Negative Growth' :
                                'Cumulative (Apr → Selected) | Negative Growth';

            const summaryMS  = summarizeByCompany(rowsMS);
            const summaryHSD = summarizeByCompany(rowsHSD);

            return (
              <div style={{ marginTop: 14 }}>
                <h3 style={{ margin: '0 0 8px 0' }}>{title}</h3>
                <SummaryTable rows={summaryMS}  label="MS | Summary by Company" />
                <GrowthTable  rows={rowsMS}     label="MS | RO-wise" />
                <SummaryTable rows={summaryHSD} label="HSD | Summary by Company" />
                <GrowthTable  rows={rowsHSD}    label="HSD | RO-wise" />
              </div>
            );
          })()}
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
    <motion.div
      key={selected?.outlet_id ?? selected?.id ?? outletKeyForRow(selected)}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.3 }}
    >
        <div>
          {/* Header: name + nav buttons */}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <h2 style={{ margin: 0 }}>{selected.name}</h2>
              <div style={{ color: '#64748B', marginTop: 6 }}>
                {selected.company} • {selected.trading_area}
              </div>
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
          {/* Month / Cumulative toggle */} 
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12, alignItems: 'center' }}>
              <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>Month</div>
              <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>MS</div>
              <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>MS LY</div>
              <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>MS Change</div>
              <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>HSD</div>
              <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>HSD LY</div>
              <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 700 }}>HSD Change</div>
            </div>

            <AnimatePresence mode="wait">
              {pageIndex === 1 ? (
                <motion.div
                  key="cumulative"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3 }}
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12, alignItems: 'center' }}
                >
                  <div style={{ fontWeight: 600 }}>Cumulative</div>
                  <div style={{ fontWeight: 700 }}>{(cumulativeSums?.ms ?? 0).toLocaleString()}</div>
                  <div>{(cumulativeSums?.ms_ly ?? 0).toLocaleString()}</div>
                  <div><VolumeChange curr={cumulativeSums?.ms ?? 0} prev={cumulativeSums?.ms_ly ?? 0} /></div>
                  <div style={{ fontWeight: 700 }}>{(cumulativeSums?.hsd ?? 0).toLocaleString()}</div>
                  <div>{(cumulativeSums?.hsd_ly ?? 0).toLocaleString()}</div>
                  <div><VolumeChange curr={cumulativeSums?.hsd ?? 0} prev={cumulativeSums?.hsd_ly ?? 0} /></div>
                </motion.div>
              ) : (
                <motion.div
                  key="monthly"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3 }}
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12, alignItems: 'center' }}
                >
                  <div>{formatMonth(selected.month)}</div>
                  <div style={{ fontWeight: 700 }}>{selected.ms.toLocaleString()}</div>
                  <div>{selected.ms_ly.toLocaleString()}</div>
                  <div><VolumeChange curr={selected.ms} prev={selected.ms_ly} /></div>
                  <div style={{ fontWeight: 700 }}>{selected.hsd.toLocaleString()}</div>
                  <div>{selected.hsd_ly.toLocaleString()}</div>
                  <div><VolumeChange curr={selected.hsd} prev={selected.hsd_ly} /></div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

           {/* Trading Area - Outlets */}
              <div style={{ marginTop: 20 }}>
  <h3 style={{ margin: '0 0 8px 0', display: "flex", alignItems: "center", gap: 6 }}>
  Trading Area - Outlets
  <AnimatePresence mode="wait">
    {pageIndex === 1 ? (
      <motion.span
        key="outlets-cumulative-title"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6 }}
        transition={{ duration: 0.3 }}
        style={{ fontWeight: 400, fontSize: "0.9em", color: "#64748B" }}
      >
        (Cumulative Apr → {formatMonth(latestMonth)})
      </motion.span>
    ) : (
      <motion.span
        key="outlets-monthly-title"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6 }}
        transition={{ duration: 0.3 }}
        style={{ fontWeight: 400, fontSize: "0.9em", color: "#64748B" }}
      >
        (Month)
      </motion.span>
    )}
  </AnimatePresence>
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
   <AnimatePresence mode="wait">
  <motion.tbody
    key={pageIndex === 1 ? "outlets-cumulative" : "outlets-monthly"}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ duration: 0.3 }}
  >
    {(() => {
      const areaNorm = (selected && (selected.trading_area_norm || (selected.trading_area || '').toLowerCase())) || "";
      let outlets = outletsInAreaNorm(areaNorm);

      if (pageIndex === 1) {
        const year = (latestMonth || "").split("-")[0] || new Date().getFullYear();
        const startMonth = `${year}-04`;
        outlets = outlets.map(o => {
          const sums = cumulativeForOutletRows(o.rows || [], startMonth, latestMonth);
          return { ...o, ms: sums.ms, ms_ly: sums.ms_ly, hsd: sums.hsd, hsd_ly: sums.hsd_ly };
        });
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
  </motion.tbody>
</AnimatePresence>

                  </table>
                </div>
              </div>

              {/* Trading Area - Market Share */}
              <div style={{ marginTop: 20 }}>
                <h3 style={{ margin: '0 0 8px 0' }}>Trading Area - Market Share</h3>
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
<AnimatePresence mode="wait">
  <motion.tbody
    key={pageIndex === 1 ? "marketshare-cumulative" : "marketshare-monthly"}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ duration: 0.3 }}
  >
    {(() => {
      const areaNorm = (selected && (selected.trading_area_norm || (selected.trading_area || '').toLowerCase())) || "";
      let rows = [];

      if (areaNorm) {
        rows = pageIndex === 1
          ? computeCumulativeMarketShareForArea(outletsInAreaNorm(areaNorm), `${(latestMonth || "").split("-")[0]}-04`, latestMonth)
          : computeMarketShare(areaNorm);
      }

      if (!rows || rows.length === 0) {
        return (<tr><td colSpan={4} style={{ padding: 16, color: '#64748B' }}>No market-share data available for this trading area.</td></tr>);
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
  </motion.tbody>
</AnimatePresence>

                  </table>
                </div>
              </div>

          {/* Trading Area - Outlets */}
          {/* (unchanged table and market share sections from your file) */}
          {/* ... paste your existing Trading Area - Outlets and Market Share blocks here unchanged ... */}
        </div>
          </motion.div>
  </AnimatePresence>
      )}
    </>
  )}
</div>

      </aside>
    </div>
  );
}
