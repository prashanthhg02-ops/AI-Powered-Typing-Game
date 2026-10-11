"use strict";

const $ = (selector) => document.querySelector(selector);
const WORDS = {
  easy: ["oak", "fox", "sun", "map", "gem", "owl", "ice", "ash", "key", "run", "red", "sky", "brave", "moss", "leaf", "gold"],
  medium: ["shield", "arcane", "silver", "ranger", "thunder", "crystal", "shadow", "victory", "warrior", "ancient", "ember", "castle"],
  hard: ["quickly", "phantom", "sorcerer", "triumphant", "bewildered", "consequence", "relentless", "transcendent", "crystalline", "unforgiving", "masterpiece"]
};
const MODES = {
  training: { title: "TRAINING GROUNDS", duration: 60, monster: "STONE SENTINEL", monsterHp: 130, damage: 0 },
  normal: { title: "NORMAL BATTLE", duration: 90, monster: "ASH WRAITH", monsterHp: 130, damage: 8 },
  boss: { title: "BOSS BATTLE", duration: 120, monster: "THE SHADOW WYRM", monsterHp: 250, damage: 12 }
};
const BUILTIN_PRACTICE = {
  target_letters: [],
  words: ["swift", "arcane", "victory", "warrior", "dragon", "crystal"],
  message: "Starter drills are ready. Finish a battle to unlock exercises tailored to your commonly mistyped letters."
};
const STORY_PATHS = {
  moss: {
    region: "THE MOSSLIT GROVE", name: "The Mosslit Grove", monster: "THORNBOUND STAG",
    monsterScale: 1.05, heal: 30, scoreMultiplier: 1, difficultyShift: -1,
    theme: "grove", words: ["verdant", "bramble", "willow", "mossy", "thicket"],
    narration: "The grove remembers your mercy. Old roots knit around your wounds as the Thornbound Stag steps from the green."
  },
  ember: {
    region: "THE EMBER MARKET", name: "The Ember Market", monster: "ASHEN COLLECTOR",
    monsterScale: 1.2, heal: 10, scoreMultiplier: 1.4, difficultyShift: 0,
    theme: "ember", words: ["forge", "cinder", "molten", "ember", "blazing"],
    narration: "The masked smith takes your word as payment. A hotter blade is yours now—but the Ashen Collector has smelled the bargain."
  },
  crown: {
    region: "THE CROWNLESS KEEP", name: "The Crownless Keep", monster: "CROWNLESS WYRM",
    monsterScale: 1.65, heal: 0, scoreMultiplier: 2, difficultyShift: 1,
    theme: "crown", words: ["sovereign", "crownless", "ascendant", "unyielding", "dominion"],
    narration: "You name the keep and its gates answer. No healing waits here: only the Crownless Wyrm, a harder trial, and a greater score."
  }
};
const state = {
  playerId: "", mode: "normal", difficulty: "easy", word: "", typed: "",
  active: false, paused: false, finished: false, sound: false, timer: 0,
  deadline: 0, interval: null, startTime: 0, wordStartedAt: 0, phase: 1,
  pauseStartedAt: 0, pausedDuration: 0,
  health: 100, monsterHealth: 100, score: 0, combo: 0, longestCombo: 0,
  correct: 0, errors: 0, words: 0, wordSeconds: [], mistakeLetters: {},
  previousWpm: 0, previousRound: { wpm: 0, accuracy: 100, error_rate: 0, avg_word_seconds: 2.5 },
  recommendation: null, chart: null, practiceWords: [],
  monsterMaxHealth: 130,
  story: {
    chapter: 1, health: 100, started: false, mode: "normal",
    outcome: "victory", encounter: null
  }
};

