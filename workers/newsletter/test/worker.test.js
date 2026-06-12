import assert from "node:assert/strict";
import test from "node:test";
import {
  corsHeaders,
  handleRequest,
  isAllowedOrigin,
  md5,
  normalizeCampaignFillUrl,
  normalizeEmail,
  normalizeSubmissionType,
  normalizeSubmittedTags,
  missingSubmissionFields,
  submissionFiles,
  submissionPayload,
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
  LINEAR_API_KEY: "linear-key",
  LINEAR_LABEL_IDS: "label-one,label-two",
  LINEAR_TEAM_ID: "team-id",
  PUSHOVER_TOKEN: "pushover-token",
  PUSHOVER_USER: "pushover-user",
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

test("normalizes submission form types", () => {
  assert.equal(normalizeSubmissionType(" Production "), "production");
  assert.equal(normalizeSubmissionType("audition"), "audition");
  assert.equal(normalizeSubmissionType("spam"), "");
});

test("detects missing required submission fields", () => {
  const form = new FormData();
  form.set("form_type", "production");
  form.set("email", "person@example.com");
  form.set("submitter_name", "Person");
  form.set("theatre", "Example Theatre");
  form.set("venue", "Example Venue");
  form.set("title", "Example Show");

  assert.deepEqual(missingSubmissionFields("production", form), ["genres", "showtimes"]);

  form.append("genres", "Play");
  form.set("showtimes", "June 12 at 8 p.m.");

  assert.deepEqual(missingSubmissionFields("production", form), []);
});

test("builds a submission payload with repeated fields and file metadata", () => {
  const form = new FormData();
  form.set("form_type", "production");
  form.set("title", "Example Show");
  form.append("genres", "Play");
  form.append("genres", "Comedy");
  form.set("poster", new Blob(["fake image"], { type: "image/webp" }), "poster.webp");

  const payload = submissionPayload("production", form);

  assert.equal(payload.formType, "production");
  assert.deepEqual(payload.fields.genres, ["Play", "Comedy"]);
  assert.equal(payload.fields.title, "Example Show");
  assert.deepEqual(payload.files, [{
    field: "poster",
    name: "poster.webp",
    size: 10,
    type: "image/webp",
  }]);

  const files = submissionFiles(form);
  assert.equal(files.length, 1);
  assert.equal(files[0].field, "poster");
  assert.equal(files[0].name, "poster.webp");
});

test("creates Linear issues for verified form submissions and uploads files", async () => {
  const calls = [];
  const form = new FormData();
  form.set("form_type", "audition");
  form.set("email", "casting@example.com");
  form.set("submitter_name", "Casting Director");
  form.set("theatre", "Example Theatre");
  form.set("production_title", "Example Musical");
  form.set("audition_dates", "June 20 at 7 p.m.");
  form.set("announcement_graphic", new Blob(["fake image"], { type: "image/webp" }), "audition.webp");
  form.set("turnstileToken", "token");

  const request = new Request("https://api.jaxplays.org/submissions", {
    method: "POST",
    headers: {
      "Origin": "https://jaxplays.org",
    },
    body: form,
  });

  const response = await handleRequest(request, env, {
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });

      if (String(url).includes("siteverify")) {
        return Response.json({ success: true });
      }

      if (String(url) === "https://api.linear.app/graphql") {
        const body = JSON.parse(options.body);

        if (body.query.includes("fileUpload")) {
          return Response.json({
            data: {
              fileUpload: {
                success: true,
                uploadFile: {
                  uploadUrl: "https://uploads.linear.example/audition.webp",
                  assetUrl: "https://linear.app/file/audition.webp",
                  headers: [{ key: "x-upload-header", value: "signed" }],
                },
              },
            },
          });
        }

        return Response.json({
          data: {
            issueCreate: {
              success: true,
              issue: {
                id: "issue-id",
                identifier: "JP-1",
                url: "https://linear.app/jaxplays/issue/JP-1",
              },
            },
          },
        });
      }

      if (String(url).includes("uploads.linear.example")) {
        return Response.json({ ok: true });
      }

      if (String(url).includes("pushover.net")) {
        return Response.json({ ok: true });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls.length, 5);
  assert.equal(calls[1].url, "https://api.linear.app/graphql");
  assert.equal(calls[2].url, "https://uploads.linear.example/audition.webp");
  assert.equal(calls[2].options.method, "PUT");
  assert.equal(calls[3].url, "https://api.linear.app/graphql");

  const issueBody = JSON.parse(calls[3].options.body);
  assert.equal(issueBody.variables.input.teamId, "team-id");
  assert.deepEqual(issueBody.variables.input.labelIds, ["label-one", "label-two"]);
  assert.match(issueBody.variables.input.title, /audition submission: Example Musical/);
  assert.match(issueBody.variables.input.description, /Uploaded files/);
  assert.match(issueBody.variables.input.description, /https:\/\/linear\.app\/file\/audition\.webp/);
  assert.equal(calls[4].url, "https://api.pushover.net/1/messages.json");
});

test("emails verified submissions when Linear is not configured", async () => {
  const calls = [];
  const form = new FormData();
  form.set("form_type", "profile");
  form.set("email", "person@example.com");
  form.set("submitter_name", "Person");
  form.set("headshot", new Blob(["fake image"], { type: "image/webp" }), "headshot.webp");
  form.set("turnstileToken", "token");

  const request = new Request("https://api.jaxplays.org/submissions", {
    method: "POST",
    headers: {
      "Origin": "https://jaxplays.org",
    },
    body: form,
  });

  const response = await handleRequest(request, {
    ...env,
    LINEAR_API_KEY: "",
    LINEAR_TEAM_ID: "",
    RESEND_API_KEY: "resend-key",
    SUBMISSION_EMAIL_FROM: "JaxPlays Submissions <submissions@jaxplays.org>",
  }, {
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });

      if (String(url).includes("siteverify")) {
        return Response.json({ success: true });
      }

      if (String(url).includes("api.resend.com")) {
        return Response.json({ id: "email-id" });
      }

      if (String(url).includes("pushover.net")) {
        return Response.json({ ok: true });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, "https://api.resend.com/emails");

  const emailBody = JSON.parse(calls[1].options.body);
  assert.deepEqual(emailBody.to, ["submissions@jaxplays.org"]);
  assert.equal(emailBody.attachments[0].filename, "headshot.webp");
});

test("falls back to email when Linear rejects a verified submission", async () => {
  const calls = [];
  const form = new FormData();
  form.set("form_type", "profile");
  form.set("email", "person@example.com");
  form.set("submitter_name", "Person");
  form.set("turnstileToken", "token");

  const request = new Request("https://api.jaxplays.org/submissions", {
    method: "POST",
    headers: {
      "Origin": "https://jaxplays.org",
    },
    body: form,
  });

  const response = await handleRequest(request, {
    ...env,
    RESEND_API_KEY: "resend-key",
    SUBMISSION_EMAIL_FROM: "JaxPlays Submissions <submissions@jaxplays.org>",
  }, {
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });

      if (String(url).includes("siteverify")) {
        return Response.json({ success: true });
      }

      if (String(url) === "https://api.linear.app/graphql") {
        return Response.json({
          errors: [{ message: "Project is invalid" }],
        });
      }

      if (String(url).includes("api.resend.com")) {
        return Response.json({ id: "email-id" });
      }

      if (String(url).includes("pushover.net")) {
        return Response.json({ ok: true });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls[1].url, "https://api.linear.app/graphql");
  assert.equal(calls[2].url, "https://api.resend.com/emails");
});

test("rejects submissions when no delivery route is configured", async () => {
  const form = new FormData();
  form.set("form_type", "profile");
  form.set("email", "person@example.com");
  form.set("submitter_name", "Person");
  form.set("turnstileToken", "token");

  const request = new Request("https://api.jaxplays.org/submissions", {
    method: "POST",
    headers: {
      "Origin": "https://jaxplays.org",
    },
    body: form,
  });

  const response = await handleRequest(request, {
    ...env,
    LINEAR_API_KEY: "",
    LINEAR_TEAM_ID: "",
    RESEND_API_KEY: "",
    SUBMISSION_EMAIL_FROM: "",
  }, {
    fetch: async (url) => {
      if (String(url).includes("siteverify")) {
        return Response.json({ success: true });
      }

      throw new Error("webhook should not be called");
    },
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "submission-not-configured",
  });
});
