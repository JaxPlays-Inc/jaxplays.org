const DEFAULT_ALLOWED_ORIGINS = [
  "https://jaxplays.org",
  "https://www.jaxplays.org",
  "http://localhost:1313",
  "http://127.0.0.1:1313",
  "http://hollister-home-server:1313",
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  if (url.pathname !== "/newsletter") {
    return json({ ok: false, error: "not-found" }, 404, cors);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "invalid-json" }, 400, cors);
  }

  const email = normalizeEmail(payload.email);
  const honeypot = String(payload.website || "").trim();
  const turnstileToken = String(payload.turnstileToken || "").trim();
  const source = normalizeSource(payload.source);

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

  const mailchimp = await subscribeToMailchimp(email, source, env, services.fetch || fetch);

  if (!mailchimp.ok) {
    return json({ ok: false, error: mailchimp.error }, mailchimp.status || 502, cors);
  }

  return json({ ok: true }, 200, cors);
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizeSource(source) {
  const normalized = String(source || "homepage-dashboard")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "homepage-dashboard";
}

export function corsHeaders(origin, env = {}) {
  const allowedOrigins = parseCsv(env.ALLOWED_ORIGINS);
  const allowed = allowedOrigins.length ? allowedOrigins : DEFAULT_ALLOWED_ORIGINS;

  if (!allowed.includes(origin)) {
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

async function subscribeToMailchimp(email, source, env, fetchImpl) {
  const apiKey = env.MAILCHIMP_API_KEY;
  const audienceId = env.MAILCHIMP_AUDIENCE_ID;
  const serverPrefix = env.MAILCHIMP_SERVER_PREFIX;

  if (!apiKey || !audienceId || !serverPrefix) {
    return { ok: false, status: 500, error: "mailchimp-not-configured" };
  }

  const subscriberHash = md5(email);
  const tags = sourceTags(source, env);
  const url = `https://${serverPrefix}.api.mailchimp.com/3.0/lists/${audienceId}/members/${subscriberHash}`;
  const body = {
    email_address: email,
    status_if_new: "subscribed",
    tags,
  };

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
    return { ok: false, status: 400, error: "mailchimp-rejected" };
  }

  return { ok: false, status: 502, error: "mailchimp-unavailable" };
}

export function sourceTags(source, env = {}) {
  const configuredTags = parseCsv(env.NEWSLETTER_SOURCE_TAGS);
  const tags = configuredTags.length ? configuredTags : [source];

  return Array.from(new Set(tags.concat(source).filter(Boolean)));
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

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
