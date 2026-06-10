#!/usr/bin/env python3
"""Update people roles from production credits.

Dry run by default. Pass --write to update content/people front matter.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

import yaml


ROLE_ORDER = (
    "Actor",
    "Playwright",
    "Director",
    "Assistant Director",
    "Dramaturg",
    "Musical Director",
    "Intimacy Director",
    "Choreographer",
    "Fight Choreographer",
    "Dance Captain",
    "Scenic Designer",
    "Costume Designer",
    "Hair and Wig Designer",
    "Make-up Artist",
    "Lighting Designer",
    "Sound Designer",
    "Audio Technician",
    "Lighting Technician",
    "Technical Director",
    "Stage Manager",
    "Assistant Stage Manager",
    "Casting Director",
    "Musician",
    "Costuming",
    "Property Master",
    "Carpenter",
    "Stage Crew",
    "Painter",
)

ROLE_CREDIT_MAP = {
    "adapted-by": ("Playwright",),
    "assistant-choreographer": ("Choreographer",),
    "assistant-costume-designer": ("Costume Designer",),
    "assistant-director": ("Assistant Director",),
    "assistant-director-stage-manager": ("Assistant Director", "Stage Manager"),
    "assistant-lighting-design": ("Lighting Designer",),
    "assistant-lighting-designer": ("Lighting Designer",),
    "assistant-stage-manager": ("Assistant Stage Manager",),
    "assistant-stage-managers": ("Assistant Stage Manager",),
    "assistant-technical-director": ("Technical Director",),
    "assistant-to-director": ("Assistant Director",),
    "assistant-to-the-director": ("Assistant Director",),
    "audio-technician": ("Audio Technician",),
    "audio-engineer": ("Audio Technician",),
    "backstage-crew": ("Stage Crew",),
    "board-operator": ("Audio Technician",),
    "book": ("Playwright",),
    "carpenter": ("Carpenter",),
    "casting": ("Casting Director",),
    "casting-director": ("Casting Director",),
    "choral-director": ("Music Director",),
    "choreograher": ("Choreographer",),
    "choreographer": ("Choreographer",),
    "choreography": ("Choreographer",),
    "co-director": ("Director",),
    "conductor": ("Music Director",),
    "construction": ("Carpenter",),
    "construction-and-painting": ("Carpenter", "Painter"),
    "construction-crew": ("Carpenter", "Stage Crew"),
    "costume-assistant": ("Costuming",),
    "costume-construction": ("Costuming",),
    "costume-coordinator": ("Costuming",),
    "costume-crew": ("Costuming",),
    "costume-design": ("Costume Designer",),
    "costume-designer": ("Costume Designer",),
    "costume-designers": ("Costume Designer",),
    "costume-manager": ("Costuming",),
    "costume-mistress": ("Costuming",),
    "costuming": ("Costuming",),
    "costumer": ("Costuming",),
    "costumers": ("Costuming",),
    "costumes": ("Costuming",),
    "costumes-and-props": ("Costuming", "Property Master"),
    "dance-captain": ("Dance Captain",),
    "deck-crew": ("Stage Crew",),
    "director": ("Director",),
    "director-and-choreographer": ("Director", "Choreographer"),
    "director-choreographer": ("Director", "Choreographer"),
    "directors": ("Director",),
    "dresser": ("Costuming",),
    "dramaturg": ("Dramaturg",),
    "dramaturge": ("Dramaturg",),
    "electrician": ("Lighting Technician",),
    "fight-choreographer": ("Fight Choreographer",),
    "fight-choreography": ("Fight Choreographer",),
    "fight-coordinator": ("Fight Choreographer",),
    "fight-director": ("Fight Choreographer",),
    "fly-crew": ("Stage Crew",),
    "follow-spot": ("Lighting Technician",),
    "follow-spot-operator": ("Lighting Technician",),
    "hair-and-make-up": ("Hair and Wig Designer", "Make-up Artist"),
    "hair-and-make-up-design": ("Hair and Wig Designer", "Make-up Artist"),
    "hair-and-makeup-designer": ("Hair and Wig Designer", "Make-up Artist"),
    "hair-and-wig-design": ("Hair and Wig Designer",),
    "hair-and-wig-designer": ("Hair and Wig Designer",),
    "hair-design": ("Hair and Wig Designer",),
    "hair-makeup-designer": ("Hair and Wig Designer", "Make-up Artist"),
    "intimacy-direction": ("Intimacy Director",),
    "intimacy-director": ("Intimacy Director",),
    "lighing-design": ("Lighting Designer",),
    "light-board-operation": ("Lighting Technician",),
    "light-board-operator": ("Lighting Technician",),
    "light-crew": ("Lighting Technician",),
    "light-design": ("Lighting Designer",),
    "light-designer": ("Lighting Designer",),
    "light-operator": ("Lighting Technician",),
    "lighting": ("Lighting Technician",),
    "lighting-and-project-design": ("Lighting Designer",),
    "lighting-assistant": ("Lighting Technician",),
    "lighting-board-operator": ("Lighting Technician",),
    "lighting-controls": ("Lighting Technician",),
    "lighting-crew": ("Lighting Technician",),
    "lighting-design": ("Lighting Designer",),
    "lighting-designer": ("Lighting Designer",),
    "lighting-director": ("Lighting Designer",),
    "lighting-operator": ("Lighting Technician",),
    "lighting-sound-operator": ("Lighting Technician", "Audio Technician"),
    "lighting-technician": ("Lighting Technician",),
    "lighting-technicians": ("Lighting Technician",),
    "lights": ("Lighting Technician",),
    "lyrics": ("Playwright",),
    "make-up": ("Make-up Artist",),
    "make-up-assistant": ("Make-up Artist",),
    "make-up-chairman": ("Make-up Artist",),
    "make-up-artist": ("Make-up Artist",),
    "make-up-designer": ("Make-up Artist",),
    "makeup-artist": ("Make-up Artist",),
    "makeup-designer": ("Make-up Artist",),
    "master-carpenter": ("Carpenter",),
    "master-electrician": ("Lighting Technician",),
    "music": ("Musician",),
    "music-and-lyrics": ("Playwright",),
    "music-director": ("Musical Director",),
    "musical-direction": ("Musical Director",),
    "musical-director": ("Musical Director",),
    "orchestrations": ("Musician",),
    "original-music": ("Musician",),
    "paint-charge": ("Painter",),
    "painter": ("Painter",),
    "painting": ("Painter",),
    "painting-and-construction": ("Painter", "Carpenter"),
    "painting-crew": ("Painter",),
    "piano-conductor": ("Music Director", "Musician"),
    "playwright": ("Playwright",),
    "production-stage-manager": ("Stage Manager",),
    "properties": ("Property Master",),
    "properties-and-run-crew": ("Property Master", "Stage Crew"),
    "properties-assistant": ("Property Master",),
    "properties-chair": ("Property Master",),
    "properties-chairman": ("Property Master",),
    "properties-coordinator": ("Property Master",),
    "properties-crew": ("Property Master",),
    "properties-management": ("Property Master",),
    "properties-master": ("Property Master",),
    "properties-mistress": ("Property Master",),
    "property-assistant": ("Property Master",),
    "property-chairman": ("Property Master",),
    "property-master": ("Property Master",),
    "prop-assistant": ("Property Master",),
    "prop-crew": ("Property Master",),
    "prop-crew-head": ("Property Master",),
    "prop-design": ("Property Master",),
    "prop-designer": ("Property Master",),
    "prop-master": ("Property Master",),
    "prop-mistress": ("Property Master",),
    "props": ("Property Master",),
    "props-crew": ("Property Master",),
    "props-designer": ("Property Master",),
    "props-master": ("Property Master",),
    "run-crew": ("Stage Crew",),
    "running-crew": ("Stage Crew",),
    "scene-and-properties": ("Scenic Designer", "Property Master"),
    "scene-construction": ("Carpenter",),
    "scene-design": ("Scenic Designer",),
    "scene-painting": ("Painter",),
    "scene-painting-and-construction": ("Painter", "Carpenter"),
    "scene-shifting": ("Stage Crew",),
    "scenery": ("Scenic Designer",),
    "scenery-design": ("Scenic Designer",),
    "scenic-and-lighting-design": ("Scenic Designer", "Lighting Designer"),
    "scenic-art": ("Painter",),
    "scenic-art-work": ("Painter",),
    "scenic-artist": ("Painter",),
    "scenic-charge-artist": ("Painter",),
    "scenic-construction": ("Carpenter",),
    "scenic-design": ("Scenic Designer",),
    "scenic-designer": ("Scenic Designer",),
    "scenic-designers": ("Scenic Designer",),
    "scenic-painter": ("Painter",),
    "scenic-painters": ("Painter",),
    "scenic-painting": ("Painter",),
    "scenic-prop-design": ("Scenic Designer", "Property Master"),
    "set-and-lighting-design": ("Scenic Designer", "Lighting Designer"),
    "set-and-technical-direction": ("Scenic Designer", "Technical Director"),
    "set-carpenter": ("Carpenter",),
    "set-construction": ("Carpenter",),
    "set-construction-and-painting": ("Carpenter", "Painter"),
    "set-construction-crew": ("Carpenter", "Stage Crew"),
    "set-crew": ("Stage Crew",),
    "set-design": ("Scenic Designer",),
    "set-design-construction": ("Scenic Designer", "Carpenter"),
    "set-design-technical-director": ("Scenic Designer", "Technical Director"),
    "set-designer": ("Scenic Designer",),
    "set-designers": ("Scenic Designer",),
    "set-lighting-design": ("Scenic Designer", "Lighting Designer"),
    "set-painting": ("Painter",),
    "set-painting-crew": ("Painter",),
    "shop-foreman": ("Carpenter",),
    "sound": ("Audio Technician",),
    "sound-and-lights": ("Audio Technician", "Lighting Technician"),
    "sound-and-music": ("Audio Technician", "Musician"),
    "sound-board-operator": ("Audio Technician",),
    "sound-crew": ("Audio Technician",),
    "sound-design": ("Sound Designer",),
    "sound-design-audio-engineering": ("Sound Designer", "Audio Technician"),
    "sound-design-engineering": ("Sound Designer", "Audio Technician"),
    "sound-design-technician": ("Sound Designer", "Audio Technician"),
    "sound-designer": ("Sound Designer",),
    "sound-director": ("Sound Designer",),
    "sound-effects": ("Sound Designer",),
    "sound-engineer": ("Audio Technician",),
    "sound-operator": ("Audio Technician",),
    "sound-supervision": ("Sound Designer",),
    "sound-technician": ("Audio Technician",),
    "stage-assistant": ("Stage Crew",),
    "stage-carpenter": ("Carpenter",),
    "stage-crew": ("Stage Crew",),
    "stage-director": ("Director",),
    "stage-hand": ("Stage Crew",),
    "stage-setting": ("Scenic Designer",),
    "stage-setting-assistant": ("Scenic Designer",),
    "stage-settings": ("Scenic Designer",),
    "stagehand": ("Stage Crew",),
    "stage-manager": ("Stage Manager",),
    "stage-managers": ("Stage Manager",),
    "tech-director": ("Technical Director",),
    "technical-assistant": ("Technical Director",),
    "technical-direcor": ("Technical Director",),
    "technical-director": ("Technical Director",),
    "technical-work": ("Technical Director",),
    "vocal-coach": ("Music Director",),
    "vocal-director": ("Music Director",),
    "wardrobe": ("Costuming",),
    "wardrobe-assistant": ("Costuming",),
    "wardrobe-chairman": ("Costuming",),
    "wardrobe-co-ordinator": ("Costuming",),
    "wardrobe-coordinator": ("Costuming",),
    "wardrobe-crew": ("Costuming",),
    "wardrobe-mistress": ("Costuming",),
    "wardrobe-supervisor": ("Costuming",),
    "wig-design": ("Hair and Wig Designer",),
    "wig-stylist": ("Hair and Wig Designer",),
    "writer": ("Playwright",),
    "written-by": ("Playwright",),
}


def split_front_matter(text: str, path: Path) -> tuple[str, str]:
    start = re.match(r"^-{3,}[ \t]*\n", text)
    if not start:
        raise ValueError(f"{path} does not start with YAML front matter")

    end = text.find("\n---", start.end())
    if end == -1:
        raise ValueError(f"{path} has no closing YAML front matter delimiter")

    front_matter = text[start.end() : end]
    body = text[end + 4 :]
    if body.startswith("\n"):
        body = body[1:]
    return front_matter, body


def load_front_matter(path: Path) -> dict[str, Any]:
    front_matter, _body = split_front_matter(path.read_text(), path)
    try:
        data = yaml.safe_load(front_matter) or {}
    except yaml.YAMLError:
        data = yaml.safe_load(strip_roles_block(front_matter)) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} front matter is not a mapping")
    return data


def strip_roles_block(front_matter: str) -> str:
    lines = front_matter.splitlines()
    output: list[str] = []
    index = 0

    while index < len(lines):
        line = lines[index]
        if re.match(r"^roles\s*:", line):
            index += 1
            while index < len(lines):
                next_line = lines[index]
                if (
                    next_line.startswith((" ", "\t"))
                    or next_line.startswith("- ")
                    or not next_line.strip()
                ):
                    index += 1
                    continue
                break
            continue

        output.append(line)
        index += 1

    return "\n".join(output).rstrip() + "\n"


def normalize_name(value: str) -> str:
    value = value.replace("’", "'").replace("‘", "'").strip()
    value = re.sub(r"^([\"“”]+|&quot;|&#34;|&ldquo;|&rdquo;)+", "", value)
    value = re.sub(r"([\"“”]+|&quot;|&#34;|&ldquo;|&rdquo;)+$", "", value)
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def normalize_credit(value: str) -> str:
    return normalize_name(value)


def as_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str) and item.strip()]
    return []


def add_role(role_index: dict[str, set[str]], role: str, people: Any) -> None:
    for name in as_string_list(people):
        role_index.setdefault(normalize_name(name), set()).add(role)


def add_mapped_roles(role_index: dict[str, set[str]], credit: str, people: Any) -> None:
    for role in ROLE_CREDIT_MAP.get(normalize_credit(credit), ()):
        add_role(role_index, role, people)


def collect_roles(productions_dir: Path) -> dict[str, set[str]]:
    role_index: dict[str, set[str]] = {}

    for path in sorted(productions_dir.rglob("*.md")):
        try:
            data = load_front_matter(path)
        except ValueError as error:
            print(f"Warning: skipping {path}: {error}", file=sys.stderr)
            continue

        for credit in data.get("cast") or []:
            if not isinstance(credit, dict):
                continue
            for people in credit.values():
                add_role(role_index, "Actor", people)

        for credit in data.get("show_details") or []:
            if not isinstance(credit, dict):
                continue
            for title, people in credit.items():
                add_mapped_roles(role_index, str(title), people)

        for credit in data.get("crew") or []:
            if not isinstance(credit, dict):
                continue
            for title, people in credit.items():
                add_mapped_roles(role_index, str(title), people)

        for credit in data.get("orchestra") or []:
            if not isinstance(credit, dict):
                continue
            for people in credit.values():
                add_role(role_index, "Musician", people)

    return role_index


def person_name_keys(data: dict[str, Any]) -> list[str]:
    names = [str(data.get("title") or "").strip()]
    names.extend(as_string_list(data.get("other_names")))
    return [normalize_name(name) for name in names if name]


def roles_for_person(data: dict[str, Any], role_index: dict[str, set[str]]) -> list[str]:
    found: set[str] = set()
    for name_key in person_name_keys(data):
        found.update(role_index.get(name_key, set()))
    return [role for role in ROLE_ORDER if role in found]


def format_roles_block(roles: list[str]) -> list[str]:
    return ["roles:"] + [f"  - {role}" for role in roles]


def replace_roles(front_matter: str, roles: list[str]) -> str:
    lines = front_matter.splitlines()
    output: list[str] = []
    index = 0

    while index < len(lines):
        line = lines[index]
        if re.match(r"^roles\s*:", line):
            index += 1
            while index < len(lines):
                next_line = lines[index]
                if (
                    next_line.startswith((" ", "\t"))
                    or next_line.startswith("- ")
                    or not next_line.strip()
                ):
                    index += 1
                    continue
                break
            if roles:
                output.extend(format_roles_block(roles))
            continue

        output.append(line)
        index += 1

    if roles and not any(re.match(r"^roles\s*:", line) for line in lines):
        insert_at = len(output)
        for idx, line in enumerate(output):
            if line.startswith("socials:"):
                insert_at = idx
                break
        output[insert_at:insert_at] = format_roles_block(roles)

    return "\n".join(output).rstrip() + "\n"


def update_person_file(path: Path, roles: list[str], write: bool) -> bool:
    text = path.read_text()
    front_matter, body = split_front_matter(text, path)
    updated_front_matter = replace_roles(front_matter, roles)
    updated = f"---\n{updated_front_matter}---\n{body}"

    if updated == text:
        return False

    if write:
        path.write_text(updated)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Update content/people roles from production cast and crew credits."
    )
    parser.add_argument("--write", action="store_true", help="write changes to people files")
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit 1 if updates would be made; useful for CI",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="site root; defaults to current working directory",
    )
    args = parser.parse_args()

    root = args.root.resolve()
    productions_dir = root / "content" / "productions"
    people_dir = root / "content" / "people"

    role_index = collect_roles(productions_dir)
    changed: list[tuple[Path, list[str]]] = []

    for path in sorted(people_dir.glob("*.md")):
        data = load_front_matter(path)
        roles = roles_for_person(data, role_index)
        if update_person_file(path, roles, args.write):
            changed.append((path, roles))

    action = "Updated" if args.write else "Would update"
    for path, roles in changed:
        role_text = ", ".join(roles) if roles else "(remove roles)"
        print(f"{action} {path.relative_to(root)}: {role_text}")

    print(f"{action} {len(changed)} people file(s).")

    if args.check and changed:
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        raise SystemExit(1)
