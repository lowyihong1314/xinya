from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATIC_ROOT = PROJECT_ROOT / "static"
TEMPLATE_ROOT = PROJECT_ROOT / "templates"
DATA_ROOT = PROJECT_ROOT / "database"
