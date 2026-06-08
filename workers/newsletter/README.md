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
- adds the `homepage-dashboard` source tag by default
- assigns configured Mailchimp group interests with `MAILCHIMP_INTEREST_IDS`
- sends the submitting page URL to the configured `MAILCHIMP_CAMPAIGN_FILL_URL_FIELD` merge field

Mailchimp newsletter interest IDs:

```text
1 = JaxPlays Spotlight
4 = Fundraising Emails
2 = News & Reviews
```

Local validation:

```bash
npm test
```

Deploy:

```bash
npm run deploy
```
