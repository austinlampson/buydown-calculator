// Netlify Function: /.netlify/functions/mnd-rates
// Pulls the Mortgage News Daily rate index and returns JSON.
// Add ?debug to the URL to see the text around each label (skips the cache).

const SOURCE = "https://www.mortgagenewsdaily.com/mortgage-rates/mnd";
const TTL_MS = 60 * 60 * 1000; // ~1 hour

// Case-sensitive on purpose: the table uses "30 Yr. FHA"; the site menu uses "30 YR FHA" (ignored).
const LABELS = [
  { key: "conv30",  label: "30 Yr. Fixed" },
  { key: "conv15",  label: "15 Yr. Fixed" },
  { key: "fha30",   label: "30 Yr. FHA" },
  { key: "va30",    label: "30 Yr. VA" },
  { key: "jumbo30", label: "30 Yr. Jumbo" },
];

let cache = null; // { at: number, data: object }

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#37;|&percnt;/gi, "%")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function findRate(text, label) {
  // e.g. "30 Yr. Fixed 7.33%"  (no "i" flag => case-sensitive)
  const re = new RegExp(escapeRe(label) + "\\s*(\\d{1,2}\\.\\d{1,3})\\s*%", "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = parseFloat(m[1]);
    if (v > 1 && v < 20) return v; // sanity check
  }
  return null;
}

function findDate(text) {
  const m = text.match(/Last Updated:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  return m ? m[1] : null;
}

function contexts(text, needle, pad = 90, max = 6) {
  const out = [];
  let i = text.indexOf(needle);
  while (i !== -1 && out.length < max) {
    out.push(text.slice(Math.max(0, i - pad), i + needle.length + pad));
    i = text.indexOf(needle, i + needle.length);
  }
  return out;
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const debug = url.searchParams.has("debug");

  if (!debug && cache && Date.now() - cache.at < TTL_MS) {
    return json({ ...cache.data, cached: true }, 200, {
      "cache-control": "public, max-age=900",
      "netlify-cdn-cache-control": "public, s-maxage=3600, stale-while-revalidate=600",
    });
  }

  try {
    const res = await fetch(SOURCE, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) throw new Error("MND responded " + res.status);
    const text = htmlToText(await res.text());

    const rates = {};
    for (const { key, label } of LABELS) rates[key] = findRate(text, label);
    const found = Object.values(rates).filter((v) => v != null).length;

    const data = {
      ok: found > 0,
      source: "Mortgage News Daily rate index",
      sourceUrl: SOURCE,
      asOf: findDate(text),
      fetchedAt: new Date().toISOString(),
      rates,
    };

    if (debug) {
      data.debug = {
        textLength: text.length,
        labels: Object.fromEntries(LABELS.map(({ key, label }) => [key, { label, matches: contexts(text, label) }])),
        ignoredMenuLabel_30_YR_FHA: contexts(text, "30 YR FHA", 60, 3),
        lastUpdated: contexts(text, "Last Updated", 60, 3),
      };
      return json(data, 200, { "cache-control": "no-store" });
    }

    if (!data.ok) throw new Error("No rates matched — open this URL with ?debug");
    cache = { at: Date.now(), data };
    return json(data, 200, {
      "cache-control": "public, max-age=900",
      "netlify-cdn-cache-control": "public, s-maxage=3600, stale-while-revalidate=600",
    });
  } catch (err) {
    if (cache) return json({ ...cache.data, stale: true, error: String(err.message || err) });
    return json({ ok: false, error: String(err.message || err) }, 502, { "cache-control": "no-store" });
  }
};
