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
- allows only configured JaxPlays/local origins
- uses Mailchimp single opt-in with `status_if_new: subscribed`
- adds the `homepage-dashboard` source tag by default

Local validation:

```bash
npm test
```

Deploy:

```bash
npm run deploy
```
