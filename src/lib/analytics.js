export const PSU_COMPANIES = new Set(["IOC", "BPC", "HPCL", "HPC"]);
export const PVT_COMPANIES = new Set(["MRPL", "NEL", "RIL"]);
export const TA_METRIC_ORDER = ["combined", "ms", "hsd"];
const PRE_APR_2025_COMMISSIONING_OUTLETS = new Set([
  "ANANGADI FUELS",
  "ARAFA PETROMART",
  "GOLDEN FUELS",
  "JAI PETROLEUM",
  "MEKKAMANNIL PETROLEUMS",
  "MKM PETROLEUM",
  "ZEAL FUELS",
]);
const TERMINATED_OUTLETS = new Set([
  "KOOLATH MOHAMMED SONS",
]);

export function formatMonth(monthStr) {
  if (!monthStr) return "";
  const [y, m] = monthStr.split("-");
  const d = new Date(Number(y), Number(m) - 1);
  return d.toLocaleString("default", { month: "short", year: "numeric" });
}

export function calcGrowth(curr, prev) {
  const c = Number(curr || 0);
  const p = Number(prev || 0);
  if (p === 0) return c === 0 ? 0 : 100;
  return ((c - p) / p) * 100;
}

export function formatRoundedNumber(value) {
  return Math.round(Number(value || 0)).toLocaleString("en-IN");
}

export function companyGroup(company) {
  const key = (company || "").toString().trim().toUpperCase();
  if (PSU_COMPANIES.has(key)) return "PSU";
  if (PVT_COMPANIES.has(key)) return "Pvt";
  return null;
}

export function marketShareStats(curr, last, totalCurr, totalLast) {
  const share = totalCurr ? (curr / totalCurr) * 100 : 0;
  const share_ly = totalLast ? (last / totalLast) * 100 : 0;
  return { share, share_ly, share_change: share - share_ly };
}

export function formatMonthRange(startMonth, endMonth) {
  return `${formatMonth(startMonth)} → ${formatMonth(endMonth)}`;
}

export function formatFiscalRangeLabel(startMonth, endMonth) {
  return `${formatMonth(startMonth)} - ${formatMonth(endMonth)}`;
}

export function uniqueSortedMonths(records) {
  const s = new Set(records.map(r => (r.month || "").toString().trim()).filter(Boolean));
  return Array.from(s).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
}

export function rowHasActualValues(row) {
  return Boolean(row?.hasCurrentValue);
}

export function uniqueSortedActualMonths(records) {
  const s = new Set(
    (records || [])
      .filter((record) => rowHasActualValues(record))
      .map((record) => (record.month || "").toString().trim())
      .filter(Boolean)
  );
  return Array.from(s).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
}

export function monthToken(monthStr) {
  if (!monthStr) return -Infinity;
  const [y, m] = monthStr.split("-").map(Number);
  if (!y || !m) return -Infinity;
  return y * 12 + (m - 1);
}

