#!/usr/bin/env python3
"""
agt_viz_local.py

Visualize a single area's month result from agt_results.json.

Usage:
  python agt_viz_local.py -a "Valanchery" -m 2025-05 -o viz_output

Outputs saved to the -o directory:
  - payoff_heatmap.png
  - strategies.png
  - summary.txt
"""

import os
import json
import argparse
import math
import ast
from typing import Any, Dict, List, Tuple, Optional

import numpy as np
import matplotlib.pyplot as plt

# -------------------------
# Helper: robust picker (adapted from your test_pick helper)
# -------------------------
def pick_area_month(results: Dict[str, Any], area: Optional[str]=None, month: Optional[str]=None) -> Tuple[str, str, Dict]:
    """
    Robust selection of area and month from agt_results.json.
    Returns (chosen_area_key, chosen_month, chosen_month_data_dict)
    """
    if not isinstance(results, dict) or not results:
        raise SystemExit("agt_results.json appears empty or not a dict")

    areas = sorted(results.keys())
    if not areas:
        raise SystemExit("No areas found in agt_results.json")

    # choose area
    if area is None:
        chosen = areas[0]
        print(f"No area specified — using first area: {chosen}")
    elif area in results:
        chosen = area
    else:
        lc_map = {k.lower(): k for k in areas}
        if area.lower() in lc_map:
            chosen = lc_map[area.lower()]
        else:
            matches = [a for a in areas if area.lower() in a.lower()]
            if len(matches) == 1:
                chosen = matches[0]
                print(f"Found area match: {chosen}")
            elif len(matches) > 1:
                print(f"Multiple matches for '{area}': {matches}. Using first: {matches[0]}")
                chosen = matches[0]
            else:
                raise SystemExit(f"Area '{area}' not found. Available: {areas[:50]}")

    area_obj = results[chosen]
    # discover months representation
    # Case A: area_obj may be dict containing direct month keys or per_month list/dict
    months_list = []
    per_month_map = None

    if isinstance(area_obj, dict):
        # if 'per_month' exists and is list/dict we handle both
        pm = area_obj.get("per_month")
        if isinstance(pm, dict):
            per_month_map = pm
            months_list = sorted(list(per_month_map.keys()))
        elif isinstance(pm, list):
            # older version may have list of dicts with 'month' key
            months_list = [entry.get("month") for entry in pm if isinstance(entry, dict) and entry.get("month")]
            per_month_map = {entry.get("month"): entry for entry in pm if isinstance(entry, dict) and entry.get("month")}
            months_list = sorted(months_list)
        else:
            # maybe direct months as keys (YYYY-MM)
            direct_months = [k for k in area_obj.keys() if isinstance(k, str) and k.count("-") == 1 and k[:4].isdigit()]
            if direct_months:
                months_list = sorted(direct_months)
            elif isinstance(area_obj.get("months"), list):
                months_list = sorted(area_obj.get("months"))
                # try to populate per_month_map from per_month if exists
                if isinstance(area_obj.get("per_month"), dict):
                    per_month_map = area_obj.get("per_month")
    else:
        raise SystemExit(f"Area object shape not recognized for area '{chosen}'")

    if not months_list:
        raise SystemExit(f"Area '{chosen}' does not contain month list. Keys preview: {list(area_obj.keys())[:30]}")

    # choose month
    if month is None:
        chosen_month = months_list[-1]  # latest (sorted ascending)
        print(f"No month specified — using latest month for '{chosen}': {chosen_month}")
    else:
        if month in months_list:
            chosen_month = month
        else:
            raise SystemExit(f"Month '{month}' not present for area '{chosen}'. Available: {months_list[:50]}")

    # extract month data (try a few shapes)
    chosen_data = None
    if per_month_map and chosen_month in per_month_map:
        chosen_data = per_month_map[chosen_month]
    elif isinstance(area_obj.get("per_month"), list):
        # find in list
        for entry in area_obj.get("per_month"):
            if isinstance(entry, dict) and entry.get("month") == chosen_month:
                chosen_data = entry
                break
    elif chosen_month in area_obj:
        chosen_data = area_obj[chosen_month]
    else:
        # try to find an entry with key 'month' inside per_month-like lists
        for v in area_obj.values():
            if isinstance(v, dict) and v.get("month") == chosen_month:
                chosen_data = v
                break

    if chosen_data is None:
        raise SystemExit(f"Could not extract month data for {chosen} / {chosen_month}. Area keys: {list(area_obj.keys())[:40]}")

    return chosen, chosen_month, chosen_data