function loadPlayerId() {
  try {
    let id = localStorage.getItem("keyflow-battle-player");
    if (!id) {
      id = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("keyflow-battle-player", id);
    }
    return id;
  } catch (error) {
    console.warn("Could not read a saved player id.", error);
    return "guest";
  }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("visible"), 2700);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers }
    });
  } catch (error) {
    console.error("Keyflow API request failed.", error);
    throw new Error("Can't reach the game server. Check that Flask is running.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `The game server returned ${response.status}.`);
  return body;
}

function navigate(page) {
  document.querySelectorAll(".page").forEach((element) => {
    element.classList.toggle("active", element.dataset.page === page);
  });
  document.querySelectorAll(".nav-link[data-page-link]").forEach((element) => {
    element.classList.toggle("active", element.dataset.pageLink === page);
  });
  if (page === "stats") loadStats();
  if (page === "practice") loadPractice();
  if (page === "arena" && state.active && !state.paused) $("#battle-input").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showStory() {
  const nextChapter = state.story.chapter + 1;
  state.story.routeLocked = false;
  $("#story-chapter").textContent = `Chapter ${new Intl.NumberFormat("en", { minimumIntegerDigits: 2 }).format(nextChapter)}`;
  $("#story-narration").textContent = state.story.outcome === "defeat"
    ? "The dark closes in, but it does not get the last word. Three paths remain. Choose how you rise."
    : state.story.outcome === "training"
      ? "The lesson settles into your hands. Three roads leave the training grounds—choose where your story begins."
      : "The monster falls. Three paths open in the silence—and each one remembers what you type.";
  $("#story-choice").value = "";
  $("#story-feedback").textContent = "Your next encounter is shaped by the word you choose.";
  navigate("story");
}

function chooseStoryPath() {
  if (state.story.routeLocked) return;
  const choice = $("#story-choice").value.trim().toLowerCase();
  const encounter = STORY_PATHS[choice];
  if (!encounter) {
    $("#story-feedback").textContent = "That path is hidden. Type exactly: moss, ember, or crown.";
    $("#story-choice").focus();
    return;
  }
  state.story.routeLocked = true;
  $("#story-feedback").textContent = encounter.narration;
  state.story.encounter = { ...encounter };
  state.story.chapter += 1;
  window.setTimeout(() => startGame(state.story.mode, state.story.encounter), 500);
}

document.addEventListener("click", (event) => {
  const pageButton = event.target.closest("[data-page-link]");
  if (pageButton) {
    if (state.active && pageButton.dataset.pageLink !== "arena") pauseGame();
    navigate(pageButton.dataset.pageLink);
    return;
  }
  const dialogButton = event.target.closest("[data-dialog]");
  if (dialogButton) {
    const dialog = $(`#${dialogButton.dataset.dialog}-dialog`);
    if (dialog) dialog.showModal();
  }
});

async function recommendDifficulty() {
  let previous = { ...state.previousRound };
  try {
    const history = await api(`/api/stats/${encodeURIComponent(state.playerId)}`);
    const last = history.sessions.at(-1);
    if (last) {
      const attempts = last.errors + last.correct_keystrokes;
      previous = {
        wpm: last.wpm,
        accuracy: last.accuracy,
        error_rate: attempts ? last.errors / attempts * 100 : 0,
        avg_word_seconds: last.avg_word_seconds
      };
    }
  } catch (error) {
    console.warn(error.message);
  }
  try {
    const result = await api("/api/analyze", {
      method: "POST",
      body: JSON.stringify({
        player_id: state.playerId, wpm: previous.wpm, accuracy: previous.accuracy,
        error_rate: previous.error_rate, avg_word_seconds: previous.avg_word_seconds,
        previous_wpm: previous.wpm
      })
    });
    state.recommendation = result;
    state.difficulty = result.difficulty;
    $("#arena-ai-note").innerHTML = `<span>✳</span> Model recommends <strong>${result.skill_level}</strong> practice · ${result.recommendation}`;
  } catch (error) {
    state.difficulty = "easy";
    $("#arena-ai-note").textContent = `${error.message} Using the starter word set for this battle.`;
    showToast(error.message);
  }
}

function pickWord() {
  const bank = [
    ...(WORDS[state.difficulty] || WORDS.easy),
    ...(state.story.encounter?.words || [])
  ];
  const options = bank.filter((word) => word !== state.word);
  return options[Math.floor(Math.random() * options.length)] || bank[0];
}

function renderWord() {
  const display = $("#battle-word");
  display.replaceChildren();
  for (let i = 0; i < state.word.length; i += 1) {
    const letter = document.createElement("span");
    letter.textContent = state.word[i];
    if (i < state.typed.length) letter.className = state.typed[i] === state.word[i] ? "typed-correct" : "typed-wrong";
    if (i === state.typed.length && state.active && !state.paused) letter.classList.add("typed-current");
    display.append(letter);
  }
  $("#word-difficulty").textContent = state.difficulty.toUpperCase();
}

function nextWord() {
  state.word = pickWord();
  state.typed = "";
  state.wordStartedAt = performance.now();
  $("#battle-input").value = "";
  renderWord();
}

function metrics() {
  const currentPause = state.paused && state.pauseStartedAt ? Date.now() - state.pauseStartedAt : 0;
  const elapsed = state.startTime
    ? Math.max((Date.now() - state.startTime - state.pausedDuration - currentPause) / 1000, 1)
    : 0;
  const wpm = elapsed ? Math.round((state.correct / 5) / (elapsed / 60)) : 0;
  const total = state.correct + state.errors;
  const accuracy = total ? Math.round(state.correct / total * 100) : 100;
  const avgWord = state.wordSeconds.length
    ? state.wordSeconds.reduce((sum, value) => sum + value, 0) / state.wordSeconds.length
    : 0;
  return { elapsed, wpm, accuracy, avgWord };
}

function updateMetrics() {
  const { wpm, accuracy } = metrics();
  $("#game-score").textContent = state.score.toLocaleString();
  $("#game-wpm").textContent = String(wpm);
  $("#game-accuracy").textContent = String(accuracy);
  $("#game-combo").textContent = String(state.combo);
  $("#combo-multiplier").textContent = (1 + Math.floor(state.combo / 3) * 0.25).toFixed(1);
  $("#player-health").style.width = `${state.health}%`;
  $("#player-health-label").textContent = `${state.health} / 100`;
  $("#monster-health").style.width = `${Math.max(0, state.monsterHealth / state.monsterMaxHealth * 100)}%`;
  $("#monster-health-label").textContent = `${Math.max(0, state.monsterHealth)} / ${state.monsterMaxHealth}`;
  $("#game-timer").textContent = String(Math.max(0, state.timer));
}

function flash(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  window.setTimeout(() => element.classList.remove(className), 430);
}

function announce(text) {
  const element = $("#arena-announcement");
  element.textContent = text;
  element.classList.remove("show");
  void element.offsetWidth;
  element.classList.add("show");
}

function playSound(kind) {
  if (!state.sound) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  oscillator.type = kind === "hit" ? "sawtooth" : "triangle";
  oscillator.frequency.setValueAtTime(kind === "hit" ? 145 : 510, now);
  oscillator.frequency.exponentialRampToValueAtTime(kind === "hit" ? 55 : 220, now + 0.15);
  gain.gain.setValueAtTime(kind === "hit" ? 0.09 : 0.05, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(now + 0.19);
  oscillator.onended = () => context.close();
}

function attack() {
  state.words += 1;
  state.combo += 1;
  state.longestCombo = Math.max(state.combo, state.longestCombo);
  const multiplier = 1 + Math.floor(state.combo / 3) * 0.25;
  const damage = Math.round((state.difficulty === "hard" ? 17 : state.difficulty === "medium" ? 14 : 12) * multiplier);
  const modeReward = (state.mode === "boss" ? 1.5 : state.mode === "training" ? 0.75 : 1)
    * (state.story.encounter?.scoreMultiplier || 1);
  state.monsterHealth = Math.max(0, state.monsterHealth - damage);
  state.score += Math.round((60 + state.word.length * 10) * multiplier * modeReward);
  state.wordSeconds.push((performance.now() - state.wordStartedAt) / 1000);
  flash($("#warrior"), "attack");
  flash($("#monster"), "hit");
  announce(`-${damage}`);
  playSound("swing");
  updateMetrics();
  if (state.combo && state.combo % 5 === 0) announce(`${state.combo} HIT COMBO!`);
  if (state.monsterHealth <= 0) {
    finishGame("victory");
    return;
  }
  nextWord();
  updateMetrics();
}

function takeDamage(amount, message = "") {
  if (state.mode === "training") return;
  state.health = Math.max(0, state.health - amount);
  flash($("#monster"), "attack");
  flash($("#warrior"), "hit");
  announce(message || `-${amount} HP`);
  playSound("hit");
  updateMetrics();
  if (state.health <= 0) finishGame("defeat");
}

function updateTimer() {
  if (!state.active || state.paused || state.finished) return;
  state.timer = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
  updateMetrics();
  if (state.timer > 0) return;
  if (state.mode === "training") {
    finishGame("training");
    return;
  }
  takeDamage(MODES[state.mode].damage, `TIME! -${MODES[state.mode].damage} HP`);
  if (state.active && !state.finished) {
    state.phase += 1;
    $("#arena-round").textContent = `ROUND ${String(state.phase).padStart(2, "0")}`;
    announce(`ROUND ${state.phase}`);
    state.timer = 30;
    state.deadline = Date.now() + 30000;
    updateMetrics();
  }
}

async function startGame(mode, encounter = null, newSaga = false) {
  state.mode = MODES[mode] ? mode : "normal";
  if (newSaga || !state.story.started) {
    state.story = {
      chapter: 1, health: 100, started: true, mode: state.mode,
      outcome: "victory", encounter: null, routeLocked: false
    };
  }
  if (encounter) {
    state.story.encounter = encounter;
    state.story.mode = state.mode;
    state.story.health = Math.min(100, state.story.health + encounter.heal);
  }
  state.active = false;
  state.paused = false;
  state.finished = false;
  state.phase = 1;
  state.pausedDuration = 0;
  state.pauseStartedAt = 0;
  state.health = state.story.health;
  state.monsterMaxHealth = Math.round(
    MODES[state.mode].monsterHp * (state.story.encounter?.monsterScale || 1)
  );
  state.monsterHealth = state.monsterMaxHealth;
  state.score = 0;
  state.combo = 0;
  state.longestCombo = 0;
  state.correct = 0;
  state.errors = 0;
  state.words = 0;
  state.wordSeconds = [];
  state.mistakeLetters = {};
  state.startTime = 0;
  $("#arena-mode").textContent = state.story.encounter
    ? state.story.encounter.region : MODES[state.mode].title;
  $("#arena-round").textContent = `CHAPTER ${String(state.story.chapter).padStart(2, "0")}`;
  const monsterName = state.story.encounter?.monster || MODES[state.mode].monster;
  $("#monster-name").textContent = monsterName;
  $("#monster-caption").textContent = monsterName;
  const battlefield = $("#battlefield");
  battlefield.classList.remove("route-grove", "route-ember", "route-crown");
  if (state.story.encounter) battlefield.classList.add(`route-${state.story.encounter.theme}`);
  $("#pause-overlay").classList.add("hidden");
  $("#pause-button").textContent = "Ⅱ Pause";
  $("#battle-input").disabled = false;
  $("#battle-input").readOnly = false;
  $("#battle-input").value = "";
  $("#arena-ai-note").innerHTML = "<span>✳</span> Your AI coach is calibrating this challenge…";
  navigate("arena");
  await recommendDifficulty();
  if (!document.querySelector('[data-page="arena"]').classList.contains("active")) return;
  if (state.story.encounter) {
    const levels = ["easy", "medium", "hard"];
    const currentIndex = levels.indexOf(state.difficulty);
    state.difficulty = levels[Math.max(0, Math.min(
      levels.length - 1, currentIndex + state.story.encounter.difficultyShift
    ))];
  }
  const modeConfig = MODES[state.mode];
  state.timer = modeConfig.duration;
  state.deadline = Date.now() + state.timer * 1000;
  state.startTime = Date.now();
  state.pausedDuration = 0;
  state.active = true;
  nextWord();
  updateMetrics();
  state.interval = window.setInterval(updateTimer, 200);
  $("#battle-input").focus();
  if (state.sound) playMusic();
}

let musicTimer = null;
function playMusic() {
  if (musicTimer) return;
  const playNote = () => {
    if (!state.sound || !state.active || state.paused) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = [110, 164.81, 220][Math.floor(Math.random() * 3)];
    gain.gain.setValueAtTime(0.012, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 1.3);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 1.3);
    oscillator.onended = () => context.close();
  };
  playNote();
  musicTimer = window.setInterval(playNote, 1450);
}

function stopMusic() {
  window.clearInterval(musicTimer);
  musicTimer = null;
}

function pauseGame() {
  if (!state.active || state.paused || state.finished) return;
  state.timer = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
  state.paused = true;
  state.pauseStartedAt = Date.now();
  window.clearInterval(state.interval);
  state.interval = null;
  $("#pause-overlay").classList.remove("hidden");
  $("#pause-button").textContent = "▶ Resume";
  $("#battle-input").blur();
  stopMusic();
}

function resumeGame() {
  if (!state.active || !state.paused) return;
  state.paused = false;
  state.deadline = Date.now() + state.timer * 1000;
  $("#pause-overlay").classList.add("hidden");
  $("#pause-button").textContent = "Ⅱ Pause";
  state.interval = window.setInterval(updateTimer, 200);
  $("#battle-input").focus();
  if (state.sound) playMusic();
}

function renderResults(outcome, result, analysis) {
  const screen = $('[data-page="results"]');
  screen.classList.toggle("result-loss", outcome === "defeat");
  screen.classList.toggle("result-training", outcome === "training");
  $("#result-kicker").textContent = outcome === "victory" ? "MONSTER DEFEATED" : outcome === "defeat" ? "GAME OVER" : "TRAINING COMPLETE";
  $("#result-title").innerHTML = outcome === "victory"
    ? "Victory is <span>yours.</span>"
    : outcome === "defeat" ? "Fallen in <span>battle.</span>" : "Practice makes <span>power.</span>";
  $("#result-subtitle").textContent = outcome === "victory"
    ? "You turned every word into a winning strike."
    : outcome === "defeat" ? "Every battle teaches you something new. Ready to sharpen your skills?"
      : "Solid practice. Your next real battle will be even stronger.";
  $("#result-score").textContent = state.score.toLocaleString();
  $("#continue-story").textContent = outcome === "victory"
    ? "Choose your next path" : "Find another path";
  $("#result-wpm").textContent = String(result.wpm);
  $("#result-accuracy").textContent = `${result.accuracy}%`;
  $("#result-words").textContent = String(state.words);
  $("#result-combo").textContent = `${state.longestCombo}×`;
  $("#result-recommendation").textContent = analysis
    ? `${analysis.recommendation} Predicted skill: ${analysis.skill_level} (${Math.round(analysis.confidence * 100)}% model confidence). Next recommended level: ${analysis.difficulty}.`
    : "Your local battle is complete, but the AI analysis service couldn't be reached.";
  const targets = $("#result-target-letters");
  targets.replaceChildren();
  (analysis?.target_letters || []).forEach((letter) => {
    const chip = document.createElement("span");
    chip.textContent = letter.toUpperCase();
    targets.append(chip);
  });
}

async function finishGame(outcome) {
  if (state.finished) return;
  state.finished = true;
  state.active = false;
  state.paused = false;
  window.clearInterval(state.interval);
  state.interval = null;
  stopMusic();
  $("#battle-input").disabled = true;
  $("#battle-input").blur();
  const result = metrics();
  state.story.health = state.health;
  state.story.outcome = outcome;
  state.story.mode = state.mode;
  const payload = {
    player_id: state.playerId, mode: state.mode, difficulty: state.difficulty,
    duration_seconds: Math.max(1, Math.min(3600, Math.round(result.elapsed))),
    wpm: result.wpm, accuracy: result.accuracy, errors: state.errors,
    correct_keystrokes: state.correct, avg_word_seconds: Number(result.avgWord.toFixed(3)),
    score: state.score, longest_combo: state.longestCombo,
    mistyped_letters: state.mistakeLetters, previous_wpm: state.previousWpm
  };
  let analysis = state.recommendation;
  try {
    const saved = await api("/api/sessions", { method: "POST", body: JSON.stringify(payload) });
    analysis = saved.analysis;
    state.recommendation = analysis;
    state.previousWpm = result.wpm;
    state.previousRound = {
      wpm: result.wpm,
      accuracy: result.accuracy,
      error_rate: state.errors + state.correct
        ? state.errors / (state.errors + state.correct) * 100 : 0,
      avg_word_seconds: result.avgWord || 2.5
    };
    try {
      localStorage.setItem("keyflow-battle-last-wpm", String(result.wpm));
    } catch (error) {
      console.warn("Could not save previous typing speed.", error);
    }
  } catch (error) {
    console.error("Could not save battle results.", error);
    showToast(`Battle complete. ${error.message}`);
  }
  renderResults(outcome, result, analysis);
  navigate("results");
  if (state.sound) playSound(outcome === "defeat" ? "hit" : "swing");
}

$("#battle-input").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    if (state.paused) resumeGame();
    else pauseGame();
    return;
  }
  if (!state.active || state.paused || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "Backspace") {
    event.preventDefault();
    state.typed = state.typed.slice(0, -1);
    event.currentTarget.value = state.typed;
    renderWord();
    return;
  }
  if (event.key.length !== 1) return;
  event.preventDefault();
  const expected = state.word[state.typed.length];
  if (event.key.toLowerCase() === expected.toLowerCase()) {
    state.typed += expected;
    state.correct += 1;
    event.currentTarget.value = state.typed;
    renderWord();
    if (state.typed.length === state.word.length) attack();
    return;
  }
  state.errors += 1;
  state.combo = 0;
  const weakLetter = expected.toLowerCase();
  if (/[a-z]/.test(weakLetter)) state.mistakeLetters[weakLetter] = (state.mistakeLetters[weakLetter] || 0) + 1;
  flash($("#battle-word"), "shake");
  if (state.mode !== "training" && state.errors % 4 === 0) {
    takeDamage(MODES[state.mode].damage === 12 ? 10 : 7, "BLOCKED!");
  }
  updateMetrics();
  renderWord();
});

