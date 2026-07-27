from __future__ import annotations

from pathlib import Path

from app.paths import DATA_ROOT


def resolve_existing_path(*parts: str) -> Path | None:
    candidate = DATA_ROOT.joinpath(*parts)
    return candidate if candidate.exists() else None


def preferred_path(*parts: str, ensure_parent: bool = False) -> Path:
    path = DATA_ROOT.joinpath(*parts)
    if ensure_parent:
        path.parent.mkdir(parents=True, exist_ok=True)
    return path


def preferred_dir(*parts: str) -> Path:
    path = DATA_ROOT.joinpath(*parts)
    path.mkdir(parents=True, exist_ok=True)
    return path
