// Netlify serverless function: Stripe webhook endpoint.
//
// Stripe calls this URL directly (not the browser) whenever something
// happens on a subscription — checkout completed, renewed, payment failed,
// cancelled, etc. We verify the signature so only real Stripe events are
// trusted, then record each customer's current subscription status in
// Netlify Blobs (store: "subscriptions"), keyed by email.
//
// Setup: in the Stripe Dashboard go to Developers -> Webhooks -> Add endpoint,
// set the URL to https://dockpulse.netlify.app/api/stripe-webhook, and select
// at least these events: checkout.session.completed,
// customer.subscription.updated, customer.subscription.deleted.
// Stripe will show you a signing secret (whsec_...) — put that in the
// STRIPE_WEBHOOK_SECRET environment variable below.
//
// Config (Netlify environment variables):
//   STRIPE_SECRET_KEY      same key used by create-checkout-session.js
//   STRIPE_WEBHOOK_SECRET  signing secret shown when you create the endpoint

import { getStore } from "@netlify/blobs";
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

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return jsonResponse(500, { error: "Stripe webhook isn't configured yet." });
  }
  const stripe = new Stripe(secretKey);

  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return jsonResponse(400, { error: "Invalid Stripe signature.", detail: String(err) });
  }

  const store = getStore("subscriptions");

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const email = session.customer_email || (session.customer_details && session.customer_details.email);
        if (email) {
          await store.setJSON(email, {
            status: "active",
            plan: session.metadata && session.metadata.plan,
            customerId: session.customer,
            subscriptionId: session.subscription,
            email,
            updatedAt: new Date().toISOString(),
          });
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        const email = customer && !customer.deleted && customer.email;
        if (email) {
          await store.setJSON(email, {
            status: sub.status, // active, past_due, canceled, unpaid, etc.
            plan: sub.metadata && sub.metadata.plan,
            customerId: sub.customer,
            subscriptionId: sub.id,
            email,
            updatedAt: new Date().toISOString(),
          });
        }
        break;
      }
      default:
        // Other event types (invoice.paid, payment failures, etc.) are
        // ignored for now but Stripe will still get a 200 so it doesn't retry.
        break;
    }
  } catch (err) {
    return jsonResponse(500, { error: "Webhook handler failed.", detail: String(err) });
  }

  return jsonResponse(200, { received: true });
};

export const config = {
  path: "/api/stripe-webhook",
};
