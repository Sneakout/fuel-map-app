# agt_sim.py
"""
Algorithmic Game Theory simulation framework for fuel-map data.

Usage:
  pip install pandas numpy nashpy scipy
  python agt_sim.py /path/to/stations.csv

Assumptions about CSV columns:
  - month: "YYYY-MM" string
  - trading_area: text
  - company: brand name
  - ms: market share (or volume) numeric for that outlet-month row
  - ms_ly: last year market share (optional)
  (If ms is outlet-level volume, the framework aggregates by company per trading area.)
"""

from typing import Dict, List, Tuple, Any
import pandas as pd
import numpy as np
import nashpy as nash
from collections import defaultdict
import math

# -------------------------
# Helpers / preprocessing
# -------------------------
def load_csv(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    # normalize column names to lowercase
    df.columns = [c.strip().lower() for c in df.columns]
    # ensure month is string like "YYYY-MM"
    df['month'] = df['month'].astype(str)
    df['company'] = df['company'].astype(str)
    df['trading_area'] = df.get('trading_area', df.get('tradingarea', pd.Series(['']*len(df)))).astype(str)
    # ensure numeric
    for col in ['ms', 'ms_ly', 'hsd', 'hsd_ly']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
    else:
        # if ms missing, attempt to use volume or hsd as fallback
        if 'ms' not in df.columns:
            df['ms'] = 0
    return df

def company_month_aggregate(df: pd.DataFrame, value_col: str='ms') -> pd.DataFrame:
    """
    Aggregates outlet rows into company x trading_area x month totals.
    Returns dataframe indexed by [trading_area, month, company] with 'value' column.
    """
    agg = df.groupby(['trading_area', 'month', 'company'], dropna=False)[value_col].sum().reset_index()
    agg = agg.rename(columns={value_col: 'value'})
    return agg

def build_area_month_matrix(agg_df: pd.DataFrame, trading_area: str, month: str) -> Dict[str, float]:
    """
    For a given trading area & month, returns dict company -> value (ms).
    Companies with no data get 0.
    """
    sub = agg_df[(agg_df['trading_area']==trading_area) & (agg_df['month']==month)]
    out = {row['company']: float(row['value']) for _, row in sub.iterrows()}
    return out

def companies_in_area(agg_df: pd.DataFrame, trading_area: str) -> List[str]:
    return sorted(agg_df[agg_df['trading_area']==trading_area]['company'].unique())

# -------------------------
# Strategy discretization
# -------------------------
def discretize_action(delta: float, eps=1e-6, thresh_small=0.02) -> int:
    """
    Map continuous change delta (fraction or absolute depending on input) to discrete action:
     0 -> Decrease
     1 -> Stable
     2 -> Increase
    `thresh_small` is a relative threshold for 'stable' (e.g. 2%).
    """
    if math.isfinite(delta) is False:
        return 1
    # if delta near zero -> stable
    if abs(delta) <= thresh_small:
        return 1
    return 2 if delta > 0 else 0

def build_company_action_series(agg_df: pd.DataFrame, trading_area: str, company: str, months_sorted: List[str]) -> List[int]:
    """
    For a company in an area, compute month-to-month action series (discrete).
    We compute relative change in company ms vs previous month (fractional).
    For first month we emit 'stable' (1).
    """
    series = []
    prev = None
    for m in months_sorted:
        val = float(agg_df[(agg_df['trading_area']==trading_area) & (agg_df['month']==m) & (agg_df['company']==company)]['value'].sum() or 0.0)
        if prev is None:
            series.append(1)
        else:
            # relative delta (prev -> val)
            if prev == 0:
                delt = (val - prev)
            else:
                delt = (val - prev) / (prev if prev != 0 else 1)
            series.append(discretize_action(delt))
        prev = val
    return series

# -------------------------
# Payoff construction
# -------------------------
def build_payoff_matrix_from_observations(agg_df: pd.DataFrame, trading_area: str, month_index: int, months_sorted: List[str]) -> Tuple[np.ndarray, List[str]]:
    """
    Improved payoff construction based on market-share (percentage-point) changes.

    Approach:
    - Compute total value per area for month t-1 and t.
    - Compute company shares at t-1 and t (share in [0,1]).
    - share_change = (share_t - share_t_minus_1) expressed in percentage points (i.e. *100).
    - Self-payoff (diagonal) = share_change_i (so positive = gained share).
    - Off-diagonal entry M[i,j] = share_change_i - influence_factor * share_change_j,
      modeling that opponent j's gain reduces i's effective payoff.
    - influence_factor is configurable here (0.25 default) to moderate opponent influence.
    - Works if some companies have zero volume (smoothing added).
    """
    companies = companies_in_area(agg_df, trading_area)
    if len(companies) == 0:
        return np.zeros((0, 0)), companies
    if month_index == 0:
        # no previous month to compare
        return np.zeros((len(companies), len(companies))), companies

    # choose months
    m_prev = months_sorted[month_index - 1]
    m_curr = months_sorted[month_index]

    # gather total volume per month for the area
    total_prev = float(agg_df[(agg_df['trading_area'] == trading_area) & (agg_df['month'] == m_prev)]['value'].sum() or 0.0)
    total_curr = float(agg_df[(agg_df['trading_area'] == trading_area) & (agg_df['month'] == m_curr)]['value'].sum() or 0.0)

    # smoothing to avoid divide-by-zero and reduce noise for tiny totals
    eps_total = 1e-9
    total_prev = max(total_prev, eps_total)
    total_curr = max(total_curr, eps_total)

    # compute shares and share-change (in percentage points)
    share_prev = {}
    share_curr = {}
    share_change_pp = {}  # percentage points (share * 100)
    for c in companies:
        val_prev = float(agg_df[(agg_df['trading_area'] == trading_area) & (agg_df['month'] == m_prev) & (agg_df['company'] == c)]['value'].sum() or 0.0)
        val_curr = float(agg_df[(agg_df['trading_area'] == trading_area) & (agg_df['month'] == m_curr) & (agg_df['company'] == c)]['value'].sum() or 0.0)
        sp = val_prev / total_prev
        sc = val_curr / total_curr
        share_prev[c] = sp
        share_curr[c] = sc
        # convert to percentage points for interpretability (e.g., +1.5 = +1.5 pp)
        share_change_pp[c] = (sc - sp) * 100.0

    # build matrix
    n = len(companies)
    M = np.zeros((n, n))

    # Tunable parameter: how strongly one company's gain penalizes another's payoff.
    # 0 => independent (only own change matters). 0.25 => opponent changes subtract 25% of their change.
    influence_factor = 0.25

    # Populate matrix: diag = own change; off-diag = own_change - influence_factor * opp_change
    for i, ci in enumerate(companies):
        for j, cj in enumerate(companies):
            own = share_change_pp.get(ci, 0.0)
            opp = share_change_pp.get(cj, 0.0)
            if i == j:
                M[i, j] = own
            else:
                M[i, j] = own - (influence_factor * opp)

    # Optional normalization: if markets are tiny, scale down large swings.
    # Here we cap values to a reasonable band to keep dynamics stable.
    cap = 50.0  # +/- 50 percentage points is extreme; clamp to this range
    M = np.clip(M, -cap, cap)

    return M, companies


# -------------------------
# Solvers & Dynamics
# -------------------------
def compute_lemke_howson_for_pair(payoff_matrix: np.ndarray, companies: List[str]) -> Dict[str, Any]:
    """
    If payoff_matrix is N x N, pick top-2 companies by diagonal magnitude and compute 2-player Nash.
    Returns solution object or empty if cannot compute.
    """
    if payoff_matrix.size == 0:
        return {}
    n = payoff_matrix.shape[0]
    if n < 2:
        return {}
    # pick two largest diagonal entries (largest self-change) as focal players
    diag = np.abs(np.diag(payoff_matrix))
    idx = np.argsort(diag)[-2:]
    i, j = idx[0], idx[1]
    A = np.array([[payoff_matrix[i,i], payoff_matrix[i,j]],[payoff_matrix[j,i], payoff_matrix[j,j]]])
    # Construct a zero-sum-ish or bimatrix: we'll treat A as row player's payoff and transpose as col player's payoff for simplicity
    try:
        game = nash.Game(A, A.T)
        equilibria = list(game.support_enumeration())
        return {
            'players': (companies[i], companies[j]),
            'matrix_pair': A,
            'equilibria': equilibria
        }
    except Exception as e:
        return {'error': str(e)}

def fictitious_play(game_matrix: np.ndarray, steps: int = 200) -> np.ndarray:
    """
    Run a simple fictitious-play like dynamic on a payoff matrix (square).
    Interprets the matrix as single-player payoff for each pure strategy vs opponent's mixed strategy.
    Returns final mixed strategy (probabilities) as numpy vector.
    """
    n = game_matrix.shape[0]
    # start uniform
    cum_counts = np.zeros(n)
    # opponent belief
    opp_belief = np.ones(n) / n

    for t in range(steps):
        # best response to opp_belief: choose row maximizing expected payoff
        ev = game_matrix.dot(opp_belief)
        br = np.argmax(ev)
        cum_counts[br] += 1
        # update opp_belief as empirical distribution of cum_counts
        opp_belief = cum_counts / cum_counts.sum()
    return opp_belief

def replicator_dynamics(payoff_matrix: np.ndarray, steps: int = 200, dt: float = 0.01) -> np.ndarray:
    """
    Simple replicator dynamics on payoff_matrix (square).
    Returns strategy probabilities.
    """
    n = payoff_matrix.shape[0]
    p = np.ones(n) / n
    for _ in range(steps):
        payoffs = payoff_matrix.dot(p)
        avg = p.dot(payoffs)
        p = p + dt * p * (payoffs - avg)
        # renormalize and clip
        p = np.maximum(p, 0)
        s = p.sum()
        if s <= 0:
            p = np.ones(n)/n
        else:
            p = p / s
    return p

# -------------------------
# Top-level orchestrator
# -------------------------
def analyze_all_areas(csv_path: str, value_col='ms') -> Dict[str, Any]:
    df = load_csv(csv_path)
    agg = company_month_aggregate(df, value_col=value_col)
    results = {}
    # collect months per area (sorted ascending)
    areas = sorted(agg['trading_area'].unique())
    for area in areas:
        months = sorted(agg[agg['trading_area'] == area]['month'].unique())
        if not months:
            continue
        area_res = {'months': months, 'per_month': {}}  # per_month is a dict keyed by month
        for mi, m in enumerate(months):
            M, companies = build_payoff_matrix_from_observations(agg, area, mi, months)
            try:
                fp = fictitious_play(M) if M.size else np.array([])
            except Exception:
                fp = np.array([])
            try:
                rd = replicator_dynamics(M) if M.size else np.array([])
            except Exception:
                rd = np.array([])
            lh = compute_lemke_howson_for_pair(M, companies) if M.size else {}
            area_res['per_month'][m] = {
                'month': m,
                'payoff_matrix': M.tolist(),
                'companies': companies,
                'fictitious_play': fp.tolist() if fp.size else [],
                'replicator': rd.tolist() if rd.size else [],
                'lemke_howson': lh
            }
        results[area] = area_res
    return results


# -------------------------
# Example usage (CLI)
# -------------------------
if __name__ == "__main__":
    import sys, json
    if len(sys.argv) < 2:
        print("Usage: python agt_sim.py /path/to/stations.csv")
        sys.exit(1)
    path = sys.argv[1]
    res = analyze_all_areas(path, value_col='ms')
    # save aggregated results to JSON for inspection and further plotting
    out = "agt_results.json"
    with open(out, "w") as f:
        json.dump(res, f, default=lambda o: o if isinstance(o, (int, float, str, list, dict)) else str(o), indent=2)
    print(f"Analysis complete. Results written to {out}")
