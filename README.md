# JaxPlays

JaxPlays is a digital guide to live theatre in Northeast Florida and Southeast Georgia, with a special focus on Jacksonville. Its mission is to preserve the past, promote the present and propel the future of the region's theatre community.

The site brings together current productions, performance schedules, reviews, news, auditions, theatre and venue profiles, artist records and historical production data. It is built as a Hugo static site using a heavily customized fork of the Ananke theme.

## What The Site Covers

JaxPlays is organized around the ways readers, artists, theatres and researchers look for theatre information.

### Home

The homepage is the front door to the site. It highlights what is closing soon, what is new, what is worth reading and where users can jump next: shows, reviews, calendars, applications and directory pages.

### Read

The Read section collects editorial and timely coverage:

- `content/news/` contains theatre news, site announcements, feature stories and community updates.
- `content/reviews/` contains production reviews tied to specific shows and theatres.
- `content/editorials/` contains opinion, context and longer-form commentary.
- `content/auditions/` contains audition announcements and calls for performers.

News, reviews and editorials use date-based permalinks.

### Shows

The Shows section is the production discovery layer:

- `content/productions/` contains individual staged productions, organized by year.
- `/productions/` shows current and upcoming productions.
- `/productions/future/` shows productions announced for future dates.
- `/productions/past/` preserves the historical archive.
- `/calendar/` provides a performance schedule view driven by production showtimes.

Production pages connect dates, showtimes, theatres, venues, cast, crew, posters, photos, ticket links and related reviews.

### Explore

The Explore section is the site directory system:

- `content/people/` contains profiles for actors, directors, designers, musicians, technicians, writers, stage managers and other theatre artists.
- `content/theatres/` contains theatre company and producer profiles.
- `content/venues/` contains physical performance spaces, addresses, maps and venue details.

These pages are connected back to productions, reviews, credits and generated indexes so a visitor can move from a show to the people, theatre, venue and coverage around it.

### Apply

The Apply section lets community members submit or request inclusion:

- `/apply/profile/` for artist profiles.
- `/apply/production/` for production listings.
- `/apply/theatre/` for theatre listings.
- `/apply/audition/` for audition announcements.

Older `/submit/` URLs are preserved as aliases where applicable, but public navigation should use `/apply/`.

### About, Subscribe and Support

The site also includes:

- `content/about/` for organization and project information.
- `/signup/` for newsletter subscription.
- `/support/` for donation and support paths.
- `content/corporate-sponsors/` for sponsor records.

## Repository Structure

Important project areas:

- `content/` is the editorial and directory content source.
- `data/` contains structured data, including generated indexes.
- `static/media/` contains headshots, posters, logos, photos, programs and other static assets.
- `themes/jaxplays/` contains the custom Hugo theme, layouts, partials, shortcodes, CSS and static theme assets.
- `scripts/` contains build and data-maintenance helpers.
- `.github/workflows/` contains GitHub Pages deployment and generated-data checks.
- `workers/` contains Cloudflare Worker code used by supporting services.

## Content Model

The core content types are:

- `productions`: specific staged productions, including dates, theatre, venue, cast, crew, orchestra, showtimes, tickets, poster data and media.
- `shows`: reference entries for the underlying play or musical, separate from any single local production.
- `people`: individual artist and contributor profiles.
- `theatres`: theatre companies and producing organizations.
- `venues`: performance spaces and physical locations.
- `reviews`: critical coverage tied to productions.
- `news`: reporting, announcements and feature stories.
- `auditions`: audition notices and opportunities.

Front matter field names should be lowercase, including nested keys.

## Generated Data

Several expensive site relationships are precomputed into `data/generated/` so Hugo can build the site quickly:

- `people_credits.json` powers people profile credit lists.
- `people_lookup.json` powers production credit links to people profiles.
- `production_cards.json` powers production directory cards and search data.
- `theatre_productions.json` powers production lists on theatre profiles.
- `venue_productions.json` powers production lists on venue profiles.
- `person_reviews.json` powers review links on people profiles.

Production builds should use `scripts/build_site.sh`, which regenerates these files before running Hugo.

After editing production credits, production metadata, people names or aliases, theatre or venue names or aliases, reviews, or show poster fallbacks, run:

```bash
scripts/check_generated_data.sh
```

That check regenerates `data/generated/` and fails if the committed generated data is stale.

## People Roles

People profile roles are maintained from production credits with:

```bash
python3 scripts/update_people_roles.py --check
python3 scripts/update_people_roles.py --write
```

Run these from the repository root. If you are already inside `scripts/`, use:

```bash
python3 update_people_roles.py --root .. --check
python3 update_people_roles.py --root .. --write
```

The role updater edits real `content/people/*.md` files. It is intentionally separate from the normal Hugo build path.

## Local Development

Install dependencies as needed:

```bash
npm ci
python3 -m pip install --user PyYAML
```

Start a local Hugo server:

```bash
hugo server
```

Build the site using the generated-data wrapper:

```bash
scripts/build_site.sh --quiet
```

Production-style build:

```bash
HUGO_ENV=production scripts/build_site.sh --minify --baseURL "https://jaxplays.org/"
```

## Deployment

The GitHub Pages workflow builds and deploys from `master`. It installs Hugo, Node dependencies, Dart Sass and PyYAML, then runs:

```bash
scripts/build_site.sh --minify --baseURL "${{ steps.pages.outputs.base_url }}/"
```

There is also a generated-data workflow that checks whether `data/generated/` is current when relevant files change.

Do not treat a local Hugo build as a live publish. Deployment is controlled by the configured workflow and branch policy.

## Wikilinks

Content supports internal wikilinks through the custom Hugo partial at `themes/jaxplays/layouts/partials/content-wikilinks.html`.

Examples:

```markdown
[[person:John Smith]]
[[production:2024 Show Name]]
[[theatre:Theatre Name]]
[[venue:Venue Name]]
[[w:Wikipedia Article]]
[[person:John Smith|Johnny]]
```

These resolve to site-aware links and keep editorial content connected to the directory and production archive.

## Media

Common media locations:

- `static/media/headshots/` for people profile images.
- `static/media/photos/` for production, event and article photos.
- `static/media/posters/` for show posters.
- `static/media/logos/` for theatre and organization logos.
- `static/media/programs/` for digital programs.

Featured images should use descriptive alt text in front matter whenever possible.

## Theme

The active theme lives in `themes/jaxplays/`. It includes:

- Layouts for productions, people, theatres, venues, reviews, news, auditions and directories.
- Shared partials for navigation, cards, profile links, generated production sections, ads, search and wikilinks.
- Shortcodes for media, layout helpers, maps, PDFs, buttons, video and related embedded content.
- Custom CSS layered over Tachyons utilities.

Prefer existing theme partials and Tachyons utilities before adding new layout systems.
