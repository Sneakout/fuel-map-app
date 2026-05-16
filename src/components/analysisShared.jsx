import React from "react";
import { formatRoundedNumber } from "../lib/analytics";

export function VolumeChange({ curr, prev }) {
  const diff = Number(curr || 0) - Number(prev || 0);
  const positive = diff >= 0;
  const sign = positive ? "+" : "-";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 8px",
        borderRadius: 8,
        background: positive ? "#ECFDF5" : "#FEF2F2",
        color: positive ? "#064E3B" : "#7F1D1D",
        fontWeight: 700,
      }}
    >
      {sign}
      {formatRoundedNumber(Math.abs(diff))}
    </span>
  );
}

export function ShareChange({ value }) {
  const positive = value >= 0;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 8px",
        borderRadius: 8,
        background: positive ? "#ECFDF5" : "#FEE2E2",
        color: positive ? "#064E3B" : "#7F1D1D",
        fontWeight: 700,
      }}
    >
      {positive ? "▲" : "▼"} {Math.abs(value).toFixed(2)} pp
    </span>
  );
}

export function TradingAreaPerformanceTable({
  rows,
  label,
  firstColumnLabel,
  includeCompany = false,
  metric = "combined",
}) {
  const cellStyle = { padding: "8px 8px", whiteSpace: "nowrap", verticalAlign: "middle" };
  const nameCellStyle = { ...cellStyle, whiteSpace: "normal" };
  const isCombined = metric === "combined";
  const isMS = metric === "ms";
  const metricLabel = isMS ? "MS" : "HSD";

  return (
    <div style={{ marginTop: 20 }}>
      <h3 style={{ margin: "0 0 8px 0" }}>{label}</h3>
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: 12,
          boxShadow: "0 1px 2px rgba(2,6,23,0.04)",
        }}
      >
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", tableLayout: "auto" }}>
          <thead style={{ color: "#94A3B8", textAlign: "left" }}>
            <tr>
              <th style={nameCellStyle}>{firstColumnLabel}</th>
              {includeCompany ? <th style={cellStyle}>Company</th> : null}
              {isCombined ? (
                <>
                  <th style={cellStyle}>MS</th>
                  <th style={cellStyle}>MS LY</th>
                  <th style={cellStyle}>MS Change</th>
                  <th style={cellStyle}>MS Share</th>
                  <th style={cellStyle}>MS Share (LY)</th>
                  <th style={cellStyle}>MS pp change</th>
                  <th style={cellStyle}>HSD</th>
                  <th style={cellStyle}>HSD LY</th>
                  <th style={cellStyle}>HSD Change</th>
                  <th style={cellStyle}>HSD Share</th>
                  <th style={cellStyle}>HSD Share (LY)</th>
                  <th style={cellStyle}>HSD pp change</th>
                </>
              ) : (
                <>
                  <th style={cellStyle}>{metricLabel}</th>
                  <th style={cellStyle}>{metricLabel} LY</th>
                  <th style={cellStyle}>{metricLabel} Change</th>
                  <th style={cellStyle}>{metricLabel} Share</th>
                  <th style={cellStyle}>{metricLabel} Share (LY)</th>
                  <th style={cellStyle}>{metricLabel} pp change</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {!rows || rows.length === 0 ? (
              <tr>
                <td
                  colSpan={includeCompany ? (isCombined ? 14 : 8) : isCombined ? 13 : 7}
                  style={{ padding: 16, color: "#64748B" }}
                >
                  No data.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr
                  key={`${r.name}-${i}`}
                  style={{
                    borderTop: "1px solid #F1F5F9",
                    fontWeight: r.isTotal ? 700 : 400,
                    background: r.isTotal ? "rgba(248,250,252,0.8)" : "transparent",
                  }}
                >
                  <td style={nameCellStyle}>{r.name}</td>
                  {includeCompany ? <td style={cellStyle}>{r.company}</td> : null}
                  {isCombined ? (
                    <>
                      <td style={cellStyle}>{formatRoundedNumber(r.ms)}</td>
                      <td style={cellStyle}>{formatRoundedNumber(r.ms_ly)}</td>
                      <td style={cellStyle}>
                        <VolumeChange curr={r.ms} prev={r.ms_ly} />
                      </td>
                      <td style={cellStyle}>{Number(r.share || 0).toFixed(2)}%</td>
                      <td style={cellStyle}>{Number(r.share_ly || 0).toFixed(2)}%</td>
                      <td style={cellStyle}>
                        <ShareChange value={r.share_change || 0} />
                      </td>
                      <td style={cellStyle}>{formatRoundedNumber(r.hsd)}</td>
                      <td style={cellStyle}>{formatRoundedNumber(r.hsd_ly)}</td>
                      <td style={cellStyle}>
                        <VolumeChange curr={r.hsd} prev={r.hsd_ly} />
                      </td>
                      <td style={cellStyle}>{Number(r.hsd_share || 0).toFixed(2)}%</td>
                      <td style={cellStyle}>{Number(r.hsd_share_ly || 0).toFixed(2)}%</td>
                      <td style={cellStyle}>
                        <ShareChange value={r.hsd_share_change || 0} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={cellStyle}>{formatRoundedNumber(isMS ? r.ms : r.hsd)}</td>
                      <td style={cellStyle}>{formatRoundedNumber(isMS ? r.ms_ly : r.hsd_ly)}</td>
                      <td style={cellStyle}>
                        <VolumeChange curr={isMS ? r.ms : r.hsd} prev={isMS ? r.ms_ly : r.hsd_ly} />
                      </td>
                      <td style={cellStyle}>{Number((isMS ? r.share : r.hsd_share) || 0).toFixed(2)}%</td>
                      <td style={cellStyle}>{Number((isMS ? r.share_ly : r.hsd_share_ly) || 0).toFixed(2)}%</td>
                      <td style={cellStyle}>
                        <ShareChange value={(isMS ? r.share_change : r.hsd_share_change) || 0} />
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
