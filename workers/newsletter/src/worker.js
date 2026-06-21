const DEFAULT_ALLOWED_ORIGINS = [
  "https://jaxplays.org",
  "https://www.jaxplays.org",
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "local.jaxplays.org"]);
const LOCAL_DEV_MIN_PORT = 1313;
const LOCAL_DEV_MAX_PORT = 1319;
const SUBMISSION_TYPES = new Set(["profile", "production", "theatre", "audition", "corporate_sponsor"]);
const LINEAR_API_URL = "https://api.linear.app/graphql";
const RESEND_API_URL = "https://api.resend.com/emails";
const PUSHOVER_API_URL = "https://api.pushover.net/1/messages.json";
const SUBMISSION_REQUIRED_FIELDS = {
  profile: ["email", "submitter_name"],
  production: ["email", "submitter_name", "theatre", "venue", "genres", "title", "showtimes"],
  theatre: ["email", "submitter_name", "theatre_name", "logo"],
  audition: ["email", "submitter_name", "theatre", "production_title"],
  corporate_sponsor: ["email", "submitter_name", "organization", "message"],
};

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request, env, services = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") || "";
  const cors = corsHeaders(origin, env);

  if (!cors) {
    return json({ ok: false, error: "origin-not-allowed" }, 403);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== "POST") {
    return json({ ok: false, error: "method-not-allowed" }, 405, cors);
  }

  if (url.pathname === "/newsletter") {
    return handleNewsletter(request, env, cors, services);
  }

  if (url.pathname === "/submissions") {
    return handleSubmission(request, env, cors, services);
  }

  return json({ ok: false, error: "not-found" }, 404, cors);
}

async function handleNewsletter(request, env, cors, services = {}) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "invalid-json" }, 400, cors);
  }

  const email = normalizeEmail(payload.email);
  const honeypot = String(payload.website || "").trim();
  const turnstileToken = String(payload.turnstileToken || "").trim();
  const submittedTags = normalizeSubmittedTags(payload.tags);
  const campaignFillUrl = normalizeCampaignFillUrl(payload.campaignFillUrl);

  if (honeypot) {
    return json({ ok: false, error: "spam-detected" }, 400, cors);
  }

  if (!email || !EMAIL_PATTERN.test(email)) {
    return json({ ok: false, error: "invalid-email" }, 400, cors);
  }

  if (!turnstileToken) {
    return json({ ok: false, error: "turnstile-required" }, 400, cors);
  }

  const remoteIp = request.headers.get("CF-Connecting-IP") || undefined;
  const turnstile = await verifyTurnstile(turnstileToken, remoteIp, env, services.fetch || fetch);

  if (!turnstile.success) {
    return json({ ok: false, error: "turnstile-failed" }, 400, cors);
  }

  const mailchimp = await subscribeToMailchimp(email, submittedTags, campaignFillUrl, env, services.fetch || fetch);

  if (!mailchimp.ok) {
    return json({ ok: false, error: mailchimp.error, detail: mailchimp.detail }, mailchimp.status || 502, cors);
  }

  return json({ ok: true }, 200, cors);
}

async function handleSubmission(request, env, cors, services = {}) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: "invalid-form-data" }, 400, cors);
  }

  const honeypot = String(formData.get("_gotcha") || "").trim();
  const turnstileToken = String(formData.get("turnstileToken") || formData.get("cf-turnstile-response") || "").trim();
  const formType = normalizeSubmissionType(formData.get("form_type"));

  if (honeypot) {
    return json({ ok: false, error: "spam-detected" }, 400, cors);
  }

  if (!formType) {
    return json({ ok: false, error: "invalid-form-type" }, 400, cors);
  }

  if (!turnstileToken) {
    return json({ ok: false, error: "turnstile-required" }, 400, cors);
  }

  const missing = missingSubmissionFields(formType, formData);

  if (missing.length) {
    return json({ ok: false, error: "missing-required-fields", fields: missing }, 400, cors);
  }

  const remoteIp = request.headers.get("CF-Connecting-IP") || undefined;
  const turnstile = await verifyTurnstile(turnstileToken, remoteIp, env, services.fetch || fetch);

  if (!turnstile.success) {
    return json({ ok: false, error: "turnstile-failed" }, 400, cors);
  }

  const payload = submissionPayload(formType, formData);
  const files = submissionFiles(formData);
  const forwarded = await routeSubmission(payload, files, env, services.fetch || fetch);

  if (!forwarded.ok) {
    return json({ ok: false, error: forwarded.error, detail: forwarded.detail }, forwarded.status || 502, cors);
  }

  return json({ ok: true }, 200, cors);
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizeCampaignFillUrl(url) {
  const normalized = String(url || "").trim();

  if (!normalized) {
    return "";
  }

  try {
    const parsed = new URL(normalized);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }

    return parsed.href.slice(0, 255);
  } catch {
    return "";
  }
}

export function normalizeSubmittedTags(tags) {
  const rawTags = Array.isArray(tags) ? tags : String(tags || "").split(",");

  return Array.from(new Set(
    rawTags
      .map((tag) => String(tag || "").trim())
      .filter(Boolean)
      .map((tag) => tag.slice(0, 100))
  ));
}

