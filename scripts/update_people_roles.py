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


ROLE_ORDER = ("Actor", "Director", "Musical Director")
DIRECTOR_CREDITS = {"director", "co-director"}
MUSICAL_DIRECTOR_CREDITS = {
    "music-director",
    "musical-direction",
    "musical-director",
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

        for credit in data.get("crew") or []:
            if not isinstance(credit, dict):
                continue
            for title, people in credit.items():
                credit_key = normalize_credit(str(title))
                if credit_key in DIRECTOR_CREDITS:
                    add_role(role_index, "Director", people)
                if credit_key in MUSICAL_DIRECTOR_CREDITS:
                    add_role(role_index, "Musical Director", people)

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
                if next_line.startswith((" ", "\t")) or not next_line.strip():
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
