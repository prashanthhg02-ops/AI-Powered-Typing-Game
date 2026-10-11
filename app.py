from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request

from database.db import init_db, save_session, session_history, weak_letters
from ml.model import analyze_performance

ROOT = Path(__file__).resolve().parent.parent
PLAYER_RE = re.compile(r"^[a-zA-Z0-9_-]{1,40}$")


def _validation_error(message: str, status: int = 400):
    return jsonify({"error": message}), status


def _number(
    data: dict[str, Any], key: str, *, minimum: float = 0, maximum: float
) -> float:
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{key} must be a number.")
    value = float(value)
    if not minimum <= value <= maximum:
        raise ValueError(f"{key} must be between {minimum:g} and {maximum:g}.")
    return value


def _integer(data: dict[str, Any], key: str, *, maximum: float) -> int:
    value = _number(data, key, maximum=maximum)
    if not value.is_integer():
        raise ValueError(f"{key} must be an integer.")
    return int(value)


def _payload() -> dict[str, Any]:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValueError("Request body must be a JSON object.")
    player_id = data.get("player_id", "guest")
    if not isinstance(player_id, str) or not PLAYER_RE.fullmatch(player_id):
        raise ValueError("player_id must contain 1–40 letters, numbers, underscores, or hyphens.")
    return data