$("#pause-button").addEventListener("click", () => state.paused ? resumeGame() : pauseGame());
$("#resume-button").addEventListener("click", resumeGame);
$("#continue-story").addEventListener("click", showStory);
$("#story-continue").addEventListener("click", chooseStoryPath);
$("#story-choice").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    chooseStoryPath();
  }
});
document.querySelectorAll("[data-story-fill]").forEach((button) => {
  button.addEventListener("click", () => {
    $("#story-choice").value = button.dataset.storyFill;
    $("#story-choice").focus();
  });
});
$("#new-saga").addEventListener("click", () => {
  state.story.started = false;
  navigate("modes");
});
$("#new-battle").addEventListener("click", () => {
  state.story.started = false;
  navigate("modes");
});
document.querySelectorAll("[data-start-mode]").forEach((button) => {
  button.addEventListener("click", () => startGame(button.dataset.startMode, null, true));
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.active && !event.target.matches("#battle-input")) pauseGame();
});

function setSound(enabled) {
  state.sound = enabled;
  $("#sound-toggle").setAttribute("aria-pressed", String(enabled));
  $("#settings-sound").checked = enabled;
  if (!enabled) stopMusic();
  else if (state.active && !state.paused) playMusic();
}
$("#sound-toggle").addEventListener("click", () => {
  setSound(!state.sound);
  showToast(state.sound ? "Battle audio enabled." : "Battle audio muted.");
});
$("#settings-sound").addEventListener("change", (event) => setSound(event.target.checked));

