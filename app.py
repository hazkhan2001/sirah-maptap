"""
Sirah MapTap - Flask backend (v1, guest mode).

Responsibilities:
  1. Load the answer key (data/events.json) and keep it server-side.
  2. Pick today's 3 locations deterministically from the date.
  3. Accept the player's guesses one at a time, store them in the session.
  4. After the 3rd guess, compute distances and scores and return the reveal.

Run locally:
  python app.py
then open http://127.0.0.1:5000
"""

import json
import math
import os
import random
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from flask import Flask, jsonify, render_template, request, session

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

# Path(__file__) is this file; .parent is the folder it lives in.
# Building paths this way (instead of "data/events.json") means the app
# works no matter which folder you launch it from.
BASE_DIR = Path(__file__).resolve().parent
EVENTS_FILE = BASE_DIR / "data" / "events.json"
# Optional: real province boundaries (see README for the fetch command).
# The app works fine without this file; region outlines just won't draw.
REGIONS_FILE = BASE_DIR / "data" / "hijaz_provinces.geojson"

ROUNDS_PER_DAY = 3
GAME_TIMEZONE = ZoneInfo("America/New_York")
EARTH_RADIUS_KM = 6371.0

app = Flask(__name__)

# The secret key signs the session cookie so players can't tamper with it.
# We read it from an environment variable; the fallback is ONLY for local dev.
# Never ship the fallback value to a real server.
app.secret_key = os.environ.get("SIRAH_SECRET_KEY", "dev-only-change-me")


# --------------------------------------------------------------------------
# Answer key
# --------------------------------------------------------------------------

def load_events() -> list[dict]:
    """Read every location from the JSON file into a list of dicts."""
    with open(EVENTS_FILE, encoding="utf-8") as f:
        return json.load(f)


# Loaded once at startup. It is a small file, so keeping it in memory is fine.
EVENTS = load_events()

# A dict lets us look up an event by id in O(1) instead of scanning the list.
EVENTS_BY_ID = {event["id"]: event for event in EVENTS}


# --------------------------------------------------------------------------
# Daily rotation
# --------------------------------------------------------------------------

def today_key() -> str:
    """
    Today's date as 'YYYY-MM-DD' in New York time.

    We seed the random picker with this string, so everyone in the world
    gets the same 3 locations until midnight in New York.
    """
    return datetime.now(GAME_TIMEZONE).date().isoformat()


def daily_events(day: str) -> list[dict]:
    """
    Pick ROUNDS_PER_DAY events for the given day.

    random.Random(seed) creates a private random generator. Same seed in,
    same sequence out, forever. That is what makes the daily pick
    deterministic without us maintaining a calendar.
    """
    rng = random.Random(day)
    return rng.sample(EVENTS, ROUNDS_PER_DAY)


# --------------------------------------------------------------------------
# Geometry and scoring
# --------------------------------------------------------------------------