def _session_data(data: dict[str, Any]) -> dict[str, Any]:
    mode = data.get("mode", "normal")
    if not isinstance(mode, str) or mode not in {"training", "normal", "boss"}:
        raise ValueError("mode must be training, normal, or boss.")
    difficulty = data.get("difficulty", "easy")
    if not isinstance(difficulty, str) or difficulty not in {"easy", "medium", "hard"}:
        raise ValueError("difficulty must be easy, medium, or hard.")
    letters = data.get("mistyped_letters", {})
    if not isinstance(letters, dict) or len(letters) > 26:
        raise ValueError("mistyped_letters must be an object with at most 26 entries.")
    safe_letters: dict[str, int] = {}
    for letter, count in letters.items():
        if not isinstance(letter, str) or not re.fullmatch(r"[a-z]", letter):
            raise ValueError("Mistyped letter keys must be lowercase a–z.")
        if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= 10000:
            raise ValueError("Mistyped letter counts must be integers from 0 to 10000.")
        safe_letters[letter] = count
    result = {
        "player_id": data.get("player_id", "guest"),
        "mode": mode,
        "difficulty": difficulty,
        "duration_seconds": _integer(data, "duration_seconds", maximum=3600),
        "wpm": _number(data, "wpm", maximum=500),
        "accuracy": _number(data, "accuracy", maximum=100),
        "errors": _integer(data, "errors", maximum=100000),
        "correct_keystrokes": _integer(data, "correct_keystrokes", maximum=100000),
        "avg_word_seconds": _number(data, "avg_word_seconds", maximum=3600),
        "score": _integer(data, "score", maximum=100000000),
        "longest_combo": _integer(data, "longest_combo", maximum=100000),
        "mistyped_letters": safe_letters,
    }
    if result["duration_seconds"] < 1:
        raise ValueError("duration_seconds must be at least 1.")
    return result


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    app = Flask(
        __name__,
        template_folder=str(ROOT / "frontend" / "templates"),
        static_folder=str(ROOT / "frontend" / "static"),
        static_url_path="/static",
    )
    app.config.update(
        DATABASE=str(ROOT / "database" / "keyflow.sqlite3"),
        JSON_SORT_KEYS=False,
    )
    if test_config:
        app.config.update(test_config)
    init_db(app.config["DATABASE"])

    @app.get("/")
    def home():
        return render_template("index.html")

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "service": "keyflow-battle"})

    @app.post("/api/analyze")
    def analyze():
        try:
            data = _payload()
            features = {
                "wpm": _number(data, "wpm", maximum=500),
                "accuracy": _number(data, "accuracy", maximum=100),
                "error_rate": _number(data, "error_rate", maximum=100),
                "avg_word_seconds": _number(data, "avg_word_seconds", maximum=3600),
                "previous_wpm": _number(data, "previous_wpm", maximum=500),
            }
            features["weak_letters"] = weak_letters(
                app.config["DATABASE"], data["player_id"]
            )
            return jsonify(analyze_performance(features))
        except ValueError as error:
            return _validation_error(str(error))
        except sqlite3.Error:
            app.logger.exception("Database error while analyzing player performance")
            return _validation_error("Player history is temporarily unavailable.", 500)

    @app.post("/api/sessions")
    def create_session():
        try:
            payload = _payload()
            data = _session_data(payload)
            features = {
                "wpm": data["wpm"],
                "accuracy": data["accuracy"],
                "error_rate": (data["errors"] / max(data["errors"] + data["correct_keystrokes"], 1)) * 100,
                "avg_word_seconds": data["avg_word_seconds"],
                "previous_wpm": _number(
                    {"previous_wpm": payload.get("previous_wpm", data["wpm"])},
                    "previous_wpm",
                    maximum=500,
                ),
            }
            result = analyze_performance(features)
            session_id = save_session(
                app.config["DATABASE"], data, result["skill_level"]
            )
            return jsonify(
                {"session_id": session_id, "analysis": result}
            ), 201
        except ValueError as error:
            return _validation_error(str(error))
        except sqlite3.Error:
            app.logger.exception("Database error while saving a game session")
            return _validation_error("Game results could not be saved.", 500)

    @app.get("/api/stats/<player_id>")
    def stats(player_id: str):
        if not PLAYER_RE.fullmatch(player_id):
            return _validation_error("Invalid player_id.")
        try:
            sessions = session_history(app.config["DATABASE"], player_id)
            return jsonify({"sessions": sessions, "weak_letters": weak_letters(
                app.config["DATABASE"], player_id
            )})
        except sqlite3.Error:
            app.logger.exception("Database error while loading player statistics")
            return _validation_error("Player statistics are temporarily unavailable.", 500)

    @app.get("/api/practice/<player_id>")
    def practice(player_id: str):
        if not PLAYER_RE.fullmatch(player_id):
            return _validation_error("Invalid player_id.")
        try:
            letters = weak_letters(app.config["DATABASE"], player_id)
            if letters:
                target = [item["letter"] for item in letters[:3]]
                words = {
                    "a": ["arcane", "blade", "mana"], "b": ["battle", "brave", "ember"],
                    "c": ["crystal", "crown", "curse"], "d": ["dragon", "dodge", "dawn"],
                    "e": ["ember", "elder", "steel"], "f": ["flame", "forge", "frost"],
                    "g": ["golem", "glory", "guard"], "h": ["hero", "health", "shadow"],
                    "i": ["ignite", "spirit", "swift"], "j": ["jewel", "justice", "major"],
                    "k": ["knight", "strike", "skill"], "l": ["legend", "light", "spell"],
                    "m": ["monster", "magic", "armor"], "n": ["night", "ancient", "inner"],
                    "o": ["oracle", "power", "sword"], "p": ["phantom", "prince", "spell"],
                    "q": ["quest", "equal", "unique"], "r": ["ranger", "realm", "armor"],
                    "s": ["sorcerer", "shadow", "sword"], "t": ["titan", "strike", "light"],
                    "u": ["unicorn", "unique", "rune"], "v": ["victory", "valor", "dive"],
                    "w": ["warrior", "wizard", "swift"], "x": ["expert", "hex", "axe"],
                    "y": ["young", "mystery", "royal"], "z": ["wizard", "frozen", "zeal"],
                }
                drills = list(dict.fromkeys(
                    word for letter in target for word in words.get(letter, [])
                ))
                message = "Your recent battles show these letters deserve extra practice."
            else:
                target = []
                drills = ["swift", "arcane", "victory", "warrior", "dragon", "crystal"]
                message = "Play a battle and I’ll tailor drills to your tricky letters."
            return jsonify({
                "target_letters": target, "words": drills,
                "weak_letters": letters, "message": message,
            })
        except sqlite3.Error:
            app.logger.exception("Database error while building practice drills")
            return _validation_error("Practice recommendations are temporarily unavailable.", 500)

    @app.errorhandler(404)
    def not_found(_error):
        if request.path.startswith("/api/"):
            return _validation_error("API endpoint not found.", 404)
        return _validation_error("Page not found.", 404)

    return app