# -------------------------
# Utilities to normalize matrix-like objects found in JSON
# -------------------------
def normalise_matrix(obj) -> np.ndarray:
    """
    Accepts a variety of representations:
      - nested lists (already)
      - string representation of numpy array or 2D list (use ast.literal_eval)
      - a flattened list with shape information (not expected but handled)
    Returns a numpy 2D array (dtype=float).
    """
    if obj is None:
        return np.array([[]])
    if isinstance(obj, np.ndarray):
        return obj
    if isinstance(obj, list):
        try:
            arr = np.array(obj, dtype=float)
            if arr.ndim == 1:
                # If it's 1D, try to make square if possible (sqrt len)
                n = int(math.sqrt(arr.size))
                if n*n == arr.size:
                    return arr.reshape((n, n))
            return arr
        except Exception:
            # fallback: convert elements to float where possible
            try:
                return np.array([[float(x) for x in row] for row in obj])
            except Exception:
                return np.array([[]])
    if isinstance(obj, str):
        # try to parse with ast.literal_eval (safe)
        try:
            parsed = ast.literal_eval(obj)
            return normalise_matrix(parsed)
        except Exception:
            # try to parse numeric tokens
            try:
                tokens = [float(t) for t in obj.replace('\n', ' ').replace('[',' ').replace(']',' ').split() if t.strip()]
                n = int(math.sqrt(len(tokens)))
                if n*n == len(tokens):
                    return np.array(tokens).reshape((n,n))
            except Exception:
                pass
    # last resort
    return np.array([[]])

# -------------------------
# Visualization functions
# -------------------------
def plot_payoff_heatmap(M: np.ndarray, companies: List[str], out_path: str):
    if M.size == 0:
        print("No payoff matrix to plot.")
        return
    fig, ax = plt.subplots(figsize=(6,6))
    im = ax.imshow(M, aspect='equal')
    ax.set_title("Payoff matrix (estimated)")
    ax.set_xticks(np.arange(len(companies)))
    ax.set_yticks(np.arange(len(companies)))
    ax.set_xticklabels(companies, rotation=45, ha='right')
    ax.set_yticklabels(companies)
    # annotate values
    for i in range(M.shape[0]):
        for j in range(M.shape[1]):
            txt = f"{M[i,j]:.3f}"
            ax.text(j, i, txt, ha='center', va='center', color='w' if abs(M[i,j])>0.2 else 'black', fontsize=9)
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    plt.tight_layout()
    fp = os.path.join(out_path, "payoff_heatmap.png")
    fig.savefig(fp, dpi=150)
    plt.close(fig)
    print(f"Saved payoff heatmap -> {fp}")

def plot_strategies(fp_vec: List[float], rd_vec: List[float], companies: List[str], out_path: str):
    # create a side-by-side bar chart of fictitious play and replicator dynamics
    n = max(1, len(companies))
    x = np.arange(n)
    width = 0.35
    fp_arr = np.array(fp_vec) if fp_vec else np.zeros(n)
    rd_arr = np.array(rd_vec) if rd_vec else np.zeros(n)

    # ensure lengths match companies (pad if necessary)
    def pad(arr, n):
        if arr.size >= n:
            return arr[:n]
        a = np.zeros(n)
        a[:arr.size] = arr
        return a

    fp_arr = pad(fp_arr, n)
    rd_arr = pad(rd_arr, n)

    fig, ax = plt.subplots(figsize=(8,4.2))
    ax.bar(x - width/2, fp_arr, width, label='Fictitious Play')
    ax.bar(x + width/2, rd_arr, width, label='Replicator')
    ax.set_xticks(x)
    ax.set_xticklabels(companies, rotation=45, ha='right')
    ax.set_ylabel("Probability / Strength")
    ax.set_title("Strategy distributions")
    ax.legend()
    plt.tight_layout()
    fp_file = os.path.join(out_path, "strategies.png")
    fig.savefig(fp_file, dpi=150)
    plt.close(fig)
    print(f"Saved strategy chart -> {fp_file}")