export function normalizeSubmissionType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return SUBMISSION_TYPES.has(normalized) ? normalized : "";
}

export function missingSubmissionFields(formType, formData) {
  return (SUBMISSION_REQUIRED_FIELDS[formType] || []).filter((field) => {
    const values = formData.getAll(field);
    return !values.some(hasSubmissionValue);
  });
}

export function submissionPayload(formType, formData) {
  const fields = {};
  const files = [];

  for (const [key, value] of formData.entries()) {
    if (["cf-turnstile-response", "turnstileToken", "_gotcha"].includes(key)) {
      continue;
    }

    if (isFileLike(value)) {
      if (value.size > 0) {
        files.push({
          field: key,
          name: value.name || "upload",
          size: value.size,
          type: value.type || "application/octet-stream",
        });
      }
      continue;
    }

    addFieldValue(fields, key, String(value || "").trim());
  }

  return {
    formType,
    submittedAt: new Date().toISOString(),
    fields,
    files,
  };
}

export function submissionFiles(formData) {
  const files = [];

  for (const [key, value] of formData.entries()) {
    if (isFileLike(value) && value.size > 0) {
      files.push({
        field: key,
        file: value,
        name: value.name || "upload",
        size: value.size,
        type: value.type || "application/octet-stream",
      });
    }
  }

  return files;
}

async function routeSubmission(payload, files, env, fetchImpl) {
  const hasLinear = env.LINEAR_API_KEY && env.LINEAR_TEAM_ID;
  let result;

  if (hasLinear) {
    result = await createLinearIssue(payload, files, env, fetchImpl);

    if (result.ok) {
      await notifyPushover(payload, result, env, fetchImpl);
      return result;
    }
  }

  const emailResult = await sendSubmissionEmail(payload, files, env, fetchImpl);

  if (emailResult.ok) {
    await notifyPushover(payload, emailResult, env, fetchImpl);
    return emailResult;
  }

  if (!hasLinear && emailResult.error === "submission-not-configured") {
    return { ok: false, status: 500, error: "submission-not-configured" };
  }

  return emailResult.error === "submission-not-configured" && result ? result : emailResult;
}

async function createLinearIssue(payload, files, env, fetchImpl) {
  try {
    const uploadedFiles = [];

    for (const file of files) {
      uploadedFiles.push(await uploadLinearFile(file, env, fetchImpl));
    }

    const response = await linearGraphql(env, fetchImpl, `
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            url
          }
        }
      }
    `, {
      input: linearIssueInput(payload, uploadedFiles, env),
    });

    const issueCreate = response.data?.issueCreate;

    if (!issueCreate?.success || !issueCreate.issue) {
      return { ok: false, status: 502, error: "linear-rejected", detail: firstGraphqlError(response) };
    }

    return {
      ok: true,
      destination: "linear",
      issue: issueCreate.issue,
      url: issueCreate.issue.url,
    };
  } catch (error) {
    return { ok: false, status: 502, error: "linear-unavailable", detail: error.message };
  }
}

