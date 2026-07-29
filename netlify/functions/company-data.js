// Netlify serverless function: lets a logged-in DockPulse user save and
// retrieve their own warehouse KPI data (the daily rows from the analyzer)
// and shift handover notes, so it's there again next time they log in from
// any device.
//
// Auth: relies on Netlify Identity. The browser sends the user's Identity
// JWT as `Authorization: Bearer <token>`; getUser() verifies it and returns
// the user record (or null if missing/invalid), so each company only ever
// sees its own data.
//
// Storage: Netlify Blobs, one JSON blob per user, keyed by the user's id.

import { getUser } from "@netlify/identity";
import { getStore } from "@netlify/blobs";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req, context) => {
  const user = await getUser();
  if (!user) {
    return jsonResponse(401, { error: "Please log in to save or load your account data." });
  }

  const store = getStore("company-data");

  if (req.method === "GET") {
    try {
      const record = await store.get(user.id, { type: "json" });
      return jsonResponse(200, {
        days: (record && record.days) || [],
        handoverNotes: (record && record.handoverNotes) || [],
        savedAt: (record && record.savedAt) || null,
        email: user.email,
      });
    } catch (err) {
      return jsonResponse(500, { error: "Could not load your saved data.", detail: String(err) });
    }
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return jsonResponse(400, { error: "Request body must be JSON." });
    }

    const days = body && body.days;
    if (!Array.isArray(days)) {
      return jsonResponse(400, { error: "Expected { days: [...] } — an array of daily KPI rows." });
    }
    const handoverNotes = Array.isArray(body && body.handoverNotes) ? body.handoverNotes : [];

    try {
      await store.setJSON(user.id, { days, handoverNotes, savedAt: new Date().toISOString(), email: user.email });
      return jsonResponse(200, { ok: true, saved: days.length });
    } catch (err) {
      return jsonResponse(500, { error: "Could not save your data.", detail: String(err) });
    }
  }

  return jsonResponse(405, { error: "Use GET or POST." });
};

export const config = {
  path: "/api/company-data",
};