def dump_summary(chosen: str, chosen_month: str, chosen_data: Dict, out_path: str):
    fp_vec = chosen_data.get("fictitious_play") or chosen_data.get("fict_play") or []
    rd_vec = chosen_data.get("replicator") or chosen_data.get("replicator_dynamics") or []
    companies = chosen_data.get("companies") or []
    lh = chosen_data.get("lemke_howson") or chosen_data.get("lemke_howson_solution") or {}

    lines = []
    lines.append(f"Area: {chosen}")
    lines.append(f"Month: {chosen_month}")
    lines.append("")
    lines.append("Companies: " + (", ".join(companies) if companies else "N/A"))
    lines.append("")
    lines.append("Fictitious play vector: " + (str(fp_vec) if fp_vec else "N/A"))
    lines.append("Replicator vector: " + (str(rd_vec) if rd_vec else "N/A"))
    lines.append("")
    lines.append("Lemke-Howson / Equilibria summary:")
    if isinstance(lh, dict) and lh:
        # some JSONs store big objects; pretty-print keys and small summaries
        import pprint
        pp = pprint.pformat(lh, width=120, compact=True)
        lines.append(pp)
    else:
        lines.append("N/A")

    out_file = os.path.join(out_path, "summary.txt")
    with open(out_file, "w") as f:
        f.write("\n".join(lines))
    print(f"Wrote textual summary -> {out_file}")

# -------------------------
# CLI + main
# -------------------------
def main():
    p = argparse.ArgumentParser(prog="agt_viz_local.py", description="Visualize AGT results for one area/month")
    p.add_argument("-a", "--area", help="Area name (case-insensitive substring allowed)", required=False)
    p.add_argument("-m", "--month", help="Month string YYYY-MM (optional, defaults to latest available)", required=False)
    p.add_argument("-o", "--out", help="Output directory to write images (default: viz_output)", default="viz_output")
    p.add_argument("--results", help="Path to agt_results.json (default: agt_results.json)", default="agt_results.json")
    args = p.parse_args()

    if not os.path.exists(args.results):
        raise SystemExit(f"Could not find results file: {args.results}")

    with open(args.results, "r") as f:
        results = json.load(f)

    chosen_area, chosen_month, chosen_data = pick_area_month(results, area=args.area, month=args.month)
    print(f"Chosen area: {chosen_area}")
    print(f"Chosen month: {chosen_month}")

    # normalize chosen_data fields
    companies = chosen_data.get("companies") or chosen_data.get("companies_list") or []
    fp_vec = chosen_data.get("fictitious_play") or chosen_data.get("fict_play") or []
    rd_vec = chosen_data.get("replicator") or chosen_data.get("replicator_dynamics") or []
    payoff_raw = chosen_data.get("payoff_matrix") or chosen_data.get("matrix") or chosen_data.get("payoff") or None

    # ensure company list is strings
    companies = [str(c) for c in companies]

    # normalize payoff matrix
    M = normalise_matrix(payoff_raw)

    # convert nested lists produced by json into floats, if needed
    try:
        M = M.astype(float) if M.size else M
    except Exception:
        M = normalise_matrix(payoff_raw)  # fallback

    # ensure consistent length: if companies length mismatch with matrix, adjust labels
    if M.size and M.ndim == 2:
        n = M.shape[0]
        if len(companies) != n:
            # try to create default company labels
            companies = [f"C{i+1}" for i in range(n)]

    # prepare output dir
    out_dir = args.out
    os.makedirs(out_dir, exist_ok=True)

    # Plot payoff matrix heatmap
    if M.size and M.ndim == 2 and M.shape[0] > 0:
        plot_payoff_heatmap(M, companies, out_dir)
    else:
        print("No valid payoff matrix found to plot (empty or unexpected shape).")

    # Plot strategy vectors
    plot_strategies(fp_vec, rd_vec, companies or [f"C{i+1}" for i in range(max(len(fp_vec), len(rd_vec), 1))], out_dir)

    # Dump textual summary (lemke-howson etc.)
    dump_summary(chosen_area, chosen_month, chosen_data, out_dir)

    print("Done. Visual outputs are in:", out_dir)

if __name__ == "__main__":
    main()
