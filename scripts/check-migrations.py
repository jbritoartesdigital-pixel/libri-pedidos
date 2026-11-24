"""Shared local migration gate. No remote connections and no customer data."""
from pathlib import Path
import sqlite3

migrations = sorted(Path("migrations").glob("*.sql"))
if not migrations:
    raise SystemExit("Nenhuma migration encontrada.")
with sqlite3.connect(":memory:") as db:
    for path in migrations:
        print("Validando", path.name)
        db.executescript(path.read_text(encoding="utf-8"))
    checks = [
        ("Catálogo V2", "SELECT COUNT(*) FROM v2_products", 7),
        ("Pacotes Ateliê", "SELECT COUNT(*) FROM v3_atelie_packages", 3),
        ("Termos gerais ativos", "SELECT COUNT(*) FROM v2_terms_versions WHERE active=1 AND length(trim(body))>0", 1),
    ]
    for label, sql, expected in checks:
        actual = db.execute(sql).fetchone()[0]
        if actual != expected:
            raise SystemExit(f"{label}: esperado {expected}, encontrado {actual}")
        print(f"{label}: OK")
print("Migrations e catálogo validados localmente.")
