"""Postgres access via a psycopg connection pool.

The backend talks to Supabase Postgres over DATABASE_URL, which bypasses RLS
(see supabase/migrations). Rows come back as dicts (dict_row). The pool is
opened/closed by the FastAPI lifespan in main.py.
"""

import os

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

DATABASE_URL = os.environ["DATABASE_URL"]

# open=False: opened explicitly in the app lifespan so import never blocks.
pool = ConnectionPool(
    DATABASE_URL,
    min_size=1,
    max_size=10,
    open=False,
    kwargs={"row_factory": dict_row},
)


def fetch_one(sql: str, params: tuple = ()):
    """Run a query, return the first row as a dict (or None)."""
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def fetch_all(sql: str, params: tuple = ()) -> list:
    """Run a query, return all rows as a list of dicts."""
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def execute(sql: str, params: tuple = ()) -> None:
    """Run a statement with no result set (INSERT/UPDATE/DELETE without RETURNING)."""
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
