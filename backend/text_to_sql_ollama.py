"""
Text-to-SQL over your local SQLite DB using Ollama (DeepSeek or any local model)

Improvements:
- `--sql` or `--sql-file` lets you bypass the LLM and run raw SQL safely.
- Strict SELECT-only validation. Rejects non-SELECT / dangerous statements.
- Output sanitation + retries if the model includes reasoning/clutter.
- Month filter guidance baked into the system prompt.

Requirements:
  - Ollama running locally: https://ollama.com
  - Example model:  ollama pull deepseek-r1:14b
  - Python deps:   pip install pandas requests sqlalchemy

Usage examples:
  python text_to_sql_ollama.py --db stations.db --question "top 10 rows" --model deepseek-r1:14b --print-sql
  python text_to_sql_ollama.py --db stations.db --table stations --question "MS by company for 2025-09" --print-sql
  # Bypass LLM:
  python text_to_sql_ollama.py --db stations.db --sql "SELECT * FROM stations LIMIT 5"

Notes:
- This tool enforces read-only SELECT queries.
- If your month column can be 'YYYY-MM' or 'YYYY-MM-DD' or a date type, use:
  (strftime('%Y-%m', month)='YYYY-MM' OR month='YYYY-MM' OR month LIKE 'YYYY-MM%')
"""
import time
import argparse
import json
import os
import re
import sqlite3
from pathlib import Path
from typing import List, Dict, Optional, Tuple

import requests
import pandas as pd
from sqlalchemy import create_engine, text
from fastapi import HTTPException

DISALLOWED = re.compile(r'\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|ATTACH|DETACH|REPLACE|TRUNCATE|VACUUM|PRAGMA)\b', re.I)

def introspect_schema(db_path: str) -> Dict[str, List[Dict]]:
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    res = cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").fetchall()
    tables = [r[0] for r in res]
    schema = {}
    for t in tables:
        cols = cur.execute(f"PRAGMA table_info('{t}')").fetchall()
        schema[t] = [{"cid": c[0], "name": c[1], "type": c[2], "notnull": c[3], "dflt_value": c[4], "pk": c[5]} for c in cols]
    con.close()
    return schema


SYS_PROMPT = """You are a Text-to-SQL assistant. You MUST output a single valid, safe, READ-ONLY SQLite SELECT query.
STRICT RULES:
- Output ONLY the SQL query text. No comments, no markdown fences, no explanations, no step-by-step, no thinking tags.
- Use only SELECT (and optional CTEs) — absolutely NO INSERT/UPDATE/DELETE/DROP/CREATE/ALTER/ATTACH/PRAGMA.
- Use domain units correctly: MS and HSD are sales volumes in kilolitres (KL). 
  Never reinterpret “MS” as “million standard” or any other unit.
- Do NOT end with a semicolon.
- MS = Motor Spirit (petrol), measured in KL
- HSD = High Speed Diesel, measured in KL
- Never confuse MS with HSD. If the user asks about HSD, do not use the MS column.
- Quote identifiers only if necessary with double quotes.
- Prefer deterministic ordering (ORDER BY ...) and include a tie-breaker like outlet_id ASC when listing top/bottom items.
- Use LIMIT when a small list is requested.
- Only reference tables/columns that exist in the provided schema.
- If filtering for a calendar month and the dataset has a 'month' column, ALWAYS use this pattern:
  (strftime('%Y-%m', month)='YYYY-MM' OR month='YYYY-MM' OR month LIKE 'YYYY-MM%')
Return ONLY the SQL query text (no backticks).
"""

RETRY_APPEND = "\nOutput was invalid. Return ONLY a single SELECT query. Do not include prose, fences, or comments."

# ===== Natural language helpers & glossary =====

MONTH_MAP = {
    "jan": "01","january": "01",
    "feb": "02","february": "02",
    "mar": "03","march": "03",
    "apr": "04","april": "04",
    "may": "05",
    "jun": "06","june": "06",
    "jul": "07","july": "07",
    "aug": "08","august": "08",
    "sep": "09","sept": "09","september": "09",
    "oct": "10","october": "10",
    "nov": "11","november": "11",
    "dec": "12","december": "12",
}

