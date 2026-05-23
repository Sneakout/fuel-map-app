export const PSU_COMPANIES = new Set(["IOC", "BPC", "HPCL", "HPC"]);
export const PVT_COMPANIES = new Set(["MRPL", "NEL", "RIL"]);
export const TA_METRIC_ORDER = ["combined", "ms", "hsd"];

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

export function monthToken(monthStr) {
  if (!monthStr) return -Infinity;
  const [y, m] = monthStr.split("-").map(Number);
  if (!y || !m) return -Infinity;
  return y * 12 + (m - 1);
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
    const comp = (s.company || "PVT").toString().trim().toUpperCase();
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
  return Object.values(by).map((r) => {
    const growth = r.curr - r.last;
    const growthPct = r.last === 0 ? (r.curr === 0 ? 0 : 100) : (growth / r.last) * 100;
    const share = total ? (r.curr / total) * 100 : 0;
    const share_ly = total_ly ? (r.last / total_ly) * 100 : 0;
    const share_change = share - share_ly;
    const target_curr = (share_ly / 100) * total;
    const mop_up = target_curr - r.curr;
    return { company: r.company, curr: r.curr, last: r.last, growth, growthPct, share, share_ly, share_change, mop_up };
  }).sort((a, b) => b.share - a.share);
}

export const marketShareRowsAllMonthly_MS = (stations, scope = "industry") => marketShareRowsAll(stations, "ms", false, undefined, undefined, scope);
export const marketShareRowsAllMonthly_HSD = (stations, scope = "industry") => marketShareRowsAll(stations, "hsd", false, undefined, undefined, scope);
export const marketShareRowsAllCumulative_MS = (stations, startMonth, endMonth, scope = "industry") => marketShareRowsAll(stations, "ms", true, startMonth, endMonth, scope);
export const marketShareRowsAllCumulative_HSD = (stations, startMonth, endMonth, scope = "industry") => marketShareRowsAll(stations, "hsd", true, startMonth, endMonth, scope);

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
