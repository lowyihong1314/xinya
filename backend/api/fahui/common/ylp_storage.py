"""DATA_ROOT 下法会资源路径的三个小助手。

原 backend/app/fahui/common/ylp_storage.py，**一个字没改**（本来就不依赖 Flask）。
名字里的 ylp 是历史遗留：print / diy / raw_docs 都在用它，不只是 YLP。
"""
from pathlib import Path

from backend.core.paths import DATA_ROOT


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