export function monthFromToken(token) {
  if (!Number.isFinite(token)) return "";
  const year = Math.floor(token / 12);
  const month = (token % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function nextMonth(monthStr) {
  const token = monthToken(monthStr);
  if (!Number.isFinite(token)) return "";
  return monthFromToken(token + 1);
}

export function monthInRange(monthStr, startStr, endStr) {
  const t = monthToken(monthStr);
  return t >= monthToken(startStr) && t <= monthToken(endStr);
}

export function fiscalYearStartMonth(monthStr) {
  const [yearRaw, monthRaw] = (monthStr || "").split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    return `${currentMonth >= 4 ? currentYear : currentYear - 1}-04`;
  }
  return `${month >= 4 ? year : year - 1}-04`;
}

export function fiscalYearLabel(monthStr) {
  const [yearRaw, monthRaw] = (monthStr || "").split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) return "";
  const startYear = month >= 4 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYearShort}`;
}

export function cumulativeForOutletRows(rows, startMonth, endMonth) {
  const sum = { ms: 0, hsd: 0, ms_ly: 0, hsd_ly: 0 };
  rows.forEach((r) => {
    const m = (r.month || "").toString();
    if (monthInRange(m, startMonth, endMonth)) {
      sum.ms += Number(r.ms || 0);
      sum.hsd += Number(r.hsd || 0);
      sum.ms_ly += Number(r.ms_ly || 0);
      sum.hsd_ly += Number(r.hsd_ly || 0);
    }
  });
  return sum;
}

export function cumulativeForAreaOutlets(areaOutlets, startMonth, endMonth) {
  return areaOutlets.map((o) => {
    const sums = cumulativeForOutletRows(o.rows || [], startMonth, endMonth);
    return { ...o, ms: sums.ms, ms_ly: sums.ms_ly, hsd: sums.hsd, hsd_ly: sums.hsd_ly };
  });
}

export function computeCumulativeMarketShareForArea(outlets, startMonth, endMonth) {
  const totals = {};
  outlets.forEach((o) => {
    const key = (o.company || "PVT").toString().toUpperCase();
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
    share: total_ms ? (vals.ms / total_ms) * 100 : 0,
    share_ly: total_ms_ly ? (vals.ms_ly / total_ms_ly) * 100 : 0,
    share_change: (total_ms && total_ms_ly) ? ((vals.ms / total_ms) * 100 - (vals.ms_ly / total_ms_ly) * 100) : 0,
  })).sort((a, b) => b.share - a.share);
}

export function buildMonthlyGrowthRowsMS(stations) {
  return (stations || []).map((s) => {
    const thisYear = Number(s.ms || 0);
    const lastYear = Number(s.ms_ly || 0);
    const growth = thisYear - lastYear;
    const growthPct = lastYear === 0 ? (thisYear === 0 ? 0 : 100) : ((growth / lastYear) * 100);
    return { name: s.name || "", company: s.company || "", area: s.trading_area || "", thisYear, lastYear, growth, growthPct };
  });
}

export function buildMonthlyGrowthRowsHSD(stations) {
  return (stations || []).map((s) => {
    const thisYear = Number(s.hsd || 0);
    const lastYear = Number(s.hsd_ly || 0);
    const growth = thisYear - lastYear;
    const growthPct = lastYear === 0 ? (thisYear === 0 ? 0 : 100) : ((growth / lastYear) * 100);
    return { name: s.name || "", company: s.company || "", area: s.trading_area || "", thisYear, lastYear, growth, growthPct };
  });
}

export function buildCumulativeGrowthRowsMS(stations, startMonth, endMonth) {
  return (stations || []).map((s) => {
    const sums = cumulativeForOutletRows(s.rows || [], startMonth, endMonth);
    const thisYear = Number(sums.ms || 0);
    const lastYear = Number(sums.ms_ly || 0);
    const growth = thisYear - lastYear;
    const growthPct = lastYear === 0 ? (thisYear === 0 ? 0 : 100) : ((growth / lastYear) * 100);
    return { name: s.name || "", company: s.company || "", area: s.trading_area || "", thisYear, lastYear, growth, growthPct };
  });
}

export function buildCumulativeGrowthRowsHSD(stations, startMonth, endMonth) {
  return (stations || []).map((s) => {
    const sums = cumulativeForOutletRows(s.rows || [], startMonth, endMonth);
    const thisYear = Number(sums.hsd || 0);
    const lastYear = Number(sums.hsd_ly || 0);
    const growth = thisYear - lastYear;
    const growthPct = lastYear === 0 ? (thisYear === 0 ? 0 : 100) : ((growth / lastYear) * 100);
    return { name: s.name || "", company: s.company || "", area: s.trading_area || "", thisYear, lastYear, growth, growthPct };
  });
}

export function sortRowsByGrowth(rows, direction) {
  const copy = [...(rows || [])];
  copy.sort((a, b) => direction === "asc" ? a.growth - b.growth : b.growth - a.growth);
  return copy;
}

export function buildIOCLossTradingAreaRows(
  stations,
  { fuel = "ms", mode = "monthly", startMonth, endMonth, rankBy = "share" } = {}
) {
  const byArea = {};
  (stations || []).forEach((s) => {
    const areaKey = (s.trading_area_norm || (s.trading_area || "").toLowerCase() || "unknown").toString();
    const areaName = (s.trading_area || "Unknown").toString().trim() || "Unknown";
    const company = (s.company || "PVT").toString().trim().toUpperCase();
    const volumes = mode === "cumulative"
      ? cumulativeForOutletRows(s.rows || [], startMonth, endMonth)
      : { ms: Number(s.ms || 0), ms_ly: Number(s.ms_ly || 0), hsd: Number(s.hsd || 0), hsd_ly: Number(s.hsd_ly || 0) };
    const curr = fuel === "hsd" ? Number(volumes.hsd || 0) : Number(volumes.ms || 0);
    const last = fuel === "hsd" ? Number(volumes.hsd_ly || 0) : Number(volumes.ms_ly || 0);
    if (!byArea[areaKey]) byArea[areaKey] = { area: areaName, totalCurr: 0, totalLast: 0, companies: {} };
    byArea[areaKey].totalCurr += curr;
    byArea[areaKey].totalLast += last;
    if (!byArea[areaKey].companies[company]) byArea[areaKey].companies[company] = { curr: 0, last: 0 };
    byArea[areaKey].companies[company].curr += curr;
    byArea[areaKey].companies[company].last += last;
  });
  return Object.values(byArea).map((area) => {
    const ioc = area.companies.IOC || { curr: 0, last: 0 };
    const growth = ioc.curr - ioc.last;
    const growthPct = ioc.last === 0 ? (ioc.curr === 0 ? 0 : 100) : (growth / ioc.last) * 100;
    const share = area.totalCurr ? (ioc.curr / area.totalCurr) * 100 : 0;
    const share_ly = area.totalLast ? (ioc.last / area.totalLast) * 100 : 0;
    return { area: area.area, curr: ioc.curr, last: ioc.last, growth, growthPct, share, share_ly, share_change: share - share_ly };
  }).filter((row) => {
    if (rankBy === "volume") return row.growth < 0;
    return row.share_change < 0;
  }).sort((a, b) => {
    if (rankBy === "volume") return a.growth - b.growth;
    return a.share_change - b.share_change;
  }).slice(0, 10);
}

export function summarizeByCompany(rows) {
  const map = {};
  (rows || []).forEach((r) => {
    const company = (r.company || "PVT").toString().trim() || "PVT";
    const hasBase = Number(r.lastYear || 0) > 0;
    if (!map[company]) map[company] = { company, total: 0, withBase: 0, withoutBase: 0 };
    map[company].total += 1;
    if (hasBase) map[company].withBase += 1;
    else map[company].withoutBase += 1;
  });
  return Object.values(map).sort((a, b) => b.total - a.total);
}

function marketShareRowsAll(stations, metric, cumulative, startMonth, endMonth, scope = "industry") {
  const by = {};
  let total = 0, total_ly = 0;
  (stations || []).forEach((s) => {
    const comp = (s.company || "").toString().trim().toUpperCase();
    if (!comp) return;
    if (scope === "psu" && !PSU_COMPANIES.has(comp)) return;
    const source = cumulative ? cumulativeForOutletRows(s.rows || [], startMonth, endMonth) : s;
    const curr = Number(source[metric] || 0);
    const last = Number(source[`${metric}_ly`] || 0);
    by[comp] = by[comp] || { company: comp, curr: 0, last: 0 };
    by[comp].curr += curr;
    by[comp].last += last;
    total += curr;
    total_ly += last;
  });
  const rows = Object.values(by).map((r) => {
    const growth = r.curr - r.last;
    const growthPct = r.last === 0 ? (r.curr === 0 ? 0 : 100) : (growth / r.last) * 100;
    const share = total ? (r.curr / total) * 100 : 0;
    const share_ly = total_ly ? (r.last / total_ly) * 100 : 0;
    const share_change = share - share_ly;
    const target_curr = (share_ly / 100) * total;
    const mop_up = target_curr - r.curr;
    return { company: r.company, curr: r.curr, last: r.last, growth, growthPct, share, share_ly, share_change, mop_up };
  }).sort((a, b) => b.share - a.share);

  rows.push({
    company: "Total",
    curr: total,
    last: total_ly,
    growth: total - total_ly,
    growthPct: total_ly === 0 ? (total === 0 ? 0 : 100) : ((total - total_ly) / total_ly) * 100,
    share: total ? 100 : 0,
    share_ly: total_ly ? 100 : 0,
    share_change: 0,
    mop_up: 0,
    isTotal: true,
  });

  return rows;
}

export const marketShareRowsAllMonthly_MS = (stations, scope = "industry") => marketShareRowsAll(stations, "ms", false, undefined, undefined, scope);
export const marketShareRowsAllMonthly_HSD = (stations, scope = "industry") => marketShareRowsAll(stations, "hsd", false, undefined, undefined, scope);
export const marketShareRowsAllCumulative_MS = (stations, startMonth, endMonth, scope = "industry") => marketShareRowsAll(stations, "ms", true, startMonth, endMonth, scope);
export const marketShareRowsAllCumulative_HSD = (stations, startMonth, endMonth, scope = "industry") => marketShareRowsAll(stations, "hsd", true, startMonth, endMonth, scope);

function weightedAverage(values, weights) {
  let totalWeight = 0;
  let total = 0;
  values.forEach((value, index) => {
    const weight = Number(weights[index] || 0);
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || weight <= 0) return;
    totalWeight += weight;
    total += numeric * weight;
  });
  return totalWeight > 0 ? total / totalWeight : null;
}

function bounded(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function recentSeries(rows, metric, latestMonth) {
  return (rows || [])
    .map((row) => ({
      month: (row.month || "").toString().trim(),
      value: Number(row[metric] || 0),
    }))
    .filter((entry, index) => {
      const row = rows[index];
      return entry.month && Number.isFinite(entry.value) && monthToken(entry.month) <= monthToken(latestMonth) && rowHasActualValues(row);
    })
    .sort((a, b) => monthToken(a.month) - monthToken(b.month));
}

function historyValueForMonth(rows, metric, targetMonth) {
  const match = (rows || []).find((row) => (row.month || "").toString().trim() === targetMonth);
  return match ? Number(match[metric] || 0) : null;
}

function confidenceLabel(score) {
  if (score >= 0.75) return "High";
  if (score >= 0.45) return "Medium";
  return "Low";
}

export function forecastOutletMetric(station, metric, latestMonth) {
  const targetMonth = nextMonth(latestMonth);
  return forecastOutletMetricForTarget(station, metric, latestMonth, targetMonth);
}

function companyProjectionContext(stations, metric, latestMonth, targetMonth, scope = "industry") {
  const grouped = {};
  (stations || []).forEach((station) => {
    const company = (station.company || "").toString().trim().toUpperCase();
    if (!company) return;
    if (scope === "psu" && !PSU_COMPANIES.has(company)) return;
    const history = recentSeries(station.rows || [], metric, latestMonth);
    const current = historyValueForMonth(station.rows || [], metric, latestMonth) ?? Number(station[metric] || 0);
    const latestLy = historyValueForMonth(station.rows || [], `${metric}_ly`, latestMonth) ?? Number(station[`${metric}_ly`] || 0);
    const targetRow = (station.rows || []).find((row) => (row.month || "").toString().trim() === targetMonth);
    const targetLy = targetRow ? Number(targetRow[`${metric}_ly`] || 0) : 0;
    const recentLevels = history.slice(-3).map((entry) => entry.value);
    if (!grouped[company]) grouped[company] = { current: 0, latestLy: 0, targetLy: 0, recentLevels: [] };
    grouped[company].current += current;
    grouped[company].latestLy += latestLy;
    grouped[company].targetLy += targetLy;
    grouped[company].recentLevels.push(...recentLevels);
  });

  const contexts = {};
  Object.entries(grouped).forEach(([company, row]) => {
    const yoyFactor = row.latestLy > 0 ? bounded(row.current / row.latestLy, 0.65, 1.45) : 1;
    const recentMomentum = row.recentLevels.length
      ? weightedAverage(
          row.recentLevels.slice(-3),
          row.recentLevels.length === 1 ? [1] : row.recentLevels.length === 2 ? [0.4, 0.6] : [0.2, 0.3, 0.5]
        )
      : row.current;
    const seasonalBase = row.targetLy > 0 ? row.targetLy : (row.latestLy || row.current || 1);
    const seasonalFactor = seasonalBase > 0 ? bounded((recentMomentum || row.current || 0) / seasonalBase, 0.7, 1.35) : 1;
    contexts[company] = { yoyFactor, seasonalFactor };
  });
  return contexts;
}

function forecastOutletMetricForTarget(station, metric, latestMonth, targetMonth, context = {}) {
  const history = recentSeries(station?.rows || [], metric, latestMonth);
  const current = historyValueForMonth(station?.rows || [], metric, latestMonth) ?? Number(station?.[metric] || 0);
  const latestLy = historyValueForMonth(station?.rows || [], `${metric}_ly`, latestMonth) ?? Number(station?.[`${metric}_ly`] || 0);
  const targetRow = (station?.rows || []).find((row) => (row.month || "").toString().trim() === targetMonth) || null;
  const targetLy = targetRow ? Number(targetRow[`${metric}_ly`] || 0) : 0;
  const recent = history.slice(-3);
  const recentLevel = recent.length
    ? weightedAverage(
        recent.map((entry) => entry.value),
        recent.length === 1 ? [1] : recent.length === 2 ? [0.4, 0.6] : [0.2, 0.3, 0.5]
      )
    : null;
  const recentRatios = [];
  for (let index = 1; index < recent.length; index += 1) {
    const prev = recent[index - 1].value;
    const next = recent[index].value;
    if (prev > 0) recentRatios.push(next / prev);
  }
  const outletMomentumFactor = recentRatios.length ? bounded(weightedAverage(recentRatios, recentRatios.length === 1 ? [1] : [0.4, 0.6]), 0.75, 1.25) : null;
  const outletYoYFactor = latestLy > 0 ? bounded(current / latestLy, 0.65, 1.5) : null;
  const company = (station?.company || "").toString().trim().toUpperCase();
  const companyContext = context[company] || { yoyFactor: 1, seasonalFactor: 1 };

  let projected = 0;
  if (targetLy > 0) {
    const factorParts = [];
    if (outletYoYFactor !== null) factorParts.push({ value: outletYoYFactor, weight: 0.45 });
    if (outletMomentumFactor !== null) factorParts.push({ value: outletMomentumFactor, weight: 0.2 });
    factorParts.push({ value: companyContext.yoyFactor, weight: 0.25 });
    factorParts.push({ value: companyContext.seasonalFactor, weight: 0.1 });
    const blendedFactor =
      factorParts.reduce((sum, part) => sum + part.value * part.weight, 0) /
      factorParts.reduce((sum, part) => sum + part.weight, 0);
    projected = targetLy * blendedFactor;
  } else if (recentLevel !== null) {
    const trendProjection = outletMomentumFactor !== null ? recentLevel * outletMomentumFactor : recentLevel;
    projected = weightedAverage(
      [recentLevel, trendProjection, recentLevel * companyContext.yoyFactor],
      [0.55, 0.2, 0.25]
    ) || recentLevel;
  } else {
    projected = current;
  }

  const recentSix = history.slice(-6).map((entry) => entry.value);
  const mean = recentSix.length ? recentSix.reduce((sum, value) => sum + value, 0) / recentSix.length : 0;
  const variance = recentSix.length
    ? recentSix.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / recentSix.length
    : 0;
  const volatility = mean > 0 ? Math.sqrt(variance) / mean : 1;
  const historyScore = Math.min(history.length / 12, 1);
  const seasonalScore = targetLy > 0 ? 1 : 0.4;
  const volatilityScore = recentSix.length < 2 ? 0.4 : Math.max(0, 1 - Math.min(volatility, 1));
  const score = (historyScore * 0.35) + (seasonalScore * 0.4) + (volatilityScore * 0.25);

  return {
    current,
    projected: Math.max(0, projected),
    growth: Math.max(0, projected) - current,
    growthPct: current === 0 ? (projected === 0 ? 0 : 100) : ((Math.max(0, projected) - current) / current) * 100,
    confidence: confidenceLabel(score),
    confidenceScore: score,
    inputs: {
      targetLy,
      recentLevel,
      outletYoYFactor,
      outletMomentumFactor,
      historyMonths: history.length,
    },
  };
}

export function buildProjectionRows(stations, metric, latestMonth, scope = "industry", targetMonth = nextMonth(latestMonth)) {
  const byCompany = {};
  let totalCurrent = 0;
  let totalProjected = 0;
  const projectionContext = companyProjectionContext(stations, metric, latestMonth, targetMonth, scope);

  (stations || []).forEach((station) => {
    const company = (station.company || "").toString().trim().toUpperCase();
    if (!company) return;
    if (scope === "psu" && !PSU_COMPANIES.has(company)) return;

    const forecast = forecastOutletMetricForTarget(station, metric, latestMonth, targetMonth, projectionContext);
    const lastYear = Number(station?.[`${metric}_ly`] || 0);
    if (!byCompany[company]) {
      byCompany[company] = {
        company,
        current: 0,
        last: 0,
        projected: 0,
        confidenceWeighted: 0,
        confidenceBase: 0,
      };
    }
    byCompany[company].current += forecast.current;
    byCompany[company].last += lastYear;
    byCompany[company].projected += forecast.projected;
    const confidenceWeight = Math.max(forecast.projected, forecast.current, 1);
    byCompany[company].confidenceWeighted += forecast.confidenceScore * confidenceWeight;
    byCompany[company].confidenceBase += confidenceWeight;
    totalCurrent += forecast.current;
    totalProjected += forecast.projected;
  });

  const rawRows = Object.values(byCompany).map((row) => {
    const projectedGrowth = row.projected - row.current;
    const projectedGrowthPct = row.current === 0 ? (row.projected === 0 ? 0 : 100) : (projectedGrowth / row.current) * 100;
    const currentShare = totalCurrent ? (row.current / totalCurrent) * 100 : 0;
    const rawProjectedShare = totalProjected ? (row.projected / totalProjected) * 100 : 0;
    const confidenceScore = row.confidenceBase ? row.confidenceWeighted / row.confidenceBase : 0;
    const currentYoYGrowthPct = row.last === 0 ? (row.current === 0 ? 0 : 100) : ((row.current - row.last) / row.last) * 100;

    let shareCap = confidenceScore >= 0.85 ? 2.5 : confidenceScore >= 0.7 ? 2 : 1.5;
    if (currentYoYGrowthPct < 0) shareCap = Math.min(shareCap, 1.5);
    const rawShareChange = rawProjectedShare - currentShare;
    const trendGap = projectedGrowthPct - currentYoYGrowthPct;

    const shareAlpha = Math.abs(rawShareChange) > shareCap ? shareCap / Math.abs(rawShareChange) : 1;
    const trendAlpha = trendGap > 12 ? Math.max(0.45, 12 / trendGap) : 1;
    const damping = Math.min(shareAlpha, trendAlpha);
    const adjustedProjected = row.current + ((row.projected - row.current) * damping);

    let confidencePenalty = 0;
    if (Math.abs(rawShareChange) > 2) confidencePenalty += 0.22;
    if (trendGap > 12) confidencePenalty += 0.22;
    if (damping < 0.8) confidencePenalty += 0.12;
    if (damping < 0.65) confidencePenalty += 0.08;
    const adjustedConfidenceScore = Math.max(0, confidenceScore - confidencePenalty);

    return {
      company: row.company,
      current: row.current,
      last: row.last,
      rawProjected: row.projected,
      projected: adjustedProjected,
      currentShare,
      rawProjectedShare,
      rawShareChange,
      currentYoYGrowthPct,
      confidenceScore: adjustedConfidenceScore,
      confidencePenalty,
      damping,
    };
  });

  const adjustedTotalProjected = rawRows.reduce((sum, row) => sum + row.projected, 0);
  const preserveTotalScale = adjustedTotalProjected > 0 ? totalProjected / adjustedTotalProjected : 1;

  const rows = rawRows
    .map((row) => {
      const projected = row.projected * preserveTotalScale;
      const projectedGrowth = projected - row.current;
      const projectedGrowthPct = row.current === 0 ? (projected === 0 ? 0 : 100) : (projectedGrowth / row.current) * 100;
      const projectedShare = totalProjected ? (projected / totalProjected) * 100 : 0;
      return {
        company: row.company,
        current: row.current,
        last: row.last,
        projected,
        rawProjected: row.rawProjected,
        projectedGrowth,
        projectedGrowthPct,
        currentShare: row.currentShare,
        projectedShare,
        projectedShareChange: projectedShare - row.currentShare,
        currentYoYGrowthPct: row.currentYoYGrowthPct,
        confidence: confidenceLabel(row.confidenceScore),
        confidenceScore: row.confidenceScore,
        wasDamped: row.damping < 0.999,
      };
    })
    .sort((a, b) => b.projectedShare - a.projectedShare);

  rows.push({
    company: "Total",
    current: totalCurrent,
    projected: totalProjected,
    projectedGrowth: totalProjected - totalCurrent,
    projectedGrowthPct: totalCurrent === 0 ? (totalProjected === 0 ? 0 : 100) : ((totalProjected - totalCurrent) / totalCurrent) * 100,
    currentShare: totalCurrent ? 100 : 0,
    projectedShare: totalProjected ? 100 : 0,
    projectedShareChange: 0,
    currentYoYGrowthPct: 0,
    confidence: "—",
    confidenceScore: 0,
    isTotal: true,
  });

  return {
    rows,
    targetMonth,
  };
}

function rowHasPositiveSales(row) {
  return rowHasActualValues(row) && (Number(row?.ms || 0) > 0 || Number(row?.hsd || 0) > 0);
}

function canonicalCommissioningName(value) {
  return (value || "")
    .toString()
    .trim()
    .toUpperCase()
    .replace(/^[\s./-]*(M\/S|MSHSD|MS\/HSD|MS HSD|MS|HSD)\b[\s./-]*/i, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalCommissioningCompany(value) {
  const raw = (value || "").toString().trim().toUpperCase();
  if (raw === "IOCL") return "IOC";
  if (raw === "BPCL") return "BPC";
  if (raw === "HPC") return "HPCL";
  return raw;
}

function normalizeCommissioningOutletId(value) {
  return String(value || "")
    .replace(/,/g, "")
    .trim();
}

function findSustainedSalesStartRow(rows) {
  const actualRows = (rows || []).filter((row) => rowHasActualValues(row));
  for (let index = 0; index < actualRows.length; index += 1) {
    if (!rowHasPositiveSales(actualRows[index])) continue;
    const staysPositive = actualRows.slice(index).every((row) => rowHasPositiveSales(row));
    if (staysPositive) return actualRows[index];
  }
  return null;
}

export function buildCommissioningData(stations, fiscalYears = []) {
  const earliestMonth = uniqueSortedMonths(
    (stations || []).flatMap((station) => station.rows || [])
  ).reverse()[0] || "";
  const preDatasetMonth = earliestMonth ? monthFromToken(monthToken(earliestMonth) - 1) : "";
  const preDatasetLabel = earliestMonth ? `Before ${formatMonth(earliestMonth)}` : "Before dataset start";

  const commissioned = [];
  const salesStarted = [];
  const outletGroups = new Map();

  (stations || []).forEach((station) => {
    (station.rows || []).forEach((row) => {
      const outletId = normalizeCommissioningOutletId(row.outlet_id || row.id);
      const identity = outletId || `${canonicalCommissioningName(row.name)}::${canonicalCommissioningCompany(row.company)}`;
      if (!identity) return;
      if (!outletGroups.has(identity)) outletGroups.set(identity, []);
      outletGroups.get(identity).push(row);
    });
  });

  outletGroups.forEach((groupedRows) => {
    const rows = [...groupedRows]
      .filter((row) => (row.month || "").toString().trim())
      .sort((a, b) => monthToken(a.month) - monthToken(b.month));
    if (!rows.length) return;

    const latestNamedRow = [...rows].reverse().find((row) => canonicalCommissioningName(row.name)) || rows[rows.length - 1];
    const outletName = canonicalCommissioningName(latestNamedRow.name);
    if (TERMINATED_OUTLETS.has(outletName)) return;

    const firstRow = rows[0];
    const firstPositiveRow = rows.find((row) => rowHasPositiveSales(row)) || null;
    const sustainedSalesStartRow = findSustainedSalesStartRow(rows);
    const actualRows = rows.filter((row) => rowHasActualValues(row));
    const preDatasetCommissioning = PRE_APR_2025_COMMISSIONING_OUTLETS.has(outletName);
    const appearedLater = monthToken(firstRow.month) > monthToken(earliestMonth);
    const priorActualRows = firstPositiveRow
      ? actualRows.filter((row) => monthToken(row.month) < monthToken(firstPositiveRow.month))
      : [];
    const hadZeroLeadIn =
      Boolean(firstPositiveRow) &&
      priorActualRows.length > 0 &&
      priorActualRows.every((row) => !rowHasPositiveSales(row));
    const isCommissioned =
      preDatasetCommissioning ||
      Boolean(firstPositiveRow && (appearedLater || hadZeroLeadIn));

    if (!isCommissioned) return;

    const commissionedMonth = preDatasetCommissioning
      ? preDatasetMonth
      : (firstPositiveRow?.month || firstRow.month);
    const commissionedDisplay = preDatasetCommissioning ? preDatasetLabel : formatMonth(commissionedMonth);

    const commissionEvent = {
      outlet: (latestNamedRow.name || "").toString().trim(),
      company: canonicalCommissioningCompany(latestNamedRow.company),
      trading_area: (latestNamedRow.trading_area || latestNamedRow.area || "").toString().trim(),
      month: commissionedMonth,
      monthDisplay: commissionedDisplay,
      fiscalYear: fiscalYearLabel(commissionedMonth),
      salesStartMonth: sustainedSalesStartRow?.month || "",
      salesStartMonthDisplay: sustainedSalesStartRow?.month ? formatMonth(sustainedSalesStartRow.month) : "",
    };
    commissioned.push(commissionEvent);

    if (sustainedSalesStartRow) {
      salesStarted.push({
        outlet: (latestNamedRow.name || "").toString().trim(),
        company: canonicalCommissioningCompany(latestNamedRow.company),
        trading_area: (latestNamedRow.trading_area || latestNamedRow.area || "").toString().trim(),
        month: sustainedSalesStartRow.month,
        monthDisplay: formatMonth(sustainedSalesStartRow.month),
        fiscalYear: fiscalYearLabel(sustainedSalesStartRow.month),
        commissionedMonth,
        commissionedMonthDisplay: commissionedDisplay,
      });
    }
  });

  const filterByFiscalYears = (rows) =>
    rows.filter((row) => !fiscalYears.length || fiscalYears.includes(row.fiscalYear));

  const summarize = (rows) => {
    const byCompany = {};
    rows.forEach((row) => {
      const company = (row.company || "").toString().trim().toUpperCase();
      if (!company) return;
      byCompany[company] = (byCompany[company] || 0) + 1;
    });
    return Object.entries(byCompany)
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count || a.company.localeCompare(b.company));
  };

  return (fiscalYears.length ? fiscalYears : Array.from(new Set([
    ...commissioned.map((row) => row.fiscalYear),
    ...salesStarted.map((row) => row.fiscalYear),
  ])).sort())
    .map((fy) => {
      const fyCommissioned = filterByFiscalYears(commissioned).filter((row) => row.fiscalYear === fy)
        .sort((a, b) => monthToken(a.month) - monthToken(b.month) || a.company.localeCompare(b.company) || a.outlet.localeCompare(b.outlet));
      const fySalesStarted = filterByFiscalYears(salesStarted).filter((row) => row.fiscalYear === fy)
        .sort((a, b) => monthToken(a.month) - monthToken(b.month) || a.company.localeCompare(b.company) || a.outlet.localeCompare(b.outlet));
      return {
        fiscalYear: fy,
        commissioned: fyCommissioned,
        salesStarted: fySalesStarted,
        commissionedSummary: summarize(fyCommissioned),
        salesStartedSummary: summarize(fySalesStarted),
      };
    });
}

export function buildTradingAreaOutletRows(outlets, totals) {
  return (outlets || []).map((o) => {
    const msStats = marketShareStats(Number(o.ms || 0), Number(o.ms_ly || 0), totals.ms, totals.ms_ly);
    const hsdStats = marketShareStats(Number(o.hsd || 0), Number(o.hsd_ly || 0), totals.hsd, totals.hsd_ly);
    return { name: o.name, company: o.company, ms: Number(o.ms || 0), ms_ly: Number(o.ms_ly || 0), hsd: Number(o.hsd || 0), hsd_ly: Number(o.hsd_ly || 0), ...msStats, hsd_share: hsdStats.share, hsd_share_ly: hsdStats.share_ly, hsd_share_change: hsdStats.share_change };
  }).sort((a, b) => b.ms - a.ms);
}

export function buildTradingAreaCompanyRows(outlets) {
  const totals = (outlets || []).reduce((acc, o) => {
    acc.ms += Number(o.ms || 0);
    acc.ms_ly += Number(o.ms_ly || 0);
    acc.hsd += Number(o.hsd || 0);
    acc.hsd_ly += Number(o.hsd_ly || 0);
    return acc;
  }, { ms: 0, ms_ly: 0, hsd: 0, hsd_ly: 0 });
  const grouped = {};
  (outlets || []).forEach((o) => {
    const company = (o.company || "PVT").toString().trim().toUpperCase();
    if (!grouped[company]) grouped[company] = { name: company, company, ms: 0, ms_ly: 0, hsd: 0, hsd_ly: 0 };
    grouped[company].ms += Number(o.ms || 0);
    grouped[company].ms_ly += Number(o.ms_ly || 0);
    grouped[company].hsd += Number(o.hsd || 0);
    grouped[company].hsd_ly += Number(o.hsd_ly || 0);
  });
  return Object.values(grouped).map((row) => {
    const msStats = marketShareStats(row.ms, row.ms_ly, totals.ms, totals.ms_ly);
    const hsdStats = marketShareStats(row.hsd, row.hsd_ly, totals.hsd, totals.hsd_ly);
    return { ...row, ...msStats, hsd_share: hsdStats.share, hsd_share_ly: hsdStats.share_ly, hsd_share_change: hsdStats.share_change };
  }).sort((a, b) => b.ms - a.ms);
}

export function buildTradingAreaGroupSectionRows(companyRows, groupName) {
  const rows = (companyRows || []).filter((row) => companyGroup(row.company) === groupName);
  if (!rows.length) return [];
  const total = rows.reduce((acc, row) => {
    acc.ms += row.ms;
    acc.ms_ly += row.ms_ly;
    acc.hsd += row.hsd;
    acc.hsd_ly += row.hsd_ly;
    return acc;
  }, { name: `${groupName} Total`, company: groupName, ms: 0, ms_ly: 0, hsd: 0, hsd_ly: 0 });
  const totalMs = (companyRows || []).reduce((sum, row) => sum + row.ms, 0);
  const totalMsLy = (companyRows || []).reduce((sum, row) => sum + row.ms_ly, 0);
  const totalHsd = (companyRows || []).reduce((sum, row) => sum + row.hsd, 0);
  const totalHsdLy = (companyRows || []).reduce((sum, row) => sum + row.hsd_ly, 0);
  const msStats = marketShareStats(total.ms, total.ms_ly, totalMs, totalMsLy);
  const hsdStats = marketShareStats(total.hsd, total.hsd_ly, totalHsd, totalHsdLy);
  return [...rows, { ...total, ...msStats, hsd_share: hsdStats.share, hsd_share_ly: hsdStats.share_ly, hsd_share_change: hsdStats.share_change, isTotal: true }];
}

export function buildTradingAreaCompanyMergedRows(companyRows) {
  const psuRows = buildTradingAreaGroupSectionRows(companyRows, "PSU");
  const pvtRows = buildTradingAreaGroupSectionRows(companyRows, "Pvt");
  return [...(companyRows || []), ...(psuRows.length ? [psuRows[psuRows.length - 1]] : []), ...(pvtRows.length ? [pvtRows[pvtRows.length - 1]] : [])];
}
