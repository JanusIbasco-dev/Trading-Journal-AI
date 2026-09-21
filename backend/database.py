"""
Database layer for Trading Journal AI.

Cloud branch:
- Uses Supabase PostgreSQL when DATABASE_URL is present.
- Keeps the app's existing qmark (?) SQL style working by translating ? -> %s.
- Returns rows that support BOTH row["column"] and row[0], because the existing
  backend modules use both forms.
- Provides executescript() compatibility for the existing library module.

The original SQLite database is intentionally not touched by this cloud branch.
"""
import os
import re
import sqlite3
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
DB_PATH = os.getenv("DATABASE_PATH", "trading_journal.db")

if DATABASE_URL:
    import psycopg
    from psycopg.rows import dict_row
    from psycopg.errors import UniqueViolation

    IntegrityError = UniqueViolation

    class CompatRow(dict):
        def __getitem__(self, key):
            if isinstance(key, int):
                try:
                    return list(self.values())[key]
                except IndexError:
                    raise IndexError(key)
            return super().__getitem__(key)

    class CompatCursor:
        def __init__(self, cursor):
            self._cursor = cursor

        @property
        def description(self):
            return self._cursor.description

        @property
        def rowcount(self):
            return self._cursor.rowcount

        @property
        def lastrowid(self):
            # PostgreSQL has no SQLite-style lastrowid. Inserts in the cloud
            # backend use RETURNING id instead.
            return None

        def _row(self, row):
            if row is None:
                return None
            if isinstance(row, CompatRow):
                return row
            if isinstance(row, dict):
                return CompatRow(row)
            return row

        def fetchone(self):
            return self._row(self._cursor.fetchone())

        def fetchall(self):
            return [self._row(r) for r in self._cursor.fetchall()]

        def __iter__(self):
            for row in self._cursor:
                yield self._row(row)

        def close(self):
            return self._cursor.close()

    class CompatConnection:
        def __init__(self, url):
            self._conn = psycopg.connect(url, row_factory=dict_row)

        @staticmethod
        def _convert_sql(sql):
            # The existing project consistently uses SQLite qmark parameters.
            # Its SQL does not contain literal '?' characters, so this simple
            # translation is safe for the project's queries.
            return sql.replace("?", "%s")

        def execute(self, sql, params=None):
            cur = self._conn.cursor()
            if params is None:
                cur.execute(self._convert_sql(sql))
            else:
                cur.execute(self._convert_sql(sql), params)
            return CompatCursor(cur)

        def executemany(self, sql, seq_of_params):
            cur = self._conn.cursor()
            cur.executemany(self._convert_sql(sql), seq_of_params)
            return CompatCursor(cur)

        def executescript(self, script):
            # Compatibility for library.py's existing SQLite-style schema setup.
            script = re.sub(
                r"\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b",
                "BIGSERIAL PRIMARY KEY",
                script,
                flags=re.IGNORECASE,
            )
            script = re.sub(
                r"\bDEFAULT\s*\(\s*datetime\('now'\)\s*\)",
                "DEFAULT CURRENT_TIMESTAMP",
                script,
                flags=re.IGNORECASE,
            )
            script = re.sub(
                r"\bdatetime\('now'\)",
                "CURRENT_TIMESTAMP",
                script,
                flags=re.IGNORECASE,
            )
            script = re.sub(r"\bREAL\b", "DOUBLE PRECISION", script, flags=re.IGNORECASE)

            # The project's schema scripts contain independent CREATE statements
            # separated by semicolons, with no procedural SQL.
            statements = [s.strip() for s in script.split(";") if s.strip()]
            for statement in statements:
                self.execute(statement)
            return None

        def commit(self):
            return self._conn.commit()

        def rollback(self):
            return self._conn.rollback()

        def close(self):
            return self._conn.close()

        def cursor(self):
            return CompatCursor(self._conn.cursor())

    def get_db() -> CompatConnection:
        return CompatConnection(DATABASE_URL)

else:
    # Fallback keeps the cloud branch runnable without DATABASE_URL for local
    # testing, although the deployed version should always set DATABASE_URL.
    IntegrityError = sqlite3.IntegrityError

    def get_db():
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn


