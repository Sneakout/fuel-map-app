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
    Constructs a symmetric payoff game for all companies in the trading area
    for the transition month_index-1 -> month_index based on observed actions.
    Approach:
      - Strategies: {Decrease, Stable, Increase} (3)
      - For each company, observed action is a strategy for that company in the month transition.
      - Payoff for a joint strategy profile is estimated from the resulting market-share changes.
    This is empirical and simplified: the payoff matrix we build is pairwise/aggregate:
      - We'll create a square N x N matrix where N = number of companies.
      - Entry (i,j) is the observed immediate payoff for company i when i used observed action ai and j used aj.
    For multi-player, nashpy handles 2-player games. We will create pairwise 2-player games
    between top-two companies in area (most relevant) for equilibrium analysis.
    """
    companies = companies_in_area(agg_df, trading_area)
    if len(companies) < 2:
        return np.zeros((1,1)), companies

    # compute values for month t-1 and t
    if month_index == 0:
        return np.zeros((len(companies), len(companies))), companies

    m_prev = months_sorted[month_index - 1]
    m_curr = months_sorted[month_index]

    vals_prev = {c: float(agg_df[(agg_df['trading_area']==trading_area) & (agg_df['month']==m_prev) & (agg_df['company']==c)]['value'].sum() or 0.0) for c in companies}
    vals_curr = {c: float(agg_df[(agg_df['trading_area']==trading_area) & (agg_df['month']==m_curr) & (agg_df['company']==c)]['value'].sum() or 0.0) for c in companies}

    # compute observed relative change per company
    rel_change = {}
    for c in companies:
        prev = vals_prev.get(c, 0)
        curr = vals_curr.get(c, 0)
        if prev == 0:
            change = curr - prev
        else:
            change = (curr - prev) / prev
        rel_change[c] = change

    # For pairwise 2-player construction (top two by prev volume)
    # We'll return full vector of changes and list of companies; caller may construct pairwise games.
    # To support generic payoff matrix, create matrix where diag is self-payoff (change), off-diags are average interactions
    n = len(companies)
    M = np.zeros((n, n))
    for i, ci in enumerate(companies):
        for j, cj in enumerate(companies):
            # simplistic rule: payoff roughly equals company's rel_change scaled by influence of opponent:
            # if opponent decreased (rel_change negative) -> i gets relatively better
            # We'll set: M[i,j] = rel_change[ci] - 0.3 * rel_change[cj]
            M[i, j] = rel_change[ci] - 0.3 * rel_change[cj]
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
    months_all = sorted(agg['month'].unique())
    areas = sorted(agg['trading_area'].unique())
    for area in areas:
        months = sorted(agg[agg['trading_area']==area]['month'].unique())
        if not months:
            continue
        area_res = {'months': months, 'per_month': []}
        for mi, m in enumerate(months):
            M, companies = build_payoff_matrix_from_observations(agg, area, mi, months)
            # quick dynamics
            try:
                fp = fictitious_play(M) if M.size else np.array([])
            except Exception:
                fp = np.array([])
            try:
                rd = replicator_dynamics(M) if M.size else np.array([])
            except Exception:
                rd = np.array([])
            lh = compute_lemke_howson_for_pair(M, companies) if M.size else {}
            area_res['per_month'].append({
                'month': m,
                'payoff_matrix': M,
                'companies': companies,
                'fictitious_play': fp.tolist() if fp.size else [],
                'replicator': rd.tolist() if rd.size else [],
                'lemke_howson': lh
            })
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
