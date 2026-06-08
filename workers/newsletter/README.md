# JaxPlays Newsletter Worker

Cloudflare Worker endpoint for the native homepage dashboard newsletter form.

Endpoint:

```text
POST https://api.jaxplays.org/newsletter
```

Required Worker secrets:

```bash
wrangler secret put MAILCHIMP_API_KEY
wrangler secret put MAILCHIMP_AUDIENCE_ID
wrangler secret put TURNSTILE_SECRET_KEY
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
