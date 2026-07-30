// Netlify serverless function: generates an AI operations briefing from
// warehouse KPI data submitted by the DockPulse demo page.
//
// Requires an ANTHROPIC_API_KEY environment variable to be set on this
// Netlify site (Project configuration > Environment variables). Never put
// the key directly in this file.

const MODEL = "claude-haiku-4-5-20251001"; // fast/cheap model, good fit for short briefings
const MAX_TOKENS = 500;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req, context) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Use POST." });
  }

  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return jsonResponse(500, {
      error: "This site isn't configured with an Anthropic API key yet. Add ANTHROPIC_API_KEY in Netlify environment variables.",
    });
  }

  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return jsonResponse(400, { error: "Request body must be JSON." });
  }

  const summary = (payload && payload.summary) || payload;
  if (!summary || !Array.isArray(summary) || summary.length === 0) {
    return jsonResponse(400, { error: "Expected a non-empty 'summary' array of daily KPI rows." });
  }

  const prompt = `You are a warehouse operations analyst. Given this daily data (JSON array, one row per day: inbound units received, outbound units shipped, orders received, orders processed, resulting backlog of orders left to process, staff scheduled, staff present), write a concise operational briefing:
1. A 2-3 sentence plain-English summary of current performance.
2. Any anomalies or concerning trends (e.g. rising backlog, understaffing, orders/staff overload, outbound lagging inbound). Call out specific numbers.
3. 2-4 prioritized, concrete recommendations.
Keep it under 180 words, no markdown headers, plain prose with short paragraphs or a simple dash list.

Data:
${JSON.stringify(summary)}`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      const detailText = await resp.text();
      // Anthropic's error body is JSON like:
      // {"type":"error","error":{"type":"invalid_request_error","message":"..."}}
      // Surface that human-readable message instead of a bare status code,
      // so billing/credit/rate-limit issues are actionable in the UI rather
      // than showing an opaque "Anthropic API returned 400".
      let friendlyError = `Anthropic API returned ${resp.status}`;
      try {
        const parsedDetail = JSON.parse(detailText);
        if (parsedDetail && parsedDetail.error && parsedDetail.error.message) {
          friendlyError = parsedDetail.error.message;
        }
      } catch (parseErr) {
        // detailText wasn't JSON — fall back to the generic message above.
      }
      return jsonResponse(502, { error: friendlyError, detail: detailText });
    }

    const data = await resp.json();
    const text = (data.content && data.content[0] && data.content[0].text) || "";
    return jsonResponse(200, { text });
  } catch (err) {
    return jsonResponse(500, { error: "Request to Anthropic failed.", detail: String(err) });
  }
};

export const config = {
  path: "/api/ai-insights",
};
