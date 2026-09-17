# Sirah MapTap (v1, guest mode)

A daily geography game for sirah history. Each day the player is shown 3
locations, one at a time, taps a satellite map of the Hijaz to guess where
each happened, then sees the distance, the score, a photo and a sourced
write-up for each.

71 locations are in the pool (67 selectable as daily rounds): 51 from the
sirah and 20 from the Rashidun period, Abu Bakr through Uthman. The day's 3
are seeded from the date, so every player worldwide gets the same 3 until
midnight America/New_York.

`/explore` is a separate, unscored reference map of all 71 locations, for
studying before playing or for walking a class through the whole timeline.
A local streak tracker (days played, current streak) lives in the browser
and needs no account - see Known open questions for what's still [PLANNED].

## Run it

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1     # PowerShell
pip install -r requirements.txt
python app.py
```

`Activate.ps1` is the PowerShell script; the extensionless `activate` is the
cmd.exe one and does nothing in PowerShell. On mac/linux it is
`source .venv/bin/activate`.

If `python app.py` reports `ModuleNotFoundError: No module named 'flask'`,
the environment is not active and bare `python` is resolving to system
Python. Either activate as above, or skip activation and name the
interpreter directly, which always works:

```powershell
.\.venv\Scripts\python.exe app.py
```

Open http://127.0.0.1:5000

## Fetch the optional data

Two data files are **deliberately not committed to git**: they are large,
they are re-fetchable, and they would go stale in the repo. The app runs
without either one and just hides the feature that needs it. Fetch them
once after cloning.

### 1. Location photos and license credits

Pulls each location's lead image from Wikipedia plus the photographer and
license from Wikimedia Commons, and writes them into `data/events.json`.

The same environment caveat applies: activate first, or call
`.\.venv\Scripts\python.exe` instead of `python`.

```powershell
python fetch_images.py                    # fill in anything still missing
python fetch_images.py --all              # re-fetch every location
python fetch_images.py --only mecca badr  # just these ids
```

Most Commons images are CC BY-SA and **legally require attribution**, which
is why the credit is fetched alongside the photo and displayed under it.

The script tries three strategies per location, in order: the article named
in the record's `wiki_link`; then the record's optional `image_search` hint;
then a plain search on the location name. It prints which strategy won, lists
anything resolved by fallback so you can eyeball it, and **exits non-zero if
any location still has no image**. If something fails, either point that
record's `wiki_link` at an article that has a photo, or add an
`"image_search"` field with a better search phrase and re-run.

### 2. Province boundaries

Real Saudi ADM1 boundaries from [geoBoundaries](https://www.geoboundaries.org)
(CC BY 4.0). Without this file the province outlines simply don't draw.

```
python -c "import json,urllib.request as r; m=json.load(r.urlopen('https://www.geoboundaries.org/api/current/gbOpen/SAU/ADM1/')); r.urlretrieve(m['gjDownloadURL'],'data/hijaz_provinces.geojson'); print('saved')"
```

The API returns metadata whose `gjDownloadURL` points at the actual GeoJSON,
so this fetches the metadata first and then the file it names. That
indirection is why it isn't a plain download — the underlying URL changes
between releases.

The file contains all 13 Saudi regions, not only the Hijaz ones, which is
what lets Turf.js decide province membership by point-in-polygon rather than
by matching province name strings (two sources spelling a name differently
would fail silently).

Note that locations outside Saudi Arabia get no province outline, because
these boundaries stop at the Saudi border. That is the intended graceful
degradation, not a bug.

## Share it beyond your LAN

Phones on *your* wifi can use the `http://192.168.x.x:5000` address the
server prints. Phones on *other* networks need a tunnel.

Leave the app running, then in a **second terminal**:

```powershell
cloudflared tunnel --url http://localhost:5000
```

It prints a `https://something.trycloudflare.com` address. Anyone, anywhere,
can open that while both the app and the tunnel keep running.

Start the app like this when you intend to tunnel:

```powershell
$env:SIRAH_TRUST_PROXY = "1"
$env:SIRAH_SECRET_KEY = (python -c "import secrets; print(secrets.token_hex(32))")
.\.venv\Scripts\python.exe app.py
```

