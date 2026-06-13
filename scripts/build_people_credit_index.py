#!/usr/bin/env python3
"""Build generated people credit data from production front matter."""

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
PEOPLE_KEYS = frozenset(("title", "other_names", "aliases"))
PRODUCTION_KEYS = frozenset(
    (
        "title",
        "opening_date",
        "approx_date",
        "theatre",
        "venue",
        "featured_image",
        "draft",
        "url",
        *CREDIT_TYPES,
    )
)
SHOW_KEYS = frozenset(("title", "featured_image"))


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


def load_front_matter(path: Path, keys: frozenset[str]) -> dict[str, Any]:
    front_matter = split_front_matter(path.read_text(), path)
    front_matter = select_front_matter_keys(front_matter, keys)
    data = yaml.safe_load(front_matter) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} front matter is not a mapping")
    return data


def normalize_name(value: str) -> str:
    value = value.replace("’", "'").replace("‘", "'").strip()
    value = re.sub(r"^([\"“”]+|&quot;|&#34;|&ldquo;|&rdquo;)+", "", value)
    value = re.sub(r"([\"“”]+|&quot;|&#34;|&ldquo;|&rdquo;)+$", "", value)
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def content_urlize(value: str) -> str:
    value = value.replace("'", "").replace("’", "").replace("‘", "")
    value = value.replace("&", "")
    value = value.lower()
    value = re.sub(r"\s+", "-", value)
    value = re.sub(r"[^a-z0-9_-]+", "", value)
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


def content_permalink(section: str, path: Path, data: dict[str, Any]) -> str:
    url = data.get("url")
    if isinstance(url, str) and url.strip():
        return url if url.endswith("/") else f"{url}/"
    return f"/{section}/{content_urlize(path.stem)}/"


def alias_name(alias: str) -> str:
    return alias.strip("/").split("/")[-1]


def person_lookup(people_dir: Path) -> tuple[dict[str, str], dict[str, Any]]:
    lookup: dict[str, str] = {}
    index: dict[str, Any] = {}

    for path in sorted(people_dir.glob("*.md")):
        try:
            data = load_front_matter(path, PEOPLE_KEYS)
        except (ValueError, yaml.YAMLError) as error:
            print(f"Warning: skipping {path}: {error}", file=sys.stderr)
            continue

        canonical = normalize_name(path.stem)
        index[canonical] = {credit_type: [] for credit_type in CREDIT_TYPES}

        names = [path.stem, str(data.get("title") or "").strip()]
        names.extend(as_string_list(data.get("other_names")))
        names.extend(alias_name(alias) for alias in as_string_list(data.get("aliases")))

        for name in names:
            key = normalize_name(name)
            if not key:
                continue
            lookup.setdefault(key, canonical)

    return lookup, index


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
        description="Generate data/generated/people_credits.json from production credits."
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
        help="output path, relative to root unless absolute",
    )
    args = parser.parse_args()

    root = args.root.resolve()
    output = args.output if args.output.is_absolute() else root / args.output

    name_lookup, people_credits = person_lookup(root / "content" / "people")
    show_images = show_featured_images(root / "content" / "shows")
    matched, unmatched = collect_credits(
        root / "content" / "productions",
        name_lookup,
        people_credits,
        show_images,
    )
    sort_entries(people_credits)

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(people_credits, indent=2, ensure_ascii=False) + "\n")

    print(
        "Generated "
        f"{output.relative_to(root)} for {len(people_credits)} people "
        f"({matched} matched credit name(s), {unmatched} unmatched)."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        raise SystemExit(1)
