"""
Fetch a photograph for each location from Wikipedia, plus its license credit.

Why a script instead of hardcoded URLs: image URLs change, and every photo on
Wikimedia Commons carries a license that usually REQUIRES crediting the
photographer. Pulling both together, automatically, keeps us honest and keeps
the data current.

Three APIs are used:
  1. Wikipedia REST summary  -> the article's lead image
  2. Wikipedia search        -> a fallback when the linked article has none
  3. Commons imageinfo       -> that image's author and license

Run it from the project folder:
    python fetch_images.py                 # fill in anything still missing
    python fetch_images.py --all           # re-fetch every location
    python fetch_images.py --only mecca badr    # just these ids

It rewrites data/events.json in place, adding "image", "image_credit" and
"image_license" to each record, and prints a report of anything it could not
resolve. It never silently leaves a location without telling you.
"""

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
EVENTS_FILE = BASE_DIR / "data" / "events.json"

# Wikimedia asks every API client to identify itself. Being a good citizen of
# someone else's free service is part of using an API responsibly.
HEADERS = {"User-Agent": "SirahMapTap/1.0 (educational project; contact: you@example.com)"}


def get_json(url: str) -> dict | None:
    """Fetch a URL and parse it as JSON. Returns None on any failure."""
    request = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)
    except Exception as error:
        print(f"    request failed: {error}")
        return None


def title_from_wiki_link(wiki_link: str) -> str:
    """
    Turn 'https://en.wikipedia.org/wiki/Battle_of_Badr' into 'Battle_of_Badr'.

    rsplit("/", 1) splits from the RIGHT and at most once, so we get the last
    path segment without having to parse the whole URL.
    """
    return wiki_link.rstrip("/").rsplit("/", 1)[-1]


def lead_image(title: str) -> str | None:
    """
    The article's main photo, at original resolution.

    Returns None for a disambiguation page as well as for a missing one.
    That distinction is the bug this function used to have: asking for
    'Hegra' returns a real response, but it is a disambiguation stub
    (there is also a Hegra in Norway) and it carries no photo.
    """
    url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(title)}"
    data = get_json(url)
    if not data:
        return None
    if data.get("type") == "disambiguation":
        print(f"    '{title}' is a disambiguation page")
        return None
    # .get() with a default avoids KeyError when an article has no image.
    original = data.get("originalimage") or {}
    thumb = data.get("thumbnail") or {}
    return original.get("source") or thumb.get("source")


def search_title(query: str) -> str | None:
    """
    Ask Wikipedia's search index for the best-matching article title.

    This is the fallback when a record's wiki_link points at an article with
    no lead image (a treaty, say, or an ambiguous name). Searching by a
    human phrase like "Al-Hudaybiyah Mosque Mecca" usually lands somewhere
    that does have a photo.
    """
    params = urllib.parse.urlencode({
        "action": "query",
        "list": "search",
        "srsearch": query,
        "srlimit": 3,
        "format": "json",
    })
    data = get_json(f"https://en.wikipedia.org/w/api.php?{params}")
    if not data:
        return None
    hits = data.get("query", {}).get("search", [])
    return hits[0]["title"] if hits else None


def resolve_image(event: dict) -> tuple[str | None, str]:
    """
    Try progressively looser strategies until one yields an image.

    Returns (image_url, how_we_found_it). Keeping the provenance lets the
    report at the end tell you which records fell back to a guess, so you
    can eyeball those rather than trusting all 36 equally.
    """
    # 1. The article the record actually cites. Preferred: it is the one a
    #    human chose, and the write-up is sourced to it.
    title = title_from_wiki_link(event["wiki_link"])
    url = lead_image(title)
    if url:
        return url, "wiki_link"

    # 2. A hand-written search hint on the record, for the awkward cases.
    hint = event.get("image_search")
    if hint:
        found = search_title(hint)
        if found:
            url = lead_image(found)
            if url:
                return url, f"search hint -> {found}"

    # 3. Last resort: the location's own name.
    found = search_title(event["name"])
    if found and found != title:
        url = lead_image(found)
        if url:
            return url, f"name search -> {found}"

    return None, "not found"