HEADER_MAP = {
    "ro_code": "RO code",
    "name": "RO name",
    "outlet": "RO name",
    "outlet_name": "RO name",
    "outlet_id": "RO code",
    "trading_area": "Trading area",
    "company": "Company",
    "ms": "MS",
    "hsd": "HSD",
    "total_ms": "MS",
    "total_hsd": "HSD",
    "month": "Month",
    "rank": "#",
}

COMPANY_ALIASES = {
    # canonical -> list of aliases (lowercased)
    "IOC": ["iocl", "indianoil", "indian oil", "indian-oil", "ioc"],
    "HPCL": ["hpc", "hp", "hindustan petroleum", "hindustan-petroleum", "hpcl"],
    "BPC": ["bpc", "bpcl", "bharat petroleum", "bharat-petroleum", "bharath petroleum"],
    "RIL": ["ril", "reliance", "jio", "jiobp", "jio-bp", "jio bp", "reliance-bp"],
    "NEL": ["nayara", "essar", "nayara energy", "nel"],
    "MRPL": ["mrpl", "mangalore refinery", "mangalore-refinery"],
}

def standardize_headers(df: pd.DataFrame) -> pd.DataFrame:
    cols = list(df.columns)
    new_cols = []
    for c in cols:
        c_lower = re.sub(r'\W+', '_', str(c).lower()).strip('_')
        new_cols.append(HEADER_MAP.get(c_lower, c))
    df.columns = new_cols
    return df

def reorder_for_leaderboard(df: pd.DataFrame) -> pd.DataFrame:
    """If it’s a leaderboard, prefer column order: #, RO name, Outlet ID, Trading area, Company, MS/HSD, Month (if present)."""
    prefer = ["#", "RO name", "Outlet ID", "Trading area", "Company", "MS", "HSD", "Month"]
    order = [c for c in prefer if c in df.columns] + [c for c in df.columns if c not in prefer]
    return df[order]

def detect_columns(schema: dict) -> dict:
    """Pick best column names from the schema for common concepts."""
    cols = {}
    names = set()
    for t, clist in schema.items():
        for c in clist:
            names.add(c["name"].lower())
    def pick(candidates, default=None):
        for c in candidates:
            if c.lower() in names:
                return c
        return default
    cols["month"] = pick(["month","date","month_str"], "month")
    cols["company"] = pick(["company","oil_company","brand"], "company")
    cols["ms"] = pick(["ms","ms_sales","ms_volume","motor_spirit"], "ms")
    cols["hsd"] = pick(["hsd","hsd_sales","hsd_volume","diesel"], "hsd")
    cols["outlet"] = pick(["outlet","outlet_name","ro","ro_name","name"], "outlet")
    cols["outlet_id"] = pick(["outlet_id","ro_id","id"], "outlet_id")
    cols["trading_area"] = pick(["trading_area","tradingarea","ta"], "trading_area")
    return cols

def normalize_month_phrases(q: str) -> str:
    def repl(m):
        mon = m.group('mon').lower()
        yr = m.group('yr')
        mm = MONTH_MAP.get(mon[:3], MONTH_MAP.get(mon, None))
        if not mm: 
            return m.group(0)
        return f"{yr}-{mm}"
    pattern = re.compile(r'\b(?P<mon>jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*[- ]\s*(?P<yr>20\d{2})\b', re.I)
    q = pattern.sub(repl, q)
    return q

def map_company_aliases_to_canonical(q: str) -> str:
    q_low = q.lower()
    for canon, aliases in COMPANY_ALIASES.items():
        for a in sorted(aliases, key=len, reverse=True):
            q_low = re.sub(rf'\b{re.escape(a)}\b', canon, q_low, flags=re.I)
    return q_low

def map_field_aliases(q: str, cols: dict) -> str:
    outlet = cols.get("outlet") or "outlet"
    trading_area = cols.get("trading_area") or "trading_area"
    outlet_id = cols.get("outlet_id") or "outlet_id"
    q = re.sub(r'\bro\b', outlet, q, flags=re.I)
    q = re.sub(r'\bro id\b', outlet_id, q, flags=re.I)
    q = re.sub(r'\bta\b', trading_area, q, flags=re.I)
    return q

