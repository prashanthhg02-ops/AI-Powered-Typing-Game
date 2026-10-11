import json
import tempfile
import unittest
from pathlib import Path

from backend.app import create_app
from ml.model import analyze_performance


class ModelTests(unittest.TestCase):
    def test_model_predicts_skill_and_a_valid_difficulty(self):
        prediction = analyze_performance({
            "wpm": 72, "accuracy": 97, "error_rate": 3,
            "avg_word_seconds": 1.3, "previous_wpm": 68,
        })
        self.assertEqual(prediction["skill_level"], "advanced")
        self.assertIn(prediction["difficulty"], {"easy", "medium", "hard"})
        self.assertGreaterEqual(prediction["confidence"], 0.0)

    def test_accuracy_guard_recommends_easy_difficulty(self):
        prediction = analyze_performance({
            "wpm": 70, "accuracy": 65, "error_rate": 35,
            "avg_word_seconds": 1.4, "previous_wpm": 65,
        })
        self.assertEqual(prediction["difficulty"], "easy")

    def test_model_rejects_invalid_input(self):
        with self.assertRaisesRegex(ValueError, "accuracy"):
            analyze_performance({
                "wpm": 35, "accuracy": 120, "error_rate": 1,
                "avg_word_seconds": 2, "previous_wpm": 30,
            })


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        database = str(Path(self.directory.name) / "test.sqlite3")
        self.app = create_app({"TESTING": True, "DATABASE": database})
        self.client = self.app.test_client()
        self.session = {
            "player_id": "tester-1", "mode": "normal", "difficulty": "medium",
            "duration_seconds": 44, "wpm": 43, "accuracy": 96, "errors": 3,
            "correct_keystrokes": 72, "avg_word_seconds": 2.1,
            "score": 1540, "longest_combo": 5, "mistyped_letters": {"a": 2},
            "previous_wpm": 38,
        }

    def tearDown(self):
        self.directory.cleanup()

    def test_health_endpoint(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "ok")

    def test_analyze_endpoint_returns_model_recommendation(self):
        response = self.client.post("/api/analyze", json={
            "player_id": "tester-1", "wpm": 35, "accuracy": 96,
            "error_rate": 4, "avg_word_seconds": 2.3, "previous_wpm": 30,
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn(response.get_json()["skill_level"], {"beginner", "intermediate", "advanced"})

    def test_api_rejects_invalid_metrics(self):
        response = self.client.post("/api/analyze", json={
            "player_id": "tester-1", "wpm": 35, "accuracy": 120,
            "error_rate": 4, "avg_word_seconds": 2.3, "previous_wpm": 30,
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("accuracy", response.get_json()["error"])

    def test_results_round_trip_to_history_and_weak_letters(self):
        response = self.client.post("/api/sessions", json=self.session)
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        saved = response.get_json()
        self.assertGreater(saved["session_id"], 0)
        self.assertIn("skill_level", saved["analysis"])
        history = self.client.get("/api/stats/tester-1").get_json()
        self.assertEqual(len(history["sessions"]), 1)
        self.assertEqual(history["sessions"][0]["score"], self.session["score"])
        self.assertEqual(history["weak_letters"], [{"letter": "a", "count": 2}])

    def test_session_api_rejects_invalid_mode(self):
        invalid = {**self.session, "mode": "impossible"}
        response = self.client.post("/api/sessions", data=json.dumps(invalid), content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("mode", response.get_json()["error"])

    def test_session_api_rejects_fractional_keystroke_counts(self):
        invalid = {**self.session, "correct_keystrokes": 2.5}
        response = self.client.post("/api/sessions", json=invalid)
        self.assertEqual(response.status_code, 400)
        self.assertIn("integer", response.get_json()["error"])

    def test_practice_endpoint_returns_targeted_words(self):
        self.client.post("/api/sessions", json=self.session)
        result = self.client.get("/api/practice/tester-1").get_json()
        self.assertEqual(result["target_letters"], ["a"])
        self.assertTrue(any("a" in word for word in result["words"]))


if __name__ == "__main__":
    unittest.main()
