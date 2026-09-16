"""
Fetch a photograph for each location from Wikipedia, plus its license credit.

Why a script instead of hardcoded URLs: image URLs change, and every photo on
Wikimedia Commons carries a license that usually REQUIRES crediting the
photographer. Pulling both together, automatically, keeps us honest and keeps
the data current.

Two APIs are used:
  1. Wikipedia REST summary  -> the article's lead image
  2. Commons imageinfo       -> that image's author and license

Run it from the project folder:
    python fetch_images.py

It rewrites data/events.json in place, adding "image", "image_credit" and
"image_license" to each record.
"""

import json
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
    """The article's main photo, at original resolution."""
    url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
    data = get_json(url)
    if not data:
        return None
    # .get() with a default avoids KeyError when an article has no image.
    original = data.get("originalimage") or {}
    thumb = data.get("thumbnail") or {}
    return original.get("source") or thumb.get("source")


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
    events = json.loads(EVENTS_FILE.read_text(encoding="utf-8"))

    for event in events:
        print(f"{event['name']} ...")
        title = title_from_wiki_link(event["wiki_link"])

        url = lead_image(title)
        if not url:
            print("    no image found; skipping")
            event["image"] = None
            event["image_credit"] = None
            event["image_license"] = None
            continue

        artist, license_name = image_credit(url)
        event["image"] = url
        event["image_credit"] = artist
        event["image_license"] = license_name
        print(f"    {license_name} / {artist[:60]}")

        # Be polite: don't hammer a free service with rapid-fire requests.
        time.sleep(0.5)

    EVENTS_FILE.write_text(
        json.dumps(events, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    found = sum(1 for e in events if e.get("image"))
    print(f"\nDone. {found} of {len(events)} locations have images.")


if __name__ == "__main__":
    main()
