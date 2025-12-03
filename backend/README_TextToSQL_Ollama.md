
# Text-to-SQL on Your Data (Local DeepSeek via Ollama)

## Files created for you
- SQLite database: `/mnt/data/stations.db`
- Schema JSON: `/mnt/data/stations_schema.json`
- CLI script: `/mnt/data/text_to_sql_ollama.py`

## Quick Start (on your Mac)
1) Install Ollama: https://ollama.com
2) Pull a local model (example DeepSeek R1 14B):
   ```bash
   ollama pull deepseek-r1:14b
   ```
   (You can use any local model name you have: `deepseek-r1:7b`, `llama3.1:8b`, etc.)

3) Create a Python venv and install deps:
   ```bash
   python3 -m venv .venv && source .venv/bin/activate
   pip install pandas requests sqlalchemy
   ```

4) Run a query:
   ```bash
   python text_to_sql_ollama.py --db stations.db --question "Show top 10 rows" --model deepseek-r1:14b --print-sql
   ```

5) Focus on a specific table (if your Excel had multiple sheets):
   ```bash
   python text_to_sql_ollama.py --db stations.db --table stations \
          --question "Total MS and HSD volume by trading_area for 2024, descending, top 10"
   ```

## Notes
- The script is **read-only** and only allows SELECT queries.
- It auto-introspects the SQLite schema and feeds it to the local LLM to generate SQL.
- If the model outputs extra text, we apply a small heuristic to extract the SQL; you can refine this prompt if needed.

## Optional: Use LlamaIndex with Ollama (if you prefer)
Install:
```bash
pip install llama-index-core llama-index-llms-ollama llama-index-embeddings-ollama sqlalchemy pandas
```

Then adapt a notebook to use:
```python
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.ollama import OllamaEmbedding
llm = Ollama(model="deepseek-r1:14b", request_timeout=120)
embed_model = OllamaEmbedding(model="nomic-embed-text")  # or any local embed model you pulled
```

Replace OpenAI classes from your guide with the Ollama equivalents and keep the rest of the pipeline the same (SQLDatabase, NLSQLTableQueryEngine, etc.).
