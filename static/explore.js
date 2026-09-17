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

// "Beyond" locations (outside the Hijaz) get the clay color instead of
// gold, so the map itself hints at the region split the write-ups mention.
function iconFor(loc) {
  return L.divIcon({
    className: loc.region === "beyond" ? "pin-answer explore-pin--beyond" : "pin-answer",
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
