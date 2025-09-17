# agt_viz.py
import json
import matplotlib.pyplot as plt
from pathlib import Path

with open("agt_results.json") as f:
    results = json.load(f)

# Example: plot equilibrium MS share over time for one trading area
area = list(results.keys())[0]  # pick first area
area_data = results[area]

months = sorted(area_data.keys())
companies = set()

for m in months:
    for eq in area_data[m]["equilibria"]:
        companies.update(eq.keys())

companies = sorted(companies)

for company in companies:
    values = []
    for m in months:
        eqs = area_data[m]["equilibria"]
        # average if multiple equilibria
        avg = sum(e.get(company, 0) for e in eqs) / (len(eqs) or 1)
        values.append(avg)
    plt.plot(months, values, marker="o", label=company)

plt.title(f"Equilibrium strategy share – {area}")
plt.xlabel("Month")
plt.ylabel("Equilibrium probability")
plt.legend()
plt.xticks(rotation=45)
plt.tight_layout()
plt.show()