def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    Great-circle distance between two points on a sphere.

    Steps: convert degrees to radians, apply the haversine formula,
    scale by Earth's radius. Accurate to about 0.5% which is far
    more precision than a geography game needs.
    """
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lng2 - lng1)

    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return EARTH_RADIUS_KM * c


def score_for_distance(distance_km: float) -> int:
    """Linear scoring: 100 minus km, never below 0 (per the spec)."""
    return max(0, round(100 - distance_km))


# --------------------------------------------------------------------------
# Session helpers
# --------------------------------------------------------------------------

def get_state() -> dict:
    """
    Return today's game state from the session, resetting it if the
    stored state belongs to a previous day.
    """
    day = today_key()
    state = session.get("game")
    if not state or state.get("day") != day:
        state = {"day": day, "guesses": []}
        session["game"] = state
    return state


def save_state(state: dict) -> None:
    # Flask only re-sends the cookie when you assign to session, so we
    # assign explicitly rather than mutating the nested dict in place.
    session["game"] = state


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/today")
def api_today():
    """
    What the browser needs to start (or resume) today's game.
    Deliberately does NOT include coordinates: those stay on the server
    until the reveal.
    """
    state = get_state()
    todays = daily_events(state["day"])
    prompts = [{"round": i + 1, "id": e["id"], "name": e["name"]} for i, e in enumerate(todays)]

    return jsonify({
        "day": state["day"],
        "rounds": ROUNDS_PER_DAY,
        "prompts": prompts,
        "guesses_made": len(state["guesses"]),
        "complete": len(state["guesses"]) >= ROUNDS_PER_DAY,
    })


@app.route("/api/guess", methods=["POST"])
def api_guess():
    """
    Body: { "lat": number, "lng": number }
    Records one guess for the next unanswered round.
    Returns only an acknowledgement until the final round, then the reveal.
    """
    state = get_state()
    round_index = len(state["guesses"])

    if round_index >= ROUNDS_PER_DAY:
        return jsonify({"error": "Today's game is already complete."}), 400

    body = request.get_json(silent=True) or {}
    try:
        lat = float(body["lat"])
        lng = float(body["lng"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Send JSON with numeric 'lat' and 'lng'."}), 400

    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return jsonify({"error": "Coordinates out of range."}), 400

    state["guesses"].append({"lat": lat, "lng": lng})
    save_state(state)

    if len(state["guesses"]) < ROUNDS_PER_DAY:
        return jsonify({"recorded": round_index + 1, "complete": False})

    return jsonify({"complete": True, "reveal": build_reveal(state)})


@app.route("/api/reveal")
def api_reveal():
    """Lets a page reload after finishing still show the results."""
    state = get_state()
    if len(state["guesses"]) < ROUNDS_PER_DAY:
        return jsonify({"error": "Finish all rounds first."}), 400
    return jsonify(build_reveal(state))


def build_reveal(state: dict) -> dict:
    """Pair each guess with its answer, compute distance and score."""
    todays = daily_events(state["day"])
    results = []

    # zip walks two lists in lockstep: round 1 event with guess 1, etc.
    for i, (event, guess) in enumerate(zip(todays, state["guesses"])):
        distance = haversine_km(guess["lat"], guess["lng"], event["true_lat"], event["true_lng"])
        results.append({
            "round": i + 1,
            "name": event["name"],
            "era": event["era"],
            "description": event["description"],
            "source_citation": event["source_citation"],
            "wiki_link": event["wiki_link"],
            # .get() rather than [] — these only exist after fetch_images.py runs,
            # so the app still works on a fresh clone without them.
            "image": event.get("image"),
            "image_credit": event.get("image_credit"),
            "image_license": event.get("image_license"),
            "guess": guess,
            "answer": {"lat": event["true_lat"], "lng": event["true_lng"]},
            "distance_km": round(distance, 1),
            "score": score_for_distance(distance),
        })

    daily_score = round(sum(r["score"] for r in results) / len(results))
    return {"day": state["day"], "results": results, "daily_score": daily_score}


@app.route("/api/regions")
def api_regions():
    """
    Real province boundaries, if the file has been downloaded (see README).
    We hand the raw GeoJSON straight to the browser; Turf.js on the frontend
    figures out which province each answer point falls inside, so this
    endpoint doesn't need to know anything about our events.
    """
    if not REGIONS_FILE.exists():
        return jsonify({"available": False}), 404
    with open(REGIONS_FILE, encoding="utf-8") as f:
        return jsonify({"available": True, "geojson": json.load(f)})


@app.route("/api/reset", methods=["POST"])
def api_reset():
    """Dev convenience: clear today's guesses so you can replay while testing."""
    session.pop("game", None)
    return jsonify({"reset": True})


if __name__ == "__main__":
    # debug=True reloads on file save and shows tracebacks in the browser.
    # Turn it off before hosting publicly.
    app.run(host="0.0.0.0", port=5000, debug=False)