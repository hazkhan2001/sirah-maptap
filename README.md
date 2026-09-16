# Sirah MapTap (v1, guest mode)

## Run it
```
python -m venv .venv
.venv\Scripts\activate          # Windows   (mac/linux: source .venv/bin/activate)
pip install -r requirements.txt
python app.py
```
Open http://127.0.0.1:5000

## Layout
```
app.py               Flask backend: daily pick, scoring, session, API
data/events.json     answer key + write-ups (server-side only)
templates/index.html page shell
static/game.js       Leaflet map + game flow
static/style.css     styling
```

## API
GET  /api/today   -> today's 3 prompts (names only) and progress
POST /api/guess   -> {lat, lng}; returns reveal after the 3rd guess
GET  /api/reveal  -> results, once all 3 guesses are in
POST /api/reset   -> dev only, clears today's guesses