async function uploadLinearFile(file, env, fetchImpl) {
  const uploadPayload = await linearGraphql(env, fetchImpl, `
    mutation RequestUpload($filename: String!, $contentType: String!, $size: Int!) {
      fileUpload(filename: $filename, contentType: $contentType, size: $size) {
        success
        uploadFile {
          uploadUrl
          assetUrl
          headers {
            key
            value
          }
        }
      }
    }
  `, {
    filename: file.name,
    contentType: file.type,
    size: file.size,
  });

  const upload = uploadPayload.data?.fileUpload;

  if (!upload?.success || !upload.uploadFile?.uploadUrl || !upload.uploadFile?.assetUrl) {
    throw new Error(firstGraphqlError(uploadPayload) || `Linear upload URL rejected ${file.name}`);
  }

  const headers = new Headers();
  headers.set("Content-Type", file.type);
  headers.set("Cache-Control", "public, max-age=31536000");

  for (const header of upload.uploadFile.headers || []) {
    headers.set(header.key, header.value);
  }

  const uploadResponse = await fetchImpl(upload.uploadFile.uploadUrl, {
    method: "PUT",
    headers,
    body: file.file,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Linear file upload failed for ${file.name}`);
  }

  return {
    field: file.field,
    name: file.name,
    size: file.size,
    type: file.type,
    url: upload.uploadFile.assetUrl,
  };
}

async function linearGraphql(env, fetchImpl, query, variables) {
  const response = await fetchImpl(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Authorization": env.LINEAR_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(firstGraphqlError(body) || `Linear returned ${response.status}`);
  }

  return body;
}

function linearIssueInput(payload, uploadedFiles, env) {
  const input = {
    teamId: env.LINEAR_TEAM_ID,
    title: submissionTitle(payload),
    description: submissionMarkdown(payload, uploadedFiles),
  };

  if (env.LINEAR_PROJECT_ID) {
    input.projectId = env.LINEAR_PROJECT_ID;
  }

  const labelIds = parseCsv(env.LINEAR_LABEL_IDS);

  if (labelIds.length) {
    input.labelIds = labelIds;
  }

  return input;
}

async function sendSubmissionEmail(payload, files, env, fetchImpl) {
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const to = String(env.SUBMISSION_EMAIL_TO || "submissions@jaxplays.org").trim();
  const from = String(env.SUBMISSION_EMAIL_FROM || "").trim();

  if (!apiKey || !to || !from) {
    return { ok: false, status: 500, error: "submission-not-configured" };
  }

  const email = {
    from,
    to: [to],
    subject: submissionTitle(payload),
    text: submissionEmailText(payload, files),
  };

  const attachments = await emailAttachments(files, env);

  if (attachments.length) {
    email.attachments = attachments;
  }

  const response = await fetchImpl(RESEND_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(email),
  });

  if (response.ok) {
    return { ok: true, destination: "email" };
  }

  if (response.status >= 400 && response.status < 500) {
    return { ok: false, status: 400, error: "submission-rejected", detail: await responseText(response) };
  }

  return { ok: false, status: 502, error: "submission-unavailable" };
}

async function notifyPushover(payload, result, env, fetchImpl) {
  if (!env.PUSHOVER_TOKEN || !env.PUSHOVER_USER) {
    return;
  }

  const body = new FormData();
  body.set("token", env.PUSHOVER_TOKEN);
  body.set("user", env.PUSHOVER_USER);
  body.set("title", "JaxPlays submission");
  body.set("message", `${titleForType(payload.formType)}: ${primarySubmissionName(payload)}`);

  if (result.url) {
    body.set("url", result.url);
    body.set("url_title", "Open Linear issue");
  }

  try {
    await fetchImpl(PUSHOVER_API_URL, {
      method: "POST",
      body,
    });
  } catch {
    // Submission delivery should not fail because a notification did.
  }
}

export function corsHeaders(origin, env = {}) {
  const allowedOrigins = parseCsv(env.ALLOWED_ORIGINS);
  const allowed = allowedOrigins.length ? allowedOrigins : DEFAULT_ALLOWED_ORIGINS;

  if (!isAllowedOrigin(origin, allowed)) {
    return null;
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

async function verifyTurnstile(token, remoteIp, env, fetchImpl) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return { success: false };
  }

  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET_KEY);
  body.append("response", token);

  if (remoteIp) {
    body.append("remoteip", remoteIp);
  }

  const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });

  if (!response.ok) {
    return { success: false };
  }

  return response.json();
}

async function subscribeToMailchimp(email, submittedTags, campaignFillUrl, env, fetchImpl) {
  const apiKey = env.MAILCHIMP_API_KEY;
  const audienceId = env.MAILCHIMP_AUDIENCE_ID;
  const serverPrefix = env.MAILCHIMP_SERVER_PREFIX;

  if (!apiKey || !audienceId || !serverPrefix) {
    return { ok: false, status: 500, error: "mailchimp-not-configured" };
  }

  const subscriberHash = md5(email);
  const tags = sourceTags(submittedTags, env);
  const interests = sourceInterests(env);
  const mergeFields = sourceMergeFields(campaignFillUrl, env);
  const url = `https://${serverPrefix}.api.mailchimp.com/3.0/lists/${audienceId}/members/${subscriberHash}`;
  const body = {
    email_address: email,
    status_if_new: "subscribed",
  };

  if (tags.length) {
    body.tags = tags;
  }

  if (Object.keys(interests).length) {
    body.interests = interests;
  }

  if (Object.keys(mergeFields).length) {
    body.merge_fields = mergeFields;
  }

  const response = await fetchImpl(url, {
    method: "PUT",
    headers: {
      "Authorization": `Basic ${btoa(`jaxplays:${apiKey}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.ok) {
    return { ok: true };
  }

  if (response.status === 400 || response.status === 404) {
    return { ok: false, status: 400, error: "mailchimp-rejected", detail: await mailchimpErrorDetail(response) };
  }

  return { ok: false, status: 502, error: "mailchimp-unavailable" };
}

async function mailchimpErrorDetail(response) {
  const fallback = `Mailchimp returned ${response.status}`;

  try {
    const data = await response.json();
    return [data.title, data.detail].filter(Boolean).join(": ").slice(0, 240) || fallback;
  } catch {
    return fallback;
  }
}

export function sourceTags(submittedTags = [], env = {}) {
  const configuredTags = parseCsv(env.NEWSLETTER_SOURCE_TAGS);
  const tags = configuredTags.concat(normalizeSubmittedTags(submittedTags));

  return Array.from(new Set(tags.filter(Boolean)));
}

export function sourceInterests(env = {}) {
  return parseCsv(env.MAILCHIMP_INTEREST_IDS).reduce((interests, interestId) => {
    interests[interestId] = true;
    return interests;
  }, {});
}

export function sourceMergeFields(campaignFillUrl, env = {}) {
  const field = String(env.MAILCHIMP_CAMPAIGN_FILL_URL_FIELD || "").trim().toUpperCase();

  if (!field || !campaignFillUrl) {
    return {};
  }

  return {
    [field]: campaignFillUrl,
  };
}

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
  });
}

export function isAllowedOrigin(origin, allowedOrigins = DEFAULT_ALLOWED_ORIGINS) {
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    const port = Number(url.port);

    return (
      url.protocol === "http:" &&
      LOCAL_DEV_HOSTS.has(url.hostname) &&
      Number.isInteger(port) &&
      port >= LOCAL_DEV_MIN_PORT &&
      port <= LOCAL_DEV_MAX_PORT
    );
  } catch {
    return false;
  }
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasSubmissionValue(value) {
  if (isFileLike(value)) {
    return value.size > 0;
  }

  return String(value || "").trim().length > 0;
}

function isFileLike(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.name === "string" &&
    typeof value.size === "number" &&
    typeof value.arrayBuffer === "function"
  );
}

