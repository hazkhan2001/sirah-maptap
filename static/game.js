/*
  Sirah MapTap - browser side.

  Flow:
    1. GET /api/today      -> today's 3 prompts (names only, no coordinates)
    2. user taps map       -> we drop a temporary pin at the tap
    3. user hits Confirm   -> POST /api/guess {lat, lng}
    4. after 3rd confirm   -> server returns the reveal, we draw it
*/

// ---------- map setup ----------

// Esri World Imagery: real satellite tiles, free, no key. Attribution is required.
const satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 17,
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  }
);

// Free panning: no maxBounds, and minZoom low enough to see the whole world.
// worldCopyJump keeps the map sane if you pan past the date line.
const map = L.map("map", {
  center: [23.5, 39.5],
  zoom: 6,
  minZoom: 2,
  maxZoom: 17,
  worldCopyJump: true,
  layers: [satellite],
  zoomControl: false,
});
L.control.zoom({ position: "bottomright" }).addTo(map);

// A "back to the Hijaz" control, since with free panning it's now possible
// to wander off and lose the region entirely.
const HIJAZ_VIEW = { center: [23.5, 39.5], zoom: 6 };
const RecenterControl = L.Control.extend({
  options: { position: "bottomright" },
  onAdd() {
    const btn = L.DomUtil.create("button", "recenter-btn");
    btn.type = "button";
    btn.textContent = "Recenter";
    btn.title = "Return to the Hijaz";
    // Stop clicks from falling through to the map (which would drop a guess pin).
    L.DomEvent.disableClickPropagation(btn);
    L.DomEvent.on(btn, "click", () => map.setView(HIJAZ_VIEW.center, HIJAZ_VIEW.zoom));
    return btn;
  },
});
map.addControl(new RecenterControl());

// ---------- DOM handles ----------

const el = {
  roundLabel: document.getElementById("round-label"),
  prompt: document.getElementById("prompt"),
  hint: document.getElementById("hint"),
  confirm: document.getElementById("confirm"),
  panel: document.getElementById("panel"),
  reveal: document.getElementById("reveal"),
  revealDay: document.getElementById("reveal-day"),
  dailyScore: document.getElementById("daily-score"),
  results: document.getElementById("results"),
  devReset: document.getElementById("dev-reset"),
  backToMap: document.getElementById("back-to-map"),
  mobileBar: document.getElementById("mobile-bar"),
  mobileScore: document.getElementById("mobile-score"),
};

// One source of truth for "are we on a phone?", matching the CSS breakpoint.
// matchMedia is live — it re-evaluates if the window is resized or rotated.
const phoneQuery = window.matchMedia("(max-width: 640px)");
const isPhone = () => phoneQuery.matches;

// ---------- game state (browser side only; the server is the authority) ----------

let prompts = [];        // [{round, id, name}, ...]
let currentRound = 0;    // 0-based index into prompts
let pendingGuess = null; // L.LatLng of the tap not yet confirmed
let pendingMarker = null;
let regionsGeoJSON = null;    // real province boundaries, or null if not downloaded yet
let regionLayers = [];        // the three dim background outlines
let emphasisLayer = null;     // the one bright outline for the round in focus

// Two visually distinct markers. iconAnchor centers the icon on the actual
// coordinate (by default Leaflet puts the icon's top-left corner there).
const guessIcon = L.divIcon({ className: "pin-guess", iconSize: [18, 18], iconAnchor: [9, 9] });
const answerIcon = L.divIcon({ className: "pin-answer", iconSize: [22, 22], iconAnchor: [11, 11] });

// ---------- helpers ----------