def preprocess_question(question: str, schema: dict) -> Tuple[str, dict]:
    cols = detect_columns(schema)
    q = question.strip()
    q = normalize_month_phrases(q)
    q = map_company_aliases_to_canonical(q)
    q = map_field_aliases(q, cols)
    q = re.sub(r'negative selling', 'rows where MS is negative (i.e., ms < 0)', q, flags=re.I)
    return q, cols

def build_glossary_text(cols: dict) -> str:
    return f"""
GLOSSARY (schema-aware):
- "MS" means Motor Spirit, column: {cols.get('ms','ms')}
- "HSD" means High Speed Diesel, column: {cols.get('hsd','hsd')}
- "RO" or "outlet" or " Dealers" or "Sellers" refers to outlet name/identifier, prefer columns {cols.get('outlet','outlet')} / {cols.get('outlet_id','outlet_id')}
- "TA" means Trading Area, column: {cols.get('trading_area','trading_area')}
- Company canonical codes in data:
  IOC = IndianOil
  BPC = Bharat Petroleum
  HPCL = Hindustan Petroleum
  NEL = Nayara (Essar)
  RIL = Reliance / Jio / Jio-bp
Units:
- All volumes (MS, HSD, totals) are in kilolitres (KL).
- Do not invent alternative units; do not expand MS as a unit. “MS” = Motor Spirit (petrol), measured in KL.
Fuel types:
- "MS" = Motor Spirit (petrol), column: {cols.get('ms','ms')} (units: KL)
- "HSD" = High Speed Diesel (diesel), column: {cols.get('hsd','hsd')} (units: KL)
Do not mix these terms. Use the correct column depending on the user’s question.
If the user mentions any alias (e.g., 'IndianOil', 'Bharat Petroleum', 'Jio'), treat them as IOC, BPC, RIL respectively.
When the user says 'Aug 2025' or 'September 2025', interpret as YYYY-MM ('2025-08', '2025-09').
If asked for 'negative selling', filter rows where MS < 0 (or totals < 0 when aggregating).
"""

def build_user_prompt(question: str, schema: Dict[str, List[Dict]], focus_table: Optional[str]=None, glossary: str="") -> str:
    if focus_table and focus_table in schema:
        s_schema = json.dumps({focus_table: schema[focus_table]}, indent=2)
    else:
        s_schema = json.dumps(schema, indent=2)
    return f"SQLite schema (JSON):\n{s_schema}\n\nDomain glossary and rules:\n{glossary}\n\nUser question:\n{question.strip()}\n\nReturn ONLY the SQL SELECT query."

def extract_sql(candidate: str) -> Optional[str]:
    if not candidate:
        return None
    txt = candidate.strip()

    # 1) Strip DeepSeek R1 thinking tags
    txt = re.sub(r'<think>.*?</think>', '', txt, flags=re.I | re.S)

    # 2) Remove markdown fences if any
    txt = re.sub(r'```+sql', '', txt, flags=re.I).replace('```', '').strip()

    # 3) Find all SELECT chunks that include a FROM
    #    Grab the last one that looks complete (ends on word/paren/digit/quote/percent)
    candidates = []
    for m in re.finditer(r'(?is)(select\b.*?from\b.*?)(?=(?:\n\s*\n|$))', txt):
        chunk = m.group(1).strip()
        # strip trailing semicolon
        chunk = chunk.rstrip().rstrip(';').strip()
        candidates.append(chunk)

    if not candidates:
        return None

    # prefer the last candidate that doesn't end mid-token
    def looks_complete(s: str) -> bool:
        if DISALLOWED.search(s):
            return False
        # must start with SELECT and contain FROM
        if not re.match(r'^\s*select\b', s, flags=re.I):
            return False
        if re.search(r'\bfrom\b', s, flags=re.I) is None:
            return False
        # avoid obviously truncated endings
        if re.search(r'[,\+\-\*/]\s*$', s):
            return False
        if re.search(r'\b(order|group|where|join|on|limit|offset)\s*$', s, flags=re.I):
            return False
        # basic paren balance
        opens = s.count('('); closes = s.count(')')
        if opens != closes:
            return False
        return True

    for s in reversed(candidates):
        if looks_complete(s):
            return s

    # fallback: return the last one anyway if nothing passes heuristics
    return candidates[-1]


