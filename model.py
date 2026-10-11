"""Reproducible Random Forest skill classifier and typing recommendations."""

from __future__ import annotations

from typing import Any

from sklearn.ensemble import RandomForestClassifier

FEATURE_NAMES = (
    "wpm", "accuracy", "error_rate", "avg_word_seconds", "previous_wpm"
)

# Small, explicitly synthetic teaching data; labels are illustrative, not a
# clinically meaningful or independently validated measure of typing ability.
_TRAINING_ROWS = [
    (8, 70, 30, 8.0, 0, "beginner"),
    (12, 78, 22, 6.2, 8, "beginner"),
    (16, 82, 18, 5.0, 14, "beginner"),
    (20, 85, 15, 4.2, 18, "beginner"),
    (22, 88, 12, 3.9, 20, "beginner"),
    (24, 86, 14, 3.8, 20, "beginner"),
    (27, 89, 11, 3.5, 24, "intermediate"),
    (31, 90, 10, 3.1, 28, "intermediate"),
    (35, 91, 9, 2.8, 32, "intermediate"),
    (39, 93, 7, 2.6, 37, "intermediate"),
    (44, 90, 10, 2.3, 40, "intermediate"),
    (48, 94, 6, 2.1, 45, "intermediate"),
    (52, 93, 7, 2.0, 48, "intermediate"),
    (55, 95, 5, 1.8, 52, "advanced"),
    (60, 96, 4, 1.6, 57, "advanced"),
    (65, 94, 6, 1.5, 60, "advanced"),
    (72, 97, 3, 1.3, 68, "advanced"),
    (80, 96, 4, 1.2, 74, "advanced"),
    (92, 98, 2, 1.0, 85, "advanced"),
    (105, 99, 1, 0.9, 96, "advanced"),
    (30, 76, 24, 4.0, 34, "beginner"),
    (42, 84, 16, 2.6, 45, "intermediate"),
    (58, 86, 14, 1.7, 62, "intermediate"),
    (49, 97, 3, 2.0, 48, "intermediate"),
    (67, 90, 10, 1.4, 72, "intermediate"),
    (72, 91, 9, 1.2, 76, "advanced"),
    (37, 96, 4, 2.8, 35, "intermediate"),
    (53, 89, 11, 1.9, 58, "intermediate"),
    (25, 96, 4, 4.0, 21, "beginner"),
    (87, 92, 8, 1.1, 91, "advanced"),
]

_MODEL = RandomForestClassifier(
    n_estimators=101,
    max_depth=5,
    class_weight="balanced",
    random_state=42,
)
_MODEL.fit(
    [row[:5] for row in _TRAINING_ROWS],
    [row[5] for row in _TRAINING_ROWS],
)


def analyze_performance(features: dict[str, Any]) -> dict[str, Any]:
    """Predict typing skill and recommend a difficulty, with weak-letter drills."""
    values = []
    for name in FEATURE_NAMES:
        value = features.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{name} must be a number.")
        if value < 0:
            raise ValueError(f"{name} cannot be negative.")
        values.append(float(value))
    for name, value, maximum in (
        ("wpm", values[0], 500), ("accuracy", values[1], 100),
        ("error_rate", values[2], 100), ("previous_wpm", values[4], 500),
    ):
        if value > maximum:
            raise ValueError(f"{name} exceeds its supported range.")

    probabilities = _MODEL.predict_proba([values])[0]
    classes = list(_MODEL.classes_)
    winner = int(probabilities.argmax())
    skill = str(classes[winner])
    difficulty = {"beginner": "easy", "intermediate": "medium", "advanced": "hard"}[skill]
    if values[1] < 80:
        difficulty = "easy"
    elif values[1] < 90 and difficulty == "hard":
        difficulty = "medium"

    weak_letters = features.get("weak_letters", [])
    if not isinstance(weak_letters, list):
        raise ValueError("weak_letters must be a list.")
    clean_letters = []
    for item in weak_letters[:3]:
        if not isinstance(item, dict):
            raise ValueError("Each weak letter must be an object.")
        letter = item.get("letter")
        count = item.get("count")
        if not isinstance(letter, str) or len(letter) != 1 or not letter.isalpha():
            raise ValueError("Weak-letter keys must be single alphabetic characters.")
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise ValueError("Weak-letter counts must be non-negative integers.")
        clean_letters.append({"letter": letter.lower(), "count": count})

    advice = {
        "beginner": "Build accuracy with shorter words, then gradually add speed.",
        "intermediate": "Keep your rhythm steady; try slightly longer words next.",
        "advanced": "Great control. Take on harder words and push your speed carefully.",
    }[skill]
    if values[1] < 90:
        advice = "Slow down slightly and prioritize clean keystrokes before chasing speed."
    if clean_letters:
        advice += f" Focus extra practice on: {', '.join(item['letter'] for item in clean_letters)}."
    return {
        "skill_level": skill,
        "confidence": round(float(probabilities[winner]), 3),
        "difficulty": difficulty,
        "recommendation": advice,
        "target_letters": [item["letter"] for item in clean_letters],
    }