async function api(path, options = {}) {
  // Relative URL on purpose: works on localhost now and on any host later.
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function showRound(index) {
  const p = prompts[index];
  el.roundLabel.textContent = `Round ${p.round} of ${prompts.length}`;
  el.prompt.textContent = p.name;
  el.hint.textContent = "Tap the map to place your guess.";
  el.confirm.disabled = true;
  clearPending();
}

function clearPending() {
  if (pendingMarker) map.removeLayer(pendingMarker);
  pendingMarker = null;
  pendingGuess = null;
}

// ---------- event handlers ----------

map.on("click", (e) => {
  if (currentRound >= prompts.length) return;   // game finished, ignore taps
  pendingGuess = e.latlng;

  if (pendingMarker) {
    pendingMarker.setLatLng(e.latlng);          // move the existing pin
  } else {
    pendingMarker = L.marker(e.latlng, { icon: guessIcon }).addTo(map);
  }
  el.hint.textContent = "Tap again to move it, or confirm.";
  el.confirm.disabled = false;
});

el.confirm.addEventListener("click", async () => {
  if (!pendingGuess) return;
  el.confirm.disabled = true;

  try {
    const data = await api("/api/guess", {
      method: "POST",
      body: JSON.stringify({ lat: pendingGuess.lat, lng: pendingGuess.lng }),
    });

    clearPending();
    currentRound += 1;

    if (data.complete) {
      showReveal(data.reveal);
    } else {
      showRound(currentRound);
    }
  } catch (err) {
    el.hint.textContent = err.message;
    el.confirm.disabled = false;
  }
});

el.backToMap.addEventListener("click", closeDetail);

el.devReset.addEventListener("click", async () => {
  await api("/api/reset", { method: "POST" });
  location.reload();
});

// ---------- reveal ----------

// Fetch the real province boundaries once, if the file has been downloaded
// (see README). If not, regionsGeoJSON stays null and we just skip outlines
// everywhere below — nothing else breaks.
async function loadRegions() {
  try {
    const data = await api("/api/regions");
    regionsGeoJSON = data.geojson;
  } catch {
    regionsGeoJSON = null;
  }
}

// Given a [lat, lng] pair, find which real province polygon contains it.
// turf.booleanPointInPolygon does the actual geometry test; we just loop
// over every province feature and ask "is this point inside you?"
function findRegion(lat, lng) {
  if (!regionsGeoJSON) return null;
  const point = turf.point([lng, lat]); // turf wants [lng, lat], the opposite of Leaflet
  return regionsGeoJSON.features.find((feature) =>
    turf.booleanPointInPolygon(point, feature)
  ) || null;
}

// Draw one dim background province outline (used for all three rounds up front).
function drawRegionOutline(feature) {
  const layer = L.geoJSON(feature, {
    style: { color: "#c8a85a", weight: 1, opacity: 0.35, fillOpacity: 0.02 },
  }).addTo(map);
  regionLayers.push(layer);
}

// Brighten one province's outline on top of the dim ones, replacing
// whichever was previously emphasized.
function emphasizeRegion(feature) {
  if (emphasisLayer) map.removeLayer(emphasisLayer);
  emphasisLayer = L.geoJSON(feature, {
    style: {
      color: "#ffe9b3",   // brighter than the dim gold, reads clearly over any terrain
      weight: 5,
      opacity: 1,
      fillColor: "#c8a85a",
      fillOpacity: 0.28,
      dashArray: "10 6",  // dashed reads as "boundary line" even at a glance
    },
  }).addTo(map);
  return emphasisLayer;
}

function showReveal(reveal) {
  el.panel.hidden = true;
  document.body.classList.add("is-revealed"); // swaps the reticle cursor for a grab hand
  el.revealDay.textContent = reveal.day;
  el.dailyScore.textContent = reveal.daily_score;
  el.results.innerHTML = "";

  const allPoints = [];
  const roundData = []; // keeps guess/answer/region per round for the click handlers below

  reveal.results.forEach((r) => {
    const guess = [r.guess.lat, r.guess.lng];
    const answer = [r.answer.lat, r.answer.lng];
    allPoints.push(guess, answer);

    const region = findRegion(r.answer.lat, r.answer.lng);
    if (region) drawRegionOutline(region); // dim outline, drawn for all three rounds up front

    // Popups (not just tooltips) carry the write-up, so clicking a pin
    // itself works even without using the side panel.
    const popupHtml = `<strong>${r.name}</strong><br>${r.era}<br>${r.distance_km} km away &middot; ${r.score} pts`;

    // The answer sits above the guess when they overlap (zIndexOffset), and
    // each carries a permanent label so you never have to guess which is which.
    const guessMarker = L.marker(guess, { icon: guessIcon })
      .addTo(map)
      .bindTooltip("Your guess", {
        permanent: true,
        direction: "bottom",
        offset: [0, 13],
        className: "pin-label is-guess",
      });

    const answerMarker = L.marker(answer, { icon: answerIcon, zIndexOffset: 1000 })
      .addTo(map)
      .bindTooltip(r.name, {
        permanent: true,
        direction: "bottom",
        offset: [0, 15],
        className: "pin-label is-answer",
      });

    // On a phone a small popup is useless, so tapping a pin opens the full
    // write-up instead. On desktop the popup is the right lightweight touch.
    if (isPhone()) {
      const open = () => openDetail(r.round);
      guessMarker.on("click", open);
      answerMarker.on("click", open);
    } else {
      guessMarker.bindPopup(popupHtml);
      answerMarker.bindPopup(popupHtml);
    }

    L.polyline([guess, answer], { color: "#b8543f", weight: 2, dashArray: "6 6" })
      .addTo(map)
      .bindTooltip(`${r.distance_km} km`, {
        permanent: true,
        direction: "center",
        className: "distance-label",
      });

    roundData.push({ guess, answer, region, answerMarker });

    // Build the info section. textContent (not innerHTML) for data fields
    // so nothing in the JSON can ever be interpreted as HTML.
    const sec = document.createElement("section");
    sec.className = "result";
    sec.dataset.round = r.round;   // lets openDetail() find this one section later
    sec.innerHTML = `
      <div class="result-top">
        <h3 class="result-name"></h3>
        <span class="result-score"></span>
      </div>
      <p class="result-meta"></p>
      <figure class="result-figure" hidden>
        <img class="result-img" alt="" loading="lazy">
        <figcaption class="result-caption"></figcaption>
      </figure>
      <p class="result-desc"></p>
      <p class="result-source"></p>
      <a class="result-link" target="_blank" rel="noopener">Read more on Wikipedia</a>
    `;
    sec.querySelector(".result-name").textContent = `Round ${r.round}: ${r.name}`;
    sec.querySelector(".result-score").textContent = r.score;
    sec.querySelector(".result-meta").textContent = `${r.era}. You were ${r.distance_km} km away.`;
    sec.querySelector(".result-desc").textContent = r.description;
    sec.querySelector(".result-source").textContent = `Sources: ${r.source_citation}`;
    sec.querySelector(".result-link").href = r.wiki_link;

    // Photo, only if fetch_images.py has been run and found one.
    if (r.image) {
      const figure = sec.querySelector(".result-figure");
      const img = sec.querySelector(".result-img");
      img.src = r.image;
      img.alt = r.name;
      // If the image 404s or is blocked, hide the whole figure rather than
      // leaving a broken-image icon sitting in the card.
      img.addEventListener("error", () => { figure.hidden = true; });
      sec.querySelector(".result-caption").textContent =
        [r.image_credit, r.image_license].filter(Boolean).join(" · ");
      figure.hidden = false;
    }

    // Clicking a result centers the map on that pair, opens the answer's
    // popup, and brightens that round's province outline against the rest.
    sec.addEventListener("click", (evt) => {
      if (evt.target.tagName === "A") return;
      if (isPhone()) return;   // on phones the section IS the detail view already
      focusRound(roundData[r.round - 1]);
    });

    el.results.appendChild(sec);
  });

  // Zoom out so every pin is visible at once, to start.
  map.fitBounds(L.latLngBounds(allPoints), { padding: [80, 80] });

  if (isPhone()) {
    // Phones start on the MAP, not the write-ups: you should see where your
    // guesses landed before reading anything. The drawer opens only on tap.
    el.reveal.hidden = true;
    el.mobileScore.textContent = reveal.daily_score;
    el.mobileBar.hidden = false;
  } else {
    el.reveal.hidden = false;
  }
}

// ---------- phone detail view ----------

function openDetail(round) {
  el.mobileBar.hidden = true;
  el.reveal.hidden = false;
  el.reveal.classList.add("is-single");   // CSS hides every section but the open one

  el.results.querySelectorAll(".result").forEach((sec) => {
    sec.classList.toggle("is-open", Number(sec.dataset.round) === round);
  });

  el.reveal.scrollTop = 0;
}

function closeDetail() {
  el.reveal.hidden = true;
  el.reveal.classList.remove("is-single");
  el.mobileBar.hidden = false;
}

function focusRound({ guess, answer, answerMarker, region }) {
  // Hide the three dim background outlines while one round is in focus —
  // otherwise they clutter the view around the outline that actually matters.
  regionLayers.forEach((layer) => map.removeLayer(layer));

  const bounds = L.latLngBounds([guess, answer]);
  if (region) {
    const outlineForBounds = emphasizeRegion(region);
    bounds.extend(outlineForBounds.getBounds());
  }
  map.fitBounds(bounds, { padding: [40, 40] });
  answerMarker.openPopup();
}

// ---------- boot ----------

async function start() {
  await loadRegions(); // safe to skip on failure; findRegion() just returns null everywhere
  try {
    const today = await api("/api/today");
    prompts = today.prompts;
    currentRound = today.guesses_made;

    if (today.complete) {
      const reveal = await api("/api/reveal");
      showReveal(reveal);
    } else {
      showRound(currentRound);
    }
  } catch (err) {
    el.prompt.textContent = "Could not load today's game.";
    el.hint.textContent = err.message;
  }
}

start();