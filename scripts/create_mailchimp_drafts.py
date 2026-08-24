#!/usr/bin/env python3
"""Create Mailchimp draft campaigns for newly published JaxPlays articles."""

from __future__ import annotations

import argparse
import base64
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import markdown
import yaml


REVIEW_TEMPLATE_ID = 10623509
NEWS_TEMPLATE_ID = 10623325


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create Mailchimp draft campaigns for newly added review/news content."
    )
    parser.add_argument("--files", required=True, help="File containing new content paths, one per line.")
    parser.add_argument("--site-root", default="sites/jaxplays", help="Hugo site root.")
    parser.add_argument("--dry-run", action="store_true", help="Print payloads without calling Mailchimp.")
    return parser.parse_args()


def load_new_files(path: Path) -> list[str]:
    return [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def load_front_matter_and_body(path: Path) -> tuple[dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}, text

    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text

    data = yaml.safe_load(parts[1]) or {}
    if not isinstance(data, dict):
        data = {}

    return data, parts[2].strip()


def strip_markup(value: Any) -> str:
    text = "" if value is None else str(value)
    text = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]:]+):([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[*_`#>]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def page_kind(repo_path: str) -> tuple[str, int]:
    if repo_path.startswith("sites/jaxplays/content/reviews/"):
        return "REVIEW", REVIEW_TEMPLATE_ID
    if repo_path.startswith("sites/jaxplays/content/news/"):
        return "NEWS", NEWS_TEMPLATE_ID
    raise ValueError(f"Unsupported content path: {repo_path}")


def article_url(repo_path: str, front_matter: dict[str, Any]) -> str:
    if front_matter.get("url"):
        url = str(front_matter["url"])
        if url.startswith("https://"):
            return url
        if url.startswith("/"):
            return f"https://jaxplays.org{url}"

    match = re.match(
        r"^sites/jaxplays/content/(reviews|news)/(\d{4})-(\d{2})-(\d{2})-(.+)\.md$",
        repo_path,
    )
    if not match:
        return "https://jaxplays.org/"

    section, year, month, day, slug = match.groups()
    slug = slug.strip().lower().replace("_", "-")
    slug = re.sub(r"[^a-z0-9-]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return f"https://jaxplays.org/{section}/{year}/{month}/{day}/{slug}/"


def clean_article_markdown(body: str) -> str:
    body = body.replace("<!--more-->", "")
    body = re.sub(r"\[\[([^|\]]+)\|([^\]]+)\]\]", r"\2", body)
    body = re.sub(r"\[\[([^\]:]+):([^\]]+)\]\]", r"\2", body)
    body = re.sub(r"\[\[([^\]]+)\]\]", r"\1", body)

    def youtube_link(match: re.Match[str]) -> str:
        video_id = match.group(1)
        return f'\n\n[Watch video](https://www.youtube.com/watch?v={video_id})\n\n'

    body = re.sub(r"\{\{<\s*youtube\s+([A-Za-z0-9_-]+)(?:\s+[^>]*)?\s*>\}\}", youtube_link, body)
    body = re.sub(r"\{\{[%<][^}]+[%>]\}\}", "", body)
    return body.strip()


def article_html(title: str, body: str, url: str) -> str:
    content = markdown.markdown(
        clean_article_markdown(body),
        extensions=["extra", "smarty"],
        output_format="html5",
    )
    escaped_title = html.escape(title)
    escaped_url = html.escape(url, quote=True)

    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>{escaped_title}</title>
  </head>
  <body>
    <article>
      <h1>{escaped_title}</h1>
      {content}
      <p><a href="{escaped_url}">Read on JaxPlays</a></p>
    </article>
  </body>
</html>"""


def mailchimp_request(endpoint: str, method: str, payload: dict[str, Any]) -> dict[str, Any]:
    api_key = os.environ.get("MAILCHIMP_API_KEY")
    server_prefix = os.environ.get("MAILCHIMP_SERVER_PREFIX")
    if not api_key or not server_prefix:
        raise RuntimeError("MAILCHIMP_API_KEY and MAILCHIMP_SERVER_PREFIX must be set.")

    auth = base64.b64encode(f"anystring:{api_key}".encode("utf-8")).decode("ascii")
    request = urllib.request.Request(
        f"https://{server_prefix}.api.mailchimp.com/3.0{endpoint}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/json",
        },
        method=method,
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            status = response.status
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Mailchimp request failed with HTTP {error.code}: {body}") from error

    if status < 200 or status >= 300:
        raise RuntimeError(f"Mailchimp request failed with HTTP {status}: {body}")

    return json.loads(body) if body else {}


def create_draft(repo_path: str, dry_run: bool) -> None:
    kind, template_id = page_kind(repo_path)
    front_matter, body = load_front_matter_and_body(Path(repo_path))
    title = strip_markup(front_matter.get("title")) or Path(repo_path).stem
    description = strip_markup(front_matter.get("description"))
    url = article_url(repo_path, front_matter)

    if not description:
        description = f"Read the latest {kind.lower()} from JaxPlays."

    subject = f"🎭✨ {kind}: {title}"
    campaign_title = f"Draft {kind}: {title}"
    content_html = article_html(title, body, url)

    campaign_payload = {
        "type": "regular",
        "recipients": {
            "list_id": os.environ.get("MAILCHIMP_LIST_ID", ""),
        },
        "settings": {
            "subject_line": subject,
            "preview_text": description,
            "title": campaign_title,
            "from_name": os.environ.get("MAILCHIMP_FROM_NAME", ""),
            "reply_to": os.environ.get("MAILCHIMP_REPLY_TO", ""),
            "template_id": template_id,
        },
        "status": "save",
    }

    if dry_run:
        print(json.dumps(campaign_payload, indent=2, ensure_ascii=False, sort_keys=True))
        print(content_html[:1000])
        return

    print(f"Creating Mailchimp draft for {repo_path}")
    campaign = mailchimp_request("/campaigns", "POST", campaign_payload)
    campaign_id = campaign.get("id")
    if not campaign_id:
        raise RuntimeError(f"Mailchimp campaign response did not include an id: {campaign}")

    mailchimp_request(f"/campaigns/{campaign_id}/content", "PUT", {"html": content_html})
    print(f"Created Mailchimp campaign draft {campaign_id}: {subject}")


def main() -> int:
    args = parse_args()
    new_files = load_new_files(Path(args.files))

    created = 0
    for repo_path in new_files:
        if not re.match(r"^sites/jaxplays/content/(reviews|news)/.+\.md$", repo_path):
            print(f"Skipping non-news/review path: {repo_path}")
            continue
        create_draft(repo_path, args.dry_run)
        created += 1

    print(f"Prepared {created} Mailchimp draft campaign(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
