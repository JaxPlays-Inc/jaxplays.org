#!/usr/bin/env python3
"""Build generated people credit and lookup data from content front matter."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

import yaml


CREDIT_TYPES = ("cast", "understudies", "crew", "orchestra")
PEOPLE_KEYS = frozenset(("title", "other_names", "aliases", "featured_image", "url"))
PRODUCTION_KEYS = frozenset(
    (
        "title",
        "subtitle",
        "description",
        "opening_date",
        "closing_date",
        "approx_date",
        "theatre",
        "venue",
        "genres",
        "category",
        "featured_image",
        "featured_image_alt",
        "tickets",
        "draft",
        "url",
        *CREDIT_TYPES,
    )
)
SHOW_KEYS = frozenset(("title", "description", "genres", "featured_image", "featured_image_alt"))
THEATRE_KEYS = frozenset(("title", "theatre_aliases", "directory"))
VENUE_KEYS = frozenset(("title", "venue_aliases", "directory"))


def split_front_matter(text: str, path: Path) -> str:
    start = re.match(r"^-{3,}[ \t]*\n", text)
    if not start:
        raise ValueError(f"{path} does not start with YAML front matter")

    end = text.find("\n---", start.end())
    if end == -1:
        raise ValueError(f"{path} has no closing YAML front matter delimiter")

    return text[start.end() : end]


def select_front_matter_keys(front_matter: str, keys: frozenset[str]) -> str:
    lines = front_matter.splitlines()
    selected: list[str] = []
    keep = False

    for line in lines:
        key_match = re.match(r"^([A-Za-z0-9_-]+)\s*:", line)
        if key_match:
            keep = key_match.group(1) in keys
        elif line and not line.startswith((" ", "\t", "-")):
            keep = False

        if keep:
            selected.append(line)

    return "\n".join(selected).rstrip() + "\n"


def split_content(text: str, path: Path) -> tuple[str, str]:
    front_matter = split_front_matter(text, path)
    start = re.match(r"^-{3,}[ \t]*\n", text)
    if not start:
        return front_matter, ""
    end = text.find("\n---", start.end())
    body = text[end + 4 :]
    if body.startswith("\n"):
        body = body[1:]
    return front_matter, body


def load_front_matter(path: Path, keys: frozenset[str]) -> dict[str, Any]:
    front_matter, _body = split_content(path.read_text(), path)
    front_matter = select_front_matter_keys(front_matter, keys)
    data = yaml.safe_load(front_matter) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} front matter is not a mapping")
    return data


def load_front_matter_and_body(path: Path, keys: frozenset[str]) -> tuple[dict[str, Any], str]:
    front_matter, body = split_content(path.read_text(), path)
    front_matter = select_front_matter_keys(front_matter, keys)
    data = yaml.safe_load(front_matter) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} front matter is not a mapping")
    return data, body


def normalize_name(value: str) -> str:
    value = value.replace("’", "'").replace("‘", "'").strip()
    value = re.sub(r"^([\"“”]+|&quot;|&#34;|&ldquo;|&rdquo;)+", "", value)
    value = re.sub(r"([\"“”]+|&quot;|&#34;|&ldquo;|&rdquo;)+$", "", value)
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def findperson_key(value: str) -> str:
    value = value.replace(".", "")
    return normalize_name(value)


def content_urlize(value: str) -> str:
    value = value.replace("'", "").replace("’", "").replace("‘", "")
    value = value.replace("&", "")
    value = value.lower()
    value = re.sub(r"\s+", "-", value)
    value = re.sub(r"[^a-z0-9_.-]+", "", value)
    return value


def as_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str) and item.strip()]
    return []


def json_safe(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def plain_text(value: Any) -> str:
    text = str(value or "")
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[\[[^|\]]+\|([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^|\]]+)\]\]", r"\1", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[*_#>~|]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def truncate_text(value: str, length: int = 220) -> str:
    value = value.strip()
    if len(value) <= length:
        return value
    return value[: length - 3].rstrip() + "..."


def normalize_list(value: Any) -> list[str]:
    return as_string_list(value)


def poster_path(value: Any) -> str:
    poster = str(value or "").strip()
    if not poster:
        return "/media/default/production_poster.webp"
    if poster.startswith(("http://", "https://", "//", "/")):
        return poster
    return f"/media/posters/{poster}"


def content_permalink(section: str, path: Path, data: dict[str, Any]) -> str:
    url = data.get("url")
    if isinstance(url, str) and url.strip():
        return url if url.endswith("/") else f"{url}/"
    return f"/{section}/{content_urlize(path.stem)}/"


def alias_name(alias: str) -> str:
    return alias.strip("/").split("/")[-1]


def person_permalink(path: Path, data: dict[str, Any]) -> str:
    return content_permalink("people", path, data)


def add_lookup_key(lookup: dict[str, Any], key: str, person: dict[str, Any]) -> None:
    if key:
        lookup.setdefault(key, person)


def person_lookup(people_dir: Path) -> tuple[dict[str, str], dict[str, Any], dict[str, Any]]:
    credit_lookup: dict[str, str] = {}
    people_credits: dict[str, Any] = {}
    public_lookup: dict[str, Any] = {}

    for path in sorted(people_dir.glob("*.md")):
        if path.stem == "_index":
            continue
        try:
            data = load_front_matter(path, PEOPLE_KEYS)
        except (ValueError, yaml.YAMLError) as error:
            print(f"Warning: skipping {path}: {error}", file=sys.stderr)
            continue

        canonical = normalize_name(path.stem)
        people_credits[canonical] = {credit_type: [] for credit_type in CREDIT_TYPES}
        featured_image = data.get("featured_image")
        person = {
            "title": str(data.get("title") or path.stem),
            "permalink": person_permalink(path, data),
            "featured_image": featured_image if isinstance(featured_image, str) else "",
        }

        names = [path.stem, str(data.get("title") or "").strip()]
        names.extend(as_string_list(data.get("other_names")))
        names.extend(alias_name(alias) for alias in as_string_list(data.get("aliases")))

        for name in names:
            key = normalize_name(name)
            if not key:
                continue
            credit_lookup.setdefault(key, canonical)
            add_lookup_key(public_lookup, key, person)
            add_lookup_key(public_lookup, findperson_key(name), person)

    return credit_lookup, people_credits, public_lookup


def show_featured_images(shows_dir: Path) -> dict[str, str]:
    images: dict[str, str] = {}

    for path in sorted(shows_dir.glob("*.md")):
        try:
            data = load_front_matter(path, SHOW_KEYS)
        except (ValueError, yaml.YAMLError) as error:
            print(f"Warning: skipping {path}: {error}", file=sys.stderr)
            continue

        featured_image = data.get("featured_image")
        if isinstance(featured_image, str) and featured_image.strip():
            title = str(data.get("title") or path.stem)
            images[normalize_name(title)] = featured_image.strip()

    return images


def show_card_data(shows_dir: Path) -> dict[str, dict[str, Any]]:
    shows: dict[str, dict[str, Any]] = {}

    for path in sorted(shows_dir.glob("*.md")):
        try:
            data, body = load_front_matter_and_body(path, SHOW_KEYS)
        except (ValueError, yaml.YAMLError) as error:
            print(f"Warning: skipping {path}: {error}", file=sys.stderr)
            continue

        title = str(data.get("title") or path.stem)
        shows[normalize_name(title)] = {
            "description": data.get("description") or "",
            "summary": truncate_text(plain_text(data.get("description") or body)),
            "genres": normalize_list(data.get("genres")),
            "featured_image": data.get("featured_image") or "",
            "featured_image_alt": data.get("featured_image_alt") or "",
        }

    return shows


def production_entry(
    path: Path, data: dict[str, Any], show_images: dict[str, str]
) -> dict[str, Any]:
    title = str(data.get("title") or path.stem)
    featured_image = data.get("featured_image")
    if not isinstance(featured_image, str) or not featured_image.strip():
        featured_image = show_images.get(normalize_name(title), "")

    return {
        "permalink": content_permalink("productions", path, data),
        "title": title,
        "opening_date": json_safe(data.get("opening_date")) or "",
        "approx_date": data.get("approx_date") or "",
        "theatre": data.get("theatre") or "",
        "venue": data.get("venue") or "",
        "featured_image": featured_image or "",
    }


def format_date_label(value: Any, approx_date: Any = "") -> str:
    date_value = json_safe(value)
    if not date_value:
        return ""
    try:
        parsed = datetime.fromisoformat(str(date_value))
    except ValueError:
        try:
            parsed = datetime.strptime(str(date_value), "%Y-%m-%d")
        except ValueError:
            return str(date_value)
    if approx_date == "year":
        return parsed.strftime("%Y")
    if approx_date == "month":
        return parsed.strftime("%B %Y")
    return f"{parsed.strftime('%b')} {parsed.day}, {parsed.year}"


def format_month_label(value: Any, approx_date: Any = "") -> str:
    date_value = json_safe(value)
    if not date_value:
        return ""
    try:
        parsed = datetime.fromisoformat(str(date_value))
    except ValueError:
        try:
            parsed = datetime.strptime(str(date_value), "%Y-%m-%d")
        except ValueError:
            return str(date_value)
    if approx_date == "year":
        return parsed.strftime("%Y")
    return parsed.strftime("%B %Y")


def production_card_entry(
    path: Path, data: dict[str, Any], body: str, shows: dict[str, dict[str, Any]]
) -> Any:
    if data.get("draft") is True or path.stem == "_index":
        return None

    title = str(data.get("title") or path.stem)
    show = shows.get(normalize_name(title), {})
    opening_date = json_safe(data.get("opening_date")) or ""
    closing_date = json_safe(data.get("closing_date")) or opening_date
    featured_image = data.get("featured_image") or show.get("featured_image") or ""
    poster_alt = (
        data.get("featured_image_alt")
        or show.get("featured_image_alt")
        or f"{title} poster"
    )
    venues = normalize_list(data.get("venue"))
    theatre = str(data.get("theatre") or "")
    normalized_theatre = plain_text(theatre).lower().strip()
    display_venues = [
        venue
        for venue in venues
        if plain_text(venue).lower().strip() != normalized_theatre
    ]
    genres = normalize_list(data.get("genres")) or list(show.get("genres") or [])
    description = data.get("description") or ""
    summary = truncate_text(plain_text(description or body or show.get("summary") or ""))
    opening_label = format_date_label(opening_date, data.get("approx_date") or "")
    closing_label = format_date_label(closing_date) if data.get("closing_date") else ""

    search_parts = [
        title,
        opening_label,
        closing_label,
        theatre,
        " ".join(venues),
        " ".join(genres),
        summary,
    ]

    return {
        "title": title,
        "url": content_permalink("productions", path, data),
        "poster": poster_path(featured_image),
        "posterAlt": str(poster_alt),
        "openingDate": opening_date,
        "closingDate": closing_date,
        "openingLabel": opening_label,
        "openingMonthLabel": format_month_label(opening_date, data.get("approx_date") or ""),
        "openingBadgeLabel": format_date_label(opening_date),
        "closingLabel": closing_label,
        "theatre": theatre,
        "venues": display_venues,
        "allVenues": venues,
        "genres": genres,
        "summary": summary,
        "tickets": data.get("tickets") or "",
        "searchBase": " ".join(part for part in search_parts if part).lower(),
    }


def production_cards(productions_dir: Path, shows: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []

    for path in sorted(productions_dir.rglob("*.md")):
        try:
            data, body = load_front_matter_and_body(path, PRODUCTION_KEYS)
        except (ValueError, yaml.YAMLError) as error:
            print(f"Warning: skipping {path}: {error}", file=sys.stderr)
            continue
        card = production_card_entry(path, data, body, shows)
        if card:
            cards.append(card)

    return cards


def theatre_lookup(theatres_dir: Path) -> dict[str, str]:
    lookup: dict[str, str] = {}

    for path in sorted(theatres_dir.glob("*/_index.md")):
        try:
            data = load_front_matter(path, THEATRE_KEYS)
        except (ValueError, yaml.YAMLError) as error:
            print(f"Warning: skipping {path}: {error}", file=sys.stderr)
            continue
        if data.get("directory") is False:
            continue

        title = str(data.get("title") or path.parent.name).strip()
        canonical_key = normalize_name(title)
        if not canonical_key:
            continue

        lookup.setdefault(canonical_key, canonical_key)
        for alias in as_string_list(data.get("theatre_aliases")):
            lookup.setdefault(normalize_name(alias), canonical_key)

    return lookup


def theatre_productions(
    theatres_dir: Path, cards: list[dict[str, Any]]
) -> dict[str, list[dict[str, Any]]]:
    lookup = theatre_lookup(theatres_dir)
    grouped: dict[str, list[dict[str, Any]]] = {}

    for card in cards:
        theatre = str(card.get("theatre") or "").strip()
        if not theatre:
            continue
        key = lookup.get(normalize_name(theatre), normalize_name(theatre))
        grouped.setdefault(key, []).append(card)

    for productions in grouped.values():
        productions.sort(
            key=lambda production: str(production.get("openingDate") or ""),
            reverse=True,
        )

    return grouped


def venue_lookup(venues_dir: Path) -> dict[str, str]:
    lookup: dict[str, str] = {}

    for path in sorted(venues_dir.glob("*.md")):
        if path.stem == "_index":
            continue
        try:
            data = load_front_matter(path, VENUE_KEYS)
        except (ValueError, yaml.YAMLError) as error:
            print(f"Warning: skipping {path}: {error}", file=sys.stderr)
            continue
        if data.get("directory") is False:
            continue

        title = str(data.get("title") or path.stem).strip()
        canonical_key = normalize_name(title)
        if not canonical_key:
            continue

        lookup.setdefault(canonical_key, canonical_key)
        for alias in as_string_list(data.get("venue_aliases")):
            lookup.setdefault(normalize_name(alias), canonical_key)

    return lookup


def venue_productions(
    venues_dir: Path, cards: list[dict[str, Any]]
) -> dict[str, list[dict[str, Any]]]:
    lookup = venue_lookup(venues_dir)
    grouped: dict[str, list[dict[str, Any]]] = {}

    for card in cards:
        for venue in as_string_list(card.get("allVenues")):
            key = lookup.get(normalize_name(venue), normalize_name(venue))
            if not key:
                continue
            grouped.setdefault(key, []).append(card)

    for productions in grouped.values():
        productions.sort(
            key=lambda production: str(production.get("openingDate") or ""),
            reverse=True,
        )

    return grouped


def add_credit(
    people_credits: dict[str, Any],
    canonical: str,
    credit_type: str,
    production: dict[str, Any],
    credit: str,
) -> None:
    entries = people_credits[canonical][credit_type]
    for entry in entries:
        if entry["permalink"] == production["permalink"]:
            if credit not in entry["credits"]:
                entry["credits"].append(credit)
            return

    entries.append({**production, "credits": [credit]})


def collect_credits(
    productions_dir: Path,
    name_lookup: dict[str, str],
    people_credits: dict[str, Any],
    show_images: dict[str, str],
) -> tuple[int, int]:
    matched = 0
    unmatched = 0

    for path in sorted(productions_dir.rglob("*.md")):
        try:
            data = load_front_matter(path, PRODUCTION_KEYS)
        except (ValueError, yaml.YAMLError) as error:
            print(f"Warning: skipping {path}: {error}", file=sys.stderr)
            continue

        production = production_entry(path, data, show_images)
        if data.get("draft") is True:
            continue
        for credit_type in CREDIT_TYPES:
            credits = data.get(credit_type) or []
            if not isinstance(credits, list):
                continue
            for credit_item in credits:
                if not isinstance(credit_item, dict):
                    continue
                for credit, people in credit_item.items():
                    for person in as_string_list(people):
                        canonical = name_lookup.get(normalize_name(person))
                        if not canonical:
                            unmatched += 1
                            continue
                        add_credit(
                            people_credits,
                            canonical,
                            credit_type,
                            production,
                            str(credit),
                        )
                        matched += 1

    return matched, unmatched


def sort_entries(people_credits: dict[str, Any]) -> None:
    for credit_groups in people_credits.values():
        for entries in credit_groups.values():
            entries.sort(
                key=lambda entry: str(entry.get("opening_date") or ""),
                reverse=True,
            )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate people credit and lookup data from site content."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="site root; defaults to current working directory",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/generated/people_credits.json"),
        help="people credits output path, relative to root unless absolute",
    )
    parser.add_argument(
        "--lookup-output",
        type=Path,
        default=Path("data/generated/people_lookup.json"),
        help="people lookup output path, relative to root unless absolute",
    )
    parser.add_argument(
        "--production-cards-output",
        type=Path,
        default=Path("data/generated/production_cards.json"),
        help="production directory cards output path, relative to root unless absolute",
    )
    parser.add_argument(
        "--theatre-productions-output",
        type=Path,
        default=Path("data/generated/theatre_productions.json"),
        help="theatre production index output path, relative to root unless absolute",
    )
    parser.add_argument(
        "--venue-productions-output",
        type=Path,
        default=Path("data/generated/venue_productions.json"),
        help="venue production index output path, relative to root unless absolute",
    )
    args = parser.parse_args()

    root = args.root.resolve()
    output = args.output if args.output.is_absolute() else root / args.output
    lookup_output = (
        args.lookup_output if args.lookup_output.is_absolute() else root / args.lookup_output
    )
    production_cards_output = (
        args.production_cards_output
        if args.production_cards_output.is_absolute()
        else root / args.production_cards_output
    )
    theatre_productions_output = (
        args.theatre_productions_output
        if args.theatre_productions_output.is_absolute()
        else root / args.theatre_productions_output
    )
    venue_productions_output = (
        args.venue_productions_output
        if args.venue_productions_output.is_absolute()
        else root / args.venue_productions_output
    )

    name_lookup, people_credits, people_lookup = person_lookup(root / "content" / "people")
    show_images = show_featured_images(root / "content" / "shows")
    shows = show_card_data(root / "content" / "shows")
    matched, unmatched = collect_credits(
        root / "content" / "productions",
        name_lookup,
        people_credits,
        show_images,
    )
    sort_entries(people_credits)

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(people_credits, indent=2, ensure_ascii=False) + "\n")
    lookup_output.parent.mkdir(parents=True, exist_ok=True)
    lookup_output.write_text(json.dumps(people_lookup, indent=2, ensure_ascii=False) + "\n")
    cards = production_cards(root / "content" / "productions", shows)
    production_cards_output.parent.mkdir(parents=True, exist_ok=True)
    production_cards_output.write_text(json.dumps(cards, indent=2, ensure_ascii=False) + "\n")
    theatre_index = theatre_productions(root / "content" / "theatres", cards)
    theatre_productions_output.parent.mkdir(parents=True, exist_ok=True)
    theatre_productions_output.write_text(
        json.dumps(theatre_index, indent=2, ensure_ascii=False) + "\n"
    )
    venue_index = venue_productions(root / "content" / "venues", cards)
    venue_productions_output.parent.mkdir(parents=True, exist_ok=True)
    venue_productions_output.write_text(
        json.dumps(venue_index, indent=2, ensure_ascii=False) + "\n"
    )

    print(
        "Generated "
        f"{output.relative_to(root)}, {lookup_output.relative_to(root)}, "
        f"{production_cards_output.relative_to(root)}, "
        f"{theatre_productions_output.relative_to(root)}, "
        f"and {venue_productions_output.relative_to(root)} "
        f"for {len(people_credits)} people "
        f"and {len(cards)} production card(s) "
        f"grouped under {len(theatre_index)} theatre key(s) "
        f"and {len(venue_index)} venue key(s) "
        f"({matched} matched credit name(s), {unmatched} unmatched)."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        raise SystemExit(1)
