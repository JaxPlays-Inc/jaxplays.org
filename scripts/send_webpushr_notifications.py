#!/usr/bin/env python3
"""Send Webpushr notifications for newly published JaxPlays posts."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import yaml


WEBPUSHR_ENDPOINT = "https://api.webpushr.com/v1/notification/send/all"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Send Webpushr notifications for newly added published news/review content."
    )
    parser.add_argument("--files", required=True, help="File containing new content paths, one per line.")
    parser.add_argument("--site-root", default="sites/jaxplays", help="Hugo site root.")
    parser.add_argument("--dry-run", action="store_true", help="Print payloads without sending.")
    return parser.parse_args()


def load_new_files(path: Path) -> list[str]:
    return [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def site_relative_content_path(repo_path: str, site_root: str) -> str:
    prefix = f"{site_root.rstrip('/')}/"
    if repo_path.startswith(prefix):
        return repo_path[len(prefix) :]
    return repo_path


def load_published_pages(site_root: str) -> dict[str, dict[str, str]]:
    result = subprocess.run(
        ["hugo", "list", "published", "--source", site_root],
        check=True,
        capture_output=True,
        text=True,
    )
    pages: dict[str, dict[str, str]] = {}
    for row in csv.DictReader(result.stdout.splitlines()):
        if row.get("kind") != "page":
            continue
        path = row.get("path")
        if path:
            pages[path] = row
    return pages


def load_front_matter(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}

    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}

    data = yaml.safe_load(parts[1]) or {}
    if not isinstance(data, dict):
        return {}
    return data


def strip_markup(value: Any) -> str:
    text = "" if value is None else str(value)
    text = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"[*_`#>]", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\s+", " ", text).strip()


def truncate(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 3)].rstrip() + "..."


def absolute_url(path: Any) -> str | None:
    if not path:
        return None
    text = str(path)
    if text.startswith("https://"):
        return text
    if text.startswith("/"):
        return f"https://jaxplays.org{text}"
    return None


def featured_image_url(front_matter: dict[str, Any]) -> str | None:
    featured = front_matter.get("featured_image")
    if isinstance(featured, dict):
        return absolute_url(featured.get("src"))
    return absolute_url(featured)


def notification_payload(repo_path: str, page: dict[str, str], front_matter: dict[str, Any]) -> dict[str, Any]:
    section = page.get("section", "")
    kind = "Review" if section == "reviews" else "News"
    title = strip_markup(front_matter.get("title") or page.get("title") or "New JaxPlays story")
    description = strip_markup(front_matter.get("description"))
    if not description:
        description = f"Read the latest {kind.lower()} from JaxPlays."

    payload: dict[str, Any] = {
        "title": truncate(title, 100),
        "message": truncate(description, 255),
        "target_url": truncate(page["permalink"], 255),
        "name": truncate(f"JaxPlays {kind}: {title}", 100),
        "auto_hide": 1,
    }

    image = featured_image_url(front_matter)
    if image:
        payload["image"] = truncate(image, 255)

    return payload


def send_notification(payload: dict[str, Any], dry_run: bool) -> None:
    if dry_run:
        print(json.dumps(payload, indent=2, sort_keys=True))
        return

    api_key = os.environ.get("WEBPUSHR_API_KEY")
    auth_token = os.environ.get("WEBPUSHR_API_AUTH_TOKEN")
    if not api_key or not auth_token:
        raise RuntimeError("WEBPUSHR_API_KEY and WEBPUSHR_API_AUTH_TOKEN must be set.")

    request = urllib.request.Request(
        WEBPUSHR_ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "webpushrKey": api_key,
            "webpushrAuthToken": auth_token,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response_body = response.read().decode("utf-8")
            status_code = response.status
    except urllib.error.HTTPError as error:
        response_body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Webpushr request failed with HTTP {error.code}: {response_body}") from error

    print(response_body)
    if status_code < 200 or status_code >= 300:
        raise RuntimeError(f"Webpushr request failed with HTTP {status_code}: {response_body}")

    try:
        result = json.loads(response_body)
    except json.JSONDecodeError:
        return

    if result.get("status") == "failure":
        raise RuntimeError(f"Webpushr returned failure: {response_body}")


def main() -> int:
    args = parse_args()
    repo_root = Path.cwd()
    site_root = args.site_root.rstrip("/")
    new_files = load_new_files(Path(args.files))
    published_pages = load_published_pages(site_root)

    sent = 0
    for repo_path in new_files:
        if not re.match(r"^sites/jaxplays/content/(reviews|news)/.+\.md$", repo_path):
            print(f"Skipping non-news/review path: {repo_path}")
            continue

        content_path = site_relative_content_path(repo_path, site_root)
        page = published_pages.get(content_path)
        if not page:
            print(f"Skipping unpublished content: {repo_path}")
            continue

        front_matter = load_front_matter(repo_root / repo_path)
        payload = notification_payload(repo_path, page, front_matter)
        print(f"Sending Webpushr notification for {repo_path} -> {payload['target_url']}")
        send_notification(payload, args.dry_run)
        sent += 1

    print(f"Prepared {sent} Webpushr notification(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
