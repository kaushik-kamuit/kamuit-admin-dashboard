"""
Runs `alembic upgrade head` inside each sibling backend repo against the
local Postgres containers started by docker-compose.

We do NOT edit any file in the backend repos. We set env vars (which their
`alembic.ini` reads via `%(DB_USER)s` style substitution) and invoke alembic
with each repo's own CWD so its migrations apply against our local DB.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

import psycopg2
from dotenv import load_dotenv


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
WORKSPACE_ROOT = PROJECT_ROOT.parent

load_dotenv(PROJECT_ROOT / ".env")


BACKENDS = [
    {
        "name": "user-management-backend",
        "path": WORKSPACE_ROOT / "user-management-backend",
        "db_host_env": "USER_MGMT_DB_HOST",
        "db_port_env": "USER_MGMT_DB_PORT",
        "db_name_env": "USER_MGMT_DB_NAME",
        "needs_postgis": False,
        "needs_fake_spatial_ref_sys": True,
    },
    {
        "name": "kamuit-backend",
        "path": WORKSPACE_ROOT / "kamuit-backend",
        "db_host_env": "KAMUIT_DB_HOST",
        "db_port_env": "KAMUIT_DB_PORT",
        "db_name_env": "KAMUIT_DB_NAME",
        "needs_postgis": True,
    },
    {
        "name": "payment-backend",
        "path": WORKSPACE_ROOT / "payment-backend",
        "db_host_env": "PAYMENT_DB_HOST",
        "db_port_env": "PAYMENT_DB_PORT",
        "db_name_env": "PAYMENT_DB_NAME",
        "needs_postgis": False,
    },
]


def wait_for_db(host: str, port: int, dbname: str, user: str, password: str, timeout_s: int = 60) -> None:
    deadline = time.time() + timeout_s
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            conn = psycopg2.connect(
                host=host, port=port, dbname=dbname, user=user, password=password,
                connect_timeout=3,
            )
            conn.close()
            return
        except Exception as e:
            last_err = e
            time.sleep(1)
    raise RuntimeError(
        f"DB {dbname} on {host}:{port} did not become ready within {timeout_s}s. Last error: {last_err}"
    )


def ensure_postgis(host: str, port: int, dbname: str, user: str, password: str) -> None:
    conn = psycopg2.connect(host=host, port=port, dbname=dbname, user=user, password=password)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
    conn.close()


def ensure_fake_spatial_ref_sys(host: str, port: int, dbname: str, user: str, password: str) -> None:
    """
    user-management-backend's migration d1216f7e9954 contains a spurious
    `DROP TABLE spatial_ref_sys` (Alembic autogenerate artifact from a dev DB
    that had PostGIS installed then uninstalled, leaving the table behind).

    On a clean Postgres, that table does NOT exist, so the DROP would fail.
    On a PostGIS-enabled Postgres, PostGIS owns the table and DROP is refused.

    Fix: create a minimal placeholder table with the same name so the DROP
    succeeds. We don't need its contents because nothing in user-management
    uses spatial features.
    """
    conn = psycopg2.connect(host=host, port=port, dbname=dbname, user=user, password=password)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS spatial_ref_sys (
                srid integer PRIMARY KEY
            );
        """)
    conn.close()


def run_alembic(backend: dict, pg_user: str, pg_password: str) -> None:
    host = os.environ[backend["db_host_env"]]
    port = os.environ[backend["db_port_env"]]
    name = os.environ[backend["db_name_env"]]

    repo_path: Path = backend["path"]
    if not repo_path.exists():
        raise RuntimeError(
            f"Sibling repo '{backend['name']}' not found at {repo_path}. "
            f"Clone it next to kamuit-admin-dashboard/ first."
        )

    print(f"\n=== [{backend['name']}] waiting for DB {name} on {host}:{port} ===")
    wait_for_db(host, int(port), name, pg_user, pg_password)

    if backend["needs_postgis"]:
        print(f"=== [{backend['name']}] enabling PostGIS extension ===")
        ensure_postgis(host, int(port), name, pg_user, pg_password)

    if backend.get("needs_fake_spatial_ref_sys"):
        print(f"=== [{backend['name']}] pre-creating fake spatial_ref_sys (workaround for d1216f7e9954) ===")
        ensure_fake_spatial_ref_sys(host, int(port), name, pg_user, pg_password)

    env = os.environ.copy()
    env["DB_HOST"] = host
    env["DB_PORT"] = str(port)
    env["DB_USER"] = pg_user
    env["DB_PASSWORD"] = pg_password
    env["DB_NAME"] = name
    env["DB_SCHEMA"] = "public"
    env["DATABASE_URL"] = f"postgresql://{pg_user}:{pg_password}@{host}:{port}/{name}"
    env["PYTHONPATH"] = str(repo_path)

    alembic_bin = Path(sys.executable).parent / ("alembic.exe" if os.name == "nt" else "alembic")
    if not alembic_bin.exists():
        alembic_bin = "alembic"

    print(f"=== [{backend['name']}] running alembic upgrade head in {repo_path} ===")
    proc = subprocess.run(
        [str(alembic_bin), "-c", "alembic.ini", "upgrade", "head"],
        cwd=str(repo_path),
        env=env,
        capture_output=True,
        text=True,
    )

    if proc.stdout:
        print(proc.stdout)
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        raise RuntimeError(f"alembic failed for {backend['name']} (exit {proc.returncode})")
    print(f"=== [{backend['name']}] migrations applied ===")


def main() -> None:
    pg_user = os.environ.get("LOCAL_PG_USER", "kamuit_admin")
    pg_password = os.environ.get("LOCAL_PG_PASSWORD", "local_dev_only")

    for backend in BACKENDS:
        run_alembic(backend, pg_user, pg_password)

    print("\nAll migrations applied successfully.")


if __name__ == "__main__":
    main()