async function loadStats() {
  let sessions;
  try {
    const result = await api(`/api/stats/${encodeURIComponent(state.playerId)}`);
    sessions = result.sessions;
  } catch (error) {
    showToast(error.message);
    return;
  }
  const rows = $("#history-rows");
  rows.replaceChildren();
  if (!sessions.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="6" class="empty-table">No battles yet. Your story starts with one.</td>';
    rows.append(row);
  } else {
    sessions.slice().reverse().forEach((session) => {
      const row = document.createElement("tr");
      const date = new Date(`${session.created_at.replace(" ", "T")}Z`);
      const values = [
        Number.isNaN(date.valueOf()) ? session.created_at : date.toLocaleDateString(),
        session.mode, `${Math.round(session.wpm)} WPM`, `${Math.round(session.accuracy)}%`,
        Number(session.score).toLocaleString(), session.skill_level
      ];
      values.forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      });
      rows.append(row);
    });
  }
  const count = sessions.length;
  const bestWpm = count ? Math.max(...sessions.map((session) => session.wpm)) : 0;
  const avgAccuracy = count
    ? Math.round(sessions.reduce((sum, session) => sum + session.accuracy, 0) / count) : 0;
  $("#home-sessions").textContent = String(count);
  $("#total-sessions").textContent = String(count);
  $("#stats-best-wpm").textContent = String(Math.round(bestWpm));
  $("#stats-average-accuracy").textContent = String(avgAccuracy);
  $("#stats-skill").textContent = sessions.at(-1)?.skill_level || "—";
  renderChart(sessions.slice(-12));
}

