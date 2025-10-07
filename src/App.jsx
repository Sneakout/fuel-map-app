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

function buildInsightsPayload({ latestMonth, stations }) {
  const year = (latestMonth || "").split("-")[0];
  const startMonth = `${year}-04`;

  const msMonthly  = marketShareRowsAllMonthly_MS(stations).slice(0,12);
  const hsdMonthly = marketShareRowsAllMonthly_HSD(stations).slice(0,12);
  const msCum      = marketShareRowsAllCumulative_MS(stations, startMonth, latestMonth).slice(0,12);
  const hsdCum     = marketShareRowsAllCumulative_HSD(stations, startMonth, latestMonth).slice(0,12);

  const monthlyMS  = buildMonthlyGrowthRowsMS(stations);
  const monthlyHSD = buildMonthlyGrowthRowsHSD(stations);
  const cumMS      = buildCumulativeGrowthRowsMS(stations, startMonth, latestMonth);
  const cumHSD     = buildCumulativeGrowthRowsHSD(stations, startMonth, latestMonth);

  return {
    context: { latestMonth, startMonth },
    marketShare: { msMonthly, hsdMonthly, msCum, hsdCum },
    growth: {
      msTopPos: monthlyMS.filter(r=>r.growth>0).sort((a,b)=>b.growth-a.growth).slice(0,10),
      msTopNeg: monthlyMS.filter(r=>r.growth<0).sort((a,b)=>a.growth-b.growth).slice(0,10),
      hsdTopPos: monthlyHSD.filter(r=>r.growth>0).sort((a,b)=>b.growth-a.growth).slice(0,10),
      hsdTopNeg: monthlyHSD.filter(r=>r.growth<0).sort((a,b)=>a.growth-b.growth).slice(0,10),
      msCumTopPos: cumMS.filter(r=>r.growth>0).sort((a,b)=>b.growth-a.growth).slice(0,10),
      msCumTopNeg: cumMS.filter(r=>r.growth<0).sort((a,b)=>a.growth-b.growth).slice(0,10),
      hsdCumTopPos: cumHSD.filter(r=>r.growth>0).sort((a,b)=>b.growth-a.growth).slice(0,10),
      hsdCumTopNeg: cumHSD.filter(r=>r.growth<0).sort((a,b)=>a.growth-b.growth).slice(0,10),
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
  setAiReply("");
  setAiInput("");
}

function closeAI() {
  const prev = prevViewRef.current;
  setAiMode(false);
  setAiReply("");
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

  // add user message
  setChatHistory(prev => [...prev, { role: "user", content: q }]);
  setAiInput("");
  setAiBusy(true);

  try {
    const payload = buildInsightsPayload({ latestMonth, stations });
    payload.question = q;

    const res = await fetch("/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { text } = await res.json();

    // add assistant reply
    setChatHistory(prev => [...prev, { role: "assistant", content: text || "(no answer)" }]);
  } catch (err) {
    setChatHistory(prev => [...prev, { role: "assistant", content: `Failed: ${err.message}` }]);
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
      Ask about monthly vs cumulative performance, biggest movers,
      market-share shifts, or mop-up guidance.
    </div>
  </div>
)}


      {/* Reply bubble */}
      <div style={{ overflowY: "auto", paddingBottom: 60, height: "calc(100% - 60px)" }}>
  {chatHistory.map((msg, i) => (
    <div
      key={i}
      style={{
        maxWidth: "80%",
        margin: msg.role === "user" ? "8px 0 8px auto" : "8px auto 8px 0",
        padding: "10px 14px",
        borderRadius: 12,
        background: msg.role === "user" ? "#E0F2FE" : "#F1F5F9",
        alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
        whiteSpace: "pre-wrap",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      {msg.content}
    </div>
  ))}
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
