#!/usr/bin/env python3
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app import create_app
from app.fahui.route_contracts import FAHUI_ANON_STATUS_CHECKS, FAHUI_ROUTE_GROUPS


def collect_route_methods(app) -> dict[str, set[str]]:
    route_methods: dict[str, set[str]] = defaultdict(set)
    for rule in app.url_map.iter_rules():
        route_methods[str(rule)].update(method for method in rule.methods if method not in {"HEAD", "OPTIONS"})
    return route_methods


def verify_route_contracts(route_methods: dict[str, set[str]]) -> list[str]:
    failures: list[str] = []
    for group in FAHUI_ROUTE_GROUPS:
        for section_name, specs in (("canonical", group.canonical), ("legacy", group.legacy)):
            for spec in specs:
                actual_methods = route_methods.get(spec.path)
                if actual_methods is None:
                    failures.append(f"[missing] {group.name}.{section_name}: {spec.path}")
                    continue
                missing_methods = sorted(set(spec.methods) - actual_methods)
                if missing_methods:
                    failures.append(
                        f"[method] {group.name}.{section_name}: {spec.path} missing {', '.join(missing_methods)} "
                        f"(have: {', '.join(sorted(actual_methods))})"
                    )
    return failures


def verify_anon_statuses(app) -> list[str]:
    failures: list[str] = []
    client = app.test_client()
    for check in FAHUI_ANON_STATUS_CHECKS:
        response = client.open(path=check.path, method=check.method)
        if response.status_code != check.expected_status:
            failures.append(
                f"[status] {check.name}: {check.path} expected {check.expected_status}, got {response.status_code}"
            )
    return failures


def main() -> int:
    app = create_app()
    route_methods = collect_route_methods(app)

    route_failures = verify_route_contracts(route_methods)
    status_failures = verify_anon_statuses(app)
    failures = [*route_failures, *status_failures]

    if failures:
        print("FAHUI route contract check failed:")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    total_routes = sum(len(group.canonical) + len(group.legacy) for group in FAHUI_ROUTE_GROUPS)
    print(f"FAHUI route contract check passed: {total_routes} route specs, {len(FAHUI_ANON_STATUS_CHECKS)} anon checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