function renderChart(sessions) {
  if (!window.Chart) {
    $("#chart-fallback").textContent = "Chart.js could not load. Start the app with an internet connection to view the chart.";
    $("#chart-fallback").classList.remove("hidden");
    return;
  }
  $("#chart-fallback").classList.toggle("hidden", sessions.length > 0);
  if (state.chart) state.chart.destroy();
  state.chart = new Chart($("#progress-chart"), {
    type: "line",
    data: {
      labels: sessions.map((_, index) => `Battle ${index + 1}`),
      datasets: [
        { label: "WPM", data: sessions.map((session) => Number(session.wpm.toFixed(1))), borderColor: "#e3b96f", backgroundColor: "rgba(227,185,111,.12)", yAxisID: "y", tension: .35, fill: true, pointRadius: 3 },
        { label: "Accuracy", data: sessions.map((session) => Number(session.accuracy.toFixed(1))), borderColor: "#9b82cb", backgroundColor: "rgba(155,130,203,.06)", yAxisID: "y1", tension: .35, fill: false, pointRadius: 3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#26232e", titleColor: "#eee5d2", bodyColor: "#c8c0cf", borderColor: "#514858", borderWidth: 1 } },
      scales: {
        x: { grid: { color: "rgba(255,255,255,.045)" }, ticks: { color: "#888290", font: { size: 9 } } },
        y: { beginAtZero: true, grid: { color: "rgba(255,255,255,.055)" }, ticks: { color: "#a68c61", font: { size: 9 } } },
        y1: { beginAtZero: true, max: 100, position: "right", grid: { drawOnChartArea: false }, ticks: { color: "#9b82cb", font: { size: 9 } } }
      }
    }
  });
}

async function loadPractice() {
  try {
    const result = await api(`/api/practice/${encodeURIComponent(state.playerId)}`);
    renderPractice(result);
  } catch (error) {
    console.warn("Personalized practice is unavailable.", error);
    renderPractice({
      ...BUILTIN_PRACTICE,
      message: `Flask is offline, so personalized drills are unavailable. ${BUILTIN_PRACTICE.message}`
    });
  }
}

function renderPractice(result) {
  $("#practice-message").textContent = result.message;
  const letters = $("#practice-targets");
  letters.replaceChildren();
  result.target_letters.forEach((letter) => {
    const chip = document.createElement("span");
    chip.textContent = letter;
    letters.append(chip);
  });
  const words = $("#practice-words");
  words.replaceChildren();
  result.words.forEach((word) => {
    const chip = document.createElement("span");
    chip.textContent = word;
    words.append(chip);
  });
  state.practiceWords = result.words;
  $("#practice-feedback").textContent = "";
  $("#practice-live").classList.add("hidden");
}

let practiceIndex = 0;
let currentPracticeWord = "";
$("#start-practice").addEventListener("click", () => {
  if (!state.practiceWords.length) return;
  currentPracticeWord = state.practiceWords[practiceIndex % state.practiceWords.length];
  practiceIndex += 1;
  $("#practice-word").textContent = currentPracticeWord;
  $("#practice-live").classList.remove("hidden");
  $("#practice-input").value = "";
  $("#practice-input").focus();
});
$("#practice-input").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !currentPracticeWord) return;
  event.preventDefault();
  const correct = event.currentTarget.value.trim().toLowerCase() === currentPracticeWord.toLowerCase();
  $("#practice-feedback").textContent = correct
    ? `Correct! "${currentPracticeWord}" — a clean, confident strike.`
    : `Keep practicing "${currentPracticeWord}". Accuracy grows one keystroke at a time.`;
  event.currentTarget.value = "";
  currentPracticeWord = "";
});

state.playerId = loadPlayerId();
try {
  state.previousWpm = Number(localStorage.getItem("keyflow-battle-last-wpm")) || 0;
} catch (error) {
  console.warn("Could not read the previous typing speed.", error);
}
$("#settings-sound").checked = state.sound;
api("/api/health").catch((error) => {
  console.error(error);
  showToast(error.message);
});
loadStats().catch((error) => console.error("Couldn't load the battle summary.", error));