def image_credit(image_url: str) -> tuple[str, str]:
    """
    Look up who made the photo and under what license.

    The filename is the last segment of the image URL, percent-decoded
    (e.g. 'Jabal_al-Nour%2C_Mecca.jpg' -> 'Jabal_al-Nour, Mecca.jpg').
    """
    filename = urllib.parse.unquote(image_url.rsplit("/", 1)[-1])
    query = urllib.parse.urlencode({
        "action": "query",
        "titles": f"File:{filename}",
        "prop": "imageinfo",
        "iiprop": "extmetadata",
        "format": "json",
    })
    data = get_json(f"https://commons.wikimedia.org/w/api.php?{query}")
    if not data:
        return ("Wikimedia Commons", "See Commons for license")

    # The response nests pages under unpredictable numeric IDs, so we take
    # whatever the first page happens to be rather than guessing a key.
    pages = data.get("query", {}).get("pages", {})
    page = next(iter(pages.values()), {})
    meta = (page.get("imageinfo") or [{}])[0].get("extmetadata", {})

    artist = meta.get("Artist", {}).get("value", "Wikimedia Commons")
    license_name = meta.get("LicenseShortName", {}).get("value", "See Commons")

    # Artist often arrives as HTML (a link tag). Strip tags crudely but safely:
    # we only ever display this as text, never as HTML.
    artist = strip_html(artist)
    return (artist, strip_html(license_name))


def strip_html(text: str) -> str:
    """Remove anything between < and >, then squash whitespace."""
    out = []
    inside_tag = False
    for char in text:
        if char == "<":
            inside_tag = True
        elif char == ">":
            inside_tag = False
        elif not inside_tag:
            out.append(char)
    return " ".join("".join(out).split())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true",
                        help="re-fetch every location, not just the ones missing an image")
    parser.add_argument("--only", nargs="+", metavar="ID",
                        help="fetch only these location ids")
    args = parser.parse_args()

    events = json.loads(EVENTS_FILE.read_text(encoding="utf-8"))

    # Decide up front which records this run touches, so the loop below
    # stays about fetching rather than about filtering.
    def wanted(event: dict) -> bool:
        if args.only:
            return event["id"] in args.only
        if args.all:
            return True
        return not event.get("image")

    targets = [e for e in events if wanted(e)]
    if not targets:
        print("Nothing to do: every location already has an image.")
        print("Use --all to re-fetch anyway.")
        return

    print(f"Fetching {len(targets)} of {len(events)} locations.\n")
    failures = []
    fallbacks = []

    for event in targets:
        print(f"{event['name']} ...")
        url, how = resolve_image(event)

        if not url:
            print("    NO IMAGE FOUND")
            event["image"] = None
            event["image_credit"] = None
            event["image_license"] = None
            failures.append(event)
            continue

        artist, license_name = image_credit(url)
        event["image"] = url
        event["image_credit"] = artist
        event["image_license"] = license_name
        print(f"    via {how}")
        print(f"    {license_name} / {artist[:60]}")
        if how != "wiki_link":
            fallbacks.append((event, how))

        # Be polite: don't hammer a free service with rapid-fire requests.
        time.sleep(0.5)

    EVENTS_FILE.write_text(
        json.dumps(events, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    # ---- report -----------------------------------------------------------
    # The old version ended with a bare count, which is how two locations sat
    # imageless without anyone noticing. Say plainly what needs a human.
    found = sum(1 for e in events if e.get("image"))
    print(f"\n{'=' * 60}")
    print(f"{found} of {len(events)} locations now have images.")

    if fallbacks:
        print(f"\n{len(fallbacks)} resolved by FALLBACK - worth eyeballing:")
        for event, how in fallbacks:
            print(f"  - {event['name']}: {how}")

    if failures:
        print(f"\n{len(failures)} STILL MISSING an image:")
        for event in failures:
            print(f"  - {event['id']}: {event['name']}")
        print("\nTo fix: find a Commons photo by hand, then either point")
        print("wiki_link at an article that has one, or add an \"image_search\"")
        print("field to that record with a better search phrase and re-run.")
        sys.exit(1)   # non-zero exit so CI or a shell && chain notices

    print("\nAll locations have images.")


if __name__ == "__main__":
    main()