function addFieldValue(fields, key, value) {
  if (!value) {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(fields, key)) {
    fields[key] = Array.isArray(fields[key]) ? fields[key].concat(value) : [fields[key], value];
    return;
  }

  fields[key] = value;
}

function submissionTitle(payload) {
  return `JaxPlays ${titleForType(payload.formType)} submission: ${primarySubmissionName(payload)}`;
}

function titleForType(formType) {
  return {
    audition: "audition",
    corporate_sponsor: "corporate sponsor",
    production: "production",
    profile: "profile",
    theatre: "theatre",
  }[formType] || "content";
}

function primarySubmissionName(payload) {
  const fields = payload.fields || {};
  return String(
    fields.production_title ||
    fields.title ||
    fields.theatre_name ||
    fields.organization ||
    fields.submitter_name ||
    "Untitled"
  ).trim();
}

export function generatedContentMarkdown(payload, uploadedFiles = []) {
  if (payload.formType === "profile") {
    return generatedProfileMarkdown(payload, uploadedFiles);
  }

  if (payload.formType === "production") {
    return generatedProductionMarkdown(payload, uploadedFiles);
  }

  if (payload.formType === "theatre") {
    return generatedTheatreMarkdown(payload, uploadedFiles);
  }

  if (payload.formType === "audition") {
    return generatedAuditionMarkdown(payload, uploadedFiles);
  }

  return "";
}

function generatedProfileMarkdown(payload, uploadedFiles = []) {
  const fields = payload.fields || {};
  const title = String(fields.submitter_name || "").trim() || "Untitled";
  const otherNames = splitLines(fields.other_names);
  const headshot = uploadedFiles.find((file) => file.field === "headshot");
  const featuredImage = headshot ? `${filenameBase(title)}${fileExtension(headshot.name)}` : "";
  const socials = {
    facebook: socialHandle(fields.facebook, "facebook"),
    twitter: socialHandle(fields.twitter, "twitter"),
    instagram: socialHandle(fields.instagram, "instagram"),
    linkedin: socialHandle(fields.linkedin, "linkedin"),
    ibdb: socialHandle(fields.ibdb, "ibdb"),
    imdb: socialHandle(fields.imdb, "imdb"),
    website: String(fields.website || "").trim(),
    bluesky: socialHandle(fields.bluesky, "bluesky"),
    backstage: socialHandle(fields.backstage, "backstage"),
    threads: socialHandle(fields.threads, "threads"),
  };

  const lines = [
    "---",
    `title: ${yamlScalar(title)}`,
  ];

  if (otherNames.length) {
    lines.push("aliases:");

    for (const name of otherNames) {
      lines.push(`  - /people/${slugify(name)}`);
    }

    lines.push("other_names:");

    for (const name of otherNames) {
      lines.push(`  - ${yamlScalar(name)}`);
    }
  } else {
    lines.push("aliases: []", "other_names: []");
  }

  lines.push(
    `date: ${yamlScalar(payload.submittedAt || new Date().toISOString())}`,
    `featured_image: ${yamlScalar(featuredImage)}`,
    `featured_image_attr: ${yamlScalar(fields.headshot_credit || "")}`,
    "featured_image_attr_link: ",
    `featured_image_alt: ${yamlScalar(featuredImage ? `Headshot of ${title}` : "")}`,
    `featured_image_caption: ${yamlScalar(featuredImage ? `Headshot of ${title}` : "")}`,
    "roles: []",
    "socials:"
  );

  for (const [key, value] of Object.entries(socials)) {
    lines.push(`  ${key}: ${yamlScalar(value)}`);
  }

  lines.push("---");

  const biography = String(fields.biography || "").trim();

  if (biography) {
    lines.push("", biography);
  }

  if (headshot) {
    lines.push(
      "",
      "## Submission asset note",
      "",
      `Download the submitted headshot from Linear and save it as \`static/media/headshots/${featuredImage}\`.`,
      `Original upload: [${headshot.name}](${headshot.url}) (${formatBytes(headshot.size)}, ${headshot.type})`
    );
  }

  return lines.join("\n");
}

