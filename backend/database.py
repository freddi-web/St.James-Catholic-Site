import json
import sqlite3
from pathlib import Path


DATABASE_PATH = Path(__file__).parent / "parish.db"


def get_connection():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database():
    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'member'
                    CHECK (role IN ('member', 'moderator', 'administrator', 'super_admin')),
                enabled INTEGER NOT NULL DEFAULT 1,
                jumuiya TEXT,
                ministry TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS parish_content (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_content_collection
                ON parish_content(collection, id);
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS moderator_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                scope_type TEXT NOT NULL CHECK (scope_type IN ('ministry', 'jumuiya')),
                scope_name TEXT NOT NULL,
                reason TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                reviewed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS donations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                jumuiya TEXT,
                amount REAL NOT NULL CHECK (amount > 0),
                project TEXT,
                reference TEXT,
                status TEXT NOT NULL DEFAULT 'pledged'
                    CHECK (status IN ('pledged', 'confirmed')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS sacramental_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                sacrament TEXT NOT NULL,
                applicant_name TEXT NOT NULL,
                contact TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS contact_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        defaults = {
            "announcement": "",
            "payment": json.dumps(
                {
                    "paybill": "",
                    "till": "",
                    "account_name": "",
                    "bank_name": "",
                    "account_name_bank": "",
                    "account_number": "",
                    "branch": "",
                }
            ),
            "map_embed": "",
            "address": "Katheka Kai, Kenya",
            "manual_readings": "",
            "show_schedules": "true",
        }
        connection.executemany(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            defaults.items(),
        )
        initial_content = {
            "schedules": [
                {"day": "Sunday", "time": "To be announced", "type": "Sunday Worship", "visible": True},
                {"day": "Weekdays", "time": "To be announced", "type": "Weekday Mass", "visible": True},
                {"day": "Saturday", "time": "To be announced", "type": "Bible Study", "visible": True},
            ],
            "jumuiyas": [
                {"name": f"Jumuiya {index}", "patron": "To be announced", "schedule": "To be announced", "venue": "To be announced", "leader": "", "contact": ""}
                for index in range(1, 10)
            ],
            "ministries": [
                {"name": name, "description": "Information coming soon.", "moderator": ""}
                for name in ("Choir", "CWA", "CMA", "Youth", "Altar Servers", "Catechism")
            ],
            "projects": [],
            "events": [],
        }
        for collection, entries in initial_content.items():
            exists = connection.execute(
                "SELECT 1 FROM parish_content WHERE collection = ? LIMIT 1",
                (collection,),
            ).fetchone()
            if not exists:
                connection.executemany(
                    "INSERT INTO parish_content (collection, data) VALUES (?, ?)",
                    [
                        (collection, json.dumps(item, ensure_ascii=False))
                        for item in entries
                    ],
                )


if __name__ == "__main__":
    initialize_database()
    print(f"Parish database initialized at {DATABASE_PATH}")
