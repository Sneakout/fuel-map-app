#!/usr/bin/env python3
# test_pick.py — small driver to exercise pick_area_month on agt_results.json

import sys
import json
import argparse
from pathlib import Path

def pick_area_month(results, area=None, month=None):
    """
    Robust selection of area and month from agt_results.json.
    Supports area entries shaped either as:
      results[area][month] = data
    OR
      results[area] = { "months": [...], "per_month": { month: data } }
    OR
      results[area] = { "months": [...], "per_month": [ { "month": m, ... }, ... ] }

    Returns: (chosen_area, chosen_month, chosen_month_data)
    """
    areas = sorted(results.keys())
    if not areas:
        raise SystemExit("No areas found in agt_results.json")

    # choose area (exact, ci exact, substring)
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
                raise SystemExit(f"Area '{area}' not found. Available: {areas[:20]} ...")

    area_obj = results[chosen]

    # collect months from multiple possible shapes
    months_list = None
    per_month_map = None  # canonical dict: month -> data

    # 1) If per_month is a dict (good)
    if isinstance(area_obj.get("per_month"), dict):
        per_month_map = area_obj["per_month"]
        months_list = sorted(per_month_map.keys())
    # 2) If per_month is a list of objects each with 'month' key
    elif isinstance(area_obj.get("per_month"), list):
        items = area_obj.get("per_month", [])
        per_month_map = {}
        for item in items:
            if isinstance(item, dict) and item.get("month"):
                per_month_map[str(item["month"])] = item
        if per_month_map:
            months_list = sorted(per_month_map.keys())
    # 3) If area_obj has 'months' array
    if not months_list and isinstance(area_obj.get("months"), list) and area_obj["months"]:
        months_list = sorted([m for m in area_obj["months"] if isinstance(m, str)])
    # 4) If months are direct keys on area_obj (e.g. area_obj["2025-05"] = {...})
    if not months_list:
        direct_months = [k for k in area_obj.keys() if isinstance(k, str) and k.count("-") == 1]
        if direct_months:
            months_list = sorted(direct_months)
            per_month_map = {m: area_obj[m] for m in direct_months}

    if not months_list:
        # final fallback: show keys and abort
        raise SystemExit(f"Area '{chosen}' does not contain months in an expected shape. Keys: {list(area_obj.keys())[:40]}")

    # choose month
    if month is None:
        chosen_month = months_list[-1]  # latest (sorted ascending)
        print(f"No month specified — using latest month for '{chosen}': {chosen_month}")
    else:
        if month in months_list:
            chosen_month = month
        else:
            # try case-insensitive / friendly matches
            lc_months = {m.lower(): m for m in months_list}
            if month.lower() in lc_months:
                chosen_month = lc_months[month.lower()]
            else:
                raise SystemExit(f"Month '{month}' not present for area '{chosen}'. Available: {months_list[:20]} ...")

    # extract chosen_data from the canonical map or direct lookup
    chosen_data = None
    if per_month_map and chosen_month in per_month_map:
        chosen_data = per_month_map[chosen_month]
    elif isinstance(area_obj.get("per_month"), list):
        # find item in list
        for item in area_obj.get("per_month", []):
            if isinstance(item, dict) and str(item.get("month")) == str(chosen_month):
                chosen_data = item
                break
    elif chosen_month in area_obj:
        chosen_data = area_obj[chosen_month]

    if chosen_data is None:
        # helpful debug print then exit
        keys_preview = list(area_obj.keys())[:40]
        raise SystemExit(f"Could not extract month data for {chosen} / {chosen_month}. Area keys: {keys_preview}")

    return chosen, chosen_month, chosen_data


def main():
    ap = argparse.ArgumentParser(description="Test pick_area_month on agt_results.json")
    ap.add_argument("-f", "--file", default="agt_results.json", help="path to agt_results.json (default: agt_results.json)")
    ap.add_argument("-a", "--area", default=None, help="area name (optional)")
    ap.add_argument("-m", "--month", default=None, help="month YYYY-MM (optional)")
    args = ap.parse_args()

    path = Path(args.file)
    if not path.exists():
        print(f"File not found: {path.resolve()}")
        sys.exit(1)

    data = json.loads(path.read_text())

    try:
        area, month, mdata = pick_area_month(data, area=args.area, month=args.month)
    except SystemExit as e:
        print("ERROR:", e)
        sys.exit(2)
    except Exception as e:
        print("Unexpected error:", e)
        sys.exit(3)

    print("Chosen area:", area)
    print("Chosen month:", month)
    # print available months snippet
    area_obj = data[area]
    months_keys = []
    if isinstance(area_obj.get("per_month"), dict):
        months_keys = sorted(area_obj["per_month"].keys())
    elif isinstance(area_obj.get("per_month"), list):
        months_keys = sorted([str(i.get("month")) for i in area_obj["per_month"] if isinstance(i, dict) and i.get("month")])
    elif isinstance(area_obj.get("months"), list):
        months_keys = sorted([m for m in area_obj["months"] if isinstance(m, str)])
    else:
        months_keys = sorted([k for k in area_obj.keys() if isinstance(k, str) and k.count("-")==1])
    print("Available months (preview):", months_keys[:10])

    # show a short JSON preview of the chosen month data
    import pprint
    pp = pprint.PrettyPrinter(depth=2, compact=True, width=120)
    print("\nMonth data preview:")
    pp.pprint(mdata if isinstance(mdata, dict) else {"value": mdata})

if __name__ == "__main__":
    main()
