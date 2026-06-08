import assert from "node:assert/strict";
import test from "node:test";
import {
  corsHeaders,
  handleRequest,
  isAllowedOrigin,
  md5,
  normalizeCampaignFillUrl,
  normalizeEmail,
  normalizeSubmittedTags,
  sourceInterests,
  sourceMergeFields,
  sourceTags,
} from "../src/worker.js";

const env = {
  ALLOWED_ORIGINS: "https://jaxplays.org",
  MAILCHIMP_API_KEY: "test-key",
  MAILCHIMP_AUDIENCE_ID: "audience-id",
  MAILCHIMP_CAMPAIGN_FILL_URL_FIELD: "URLFILL",
  MAILCHIMP_INTEREST_IDS: "interest-id",
  MAILCHIMP_SERVER_PREFIX: "us21",
  NEWSLETTER_SOURCE_TAGS: "homepage-dashboard",
  TURNSTILE_SECRET_KEY: "turnstile-secret",
};

test("normalizes email values", () => {
  assert.equal(normalizeEmail("  RAY@JAXPLAYS.ORG "), "ray@jaxplays.org");
});

test("normalizes campaign fill URLs", () => {
  assert.equal(normalizeCampaignFillUrl(" https://jaxplays.org/homepage-dashboard/ "), "https://jaxplays.org/homepage-dashboard/");
  assert.equal(normalizeCampaignFillUrl("javascript:alert(1)"), "");
  assert.equal(normalizeCampaignFillUrl("not a url"), "");
});

test("normalizes submitted Mailchimp tags", () => {
  assert.deepEqual(normalizeSubmittedTags("Homepage Signup Form, homepage-dashboard"), [
    "Homepage Signup Form",
    "homepage-dashboard",
  ]);
  assert.deepEqual(normalizeSubmittedTags(["Homepage Signup Form", "Homepage Signup Form", "  "]), [
    "Homepage Signup Form",
  ]);
});

test("calculates the Mailchimp subscriber hash", () => {
  assert.equal(md5("user@example.com"), "b58996c504c5638798eb6b511e6f49af");
});

test("uses configured and submitted source tags", () => {
  assert.deepEqual(sourceTags([], env), ["homepage-dashboard"]);
  assert.deepEqual(sourceTags(["Homepage Signup Form"], {
    ...env,
    NEWSLETTER_SOURCE_TAGS: "Cloudflare worker",
  }), ["Cloudflare worker", "Homepage Signup Form"]);
  assert.deepEqual(sourceTags([], {}), []);
});

test("uses configured Mailchimp interest IDs", () => {
  assert.deepEqual(sourceInterests({ MAILCHIMP_INTEREST_IDS: "spotlight-id, weekly-id" }), {
    "spotlight-id": true,
    "weekly-id": true,
  });
  assert.deepEqual(sourceInterests({}), {});
});

test("uses configured Mailchimp merge field for campaign fill URL", () => {
  assert.deepEqual(sourceMergeFields("https://jaxplays.org/homepage-dashboard/", env), {
    URLFILL: "https://jaxplays.org/homepage-dashboard/",
  });
  assert.deepEqual(sourceMergeFields("https://jaxplays.org/homepage-dashboard/", {}), {});
});

test("rejects disallowed origins", () => {
  assert.equal(corsHeaders("https://example.com", env), null);
  assert.equal(corsHeaders("https://jaxplays.org", env)["Access-Control-Allow-Origin"], "https://jaxplays.org");
});

test("allows only local Hugo dev ports for known local hosts", () => {
  assert.equal(isAllowedOrigin("http://localhost:1313", ["https://jaxplays.org"]), true);
  assert.equal(isAllowedOrigin("http://localhost:1319", ["https://jaxplays.org"]), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:1316", ["https://jaxplays.org"]), true);
  assert.equal(isAllowedOrigin("http://local.jaxplays.org:1313", ["https://jaxplays.org"]), true);
  assert.equal(isAllowedOrigin("http://localhost:1320", ["https://jaxplays.org"]), false);
  assert.equal(isAllowedOrigin("https://localhost:1313", ["https://jaxplays.org"]), false);
  assert.equal(isAllowedOrigin("http://hollister-home-server:1314", ["https://jaxplays.org"]), false);
  assert.equal(isAllowedOrigin("http://example.com:1313", ["https://jaxplays.org"]), false);
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
      tags: ["Homepage Signup Form"],
      campaignFillUrl: "https://jaxplays.org/homepage-dashboard/",
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
    interests: {
      "interest-id": true,
    },
    merge_fields: {
      URLFILL: "https://jaxplays.org/homepage-dashboard/",
    },
    status_if_new: "subscribed",
    tags: ["homepage-dashboard", "Homepage Signup Form"],
  });
});

test("does not use submitted source as a Mailchimp tag", async () => {
  const calls = [];
  const request = new Request("https://api.jaxplays.org/newsletter", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://jaxplays.org",
    },
    body: JSON.stringify({
      email: "Person@Example.com",
      website: "",
      turnstileToken: "token",
      source: "homepage-dashboard",
      tags: "Homepage Signup Form",
      campaignFillUrl: "https://jaxplays.org/homepage-dashboard/",
    }),
  });

  const response = await handleRequest(request, {
    ...env,
    NEWSLETTER_SOURCE_TAGS: "Cloudflare worker",
  }, {
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });

      if (String(url).includes("siteverify")) {
        return Response.json({ success: true });
      }

      return Response.json({ id: "member-id" });
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(calls[1].options.body).tags, ["Cloudflare worker", "Homepage Signup Form"]);
});

test("returns sanitized Mailchimp rejection details", async () => {
  const request = new Request("https://api.jaxplays.org/newsletter", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://jaxplays.org",
    },
    body: JSON.stringify({
      email: "person@example.com",
      website: "",
      turnstileToken: "token",
    }),
  });

  const response = await handleRequest(request, env, {
    fetch: async (url) => {
      if (String(url).includes("siteverify")) {
        return Response.json({ success: true });
      }

      return Response.json({ title: "Invalid Resource", detail: "The resource submitted could not be validated." }, { status: 400 });
    },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "mailchimp-rejected",
    detail: "Invalid Resource: The resource submitted could not be validated.",
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
