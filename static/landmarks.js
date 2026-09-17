/*
  Sirah MapTap - reference landmarks.

  Permanent, non-interactive city labels drawn under the game pins so the
  player has something to reason from. Satellite imagery of the Hijaz is
  visually undifferentiated, so without these the game tests coordinate
  memory rather than historical knowledge: someone can know perfectly well
  that Badr sits on the coastal road southwest of Medina and still have no
  way to turn that into a tap.

  These coordinates are hardcoded on purpose. They are modern cities, public
  knowledge, and nothing here comes from events.json - so this does NOT
  violate the "answers stay server-side" rule. Nothing in this file reveals
  where any round's answer is.

  Usage, after the Leaflet map exists:

      addReferenceLandmarks(map);

  Load it BEFORE game.js in index.html:

      <script src="{{ url_for('static', filename='landmarks.js') }}"></script>
      <script src="{{ url_for('static', filename='game.js') }}"></script>
*/

// Mecca, Medina, Jeddah and Jerusalem are reference-only: they were removed
// from the answer pool when these labels were added, because a permanently
// labelled location cannot also be a fair round. Hiding a label while its
// location is the active answer would leak more than showing it does - the
// missing label would itself give the answer away.
//
// Baghdad and Isfahan were added with the Rashidun expansion, for the same
// reason the original five exist: the Iranian plateau and the Mesopotamian
// plain are as featureless from orbit as the Hijaz is, and without an
// anchor "the Zagros passes east of the Tigris" is knowledge a player
// cannot convert into a tap. Both are deliberately MODERN cities rather
// than period sites, which keeps them out of the answer pool by
// construction - Baghdad did not exist until the 760s, and Isfahan is
// pinned at the modern centre rather than at 7th-century Jayy.
//
// Cairo was considered and left out. Egypt locates itself from orbit (the
// delta, the Nile, Sinai), and a Cairo label would sit ~4km from the
// fustat_babylon answer, turning that round into a giveaway. Revisit only
// if playtesting shows Egypt is actually hard to find.
const REFERENCE_LANDMARKS = [
  { name: "Mecca", lat: 21.4225, lng: 39.8262, minZoom: 4 },
  { name: "Medina", lat: 24.4672, lng: 39.6111, minZoom: 4 },
  { name: "Jeddah", lat: 21.4858, lng: 39.1925, minZoom: 6 },
  { name: "Jerusalem", lat: 31.7683, lng: 35.2137, minZoom: 4 },
  { name: "Damascus", lat: 33.5138, lng: 36.2765, minZoom: 4 },
  { name: "Baghdad", lat: 33.3152, lng: 44.3661, minZoom: 4 },
  { name: "Isfahan", lat: 32.6539, lng: 51.6660, minZoom: 4 },
];

/**
 * Draw the reference labels and keep them in sync with the zoom level.
 *
 * Returns the Leaflet layer group, so a caller can remove or restyle the
 * whole set later without tracking individual markers.
 */
function addReferenceLandmarks(map, options = {}) {
  // A pane is Leaflet's stacking mechanism. Putting the labels in their own
  // pane with a low z-index guarantees the answer and guess pins always draw
  // on top, no matter what order things were added to the map in. Relying on
  // insertion order instead would break the first time someone reordered a
  // call in game.js.
  const PANE = "referenceLandmarks";
  if (!map.getPane(PANE)) {
    map.createPane(PANE);
    map.getPane(PANE).style.zIndex = 450;   // below markers (600), above tiles
    // Belt and braces alongside interactive:false below. Without this, a
    // label can swallow a click, the player loses a guess to a piece of
    // scenery, and they will blame the game rather than the label.
    map.getPane(PANE).style.pointerEvents = "none";
  }

  const group = L.layerGroup([], { pane: PANE }).addTo(map);

  for (const place of REFERENCE_LANDMARKS) {
    // divIcon renders arbitrary HTML instead of an image, which is what lets
    // the dot and the text be one object that styles from CSS.
    //
    // Note textContent-style safety is not a concern here the way it is for
    // write-ups: these names are literals in this file, not data from
    // anywhere. If this list ever becomes data-driven, build the node with
    // document.createElement and .textContent instead of a template string.
    const icon = L.divIcon({
      className: "",                 // suppress Leaflet's default styling
      html: `<div class="sirah-landmark">
               <span class="sirah-landmark__dot"></span>
               <span class="sirah-landmark__name">${place.name}</span>
             </div>`,
      iconSize: [0, 0],              // let CSS size it
      iconAnchor: [0, 0],            // anchor at the dot, not the text
    });

    const marker = L.marker([place.lat, place.lng], {
      icon,
      pane: PANE,
      interactive: false,            // no click, no hover, no cursor change
      keyboard: false,               // keep it out of tab order
      zIndexOffset: -1000,
    });

    marker._minZoom = place.minZoom ?? 0;
    group.addLayer(marker);
  }

  // Zoom gating: at low zoom the labels crowd each other, at high zoom Jeddah
  // and Mecca overlap. Each landmark declares the zoom it becomes useful at.
  function applyZoomVisibility() {
    const zoom = map.getZoom();
    group.eachLayer((layer) => {
      const element = layer.getElement();
      if (element) {
        element.style.display = zoom >= layer._minZoom ? "" : "none";
      }
    });
  }

  map.on("zoomend", applyZoomVisibility);
  applyZoomVisibility();

  return group;
}
