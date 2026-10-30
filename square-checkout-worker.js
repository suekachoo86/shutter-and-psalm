const ALLOWED_ORIGINS = new Set([
  'https://suekachoo86.github.io',
  'https://shutterandpsalm.com',
  'https://www.shutterandpsalm.com'
]);

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : 'https://suekachoo86.github.io';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === 'GET') {
      return jsonResponse(
        { ok: true, message: 'Shutter & Psalm Square Sandbox checkout is connected.' },
        200,
        origin
      );
    }

    if (request.method !== 'POST' || url.pathname !== '/checkout') {
      return jsonResponse({ message: 'Not found.' }, 404, origin);
    }

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse({ message: 'This website is not allowed to use checkout.' }, 403, origin);
    }

    if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) {
      return jsonResponse({ message: 'Square checkout is not configured.' }, 500, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ message: 'The checkout request was not valid JSON.' }, 400, origin);
    }

    if (!Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 100) {
      return jsonResponse({ message: 'Your cart is empty or contains too many items.' }, 400, origin);
    }

    const lineItems = [];
    let askForShippingAddress = false;

    for (const item of payload.items) {
      const variationId = String(item.variationId || '');
      const quantity = Number(item.quantity);

      if (!/^[A-Z0-9]{20,40}$/.test(variationId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        return jsonResponse({ message: 'One of the cart items is invalid.' }, 400, origin);
      }

      lineItems.push({
        catalog_object_id: variationId,
        quantity: String(quantity)
      });

      if (item.requiresShipping === true) {
        askForShippingAddress = true;
      }
    }

    const squareRequest = {
      idempotency_key: crypto.randomUUID(),
      order: {
        location_id: env.SQUARE_LOCATION_ID,
        line_items: lineItems
      },
      checkout_options: {
        ask_for_shipping_address: askForShippingAddress,
        redirect_url: 'https://suekachoo86.github.io/shutter-and-psalm/shop.html',
        merchant_support_email: 'hello@shutterandpsalm.com'
      },
      payment_note: 'Shutter & Psalm website order'
    };

    let squareResponse;
    try {
      squareResponse = await fetch(
        'https://connect.squareupsandbox.com/v2/online-checkout/payment-links',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
            'Square-Version': '2026-09-16',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(squareRequest)
        }
      );
    } catch {
      return jsonResponse({ message: 'Square could not be reached. Please try again.' }, 502, origin);
    }

    const squareData = await squareResponse.json();

    if (!squareResponse.ok) {
      const message = squareData.errors?.[0]?.detail || 'Square could not prepare checkout.';
      return jsonResponse({ message }, squareResponse.status, origin);
    }

    const paymentUrl = squareData.payment_link?.url;
    if (!paymentUrl || !paymentUrl.startsWith('https://sandbox.square.link/')) {
      return jsonResponse({ message: 'Square did not return a Sandbox payment link.' }, 502, origin);
    }

    return jsonResponse({ url: paymentUrl }, 200, origin);
  }
};