- `SIRAH_TRUST_PROXY=1` makes shared links come out `https://` rather than
  `http://`. Not cosmetic: the clipboard and Web Share APIs only work in a
  secure context, so an `http` link leaves the share button dead for
  whoever opens it. Only set this when a proxy really is in front of the
  app - the headers it trusts are forgeable by any direct client.
- `SIRAH_SECRET_KEY` replaces the `dev-only-change-me` fallback. That
  fallback is in this repo, so anyone could forge a session cookie against
  a server still using it. Low stakes with no accounts, but do not put the
  known key on the public internet.

Notes:

- Quick tunnels are **ephemeral**. The URL changes every time you start
  one, and dies when you close the terminal. Fine for a class session, not
  for anything you want to link to permanently - see the hosting section.
- This exposes Flask's development server to the public internet. It is
  single-threaded and not hardened. Acceptable for a short playtest, not
  for leaving up.
- You do not need `SIRAH_PUBLIC_URL` for this. The app reads the host the
  browser actually used, so the tunnel URL ends up in shared links by
  itself.

## Working on two machines

Repo: https://github.com/hazkhan2001/sirah-maptap

The loop, every time, on both machines:

```
git pull        # BEFORE you start
...work...
git add -A
git commit -m "what you did"
git push        # BEFORE you stop
```

The failure mode is forgetting the last step, then starting fresh somewhere
else. You end up with two histories that both moved on from the same point,
and git refuses to push until you reconcile them. Set this once per machine
so reconciling replays your commits on top instead of making a merge commit:

```
git config --global pull.rebase true
```

### First time on the Mac

```bash
git clone https://github.com/hazkhan2001/sirah-maptap.git
cd sirah-maptap
python3 -m venv .venv
source .venv/bin/activate          # note: bin/, not Scripts/
pip install -r requirements.txt
```

Then fetch the province boundaries, which are gitignored (see above), and
run it:

```bash
python -c "import json,urllib.request as r; m=json.load(r.urlopen('https://www.geoboundaries.org/api/current/gbOpen/SAU/ADM1/')); r.urlretrieve(m['gjDownloadURL'],'data/hijaz_provinces.geojson'); print('saved')"
python app.py
```

### What git does NOT carry across

- **`.venv/`** — gitignored, and rightly so: it contains platform-specific
  binaries that would not run on the other OS anyway. Create a fresh one
  per machine, as above.
- **`data/hijaz_provinces.geojson`** — gitignored as re-fetchable. Without
  it the app runs fine and province outlines just do not draw, which is
  easy to mistake for a bug. Run the fetch command on each machine.

Photos *do* come across, since the URLs live in `data/events.json`, which
is committed.

### Do not sync this folder with Dropbox, iCloud or OneDrive

Cloud sync and git are both trying to manage the same files, and sync
services will happily corrupt `.git` by copying half-written objects or
resurrecting deleted ones. Git is already the sync mechanism here. Two
clones plus push and pull is the whole answer.

### Line endings

Already handled. `.gitattributes` sets `* text=auto`, so files are stored
with LF in the repo, checked out as CRLF on Windows and LF on macOS. The
"CRLF will be replaced by LF" messages on Windows are that working as
intended, not a warning you need to act on.

## Layout

```
app.py               Flask backend: daily pick, scoring, session, API
fetch_images.py      one-off script: pulls photos + license credits
data/events.json     answer key, write-ups, citations, images (server-side only)
data/hijaz_provinces.geojson   real province boundaries (fetched, not in git)
templates/index.html page shell
templates/explore.html reference map of every location (unscored)
static/game.js       Leaflet map + game flow
static/landmarks.js  permanent reference city labels
static/explore.js    Explore-mode map (shares style.css with the game)
static/style.css     styling
```

## API

