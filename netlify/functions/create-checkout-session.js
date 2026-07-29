// Netlify serverless function: creates a Stripe Checkout Session so a
// logged-in DockPulse user can subscribe to the Starter or Growth plan.
//
// Auth: requires a valid Netlify Identity JWT (same pattern as
// company-data.js), so every checkout session is tied to the signed-in
// user's account email — nobody can start a session for someone else.
//
// Config — set these as Netlify environment variables (Project configuration
// -> Environment variables). Never commit real key values to the repo.
//   STRIPE_SECRET_KEY          Stripe secret key (sk_test_... or sk_live_...)
//   STRIPE_PRICE_STARTER       Price ID for the Starter plan (£299/mo)
//   STRIPE_PRICE_GROWTH        Price ID for the Growth plan (£599/mo)
//   STRIPE_FIRST_MONTH_COUPON  Coupon ID for "50% off first month" (optional —
//                              if unset, checkout runs at full price and shows
//                              a promo-code box instead)

import { getUser } from "@netlify/identity";
import Stripe from "stripe";

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

  const user = await getUser();
  if (!user) {
    return jsonResponse(401, { error: "Please log in or sign up first, then subscribe." });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return jsonResponse(500, { error: "Payments aren't configured yet. Please contact dockpulse@outlook.com." });
  }
  const stripe = new Stripe(secretKey);

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return jsonResponse(400, { error: "Request body must be JSON." });
  }

  const plan = body && body.plan;
  const priceId =
    plan === "growth" ? process.env.STRIPE_PRICE_GROWTH :
    plan === "starter" ? process.env.STRIPE_PRICE_STARTER :
    null;

  if (!priceId) {
    return jsonResponse(400, { error: "Expected { plan: 'starter' | 'growth' }, and the matching STRIPE_PRICE_* env var must be set." });
  }

  const origin = req.headers.get("origin") || "https://dockpulse.netlify.app";

  const sessionParams = {
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: user.email,
    client_reference_id: user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/?checkout=success&plan=${plan}`,
    cancel_url: `${origin}/?checkout=cancelled`,
    metadata: { plan, userId: user.id },
    subscription_data: { metadata: { plan, userId: user.id } },
  };

  if (process.env.STRIPE_FIRST_MONTH_COUPON) {
    sessionParams.discounts = [{ coupon: process.env.STRIPE_FIRST_MONTH_COUPON }];
  } else {
    sessionParams.allow_promotion_codes = true;
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionParams);
    return jsonResponse(200, { url: session.url });
  } catch (err) {
    return jsonResponse(500, { error: "Could not start checkout.", detail: String(err) });
  }
};

export const config = {
  path: "/api/create-checkout-session",
};
