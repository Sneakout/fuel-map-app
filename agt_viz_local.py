def pick_area_month(results, area=None, month=None):
    """
    Robust selection of area and month from agt_results.json.
    Supports area entries shaped either as:
      results[area][month] = data
    OR
      results[area] = { "months": [...], "per_month": { month: data } }

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
        # case-insensitive exact
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

    # detect month storage
    # case A: direct months as keys, e.g. area_obj["2025-05"]
    direct_months = sorted([k for k in area_obj.keys() if isinstance(k, str) and k.count("-")==1])
    # case B: area_obj has 'per_month' dict and 'months' list
    per_month = area_obj.get("per_month") if isinstance(area_obj.get("per_month"), dict) else None
    months_list = None
    if per_month:
        months_list = sorted(list(per_month.keys()))
    elif direct_months:
        months_list = direct_months
    elif isinstance(area_obj.get("months"), list):
        months_list = sorted(area_obj.get("months"))
    else:
        # fallback: show keys to help debugging
        raise SystemExit(f"Area '{chosen}' does not contain months in an expected shape. Keys: {list(area_obj.keys())[:30]}")

    # choose month
    if month is None:
        chosen_month = months_list[-1]  # latest
        print(f"No month specified — using latest month for '{chosen}': {chosen_month}")
    else:
        if month in months_list:
            chosen_month = month
        else:
            raise SystemExit(f"Month '{month}' not present for area '{chosen}'. Available: {months_list[:20]} ...")

    # extract month data whether direct or in per_month
    if per_month and chosen_month in per_month:
        chosen_data = per_month[chosen_month]
    elif chosen_month in area_obj:
        chosen_data = area_obj[chosen_month]
    else:
        # fallback: maybe area_obj stores months under a nested dict key 'months'->'per_month'
        chosen_data = None
        if per_month and chosen_month in per_month:
            chosen_data = per_month[chosen_month]

    if chosen_data is None:
        raise SystemExit(f"Could not extract month data for {chosen} / {chosen_month}. Keys: {list(area_obj.keys())[:20]}")

    return chosen, chosen_month, chosen_data
