import os
import json
from typing import Any, List, Optional
import re
from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, RootModel
import uvicorn
from text_to_sql_ollama import normalize_outlet_aggregates, standardize_headers, reorder_for_leaderboard

# Import your NL->SQL helpers from the local file (keep the patched version here)
from text_to_sql_ollama import (
    introspect_schema,
    normalize_ordering,
    generate_sql_ollama,
    execute_sql,
)

DB_PATH = os.getenv("DB_PATH", os.path.abspath(os.path.join(os.path.dirname(__file__), "stations.db")))
MODEL  = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
DEFAULT_TABLE = os.getenv("DEFAULT_TABLE", "stations")

app = FastAPI(title="FuelMap Text-to-SQL API")

# Allow local dev frontends (Vite/Next) to call us
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SQLRequest(BaseModel):
    question: str
    table: Optional[str] = None
    model: Optional[str] = None
    print_sql: Optional[bool] = False

class SQLResponse(BaseModel):
    sql: str
    columns: List[str]
    rows: List[List[Any]]
    rowcount: int

# Use RootModel for arbitrary JSON (Pydantic v2)
class InsightsRequest(RootModel[Any]):
    pass

class InsightsResponse(BaseModel):
    text: str

@app.get("/api/health")
def health():
    return {"ok": True, "db": DB_PATH, "model": MODEL}

@app.post("/api/sql", response_model=SQLResponse)
def api_sql(req: SQLRequest):
    db = DB_PATH
    model = req.model or MODEL
    table = req.table or DEFAULT_TABLE

    schema = introspect_schema(db)
    sql = generate_sql_ollama(req.question, schema, model=model, focus_table=table)
    sql = normalize_ordering(sql, req.question)
    # ensure canonical leaderboard shape (rank + correct metric + proper clause order)
    sql = normalize_outlet_aggregates(sql, req.question or "", schema)
    if req.print_sql:
        print("Generated SQL:\n", sql, flush=True)

    df = execute_sql(db, sql)

    # standardize headers and column order for display
    df = standardize_headers(df)
    df = reorder_for_leaderboard(df)
    cols = list(df.columns)
    rows = df.values.tolist()
    return SQLResponse(sql=sql, columns=cols, rows=rows, rowcount=len(rows))

@app.post("/api/insights", response_model=InsightsResponse)
def api_insights(payload: InsightsRequest = Body(...)):
    """
    Convert the rich 'insights' JSON payload from the UI into a concise narrative via Ollama.
    Falls back to a minimal summary if Ollama is unavailable.
    """
    data = payload.root  # RootModel holds the value at .root
    try:
        import requests
        prompt = f"""
You are a senior IOCL sales analyst. 
Your task: return output in *exactly this structure*:

1. One plain English summary in 1–2 sentences.
2. One markdown table with the schema that matches the query type:
   - Leaderboard → | # | RO code | RO name | Trading Area | Company | Sales (KL) | Month/FY Basis |
   - Growth/Loss → | # | RO code | RO name | Trading Area | Company | Sales Current Year (KL) | Sales Last Year (KL) | Change (KL) | Change % |

Rules:
- Do not output any extra tables or free-form “RO name HSD” blocks.
- Use KL (kilolitres) as the unit.
- Deduplicate outlets by RO code (only one row per outlet).
- Always rank and include a "#" column for leaderboard results.
- If month not specified → use average monthly sales from April to latest month available in this FY.

Rules for summary:
- If the query was for "lowest"/"bottom" → phrase as "lowest performing outlets."
- If the query was for "top"/"highest" → phrase as "highest selling outlets."
- Always explicitly state the unit (KL).
- Do not contradict ("top 5 lowest").


DATA (JSON, truncated):
{json.dumps(data)[:6000]}
"""


        resp = requests.post(
            os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate"),
            json={"model": MODEL, "prompt": prompt, "stream": False, "options": {"temperature": 0.2}},
            timeout=60
        )
        resp.raise_for_status()
        txt = resp.json().get("response", "").strip()
        if not txt:
            raise RuntimeError("Empty Ollama response")
        return InsightsResponse(text=txt)
    except Exception:
        ctx = data.get("context", {}) if isinstance(data, dict) else {}
        ms = (data.get("marketShare", {}) if isinstance(data, dict) else {}).get("msMonthly", [])
        leader = (ms[0]["company"] if ms else "N/A")
        latest = ctx.get("latestMonth", "N/A")
        text = f"Snapshot for {latest}: Market-share leader appears to be {leader}. (LLM summary unavailable; fallback used.)"
        return InsightsResponse(text=text)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=3001)