function generatedProductionMarkdown(payload, uploadedFiles = []) {
  const fields = payload.fields || {};
  const title = String(fields.title || "").trim() || "Untitled";
  const poster = uploadedFiles.find((file) => file.field === "poster");
  const program = uploadedFiles.find((file) => file.field === "program");
  const featuredImage = poster ? `${filenameBase(title)}${fileExtension(poster.name)}` : "";
  const programFile = program ? `${filenameBase(title)}-program${fileExtension(program.name)}` : "";
  const genres = normalizeList(fields.genres).concat(splitLines(fields.other_genres));

  const lines = [
    "---",
    `title: ${yamlScalar(title)}`,
    `theatre: ${yamlScalar(fields.theatre || "")}`,
    `venue: ${yamlScalar(fields.venue || "")}`,
    "season: ",
    `date: ${yamlScalar(payload.submittedAt || new Date().toISOString())}`,
    "opening_date: ",
    "closing_date: ",
    "showtimes: []",
    `featured_image: ${yamlScalar(featuredImage)}`,
    `featured_image_alt: ${yamlScalar(featuredImage ? `Poster for ${title}` : "")}`,
    `featured_image_caption: ${yamlScalar(featuredImage ? `Poster for ${title}` : "")}`,
    `featured_image_attr: ${yamlScalar(fields.poster_credit || "")}`,
    "featured_image_attr_link: ",
    `program: ${yamlScalar(programFile)}`,
    `website: ${yamlScalar(fields.web_page || "")}`,
    `tickets: ${yamlScalar(fields.ticket_link || "")}`,
    "cast: []",
    "understudies: []",
    "crew: []",
    "orchestra: []",
  ];

  if (genres.length) {
    lines.push("genres:");
    lines.push(...yamlListLines(genres));
  } else {
    lines.push("genres: []");
  }

  lines.push(
    `description: ${yamlScalar(fields.description || "")}`,
    "source: Submitted through JaxPlays production form",
    `source_date: ${yamlScalar(dateOnly(payload.submittedAt))}`,
    `source_url: ${yamlScalar(fields.source_url || "")}`,
    "---"
  );

  const synopsis = String(fields.synopsis || "").trim();

  if (synopsis) {
    lines.push("", synopsis);
  }

  const noteSections = [
    ["Showtimes submitted", fields.showtimes],
    ["Other venue details", fields.other_venue],
    ["Cast submitted", fields.cast],
    ["Understudies submitted", fields.understudies],
    ["Crew submitted", fields.crew],
    ["Orchestra submitted", fields.orchestra],
  ];

  appendRawSections(lines, noteSections);
  appendProductionAssetNotes(lines, poster, program, featuredImage, programFile);

  return lines.join("\n");
}

function generatedTheatreMarkdown(payload, uploadedFiles = []) {
  const fields = payload.fields || {};
  const title = String(fields.theatre_name || "").trim() || "Untitled Theatre";
  const logo = uploadedFiles.find((file) => file.field === "logo");
  const featuredImage = logo ? `${filenameBase(title)}${fileExtension(logo.name)}` : "";
  const socials = {
    facebook: socialHandle(fields.facebook, "facebook"),
    twitter: socialHandle(fields.twitter, "twitter"),
    instagram: socialHandle(fields.instagram, "instagram"),
    linkedin: socialHandle(fields.linkedin, "linkedin"),
    website: String(fields.website || "").trim(),
    threads: socialHandle(fields.threads, "threads"),
  };

  const lines = [
    "---",
    `title: ${yamlScalar(title)}`,
    "layout: profile",
    "active: true",
    "company_type: ",
    `featured_image: ${yamlScalar(featuredImage)}`,
    `featured_image_attr: ${yamlScalar(fields.logo_credit || "")}`,
    `featured_image_alt: ${yamlScalar(featuredImage ? `Logo for ${title}` : "")}`,
    `featured_image_caption: ${yamlScalar(featuredImage ? `Logo for ${title}` : "")}`,
    `description: ${yamlScalar(shortDescription(fields.history))}`,
    `founded: ${yamlScalar(fields.founded || "")}`,
  ];

  const address = String(fields.venue_address || "").trim();

  if (address) {
    lines.push("address: |");
    lines.push(...indentLines(address, "  "));
  } else {
    lines.push("address: ");
  }

  lines.push("socials:");

  for (const [key, value] of Object.entries(socials)) {
    lines.push(`  ${key}: ${yamlScalar(value)}`);
  }

  lines.push(
    `phone: ${yamlScalar(fields.phone || "")}`,
    `color: ${yamlScalar(fields.theatre_color || "")}`,
    `date: ${yamlScalar(payload.submittedAt || new Date().toISOString())}`,
    "---"
  );

  const history = String(fields.history || "").trim();

  if (history) {
    lines.push("", history);
  }

  const venueNotes = [
    ["Dedicated venue", normalizeList(fields.has_venue).join(", ")],
    ["Venue name", fields.venue_name],
    ["Venue address", fields.venue_address],
  ];

  appendRawSections(lines, venueNotes);
  appendTheatreAssetNotes(lines, logo, featuredImage);

  return lines.join("\n");
}

