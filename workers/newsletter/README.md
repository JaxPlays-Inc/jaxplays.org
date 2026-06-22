# JaxPlays API Worker

Cloudflare Worker endpoint for JaxPlays public API routes.

Endpoint:

```text
POST https://api.jaxplays.org/newsletter
POST https://api.jaxplays.org/submissions
```

Required Worker secrets:

```bash
wrangler secret put MAILCHIMP_API_KEY
wrangler secret put MAILCHIMP_AUDIENCE_ID
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put LINEAR_API_KEY
wrangler secret put LINEAR_TEAM_ID
wrangler secret put PUSHOVER_TOKEN
wrangler secret put PUSHOVER_USER
```

Configured behavior:

- verifies Cloudflare Turnstile before Mailchimp is called
- rejects filled honeypot fields
- allows configured production origins plus local Hugo dev origins on ports `1313-1319`
- uses Mailchimp single opt-in with `status_if_new: subscribed`
- adds configured Worker-level Mailchimp tags with `NEWSLETTER_SOURCE_TAGS`
- adds page-submitted Mailchimp tags from the JSON `tags` field
- assigns configured Mailchimp group interests with `MAILCHIMP_INTEREST_IDS`
- sends the submitting page URL to the configured `MAILCHIMP_CAMPAIGN_FILL_URL_FIELD` merge field
- accepts native JaxPlays submit forms for `profile`, `production`, `theatre`, and `audition`
- verifies Cloudflare Turnstile before delivering submissions
- subscribes submitters to Mailchimp when the native submit form email communications checkbox is checked
- tags opted-in native submit form subscribers with `Cloudflare Worker` and the submitted form name
- creates Linear issues when `LINEAR_API_KEY` and `LINEAR_TEAM_ID` are configured
- uploads submitted files to Linear through the server-side signed upload flow and links them in the issue description
- sends fallback email to `SUBMISSION_EMAIL_TO` through Resend when Linear is not configured or unavailable
- sends a non-blocking Pushover notification when `PUSHOVER_TOKEN` and `PUSHOVER_USER` are configured

Optional submission configuration:

```bash
wrangler secret put LINEAR_PROJECT_ID
wrangler secret put LINEAR_LABEL_IDS
wrangler secret put RESEND_API_KEY
wrangler secret put SUBMISSION_EMAIL_FROM
wrangler secret put SUBMISSION_EMAIL_TO
```

`SUBMISSION_EMAIL_TO` defaults to `submissions@jaxplays.org`, but `SUBMISSION_EMAIL_FROM` must be a Resend-verified sender. Fallback email attachments are capped by `SUBMISSION_EMAIL_ATTACHMENT_LIMIT`, which defaults to 10 MB.

The Worker does not use `source` as a Mailchimp tag. Mailchimp tags come only from `NEWSLETTER_SOURCE_TAGS` and the submitted JSON `tags` field.

Mailchimp newsletter interest IDs must be Marketing API interest IDs, not hosted-form checkbox values.
The public signup form values like `group[2200][1]` are not valid for the `interests` payload.

Newsletters category:

```text
dcfb52b733 = Newsletters
```

Newsletter interest IDs:

```text
98e7fe4901 = JaxPlays Spotlight
21aacbee05 = Fundraising Emails
dab2ddf414 = News & Reviews
```

Fetch/reconfirm the API IDs with:

```text
GET /3.0/lists/{list_id}/interest-categories
GET /3.0/lists/{list_id}/interest-categories/{interest_category_id}/interests
```

Local validation:

```bash
npm test
```

Deploy:

```bash
npm run deploy
```
