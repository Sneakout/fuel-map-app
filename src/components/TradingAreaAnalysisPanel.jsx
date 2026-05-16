import React, { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  buildTradingAreaCompanyMergedRows,
  buildTradingAreaCompanyRows,
  buildTradingAreaOutletRows,
  cumulativeForOutletRows,
  fiscalYearStartMonth,
  formatFiscalRangeLabel,
  formatMonth,
  formatMonthRange,
  formatRoundedNumber,
} from "../lib/analytics";
import { TradingAreaPerformanceTable, VolumeChange } from "./analysisShared";

export default function TradingAreaAnalysisPanel({
  taSelected,
  taView,
  latestMonth,
  outletsInAreaNorm,
  onBack,
}) {
  const data = useMemo(() => {
    const areaNorm = taSelected?.trading_area_norm || "";
    const areaOutletsBase = outletsInAreaNorm(areaNorm);
    const startMonth = fiscalYearStartMonth(latestMonth);
    const isCumulative = taView.period === "cumulative";
    const activeMetric = taView.metric;
    const areaOutlets = isCumulative
      ? areaOutletsBase.map((o) => {
          const sums = cumulativeForOutletRows(o.rows || [], startMonth, latestMonth);
          return { ...o, ms: sums.ms, ms_ly: sums.ms_ly, hsd: sums.hsd, hsd_ly: sums.hsd_ly };
        })
      : areaOutletsBase;

    const areaTotals = areaOutlets.reduce(
      (acc, o) => {
        acc.ms += Number(o.ms || 0);
        acc.ms_ly += Number(o.ms_ly || 0);
        acc.hsd += Number(o.hsd || 0);
        acc.hsd_ly += Number(o.hsd_ly || 0);
        return acc;
      },
      { ms: 0, ms_ly: 0, hsd: 0, hsd_ly: 0 }
    );

    const outletRows = buildTradingAreaOutletRows(areaOutlets, areaTotals);
    const companyRows = buildTradingAreaCompanyRows(areaOutlets);
    const companyMergedRows = buildTradingAreaCompanyMergedRows(companyRows);
    const outletCount = areaOutlets.length || 0;
    const areaAverages = {
      ms: outletCount ? areaTotals.ms / outletCount : 0,
      hsd: outletCount ? areaTotals.hsd / outletCount : 0,
    };

    return {
      activeMetric,
      areaAverages,
      areaOutlets,
      areaTotals,
      companyMergedRows,
      cumulativeRangeLabel: formatMonthRange(startMonth, latestMonth),
      isCumulative,
      metricLabel: activeMetric === "combined" ? "Combined" : activeMetric === "ms" ? "MS" : "HSD",
      outletCount,
      outletRows,
      periodLabel: isCumulative ? formatFiscalRangeLabel(startMonth, latestMonth) : formatMonth(latestMonth),
    };
  }, [latestMonth, outletsInAreaNorm, taSelected, taView.metric, taView.period]);

  const {
    activeMetric,
    areaAverages,
    areaTotals,
    companyMergedRows,
    cumulativeRangeLabel,
    isCumulative,
    metricLabel,
    outletCount,
    outletRows,
    periodLabel,
  } = data;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={`ta-${taSelected?.trading_area_norm || ""}`}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.3 }}
      >
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  type="button"
                  onClick={onBack}
                  aria-label="Back to trading area rankings"
                  title="Back"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    border: "none",
                    background: "#F8FAFC",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <h2 style={{ margin: 0 }}>{taSelected?.trading_area}</h2>
              </div>
              <div style={{ color: "#64748B", marginTop: 6 }}>Trading area analysis</div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: activeMetric === "combined" ? "repeat(11, 1fr)" : "repeat(7, 1fr)",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>Period</div>
              <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>Outlets</div>
              {activeMetric === "combined" ? (
                <>
                  <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>MS</div>
                  <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>MS LY</div>
                  <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>MS Change</div>
                  <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>Avg MS</div>
                  <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>HSD</div>
                  <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>HSD LY</div>
                  <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>HSD Change</div>
                  <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>Avg HSD</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>{metricLabel}</div>
                  <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>{metricLabel} LY</div>
                  <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>{metricLabel} Change</div>
                  <div style={{ fontSize: 12, color: "#94A3B8", fontWeight: 700 }}>Avg {metricLabel}</div>
                </>
              )}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={isCumulative ? "ta-cumulative" : "ta-monthly"}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
                style={{
                  display: "grid",
                  gridTemplateColumns: activeMetric === "combined" ? "repeat(11, 1fr)" : "repeat(7, 1fr)",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div style={{ fontWeight: 600 }}>{periodLabel}</div>
                <div style={{ fontWeight: 700 }}>{outletCount}</div>
                {activeMetric === "combined" ? (
                  <>
                    <div style={{ fontWeight: 700 }}>{formatRoundedNumber(areaTotals.ms)}</div>
                    <div>{formatRoundedNumber(areaTotals.ms_ly)}</div>
                    <div>
                      <VolumeChange curr={areaTotals.ms} prev={areaTotals.ms_ly} />
                    </div>
                    <div>{formatRoundedNumber(areaAverages.ms)}</div>
                    <div style={{ fontWeight: 700 }}>{formatRoundedNumber(areaTotals.hsd)}</div>
                    <div>{formatRoundedNumber(areaTotals.hsd_ly)}</div>
                    <div>
                      <VolumeChange curr={areaTotals.hsd} prev={areaTotals.hsd_ly} />
                    </div>
                    <div>{formatRoundedNumber(areaAverages.hsd)}</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 700 }}>{formatRoundedNumber(activeMetric === "ms" ? areaTotals.ms : areaTotals.hsd)}</div>
                    <div>{formatRoundedNumber(activeMetric === "ms" ? areaTotals.ms_ly : areaTotals.hsd_ly)}</div>
                    <div>
                      <VolumeChange
                        curr={activeMetric === "ms" ? areaTotals.ms : areaTotals.hsd}
                        prev={activeMetric === "ms" ? areaTotals.ms_ly : areaTotals.hsd_ly}
                      />
                    </div>
                    <div>{formatRoundedNumber(activeMetric === "ms" ? areaAverages.ms : areaAverages.hsd)}</div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <TradingAreaPerformanceTable
            rows={outletRows}
            label={`Trading Area - Outlets | ${metricLabel} ${isCumulative ? `(${cumulativeRangeLabel})` : "(Month)"}`}
            firstColumnLabel="Outlet"
            includeCompany
            metric={activeMetric}
          />

          <TradingAreaPerformanceTable
            rows={companyMergedRows}
            label={`Trading Area - Company | ${metricLabel}`}
            firstColumnLabel="Company"
            metric={activeMetric}
          />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
