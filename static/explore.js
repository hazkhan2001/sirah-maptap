/*
  Sirah MapTap - Explore mode.

  A reference map of every location in the gazetteer (all 36, including
  Mecca, Medina, Jeddah and al-Aqsa, which never appear as daily rounds
  because they're permanent map labels instead - see landmarks.js).

  This is NOT the daily game: there's no guessing, no scoring, no session.
  /api/locations intentionally returns real coordinates up front, which
  /api/today never does - the "answers stay server-side" rule protects the
  guessing game specifically, and showing everything is the entire point
  of this page. Good for studying before playing, or for a classroom
  walkthrough of the whole sirah timeline at once.
*/

const satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 17,
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  }
);

const map = L.map("map", {
  center: [23.5, 39.5],
  zoom: 5,
  minZoom: 2,
  maxZoom: 17,
  worldCopyJump: true,
  layers: [satellite],
  zoomControl: false,
});
L.control.zoom({ position: "bottomright" }).addTo(map);

// Same reference labels as the daily game, so Explore reads as the same
// world rather than a different app.
addReferenceLandmarks(map);

const el = {
  detail: document.getElementById("explore-detail"),
  body: document.getElementById("explore-body"),
  close: document.getElementById("explore-close"),
};

// The map hints at the same region split the write-ups and the scoring
// cutoffs use: gold in the Hijaz, clay for "beyond" (the Levant and the
// rest of Arabia), lapis for "far" (Egypt, Iraq, Persia and beyond).
//
// A lookup rather than a ternary chain, so adding a fourth tier later is a
// one-line change here and a one-line change in style.css, with no risk of
// an unreachable branch. An unknown region falls through to plain gold,
// matching how app.py defaults an unknown region to the Hijaz cutoff.
const REGION_PIN_CLASS = {
  beyond: "pin-answer explore-pin--beyond",
  far: "pin-answer explore-pin--far",
};

function iconFor(loc) {
  return L.divIcon({
    className: REGION_PIN_CLASS[loc.region] || "pin-answer",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

// Reuses the .result-* markup shape from the daily game's reveal drawer,
// so a write-up looks identical whether you got here by guessing
// correctly or by browsing.
function openLocation(loc) {
  el.body.innerHTML = `
    <div class="result-top">
      <h3 class="result-name"></h3>
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
  // textContent, not innerHTML, for every data field - same rule the daily
  // game follows, so nothing in events.json can ever render as HTML.
  el.body.querySelector(".result-name").textContent = loc.name;
  el.body.querySelector(".result-meta").textContent = loc.era;
  el.body.querySelector(".result-desc").textContent = loc.description;
  el.body.querySelector(".result-source").textContent = `Sources: ${loc.source_citation}`;
  el.body.querySelector(".result-link").href = loc.wiki_link;

  if (loc.image) {
    const figure = el.body.querySelector(".result-figure");
    const img = el.body.querySelector(".result-img");
    img.src = loc.image;
    img.alt = loc.name;
    img.addEventListener("error", () => { figure.hidden = true; });
    el.body.querySelector(".result-caption").textContent =
      [loc.image_credit, loc.image_license].filter(Boolean).join(" · ");
    figure.hidden = false;
  }

  el.detail.hidden = false;
}

el.close.addEventListener("click", () => { el.detail.hidden = true; });

async function start() {
  const res = await fetch("/api/locations");
  const data = await res.json();

  data.locations.forEach((loc) => {
    L.marker([loc.lat, loc.lng], { icon: iconFor(loc) })
      .addTo(map)
      .bindTooltip(loc.name, { direction: "top" })
      .on("click", () => openLocation(loc));
  });
}

start();