def generate_sql_ollama(question: str, schema: Dict[str, List[Dict]], model: str="deepseek-r1:14b", focus_table: Optional[str]=None, max_retries: int=2) -> str:
    url = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/generate")
    norm_q, cols = preprocess_question(question, schema)
    glossary = build_glossary_text(cols)
    base_prompt = build_user_prompt(norm_q, schema, focus_table, glossary)

    def call_ollama(msg: str) -> str:
        payload = {
            "model": model,
            "prompt": f"<<SYS>>{SYS_PROMPT}<</SYS>>\n{msg}\n",
            "stream": False,
            "options": {
    "temperature": 0.1,
    "num_predict": 256,
    "stop": ["</think>"]
}
        }
        r = requests.post(url, json=payload, timeout=30)
        r.raise_for_status()
        return r.json().get("response", "")

    out = call_ollama(base_prompt)
    sql = extract_sql(out)

    tries = 0
    while (sql is None) and (tries < max_retries):
        tries += 1
        out = call_ollama(base_prompt + RETRY_APPEND)
        sql = extract_sql(out)

    if sql is None:
        raise ValueError("Failed to generate a valid SELECT query from the model output.")
    return sql

def execute_sql(db_path: str, sql: str) -> pd.DataFrame:
    if not re.match(r'^\s*SELECT\b', sql, re.I):
        raise ValueError("Only SELECT queries are allowed.")
    if DISALLOWED.search(sql):
        raise ValueError("Disallowed SQL keyword detected. Aborting.")
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.connect() as con:
        df = pd.read_sql(text(sql), con)
    return df

def _q_month(question: str) -> Optional[str]:
    m = re.search(r"(20\d{2})-(0[1-9]|1[0-2])", (question or ""))
    return m.group(0) if m else None