function generatedAuditionMarkdown(payload, uploadedFiles = []) {
  const fields = payload.fields || {};
  const theatre = String(fields.theatre || "").trim() || "Untitled Theatre";
  const productionTitle = String(fields.production_title || "").trim() || "Untitled Production";
  const announcementGraphic = uploadedFiles.find((file) => file.field === "announcement_graphic");
  const featuredImage = announcementGraphic
    ? `${dateOnly(payload.submittedAt)}-${slugify(theatre)}-${slugify(productionTitle)}-auditions${fileExtension(announcementGraphic.name)}`
    : "";
  const articleTitle = `${theatre} Announces '${productionTitle}' Auditions`;
  const description = String(fields.description || "").trim()
    || `${theatre} will hold auditions for *${productionTitle}*.`;

  const lines = [
    "---",
    `title: ${yamlScalar(articleTitle)}`,
    `date: ${yamlScalar(payload.submittedAt || new Date().toISOString())}`,
    "authors:",
    "- JaxPlays",
    "show_reading_time: true",
    `description: ${yamlScalar(description)}`,
  ];

  if (featuredImage) {
    lines.push(
      "featured_image:",
      `  src: ${yamlScalar(`/media/photos/${featuredImage}`)}`,
      `  alt: ${yamlScalar(`Audition announcement graphic for ${theatre}'s ${productionTitle}.`)}`,
      `  caption: ${yamlScalar(`${theatre} will hold auditions for *${productionTitle}*.`)}`,
      "  credit:",
      `    name: ${yamlScalar(theatre)}`
    );
  } else {
    lines.push("featured_image:");
  }

  lines.push("---");

  const announcementText = String(fields.announcement_text || "").trim();

  if (announcementText) {
    lines.push("", announcementText);
  } else {
    lines.push("", `[[theatre:${theatre}]] will hold auditions for *${productionTitle}*.`);
    appendRawSections(lines, [
      ["Audition Dates and Times", fields.audition_dates],
      ["Audition Location", fields.audition_location],
      ["Roles", fields.roles],
      ["Preparation", fields.preparation],
    ]);

    if (fields.signup_link || fields.web_page) {
      lines.push("", "## Links", "");

      if (fields.signup_link) {
        lines.push(`- [Audition sign-up](${fields.signup_link})`);
      }

      if (fields.web_page) {
        lines.push(`- [Audition information](${fields.web_page})`);
      }
    }
  }

  appendRawSections(lines, [
    ["Submitter notes", fields.notes],
  ]);
  appendAuditionAssetNotes(lines, announcementGraphic, featuredImage);

  return lines.join("\n");
}

function submissionMarkdown(payload, uploadedFiles = []) {
  const generated = generatedContentMarkdown(payload, uploadedFiles);
  const lines = [
    ...(generated ? [
      "## Copy/paste content draft",
      "",
      "```markdown",
      generated,
      "```",
      "",
      "## Submission details",
      "",
    ] : []),
    `Submitted through the JaxPlays ${titleForType(payload.formType)} form.`,
    "",
    `- Submitted at: ${payload.submittedAt}`,
  ];

  for (const [key, value] of Object.entries(payload.fields || {})) {
    lines.push(`- ${humanizeFieldName(key)}: ${formatFieldValue(value)}`);
  }

  if (uploadedFiles.length) {
    lines.push("", "## Uploaded files");

    for (const file of uploadedFiles) {
      lines.push(`- ${humanizeFieldName(file.field)}: [${file.name}](${file.url}) (${formatBytes(file.size)}, ${file.type})`);
    }
  }

  return lines.join("\n");
}

function submissionEmailText(payload, files = []) {
  const lines = [
    submissionTitle(payload),
    "",
    `Submitted at: ${payload.submittedAt}`,
    "",
  ];

  for (const [key, value] of Object.entries(payload.fields || {})) {
    lines.push(`${humanizeFieldName(key)}: ${formatFieldValue(value)}`);
  }

  if (files.length) {
    lines.push("", "Attached files:");

    for (const file of files) {
      lines.push(`- ${humanizeFieldName(file.field)}: ${file.name} (${formatBytes(file.size)}, ${file.type})`);
    }
  }

  return lines.join("\n");
}

async function emailAttachments(files, env) {
  const maxBytes = Number(env.SUBMISSION_EMAIL_ATTACHMENT_LIMIT || 10 * 1024 * 1024);
  const attachments = [];
  let totalBytes = 0;

  for (const file of files) {
    if (totalBytes + file.size > maxBytes) {
      continue;
    }

    const content = await file.file.arrayBuffer();
    attachments.push({
      filename: file.name,
      content: arrayBufferToBase64(content),
    });
    totalBytes += file.size;
  }

  return attachments;
}

function formatFieldValue(value) {
  return Array.isArray(value) ? value.join(", ") : String(value || "");
}

function splitLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function yamlListLines(values) {
  return normalizeList(values).map((value) => `  - ${yamlScalar(value)}`);
}