```
GET  /api/today     today's 3 prompts (names only - no coordinates)
POST /api/guess     {lat, lng}; returns the reveal after the 3rd guess
GET  /api/reveal    results, once all 3 guesses are in
GET  /api/regions   province boundary GeoJSON (404 if not fetched)
POST /api/reset     dev only, clears today's guesses
GET  /explore       the unscored reference map page
GET  /api/locations every location WITH coordinates - intentionally not
                    guarded like /api/today, since showing everything is
                    the whole point of Explore, not a leak of the game
```

## Data record

```json
{
  "id": "badr",
  "name": "Badr",
  "true_lat": 23.78,
  "true_lng": 38.7906,
  "era": "17 Ramadan, 2 AH (March 624 CE)",
  "description": "...",
  "source_citation": "...",
  "wiki_link": "https://en.wikipedia.org/wiki/Battle_of_Badr",
  "coord_note": "not shown to players - confidence and what needs checking",
  "region": "hijaz",
  "image": null,
  "image_credit": null,
  "image_license": null,
  "image_search": "optional hint, only on awkward records"
}
```

`region` is `"hijaz"`, `"beyond"` or `"far"`. It drives the scoring cutoff
(see below) and the pin color on `/explore` - gold, clay and lapis
respectively. The tier widens as a location moves away from the frame of
reference a player actually has:

| region   | cutoff | covers                                              |
|----------|--------|-----------------------------------------------------|
| `hijaz`  | 100 km | the Hijaz proper                                     |
| `beyond` | 300 km | the Levant and the rest of Arabia                    |
| `far`    | 600 km | Egypt, North Africa, Iraq, Persia, Anatolia, Central Asia |

A location is never scored against a tighter cutoff than the player could
reasonably hit. `far` exists because Nahavand is ~1,500 km from Mecca and
Merv ~3,500 km; at the 300 km cutoff those would reproduce the exact
problem `beyond` was created to solve.

## Conventions worth keeping

- **Answers stay server-side.** `/api/today` deliberately sends only
  `{round, id, name}`. Coordinates never reach the browser until the reveal.
  Shipping `events.json` to the client would put the answers in DevTools.
- **Data is never rendered as HTML.** Write-ups and citations are inserted
  with `textContent`, never `innerHTML`.
- **Optional features degrade gracefully.** A missing boundary file or a
  missing photo hides that feature rather than breaking the page.
- **Fetched data is re-fetchable, not committed.** See the two commands above.

## Before hosting this publicly

- `debug=False` permanently (the Flask debugger allows remote code execution)
- a real WSGI server instead of Flask's dev server
- a freshly generated `SIRAH_SECRET_KEY` in the environment
- lock down `/api/reset`, and lock down replaying once accounts land, so a
  leaderboard score reflects the first attempt rather than the best of many

## Known open questions

- **The 100 km cutoff - resolved 2026-09-17, extended to three tiers with
  the Rashidun expansion.** Score is `100 * (1 - distance_km / cutoff)`,
  floored at 0, with the cutoff taken from the location's `region` (see the
  table above). Percentage-of-cutoff rather than a flat subtraction, so
  every score still lands in 0-100 regardless of which cutoff applied.
- **Rashidun coverage is uneven by design, and honestly so.** Of 34
  researched candidates, 20 made it in. Ajnadayn was dropped because its
  site is genuinely unknown rather than merely imprecise; the Saqifah, the
  Quran compilation, Umar's assassination and the siege of Uthman's house
  were all dropped because they happened within a few hundred metres of the
  existing `medina` pin and are not distinct rounds. The Ridda wars are
  thinly covered because most of their battles were fought at wells and
  waystations nobody has fixed on a map.
- **Clustered pins.** Seven locations sit within about 10 km of Medina and
  five within about 12 km of Mecca. At the current scoring granularity some
  of these are hard to tell apart - Jannat al-Baqi' is 0.3 km from the Medina
  pin. Related to the v2 plan for event-specific points within a location.
- **Hadith numbers need checking.** Citations were drafted from standard
  Bukhari/Muslim numbering and should be verified against physical copies
  before classroom use. Several records also carry `coord_note` values
  flagging approximate coordinates - Hudaybiyyah, al-Ji'ranah, Nakhlah,
  al-Abwa', Fadak and al-Juhfah are the least certain.