def normalize_outlet_aggregates(sql: str, question: str, schema: Dict[str, List[Dict]]) -> str:
    """
    Normalize outlet/RO ranking queries to a canonical aggregate shape.

    - If the question targets outlets/ROs + mentions MS or HSD:
        • ensures SUM(ms|hsd) AS total_* in SELECT
        • selects outlet name, and optionally outlet_id depending on question
        • GROUP BY name (and outlet_id if included)
        • ORDER BY total_* DESC, then name or outlet_id as a tie-breaker
        • preserve WHERE/JOIN and LIMIT when present
    - If the SQL already aggregates, we still fix GROUP BY/ORDER BY if needed.
    """
    q = (question or "").lower()
    wants_outlets = ("outlet" in q) or (re.search(r'\bro\b', q) is not None)
    if not wants_outlets:
        return sql
    
    def normalize_ordering(sql: str, question: str) -> str:
        q = (question or "").lower()

    # Force ASC for lowest/bottom/least
    if any(w in q for w in ["lowest", "bottom", "least"]):
        sql = re.sub(r"(ORDER\s+BY\s+[^\n;]+?)\bDESC\b", r"\1ASC", sql, flags=re.I)
        # If ORDER BY has no explicit ASC/DESC, make it ASC
        if not re.search(r"\bORDER\s+BY\s+[^\n;]+\b(ASC|DESC)\b", sql, flags=re.I):
            sql = re.sub(r"(ORDER\s+BY\s+[^\n;]+)", r"\1 ASC", sql, flags=re.I)

    # Force DESC for top/highest/best
    if any(w in q for w in ["top", "highest", "best"]):
        sql = re.sub(r"(ORDER\s+BY\s+[^\n;]+?)\bASC\b", r"\1DESC", sql, flags=re.I)
        if not re.search(r"\bORDER\s+BY\s+[^\n;]+\b(ASC|DESC)\b", sql, flags=re.I):
            sql = re.sub(r"(ORDER\s+BY\s+[^\n;]+)", r"\1 DESC", sql, flags=re.I)

    # Ensure LIMIT if user asked for a count but model forgot
    if "limit" not in sql.lower():
        if re.search(r"\b(top|lowest)\s+5\b", q):
            sql += " LIMIT 5"
        elif re.search(r"\b(top|lowest)\s+10\b", q):
            sql += " LIMIT 10"

    return sql


    # Metric
    wants_ms  = (" ms " in f" {q} ") or q.startswith("ms") or ("motor spirit" in q)
    wants_hsd = ("hsd" in q) or ("diesel" in q)
    if not (wants_ms or wants_hsd):
        return sql
    metric = "ms" if (wants_ms and not wants_hsd) else "hsd"
    total_alias = f"total_{metric}"

    # schema-aware column names
    def pick(cols, names, default):
        names_set = set([c["name"].lower() for c in cols])
        for n in names:
            if n.lower() in names_set:
                return n
        return default
    
    cols = {}
    for t, clist in schema.items():
        for c in clist:
            cols[c["name"].lower()] = c["name"]
    month_col        = cols.get("month", "month")
    outlet_id_col    = cols.get("outlet_id", "outlet_id")
    outlet_name_col  = cols.get("name", "name")
    trading_area_col = cols.get("trading_area", "trading_area")
    company_col      = cols.get("company", "company")

    # Always define LIMIT (read "top N", else 10)
    lim = 10
    m_top = re.search(r"\btop\s+(\d+)\b", q)
    if m_top:
        try:
            lim = int(m_top.group(1))
        except Exception:
            lim = 10

    # strip GROUP/ORDER/LIMIT anywhere after FROM; we’ll rebuild
    def strip_group_order_limit(txt: str) -> str:
        t = re.sub(r'\bGROUP\s+BY\b.*?(?=(ORDER\s+BY|LIMIT|$))', '', txt, flags=re.I|re.S)
        t = re.sub(r'\bORDER\s+BY\b.*?(?=(LIMIT|$))', '', t, flags=re.I|re.S)
        t = re.sub(r'\bLIMIT\b\s+\d+(?:\s+OFFSET\s+\d+)?', '', t, flags=re.I|re.S)
        return t

    # If user asked to hide id
    hide_id = any(kw in q for kw in [
        "don't show outlet id", "dont show outlet id", "do not show outlet id",
        "without outlet id", "hide outlet id", "no outlet id", "don't show id",
        "no id", "hide id"
    ])

    # Helpers
    def strip_group_order(txt: str):
        t = re.sub(r'\bGROUP\s+BY\b.*?(?=(ORDER\s+BY|LIMIT|$))', '', txt, flags=re.I | re.S)
        t = re.sub(r'\bORDER\s+BY\b.*?(?=(LIMIT|$))', '', t, flags=re.I | re.S)
        return t

    # Find FROM position
    m_from = re.search(r'^\s*SELECT\b.*?\bFROM\b', sql, flags=re.I | re.S)
    if not m_from:
        return sql

    head_end = m_from.end()
    tail = strip_group_order_limit(sql[head_end:]).strip()
    rest = sql[head_end:]  # after FROM (table, WHERE, GROUP BY, ORDER BY, LIMIT)
    lim_match = re.search(r'\bLIMIT\b\s+\d+', rest, flags=re.I)
    lim_text = lim_match.group(0) if lim_match else ""

    # enforce month predicate if the question has one
    m_q = _q_month(question)
    if m_q:
        pred = "(strftime('%Y-%m', {mc})='{ym}' OR {mc}='{ym}' OR {mc} LIKE '{ym}%')".format(mc=month_col, ym=m_q)
        if re.search(r'\bwhere\b', tail, flags=re.I):
            if pred.lower() not in tail.lower():
                tail = re.sub(r'\bwhere\b', "WHERE " + pred + " AND ", tail, flags=re.I, count=1)
        else:
            tail = "WHERE " + pred + " " + tail

    # Decide columns to expose + group by
    if hide_id:
        select_cols = f"{outlet_name_col}, SUM({metric}) AS {total_alias}"
        group_cols = outlet_name_col
        tie_breaker = outlet_name_col
    else:
        # Default: include id + name
        select_cols = f"{outlet_id_col}, {outlet_name_col}, SUM({metric}) AS {total_alias}"
        group_cols = f"{outlet_id_col}, {outlet_name_col}"
        tie_breaker = outlet_id_col

    # If SQL already has SUM(metric), enforce GROUP/ORDER shape only
    if re.search(rf'\bSUM\s*\(\s*{re.escape(metric)}\s*\)', sql, flags=re.I):
        # Rebuild SELECT list to ensure desired columns & alias
        # Replace the part between SELECT and FROM
        sql_rebuilt = re.sub(
            r'^\s*SELECT\b.*?\bFROM\b',
            f"SELECT {select_cols} FROM",
            sql,
            flags=re.I | re.S
        )
        # Clean GROUP/ORDER then append our own
        tail_clean = strip_group_order(sql_rebuilt[head_end:])
        base = sql_rebuilt[:head_end] + tail_clean.strip()
        rebuilt = f"{base} GROUP BY {group_cols} ORDER BY {total_alias} DESC, {tie_breaker} ASC"
        if lim_text:
            rebuilt += f" {lim_text}"
        return rebuilt
    
     # canonical aggregate + ROW_NUMBER rank
    base = (
    "SELECT CAST({id} AS TEXT) AS ro_code, {nm} AS name, {ta} AS trading_area, {co} AS company, "
    "SUM({metric}) AS {tot} "
    "FROM {tail} "
    "GROUP BY {id}, {nm}, {ta}, {co}"
).format(
    id=outlet_id_col,
    nm=outlet_name_col,
    ta=trading_area_col,
    co=company_col,
    metric=metric,
    tot=total_alias,
    tail=tail,
)

    ranked = """
SELECT
  ROW_NUMBER() OVER (ORDER BY {tot} DESC, ro_code ASC) AS rank,
  name, ro_code, trading_area, company, {tot}
FROM ({base}) AS agg
ORDER BY rank ASC
LIMIT {lim}
""".format(tot=total_alias, base=base, lim=lim).strip()


    return ranked

    # Else, rebuild fully (SELECT list), keep WHERE/JOIN + LIMIT
    rest_clean = strip_group_order(rest)
    base = f"SELECT {select_cols} FROM {rest_clean.strip()}"
    rebuilt = f"{base} GROUP BY {group_cols} ORDER BY {total_alias} DESC, {tie_breaker} ASC"
    if lim_text:
        rebuilt += f" {lim_text}"
    else:
        # Top N default
        m_top = re.search(r'\btop\s+(\d+)\b', q)
        if m_top:
            rebuilt += f" LIMIT {int(m_top.group(1))}"
        elif re.search(r'\b(highest|top|largest|max)\b', q):
            rebuilt += " LIMIT 10"
    return rebuilt

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="Path to SQLite DB (e.g., stations.db)")
    ap.add_argument("--question", help="Natural language question")
    ap.add_argument("--model", default="deepseek-r1:14b", help="Ollama model name")
    ap.add_argument("--table", default=None, help="Optional: focus on a single table name")
    ap.add_argument("--print-sql", action="store_true", help="Print generated SQL")
    ap.add_argument("--sql", default=None, help="Execute this raw SQL directly (must be a single SELECT)")
    ap.add_argument("--sql-file", default=None, help="Path to a .sql file to execute (must contain a single SELECT)")
    args = ap.parse_args()

    if not Path(args.db).exists():
        raise SystemExit(f"DB not found: {args.db}")

    raw_sql = None
    if args.sql:
        raw_sql = args.sql.strip()
    elif args.sql_file:
        p = Path(args.sql_file)
        if not p.exists():
            raise SystemExit(f"SQL file not found: {p}")
        raw_sql = p.read_text().strip()

    if raw_sql:
        try:
            df = execute_sql(args.db, raw_sql)
        except Exception as e:
            print("SQL execution error:", e)
            print("Problematic SQL was:\n", raw_sql)
            return
        with pd.option_context("display.max_rows", 200, "display.max_columns", None):
            print(df)
        return

    if not args.question:
        raise SystemExit("Provide --question for NL->SQL, or use --sql/--sql-file to run raw SQL.")
    schema = introspect_schema(args.db)
    try:
        sql = generate_sql_ollama(args.question, schema, model=args.model, focus_table=args.table)

    except Exception as e:
        print("Generation error:", e)
        return
    
    # Normalize outlet/RO queries to guaranteed aggregates and ordering
    sql = normalize_outlet_aggregates(sql, args.question or "", schema)

    if args.print_sql:
        print("Generated SQL:\n", sql, "\n", flush=True)

    try:
        df = execute_sql(args.db, sql)
    except Exception as e:
        print("SQL execution error:", e)
        print("Problematic SQL was:\n", sql)    
        return

    with pd.option_context("display.max_rows", 200, "display.max_columns", None):
        print(df)

if __name__ == "__main__":
    main()
