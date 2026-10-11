# Keyflow Battle

A playable dark-fantasy typing battle game and AIML college-project demonstration. Type words to strike monsters, build combo multipliers, defend your health, and review your typing progress. The Python service uses Flask and SQLite; a trained scikit-learn Random Forest predicts a player's skill band and recommends practice difficulty. Chart.js plots recent results.

## Project structure

```text
backend/                    Flask app and validated JSON API
database/                   SQLite schema and parameterized persistence
frontend/
  templates/index.html       Home, mode picker, arena, results, stats, practice
  static/css/style.css       Responsive fantasy UI and CSS animations
  static/js/app.js           Battle loop, typing metrics, navigation, API client
  static/assets/arena-stars.svg Original, bundled fantasy sky texture
ml/model.py                 Reproducible Random Forest classifier
tests/test_game.py          Model and Flask API tests
requirements.txt            Flask and scikit-learn
run.py                      Development server entry point
```

## Run in VS Code

1. Open this project folder in VS Code and select a Python 3.10+ interpreter.
2. Create and activate a virtual environment:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

   If PowerShell blocks activation, use `.\.venv\Scripts\python.exe` in place of `python` in the following commands.
3. Install dependencies:

   ```powershell
   python -m pip install -r requirements.txt
   ```
4. Start the Flask server:

   ```powershell
   python run.py
   ```
5. Open [http://127.0.0.1:5000](http://127.0.0.1:5000). Keep the server running while you play. The stylesheet and Chart.js Google Fonts/JSCDN links require internet access; original character art and the rest of the game are bundled in the project.

The SQLite database is created automatically as `database/keyflow.sqlite3`. Player IDs are random browser-local guest IDs; no name, email, or account is collected.

## Play

- **Training** is a 60-second practice round without health damage.
- **Normal battle** has a 90-second first phase, 100 player health, and a 130-health monster.
- **Boss battle** has a 120-second first phase and a tougher 250-health monster. Later battle phases restart at 30 seconds; the timer deals health damage, and each fourth typing error costs health.
- Type the displayed word exactly to attack. Consecutive correct words grow a score/damage multiplier; a wrong key resets the combo. Backspace edits the current word without a penalty.
- Pause/resume with the arena button or Escape. After every encounter, type **moss**, **ember**, or **crown** at the story crossroads to choose the next route. Each route changes the next monster, available words, supplies, and score/difficulty modifiers. You can also start a new saga from the crossroads or choose a fresh mode from the results page.
- The Mosslit Grove restores health and eases difficulty; the Ember Market restores some health and boosts score; the Crownless Keep offers the biggest score multiplier but raises the challenge and brings a stronger monster.
- The mode picker, results page, branching story, stats, practice page, main menu, and sound controls are interactive.
- The practice page uses personalized SQLite-backed drills when the Flask API is running; if the server is unavailable, it falls back to a built-in word set so typing exercises still work.
- Stats and saved anonymous rounds are held in local SQLite on the Flask server. Your typed words are not stored; only aggregate metrics and counts of mistyped letters are saved.

## Machine-learning approach and limitations

`ml/model.py` trains a scikit-learn `RandomForestClassifier` with a fixed random seed on a small, explicitly documented synthetic teaching dataset. Features are WPM, accuracy, error rate, average word-completion time, and previous-round WPM. The model returns beginner/intermediate/advanced plus class confidence. The app combines the predicted class with an accuracy safety check to recommend easy/medium/hard practice; low accuracy never leads to a harder recommendation. Repeatedly mistyped letters from battle history are returned as personalized letter/word drills.

These synthetic examples make the project reproducible, not scientifically validated: the predicted category/confidence is only a classroom demonstration. A production model would require a larger consented dataset, participant-independent validation, and periodic model evaluation. WPM is calculated as correct keystrokes / 5 / elapsed minutes; accuracy as correct keystrokes / (correct + incorrect keystrokes) × 100; average word time is the mean time taken for completed words.

## API

- `GET /api/health` — server health.
- `POST /api/analyze` — validate live typing features and return skill prediction, recommended difficulty, coaching text, and weak letters.
- `POST /api/sessions` — validate and persist aggregate metrics and letter-error counts; return the model analysis.
- `GET /api/stats/<player_id>` — up to 50 recent sessions and the most-mistyped letters.
- `GET /api/practice/<player_id>` — targeted letter and word exercises.

Invalid JSON, out-of-range metrics, malformed player IDs, and invalid modes are rejected with descriptive 400 responses; database failures are logged and return 500 responses.

## Tests

```powershell
python -m unittest discover -s tests -v
```
