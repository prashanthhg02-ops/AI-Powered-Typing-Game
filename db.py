from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


@contextmanager
def connect(database_path: str) -> Iterator[sqlite3.Connection]:
    path = Path(database_path)
    if str(path) != ":memory:":
        path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db(database_path: str) -> None:
    with connect(database_path) as connection:
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS players (
                player_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS game_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_id TEXT NOT NULL REFERENCES players(player_id),
                mode TEXT NOT NULL CHECK (mode IN ('training', 'normal', 'boss')),
                difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
                duration_seconds INTEGER NOT NULL,
                score INTEGER NOT NULL,
                longest_combo INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS typing_statistics (
                session_id INTEGER PRIMARY KEY REFERENCES game_sessions(id) ON DELETE CASCADE,
                wpm REAL NOT NULL,
                accuracy REAL NOT NULL,
                errors INTEGER NOT NULL,
                correct_keystrokes INTEGER NOT NULL,
                avg_word_seconds REAL NOT NULL,
                skill_level TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS performance_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player_id TEXT NOT NULL REFERENCES players(player_id),
                session_id INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
                wpm REAL NOT NULL,
                accuracy REAL NOT NULL,
                skill_level TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS mistyped_letters (
                player_id TEXT NOT NULL REFERENCES players(player_id),
                letter TEXT NOT NULL CHECK (length(letter) = 1),
                count INTEGER NOT NULL,
                PRIMARY KEY (player_id, letter)
            );
        """)


def save_session(
    database_path: str, data: dict[str, Any], skill_level: str
) -> int:
    with connect(database_path) as connection:
        connection.execute(
            "INSERT OR IGNORE INTO players (player_id) VALUES (?)",
            (data["player_id"],),
        )
        cursor = connection.execute(
            """INSERT INTO game_sessions
               (player_id, mode, difficulty, duration_seconds, score, longest_combo)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                data["player_id"], data["mode"], data["difficulty"],
                data["duration_seconds"], data["score"], data["longest_combo"],
            ),
        )
        session_id = int(cursor.lastrowid)
        connection.execute(
            """INSERT INTO typing_statistics
               (session_id, wpm, accuracy, errors, correct_keystrokes,
                avg_word_seconds, skill_level)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                session_id, data["wpm"], data["accuracy"], data["errors"],
                data["correct_keystrokes"], data["avg_word_seconds"], skill_level,
            ),
        )
        connection.execute(
            """INSERT INTO performance_history
               (player_id, session_id, wpm, accuracy, skill_level)
               VALUES (?, ?, ?, ?, ?)""",
            (
                data["player_id"], session_id, data["wpm"], data["accuracy"],
                skill_level,
            ),
        )
        for letter, count in data["mistyped_letters"].items():
            connection.execute(
                """INSERT INTO mistyped_letters (player_id, letter, count)
                   VALUES (?, ?, ?)
                   ON CONFLICT(player_id, letter)
                   DO UPDATE SET count = count + excluded.count""",
                (data["player_id"], letter, count),
            )
        return session_id


def session_history(database_path: str, player_id: str) -> list[dict[str, Any]]:
    with connect(database_path) as connection:
        rows = connection.execute(
            """SELECT gs.id, gs.mode, gs.difficulty, gs.duration_seconds,
                      gs.score, gs.longest_combo, gs.created_at,
                      ts.wpm, ts.accuracy, ts.errors, ts.correct_keystrokes,
                      ts.avg_word_seconds, ts.skill_level
               FROM game_sessions AS gs
               JOIN typing_statistics AS ts ON ts.session_id = gs.id
               WHERE gs.player_id = ?
               ORDER BY gs.id DESC LIMIT 50""",
            (player_id,),
        ).fetchall()
        return [dict(row) for row in reversed(rows)]


def weak_letters(database_path: str, player_id: str) -> list[dict[str, Any]]:
    with connect(database_path) as connection:
        rows = connection.execute(
            """SELECT letter, count FROM mistyped_letters
               WHERE player_id = ? ORDER BY count DESC, letter ASC LIMIT 8""",
            (player_id,),
        ).fetchall()
        return [dict(row) for row in rows]
