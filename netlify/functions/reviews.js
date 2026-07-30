// Netlify serverless function: public customer reviews for the DockPulse
// marketing site.
//
// GET  -> returns all reviews (public, no auth needed) so anyone visiting
//         the site can read them.
// POST -> requires a valid Netlify Identity JWT (same pattern as
//         company-data.js), so only signed-in customers can leave a review.
//         Each user can have at most one review — submitting again replaces
//         their previous one.
//
// Storage: a single JSON blob (store "reviews", key "all") containing an
// array of { id, userId, name, rating, comment, createdAt } objects.

import { getUser } from "@netlify/identity";
import { getStore } from "@netlify/blobs";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req, context) => {
  const store = getStore("reviews");

  if (req.method === "GET") {
    try {
      const reviews = (await store.get("all", { type: "json" })) || [];
      return jsonResponse(200, { reviews });
    } catch (err) {
      return jsonResponse(500, { error: "Could not load reviews.", detail: String(err) });
    }
  }

  if (req.method === "POST") {
    const user = await getUser();
    if (!user) {
      return jsonResponse(401, { error: "Please log in or sign up first, then leave a review." });
    }

    let body;
    try {
      body = await req.json();
    } catch (e) {
      return jsonResponse(400, { error: "Request body must be JSON." });
    }

    const rating = Number(body && body.rating);
    const comment = String((body && body.comment) || "").trim().slice(0, 600);
    const name = String((body && body.name) || "").trim().slice(0, 60) || (user.email ? user.email.split("@")[0] : "Customer");

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return jsonResponse(400, { error: "Rating must be a whole number from 1 to 5." });
    }
    if (!comment) {
      return jsonResponse(400, { error: "Please write a short comment with your review." });
    }

    try {
      const reviews = (await store.get("all", { type: "json" })) || [];
      const filtered = reviews.filter((r) => r.userId !== user.id);
      filtered.unshift({
        id: user.id,
        userId: user.id,
        name,
        rating,
        comment,
        createdAt: new Date().toISOString(),
      });
      await store.setJSON("all", filtered);
      return jsonResponse(200, { ok: true, reviews: filtered });
    } catch (err) {
      return jsonResponse(500, { error: "Could not save your review.", detail: String(err) });
    }
  }

  return jsonResponse(405, { error: "Use GET or POST." });
};

export const config = {
  path: "/api/reviews",
};
