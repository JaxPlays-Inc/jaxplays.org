import assert from "node:assert/strict";
import test from "node:test";
import { corsHeaders, handleRequest, md5, normalizeEmail, normalizeSource, sourceTags } from "../src/worker.js";

const env = {
  ALLOWED_ORIGINS: "https://jaxplays.org",
  MAILCHIMP_API_KEY: "test-key",
  MAILCHIMP_AUDIENCE_ID: "audience-id",
  MAILCHIMP_SERVER_PREFIX: "us21",
  NEWSLETTER_SOURCE_TAGS: "homepage-dashboard",
  TURNSTILE_SECRET_KEY: "turnstile-secret",
};

test("normalizes email and source values", () => {
  assert.equal(normalizeEmail("  RAY@JAXPLAYS.ORG "), "ray@jaxplays.org");
  assert.equal(normalizeSource("Homepage Dashboard!"), "homepage-dashboard");
});

test("calculates the Mailchimp subscriber hash", () => {
  assert.equal(md5("user@example.com"), "b58996c504c5638798eb6b511e6f49af");
});

test("uses configured and submitted source tags", () => {
  assert.deepEqual(sourceTags("homepage-dashboard", env), ["homepage-dashboard"]);
  assert.deepEqual(sourceTags("footer", env), ["homepage-dashboard", "footer"]);
});

test("rejects disallowed origins", () => {
  assert.equal(corsHeaders("https://example.com", env), null);
  assert.equal(corsHeaders("https://jaxplays.org", env)["Access-Control-Allow-Origin"], "https://jaxplays.org");
});

test("submits verified subscribers to Mailchimp", async () => {
  const calls = [];
  const request = new Request("https://api.jaxplays.org/newsletter", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://jaxplays.org",
      "CF-Connecting-IP": "203.0.113.10",
    },
    body: JSON.stringify({
      email: "Person@Example.com",
      website: "",
      turnstileToken: "token",
      source: "homepage-dashboard",
    }),
  });

  const response = await handleRequest(request, env, {
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });

      if (String(url).includes("siteverify")) {
        return Response.json({ success: true });
      }

      return Response.json({ id: "member-id" });
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /lists\/audience-id\/members\/7de8517bce4457e8390aa4006a1880fb$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    email_address: "person@example.com",
    status_if_new: "subscribed",
    tags: ["homepage-dashboard"],
  });
});

test("rejects honeypot submissions before external calls", async () => {
  const request = new Request("https://api.jaxplays.org/newsletter", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://jaxplays.org",
    },
    body: JSON.stringify({
      email: "person@example.com",
      website: "spam",
      turnstileToken: "token",
    }),
  });

  const response = await handleRequest(request, env, {
    fetch: async () => {
      throw new Error("fetch should not be called");
    },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: "spam-detected" });
});