def init_db():
    conn = get_db()

    if DATABASE_URL:
        schema = """
            CREATE TABLE IF NOT EXISTS accounts (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('day_trading','swing_trading','investment')),
                color TEXT NOT NULL DEFAULT '#6366f1',
                broker TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS trades (
                id BIGSERIAL PRIMARY KEY,
                account_id BIGINT NOT NULL REFERENCES accounts(id),
                trade_group TEXT NOT NULL,
                date TEXT NOT NULL,
                ticker TEXT NOT NULL,
                instrument_type TEXT NOT NULL CHECK(instrument_type IN ('STOCK','OPTION','FUTURE')),
                side TEXT NOT NULL CHECK(side IN ('LONG','SHORT')),
                gross_pnl DOUBLE PRECISION,
                net_pnl DOUBLE PRECISION,
                commissions DOUBLE PRECISION DEFAULT 0,
                executions TEXT NOT NULL DEFAULT '[]',
                option_expiry TEXT,
                option_strike DOUBLE PRECISION,
                option_type TEXT CHECK(option_type IN ('CALL','PUT') OR option_type IS NULL),
                source TEXT NOT NULL DEFAULT 'imported',
                imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(trade_group, account_id)
            );

            CREATE TABLE IF NOT EXISTS diary_entries (
                id BIGSERIAL PRIMARY KEY,
                account_id BIGINT NOT NULL REFERENCES accounts(id),
                entry_date TEXT NOT NULL,
                image_path TEXT,
                raw_text TEXT,
                ai_analysis TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS trade_analysis (
                id BIGSERIAL PRIMARY KEY,
                trade_group TEXT NOT NULL UNIQUE,
                ticker TEXT NOT NULL,
                date TEXT NOT NULL,
                strategy TEXT,
                stop_loss DOUBLE PRECISION,
                risk_per_trade DOUBLE PRECISION,
                risk_reward DOUBLE PRECISION,
                r_multiple DOUBLE PRECISION,
                entry_reason TEXT,
                exit_reason TEXT,
                mistakes TEXT,
                emotional_state TEXT,
                notes TEXT,
                ai_feedback TEXT,
                match_confidence TEXT CHECK(match_confidence IN ('high','medium','low','ambiguous','unmatched','manual')),
                match_notes TEXT,
                diary_entry_id BIGINT REFERENCES diary_entries(id),
                target_price DOUBLE PRECISION,
                trade_rating INTEGER,
                idea_source TEXT
            );

            CREATE TABLE IF NOT EXISTS trade_tags (
                id BIGSERIAL PRIMARY KEY,
                trade_group TEXT NOT NULL,
                tag_type TEXT NOT NULL,
                tag_value TEXT NOT NULL,
                source TEXT NOT NULL CHECK(source IN ('ai','manual'))
            );

            CREATE TABLE IF NOT EXISTS daily_summaries (
                id BIGSERIAL PRIMARY KEY,
                account_id BIGINT REFERENCES accounts(id),
                summary_date TEXT NOT NULL,
                ai_content TEXT NOT NULL,
                generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(summary_date, account_id)
            );

            CREATE TABLE IF NOT EXISTS settings (
                id BIGSERIAL PRIMARY KEY,
                account_id BIGINT NOT NULL DEFAULT 0,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                UNIQUE(account_id, key)
            );

            CREATE TABLE IF NOT EXISTS custom_setups (
                id BIGSERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                side TEXT,
                notes TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_trades_account_date ON trades(account_id, date);
            CREATE INDEX IF NOT EXISTS idx_trades_group ON trades(trade_group);
            CREATE INDEX IF NOT EXISTS idx_analysis_group ON trade_analysis(trade_group);
            CREATE INDEX IF NOT EXISTS idx_tags_group ON trade_tags(trade_group);

            CREATE TABLE IF NOT EXISTS library_items (
                id BIGSERIAL PRIMARY KEY,
                kind TEXT NOT NULL CHECK(kind IN ('strategy','source','tag')),
                tag_type TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(kind, tag_type, name)
            );

            CREATE TABLE IF NOT EXISTS library_aliases (
                id BIGSERIAL PRIMARY KEY,
                kind TEXT NOT NULL,
                tag_type TEXT NOT NULL DEFAULT '',
                alias TEXT NOT NULL,
                canonical TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(kind, tag_type, alias)
            );
        """
        conn.executescript(schema)

        # Safe PostgreSQL migrations for databases that were initialized before
        # the newer fields were added.
        migrations = [
            "ALTER TABLE trades ADD COLUMN IF NOT EXISTS setup TEXT",
            "ALTER TABLE trades ADD COLUMN IF NOT EXISTS setup_grade TEXT",
            "ALTER TABLE trades ADD COLUMN IF NOT EXISTS setup_notes TEXT",
            "ALTER TABLE trades ADD COLUMN IF NOT EXISTS setup_features TEXT",
            "ALTER TABLE trades ADD COLUMN IF NOT EXISTS setup_source TEXT DEFAULT 'auto'",
            "ALTER TABLE trades ADD COLUMN IF NOT EXISTS mfe_pct DOUBLE PRECISION",
            "ALTER TABLE trades ADD COLUMN IF NOT EXISTS mae_pct DOUBLE PRECISION",
            "ALTER TABLE trades ADD COLUMN IF NOT EXISTS exit_efficiency DOUBLE PRECISION",
            "ALTER TABLE trade_analysis ADD COLUMN IF NOT EXISTS target_price DOUBLE PRECISION",
            "ALTER TABLE trade_analysis ADD COLUMN IF NOT EXISTS trade_rating INTEGER",
            "ALTER TABLE trade_analysis ADD COLUMN IF NOT EXISTS idea_source TEXT",
        ]
        for ddl in migrations:
            conn.execute(ddl)

        conn.commit()
        conn.close()
        return

    # Original SQLite schema for local fallback.
    cursor = conn.cursor()
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('day_trading','swing_trading','investment')),
            color TEXT NOT NULL DEFAULT '#6366f1',
            broker TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL REFERENCES accounts(id),
            trade_group TEXT NOT NULL,
            date TEXT NOT NULL,
            ticker TEXT NOT NULL,
            instrument_type TEXT NOT NULL CHECK(instrument_type IN ('STOCK','OPTION','FUTURE')),
            side TEXT NOT NULL CHECK(side IN ('LONG','SHORT')),
            gross_pnl REAL,
            net_pnl REAL,
            commissions REAL DEFAULT 0,
            executions TEXT NOT NULL DEFAULT '[]',
            option_expiry TEXT,
            option_strike REAL,
            option_type TEXT CHECK(option_type IN ('CALL','PUT',NULL)),
            source TEXT NOT NULL DEFAULT 'imported',
            imported_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(trade_group, account_id)
        );
        CREATE TABLE IF NOT EXISTS diary_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL REFERENCES accounts(id),
            entry_date TEXT NOT NULL,
            image_path TEXT,
            raw_text TEXT,
            ai_analysis TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS trade_analysis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_group TEXT NOT NULL UNIQUE,
            ticker TEXT NOT NULL,
            date TEXT NOT NULL,
            strategy TEXT,
            stop_loss REAL,
            risk_per_trade REAL,
            risk_reward REAL,
            r_multiple REAL,
            entry_reason TEXT,
            exit_reason TEXT,
            mistakes TEXT,
            emotional_state TEXT,
            notes TEXT,
            ai_feedback TEXT,
            match_confidence TEXT CHECK(match_confidence IN ('high','medium','low','ambiguous','unmatched','manual')),
            match_notes TEXT,
            diary_entry_id INTEGER REFERENCES diary_entries(id),
            target_price REAL,
            trade_rating INTEGER,
            idea_source TEXT
        );
        CREATE TABLE IF NOT EXISTS trade_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_group TEXT NOT NULL,
            tag_type TEXT NOT NULL,
            tag_value TEXT NOT NULL,
            source TEXT NOT NULL CHECK(source IN ('ai','manual'))
        );
        CREATE TABLE IF NOT EXISTS daily_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER REFERENCES accounts(id),
            summary_date TEXT NOT NULL,
            ai_content TEXT NOT NULL,
            generated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(summary_date, account_id)
        );
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL DEFAULT 0,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            UNIQUE(account_id, key)
        );
        CREATE TABLE IF NOT EXISTS custom_setups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            side TEXT,
            notes TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_trades_account_date ON trades(account_id, date);
        CREATE INDEX IF NOT EXISTS idx_trades_group ON trades(trade_group);
        CREATE INDEX IF NOT EXISTS idx_analysis_group ON trade_analysis(trade_group);
        CREATE INDEX IF NOT EXISTS idx_tags_group ON trade_tags(trade_group);
    """)
    conn.commit()
    for ddl in [
        "ALTER TABLE trade_analysis ADD COLUMN target_price REAL",
        "ALTER TABLE trade_analysis ADD COLUMN trade_rating INTEGER",
        "ALTER TABLE trade_analysis ADD COLUMN idea_source TEXT",
        "ALTER TABLE trades ADD COLUMN setup TEXT",
        "ALTER TABLE trades ADD COLUMN setup_grade TEXT",
        "ALTER TABLE trades ADD COLUMN setup_notes TEXT",
        "ALTER TABLE trades ADD COLUMN setup_features TEXT",
        "ALTER TABLE trades ADD COLUMN setup_source TEXT DEFAULT 'auto'",
        "ALTER TABLE trades ADD COLUMN mfe_pct REAL",
        "ALTER TABLE trades ADD COLUMN mae_pct REAL",
        "ALTER TABLE trades ADD COLUMN exit_efficiency REAL",
    ]:
        try:
            conn.execute(ddl)
            conn.commit()
        except Exception:
            pass
    conn.close()


def row_to_dict(row) -> dict:
    return dict(row)
