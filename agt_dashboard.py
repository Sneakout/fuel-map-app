# agt_dashboard.py
import json
import math
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pandas as pd
import streamlit as st
import matplotlib.pyplot as plt

st.set_page_config(layout="wide", page_title="AGT - Company Dashboard")

RESULTS_PATH = Path("agt_results.json")


def safe_load_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        st.error(f"Cannot find {path.resolve()}. Run agt_sim.py first to produce agt_results.json")
        st.stop()
    with open(path, "r") as f:
        return json.load(f)


def extract_rows(results: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Flatten structure into rows of:
      { area, month, company, self_payoff, fictitious_score, replicator_score, lemke_howson_present }
    The original `results[area]` may contain:
      - 'months' (list) and 'per_month' (list/dict) OR
      - direct month keys.
    This function is defensive about the different shapes.
    """
    rows = []
    for area, area_obj in results.items():
        # Two common shapes:
        # 1) {'months': [...], 'per_month': [ {month:..., payoff_matrix:..., companies:..., ...}, ... ] }
        # 2) {'2025-05': {...}, '2025-06': {...}, 'months': [...], 'per_month': {...}} etc.
        per_month_entries = []

        # If `per_month` is a list of entries (our agt_sim used list), use that
        if isinstance(area_obj.get("per_month"), list):
            per_month_entries = area_obj.get("per_month", [])
        elif isinstance(area_obj.get("per_month"), dict):
            # dictionary keyed by month -> entry
            for m, entry in area_obj.get("per_month", {}).items():
                ent = dict(entry)
                ent["month"] = m
                per_month_entries.append(ent)
        else:
            # fallback: inspect keys for month-like keys (YYYY-MM)
            for k, v in area_obj.items():
                if isinstance(k, str) and k.count("-") == 1 and isinstance(v, dict):
                    ent = dict(v)
                    ent["month"] = k
                    per_month_entries.append(ent)

        # final fallback: if 'months' exists but per_month empty, skip gracefully
        for ent in per_month_entries:
            month = str(ent.get("month", ent.get("month", "")))
            companies = ent.get("companies") or ent.get("company") or []
            # payoffs may be stored as matrix-like object; we'll extract diagonal if possible
            payoff_raw = ent.get("payoff_matrix") or ent.get("payoff") or ent.get("matrix_pair")
            # try to coerce to numpy array if possible
            payoff_matrix = None
            if payoff_raw is None:
                payoff_matrix = None
            else:
                # Accept strings, lists, nested lists, or numpy arrays
                if isinstance(payoff_raw, str):
                    # attempt to parse numeric matrix in string form (e.g. '[[0. 0.]\n [..]]')
                    try:
                        # remove extra characters, rely on numpy
                        cleaned = payoff_raw.strip()
                        # Try literal eval via numpy fromstring or eval safely
                        arr = np.array(eval(cleaned))
                        payoff_matrix = arr
                    except Exception:
                        payoff_matrix = None
                else:
                    try:
                        payoff_matrix = np.array(payoff_raw)
                    except Exception:
                        payoff_matrix = None

            # scores
            fp = ent.get("fictitious_play") or ent.get("fictitious") or ent.get("fictitious_play", [])
            rd = ent.get("replicator") or ent.get("replicator", [])
            lh = ent.get("lemke_howson") or ent.get("lemke_howson", {})

            # If companies list present as list of strings -> map values per company
            if isinstance(companies, list) and companies:
                for idx, comp in enumerate(companies):
                    comp_name = str(comp)
                    # self payoff: prefer diagonal of payoff_matrix if shape matches
                    self_payoff = None
                    if payoff_matrix is not None and payoff_matrix.ndim == 2 and payoff_matrix.shape[0] == len(companies):
                        try:
                            self_payoff = float(payoff_matrix[idx, idx])
                        except Exception:
                            self_payoff = None
                    # fallback: sometimes ent contains a 'payoffs_by_company' dict
                    if self_payoff is None:
                        by_comp = ent.get("payoffs_by_company") or ent.get("payoff_by_company")
                        if isinstance(by_comp, dict) and comp_name in by_comp:
                            try:
                                self_payoff = float(by_comp[comp_name])
                            except Exception:
                                self_payoff = None
                    # fictitious/replicator entries may be lists aligned to companies
                    fict_score = None
                    if isinstance(fp, list) and len(fp) == len(companies):
                        try:
                            fict_score = float(fp[idx])
                        except Exception:
                            fict_score = None
                    replic_score = None
                    if isinstance(rd, list) and len(rd) == len(companies):
                        try:
                            replic_score = float(rd[idx])
                        except Exception:
                            replic_score = None

                    rows.append({
                        "area": area,
                        "month": month,
                        "company": comp_name,
                        "self_payoff": None if self_payoff is None else float(self_payoff),
                        "fictitious_score": None if fict_score is None else float(fict_score),
                        "replicator_score": None if replic_score is None else float(replic_score),
                        "has_lemke_howson": bool(lh)
                    })
            else:
                # if companies not provided but payoff has names inside, try to infer
                # fallback: create a single aggregated row for area/month
                avg_self = None
                if payoff_matrix is not None:
                    try:
                        avg_self = float(np.mean(np.diag(payoff_matrix)))
                    except Exception:
                        avg_self = None
                rows.append({
                    "area": area,
                    "month": month,
                    "company": "UNKNOWN",
                    "self_payoff": None if avg_self is None else float(avg_self),
                    "fictitious_score": None,
                    "replicator_score": None,
                    "has_lemke_howson": bool(lh)
                })
    return rows


# ---------------------
# Build DataFrame
# ---------------------
results = safe_load_json(RESULTS_PATH)
rows = extract_rows(results)
if not rows:
    st.error("No rows extracted from agt_results.json — check file format.")
    st.stop()

df = pd.DataFrame(rows)

# Clean company strings
df["company"] = df["company"].astype(str).str.strip()
# ensure numeric columns
for c in ["self_payoff", "fictitious_score", "replicator_score"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")

# Quick top-level summary
st.title("AGT — Company Performance Dashboard")
st.markdown("This dashboard aggregates analysis produced by `agt_sim.py` (agt_results.json).")
col1, col2 = st.columns([3, 1])

with col2:
    st.write("Data source")
    st.write(RESULTS_PATH)
    st.write("Rows:", len(df))
    st.write("Areas:", df["area"].nunique())
    st.write("Months:", df["month"].nunique())

# Controls
areas = ["All"] + sorted(df["area"].unique().tolist())
months = ["All"] + sorted(df["month"].unique().tolist())
companies = ["All"] + sorted(df["company"].unique().tolist())

sel_area = st.selectbox("Area", areas, index=0)
sel_month = st.selectbox("Month", months, index=0)
sel_company = st.selectbox("Company", companies, index=companies.index("IOC") if "IOC" in companies else 0)

filt = df.copy()
if sel_area != "All":
    filt = filt[filt["area"] == sel_area]
if sel_month != "All":
    filt = filt[filt["month"] == sel_month]
if sel_company != "All":
    filt = filt[filt["company"] == sel_company]

# Company-level aggregates (across filtered rows)
summary = filt.groupby("company").agg(
    rows_count=("company", "size"),
    mean_self_payoff=("self_payoff", "mean"),
    mean_fictitious=("fictitious_score", "mean"),
    mean_replicator=("replicator_score", "mean"),
    lemke_count=("has_lemke_howson", "sum")
).reset_index().sort_values(by="mean_self_payoff", ascending=False, na_position="last")

# Show ranking table
st.subheader("Company ranking (filtered)")
st.dataframe(summary.style.format({
    "mean_self_payoff": "{:.4f}",
    "mean_fictitious": "{:.4f}",
    "mean_replicator": "{:.4f}"
}).highlight_max("mean_self_payoff", color="#d4f1d4").set_properties(**{"font-family": "monospace"}), height=260)

# Chart: mean self-payoff
st.subheader("Mean self-payoff — company comparison")
fig, ax = plt.subplots(figsize=(8, 4))
bars = ax.bar(summary["company"], summary["mean_self_payoff"].fillna(0))
ax.set_ylabel("Mean self-payoff")
ax.set_xlabel("Company")
ax.set_title("Mean Self-Payoff (higher = better)")
ax.set_xticklabels(summary["company"], rotation=45, ha="right")
# highlight IOC if present
for i, bar in enumerate(bars):
    lbl = summary["company"].iloc[i]
    if lbl.upper() == "IOC" or lbl.upper().endswith("IOC"):
        bar.set_edgecolor("black")
        bar.set_linewidth(1.6)
        bar.set_alpha(0.95)
        bar.set_color("#1f77b4")
    else:
        bar.set_alpha(0.6)
ax.axhline(0, color="#444", linewidth=0.5)
st.pyplot(fig)

# Per-area details for selected company (IOC focus)
st.subheader(f"Where {sel_company} stands (area / month breakdown)")
if sel_company == "All":
    st.info("Pick a specific company to see area/month breakdown.")
else:
    comp_rows = df[df["company"] == sel_company]
    if sel_area != "All":
        comp_rows = comp_rows[comp_rows["area"] == sel_area]
    if comp_rows.empty:
        st.warning(f"No data for {sel_company} in current filters.")
    else:
        # small pivot table: area x month -> mean_self_payoff
        pivot = comp_rows.pivot_table(index="area", columns="month", values="self_payoff", aggfunc="mean")
        st.dataframe(pivot.fillna("").round(4), height=300)

        # highlight top areas where IOC is strong
        area_avg = comp_rows.groupby("area")["self_payoff"].mean().reset_index().sort_values("self_payoff", ascending=False)
        st.write("Top areas for", sel_company)
        st.table(area_avg.head(10).assign(self_payoff=lambda d: d["self_payoff"].round(4)).set_index("area"))

# Textual guidance hints (simple heuristics)
st.subheader("Automated hints (rough)")
hints = []
# Where IOC is weak vs peers (across filtered data)
if "IOC" in df["company"].values:
    ioc_avg = summary[summary["company"].str.upper() == "IOC"]["mean_self_payoff"]
    if not ioc_avg.empty and not math.isnan(ioc_avg.iloc[0]):
        ioc_val = ioc_avg.iloc[0]
        # find peers above IOC
        peers_above = summary[summary["mean_self_payoff"] > ioc_val]
        if len(peers_above) == 0:
            hints.append("IOC is top on mean self-payoff in current filters — maintain focus on high-performing areas.")
        else:
            top_peer = peers_above.iloc[0]["company"]
            hints.append(f"IOC lags behind {top_peer} on mean self-payoff in current filters — analyze promotions/pricing in overlapping areas.")
    else:
        hints.append("IOC: insufficient numeric self-payoff data in current filters.")
else:
    hints.append("IOC not present in dataset — check company naming / logos (maybe 'I O C' or 'i o c').")

st.write("- " + "\n- ".join(hints))

# Download aggregated CSV for offline analysis
st.markdown("---")
st.write("Export flattened data")
csv_bytes = df.to_csv(index=False).encode("utf-8")
st.download_button("Download flattened CSV", data=csv_bytes, file_name="agt_flattened.csv", mime="text/csv")

st.info("If anything looks off, inspect the raw agt_results.json structure. This dashboard attempts to be permissive about multiple possible shapes, but if your JSON is differently shaped please paste a small sample and I will adapt the loader.")