function yamlScalar(value) {
  const normalized = String(value || "");

  if (!normalized) {
    return "";
  }

  return JSON.stringify(normalized);
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function filenameBase(value) {
  return String(value || "Untitled")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "Untitled";
}

function fileExtension(filename) {
  const match = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? `.${match[1]}` : "";
}

function socialHandle(value, service) {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    const parts = url.pathname.split("/").map((part) => part.trim()).filter(Boolean);

    if (service === "facebook" && hostname.endsWith("facebook.com")) {
      return parts[0] || "";
    }

    if (service === "instagram" && hostname.endsWith("instagram.com")) {
      return parts[0] || "";
    }

    if (service === "threads" && hostname.endsWith("threads.net")) {
      return stripAt(parts[0] || "");
    }

    if (service === "linkedin" && hostname.endsWith("linkedin.com")) {
      return parts[0] === "in" || parts[0] === "company" ? (parts[1] || "") : (parts[0] || "");
    }

    if (service === "bluesky" && (hostname.endsWith("bsky.app") || hostname.endsWith("bsky.social"))) {
      return parts[0] === "profile" ? (parts[1] || "") : (parts[0] || "");
    }

    if (service === "twitter" && (hostname.endsWith("twitter.com") || hostname.endsWith("x.com"))) {
      return stripAt(parts[0] || "");
    }

    if (service === "imdb" && hostname.endsWith("imdb.com")) {
      return parts.join("/");
    }

    if (service === "ibdb" && hostname.endsWith("ibdb.com")) {
      return parts.join("/");
    }

    if (service === "backstage" && hostname.endsWith("backstage.com")) {
      return parts[0] === "u" ? (parts[1] || "") : parts.join("/");
    }

    return raw;
  } catch {
    return stripAt(raw);
  }
}

function stripAt(value) {
  return String(value || "").replace(/^@+/, "");
}

function dateOnly(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function shortDescription(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  return normalized.length > 200 ? `${normalized.slice(0, 197).trim()}...` : normalized;
}

function indentLines(value, prefix) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`);
}

function appendRawSections(lines, sections) {
  for (const [heading, value] of sections) {
    const normalized = Array.isArray(value) ? value.join("\n") : String(value || "").trim();

    if (!normalized) {
      continue;
    }

    lines.push("", `## ${heading}`, "", normalized);
  }
}

function appendProductionAssetNotes(lines, poster, program, featuredImage, programFile) {
  const notes = [];

  if (poster) {
    notes.push(
      `Download the submitted poster from Linear and save it as \`static/media/posters/${featuredImage}\`.`,
      `Original poster upload: [${poster.name}](${poster.url}) (${formatBytes(poster.size)}, ${poster.type})`
    );
  }

  if (program) {
    notes.push(
      `Download the submitted program from Linear and save it as \`static/media/programs/${programFile}\`.`,
      `Original program upload: [${program.name}](${program.url}) (${formatBytes(program.size)}, ${program.type})`
    );
  }

  if (notes.length) {
    lines.push("", "## Submission asset notes", "", ...notes);
  }
}

function appendTheatreAssetNotes(lines, logo, featuredImage) {
  if (!logo) {
    return;
  }

  lines.push(
    "",
    "## Submission asset note",
    "",
    `Download the submitted logo from Linear and save it as \`static/media/logos/${featuredImage}\` or move it to the theatre image location preferred for this record.`,
    `Original upload: [${logo.name}](${logo.url}) (${formatBytes(logo.size)}, ${logo.type})`
  );
}

function appendAuditionAssetNotes(lines, announcementGraphic, featuredImage) {
  if (!announcementGraphic) {
    return;
  }

  lines.push(
    "",
    "## Submission asset note",
    "",
    `Download the submitted announcement graphic from Linear and save it as \`static/media/photos/${featuredImage}\`.`,
    `Original upload: [${announcementGraphic.name}](${announcementGraphic.url}) (${formatBytes(announcementGraphic.size)}, ${announcementGraphic.type})`
  );
}

