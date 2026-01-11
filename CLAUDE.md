# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JaxPlays is a Hugo static site for Jacksonville, Florida's theatre community. It covers productions, reviews, theatre companies, venues, and people involved in local theatre. The site uses a heavily customized fork of the Ananke theme.

## Build Commands

```bash
# Local development server
hugo server

# Production build
HUGO_ENV=production hugo --minify

# Production build with specific base URL (used in CI)
HUGO_ENV=production hugo --minify --baseURL "https://jaxplays.org/"
```

## Content Structure

### Primary Content Types

- **productions/** - Individual theatre productions organized by year (e.g., `2025/2025-Hadestown-Teen-Edition.md`)
- **shows/** - Reference entries for plays/musicals (the source material, not specific productions)
- **theatres/** - Theatre companies with company_type, active status, socials, color branding
- **venues/** - Physical locations with address, latitude/longitude, active status
- **people/** - Individual profiles for actors, directors, crew members
- **reviews/** - Production reviews with author attribution, linked to productions
- **news/** - Theatre news articles

### Front Matter Patterns

Productions use structured cast/crew data:
```yaml
cast:
  - Role Name: Person Name
  - Role Name:
      - Person 1
      - Person 2
crew:
  - Director: Person Name
showtimes:
  - 2025-08-08 19:30:00
Theatre: Theatre Name
Venue: Venue Name
```

Reviews link to productions via:
```yaml
production: 2024 Dear Evan Hansen
Theatre: FSCJ Artist Series
authors:
- Author Name
```

### Wikilink Syntax

Content supports internal wikilinks that are processed by `themes/jaxplays/layouts/partials/content-wikilinks.html`:

```markdown
[[person:John Smith]]           → links to /people/john-smith/
[[production:2024 Show Name]]   → links to /productions/2024-show-name/ (italicized)
[[theatre:Theatre Name]]        → links to /theatres/theatre-name/
[[venue:Venue Name]]            → links to /venues/venue-name/
[[w:Wikipedia Article]]         → external Wikipedia link
[[person:John Smith|Johnny]]    → custom display text
```

## Theme Architecture

The theme is at `themes/jaxplays/` and includes:
- Custom layouts for each content type in `layouts/{content-type}/`
- Shortcodes: `columns`, `figure`, `video`, `button`, `embed-pdf`, `leaflet` (maps), `seatmap`
- Tachyons CSS utility classes for styling

## Media Organization

Static assets in `static/media/`:
- `headshots/` - People profile images
- `photos/` - Production/event photos
- `posters/` - Show posters
- `logos/` - Theatre company logos
- `programs/` - Digital programs

Featured images for content are typically named to match the content file (e.g., `2025-Hadestown-Teen-Edition.webp`).

## Deployment

- Deploys via GitHub Actions on push to `master`
- Runs daily at 6 AM UTC (automatic rebuild for date-based content)
- Hugo version: 0.147.8 (extended)
- Creates Mailchimp draft campaigns for new reviews/news articles

## Taxonomies

```yaml
taxonomies:
  category: categories
  tag: tags
  genre: genres
  author: authors
```

## Custom Output Formats

The site generates JSON calendar feeds and iCal files for opening nights in addition to standard HTML/RSS.