function humanizeFieldName(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 102.4) / 10} KB`;
  }

  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

function firstGraphqlError(response) {
  const message = response?.errors?.[0]?.message;
  return message ? String(message).slice(0, 240) : "";
}

async function responseText(response) {
  try {
    return (await response.text()).slice(0, 240);
  } catch {
    return `Submission endpoint returned ${response.status}`;
  }
}

export function md5(input) {
  const bytes = new TextEncoder().encode(input);
  const words = [];

  for (let i = 0; i < bytes.length; i += 1) {
    words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  }

  const bitLength = bytes.length * 8;
  words[bitLength >> 5] |= 0x80 << (bitLength % 32);
  words[(((bitLength + 64) >>> 9) << 4) + 14] = bitLength;

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let i = 0; i < words.length; i += 16) {
    const oldA = a;
    const oldB = b;
    const oldC = c;
    const oldD = d;

    a = ff(a, b, c, d, words[i + 0], 7, -680876936);
    d = ff(d, a, b, c, words[i + 1], 12, -389564586);
    c = ff(c, d, a, b, words[i + 2], 17, 606105819);
    b = ff(b, c, d, a, words[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, words[i + 4], 7, -176418897);
    d = ff(d, a, b, c, words[i + 5], 12, 1200080426);
    c = ff(c, d, a, b, words[i + 6], 17, -1473231341);
    b = ff(b, c, d, a, words[i + 7], 22, -45705983);
    a = ff(a, b, c, d, words[i + 8], 7, 1770035416);
    d = ff(d, a, b, c, words[i + 9], 12, -1958414417);
    c = ff(c, d, a, b, words[i + 10], 17, -42063);
    b = ff(b, c, d, a, words[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, words[i + 12], 7, 1804603682);
    d = ff(d, a, b, c, words[i + 13], 12, -40341101);
    c = ff(c, d, a, b, words[i + 14], 17, -1502002290);
    b = ff(b, c, d, a, words[i + 15], 22, 1236535329);

    a = gg(a, b, c, d, words[i + 1], 5, -165796510);
    d = gg(d, a, b, c, words[i + 6], 9, -1069501632);
    c = gg(c, d, a, b, words[i + 11], 14, 643717713);
    b = gg(b, c, d, a, words[i + 0], 20, -373897302);
    a = gg(a, b, c, d, words[i + 5], 5, -701558691);
    d = gg(d, a, b, c, words[i + 10], 9, 38016083);
    c = gg(c, d, a, b, words[i + 15], 14, -660478335);
    b = gg(b, c, d, a, words[i + 4], 20, -405537848);
    a = gg(a, b, c, d, words[i + 9], 5, 568446438);
    d = gg(d, a, b, c, words[i + 14], 9, -1019803690);
    c = gg(c, d, a, b, words[i + 3], 14, -187363961);
    b = gg(b, c, d, a, words[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, words[i + 13], 5, -1444681467);
    d = gg(d, a, b, c, words[i + 2], 9, -51403784);
    c = gg(c, d, a, b, words[i + 7], 14, 1735328473);
    b = gg(b, c, d, a, words[i + 12], 20, -1926607734);

    a = hh(a, b, c, d, words[i + 5], 4, -378558);
    d = hh(d, a, b, c, words[i + 8], 11, -2022574463);
    c = hh(c, d, a, b, words[i + 11], 16, 1839030562);
    b = hh(b, c, d, a, words[i + 14], 23, -35309556);
    a = hh(a, b, c, d, words[i + 1], 4, -1530992060);
    d = hh(d, a, b, c, words[i + 4], 11, 1272893353);
    c = hh(c, d, a, b, words[i + 7], 16, -155497632);
    b = hh(b, c, d, a, words[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, words[i + 13], 4, 681279174);
    d = hh(d, a, b, c, words[i + 0], 11, -358537222);
    c = hh(c, d, a, b, words[i + 3], 16, -722521979);
    b = hh(b, c, d, a, words[i + 6], 23, 76029189);
    a = hh(a, b, c, d, words[i + 9], 4, -640364487);
    d = hh(d, a, b, c, words[i + 12], 11, -421815835);
    c = hh(c, d, a, b, words[i + 15], 16, 530742520);
    b = hh(b, c, d, a, words[i + 2], 23, -995338651);

    a = ii(a, b, c, d, words[i + 0], 6, -198630844);
    d = ii(d, a, b, c, words[i + 7], 10, 1126891415);
    c = ii(c, d, a, b, words[i + 14], 15, -1416354905);
    b = ii(b, c, d, a, words[i + 5], 21, -57434055);
    a = ii(a, b, c, d, words[i + 12], 6, 1700485571);
    d = ii(d, a, b, c, words[i + 3], 10, -1894986606);
    c = ii(c, d, a, b, words[i + 10], 15, -1051523);
    b = ii(b, c, d, a, words[i + 1], 21, -2054922799);
    a = ii(a, b, c, d, words[i + 8], 6, 1873313359);
    d = ii(d, a, b, c, words[i + 15], 10, -30611744);
    c = ii(c, d, a, b, words[i + 6], 15, -1560198380);
    b = ii(b, c, d, a, words[i + 13], 21, 1309151649);
    a = ii(a, b, c, d, words[i + 4], 6, -145523070);
    d = ii(d, a, b, c, words[i + 11], 10, -1120210379);
    c = ii(c, d, a, b, words[i + 2], 15, 718787259);
    b = ii(b, c, d, a, words[i + 9], 21, -343485551);

    a = add32(a, oldA);
    b = add32(b, oldB);
    c = add32(c, oldC);
    d = add32(d, oldD);
  }

  return [a, b, c, d].map(hexLe).join("");
}

function cmn(q, a, b, x, s, t) {
  return add32(rotl(add32(add32(a, q), add32(x || 0, t)), s), b);
}

function ff(a, b, c, d, x, s, t) {
  return cmn((b & c) | (~b & d), a, b, x, s, t);
}

function gg(a, b, c, d, x, s, t) {
  return cmn((b & d) | (c & ~d), a, b, x, s, t);
}

function hh(a, b, c, d, x, s, t) {
  return cmn(b ^ c ^ d, a, b, x, s, t);
}

function ii(a, b, c, d, x, s, t) {
  return cmn(c ^ (b | ~d), a, b, x, s, t);
}

function rotl(value, bits) {
  return (value << bits) | (value >>> (32 - bits));
}

function add32(a, b) {
  return (a + b) | 0;
}

function hexLe(value) {
  let output = "";

  for (let i = 0; i < 4; i += 1) {
    output += (`0${((value >> (i * 8)) & 0xff).toString(16)}`).slice(-2);
  }

  return output;
}
