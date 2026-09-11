// Offline API — turns `apiFetch("/api/…")` calls into localStorage reads/writes
// so the whole app runs with no backend. `apiFetch` calls `mockFetch` first;
// when it returns a Response, that's the answer.

import {
  loadDB,
  saveDB,
  ensureSeeded,
  toAnalyticsOrders,
  generateOrders,
  currentUser,
  uid,
  type MockOrder,
  type MockProduct,
} from "@/lib/mock-db";
import {
  computeDashboardData,
  computeHomeData,
  computePaymentPeriods,
  computePerformanceMetrics,
  resolveDashboardWindow,
} from "@/lib/analytics";
import {
  OrderSchema,
  ProductSchema,
  ImportRowSchema,
  fieldErrors,
  ORDER_STATUSES,
  type ImportRow,
} from "@/lib/definitions";
import { z } from "zod";

// Master switch. The real backend is down, so the offline store is the app.
// Flip to `false` once a working backend exists and `apiFetch` will hit the
// network again.
export const OFFLINE_MODE = true;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function orderRow(o: MockOrder) {
  return {
    id: o.id,
    productName: o.productName,
    category: o.category,
    customerName: o.customerName,
    quantity: o.quantity,
    amount: o.amount,
    status: o.status,
    createdAtIso: o.createdAt,
  };
}
function catalogRow(p: MockProduct) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: p.price,
    stock: p.stock,
    imageUrl: p.imageUrl,
    createdAtIso: p.createdAt,
  };
}

async function readJson(init?: RequestInit): Promise<unknown> {
  if (!init?.body || typeof init.body !== "string") return null;
  try {
    return JSON.parse(init.body);
  } catch {
    return null;
  }
}

/**
 * Returns a Response when the request is handled offline, or null to let the
 * caller fall through to the network.
 */
export async function mockFetch(
  input: string,
  init?: RequestInit,
): Promise<Response | null> {
  if (!OFFLINE_MODE || typeof window === "undefined") return null;
  if (!input.startsWith("/api/")) return null;

  const url = new URL(input, window.location.origin);
  const path = url.pathname;
  const method = (init?.method ?? "GET").toUpperCase();

  ensureSeeded();

  // --- auth ---------------------------------------------------------------
  if (path === "/api/me") {
    const user = currentUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    return json(user);
  }

  // --- dashboard ---------------------------------------------------------
  if (path === "/api/dashboard" && method === "GET") {
    const sp = Object.fromEntries(url.searchParams) as {
      range?: string;
      s?: string;
      e?: string;
      cs?: string;
      ce?: string;
    };
    const { current, compare, activeRange, pickerDefaults } = resolveDashboardWindow(sp);
    const data = computeDashboardData(
      toAnalyticsOrders(loadDB().orders),
      current,
      compare,
    );
    return json({ data, pickerDefaults, activeRange });
  }

  // --- home ------------------------------------------------------------
  if (path === "/api/home" && method === "GET") {
    const db = loadDB();
    const data = computeHomeData(
      toAnalyticsOrders(db.orders),
      db.products,
      db.user?.name ?? "Seller",
    );
    return json(data);
  }

  // --- payments / performance ----------------------------------------
  if (path === "/api/payments" && method === "GET") {
    return json(computePaymentPeriods(toAnalyticsOrders(loadDB().orders)));
  }
  if (path === "/api/performance" && method === "GET") {
    return json(computePerformanceMetrics(toAnalyticsOrders(loadDB().orders)));
  }

  // --- generate orders ---------------------------------------------
  if (path === "/api/orders/generate" && method === "POST") {
    const body = (await readJson(init)) as Record<string, unknown> | null;
    generateOrders({
      gmv: Number(body?.gmv) || undefined,
      units: Number(body?.units) || undefined,
      orders: Number(body?.orders) || undefined,
      from: typeof body?.from === "string" ? body.from : undefined,
      to: typeof body?.to === "string" ? body.to : undefined,
    });
    return json({ ok: "Dashboard reset — your generated orders are ready." });
  }

  // --- orders collection ------------------------------------------
  if (path === "/api/orders" && method === "GET") {
    const rows = [...loadDB().orders]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(orderRow);
    return json(rows);
  }
  if (path === "/api/orders" && method === "POST") {
    const parsed = OrderSchema.safeParse(await readJson(init));
    if (!parsed.success) return json({ errors: fieldErrors(parsed.error) }, 400);
    const db = loadDB();
    const product = db.products.find((p) => p.id === parsed.data.productId);
    if (!product) {
      return json({ errors: { productId: ["Please choose a valid product."] } }, 400);
    }
    const order: MockOrder = {
      id: uid(),
      productId: product.id,
      productName: product.name,
      category: product.category,
      customerName: parsed.data.customerName,
      quantity: parsed.data.quantity,
      unitPrice: product.price,
      amount: product.price * parsed.data.quantity,
      status: parsed.data.status,
      createdAt: new Date().toISOString(),
    };
    saveDB({ ...db, orders: [order, ...db.orders] });
    return json({ success: true, order });
  }

  // --- single order ---------------------------------------------
  const orderIdMatch = path.match(/^\/api\/orders\/([^/]+)$/);
  if (orderIdMatch) {
    const id = decodeURIComponent(orderIdMatch[1]);
    const db = loadDB();
    if (method === "PATCH") {
      const body = (await readJson(init)) as { status?: unknown } | null;
      const parsed = z.enum(ORDER_STATUSES).safeParse(body?.status);
      if (!parsed.success) return json({ error: "Invalid status." }, 400);
      saveDB({
        ...db,
        orders: db.orders.map((o) =>
          o.id === id ? { ...o, status: parsed.data } : o,
        ),
      });
      return json({ success: true });
    }
    if (method === "DELETE") {
      saveDB({ ...db, orders: db.orders.filter((o) => o.id !== id) });
      return json({ success: true });
    }
  }

  // --- products collection ----------------------------------
  if (path === "/api/products" && method === "GET") {
    const rows = [...loadDB().products]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(catalogRow);
    return json(rows);
  }
  if (path === "/api/products" && method === "POST") {
    const parsed = ProductSchema.safeParse(await readJson(init));
    if (!parsed.success) return json({ errors: fieldErrors(parsed.error) }, 400);
    const db = loadDB();
    const product: MockProduct = {
      id: uid(),
      name: parsed.data.name,
      category: parsed.data.category,
      price: parsed.data.price,
      stock: parsed.data.stock,
      imageUrl: parsed.data.imageUrl || null,
      createdAt: new Date().toISOString(),
    };
    saveDB({ ...db, products: [product, ...db.products] });
    return json({ success: true, product });
  }

  // --- single product --------------------------------------
  const productIdMatch = path.match(/^\/api\/products\/([^/]+)$/);
  if (productIdMatch) {
    const id = decodeURIComponent(productIdMatch[1]);
    const db = loadDB();
    if (method === "PATCH") {
      const body = (await readJson(init)) as Record<string, unknown> | null;
      const patch: Partial<MockProduct> = {};
      if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim();
      if (typeof body?.category === "string" && body.category.trim())
        patch.category = body.category.trim();
      if (body?.price !== undefined && body.price !== "") {
        const n = Number(body.price);
        if (Number.isFinite(n) && n > 0) patch.price = n;
      }
      if (body?.stock !== undefined && body.stock !== "") {
        const n = Number(body.stock);
        if (Number.isInteger(n) && n >= 0) patch.stock = n;
      }
      if (typeof body?.imageUrl === "string") patch.imageUrl = body.imageUrl.trim() || null;
      if (Object.keys(patch).length > 0) {
        saveDB({
          ...db,
          products: db.products.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        });
      }
      return json({ success: true });
    }
    if (method === "DELETE") {
      saveDB({ ...db, products: db.products.filter((p) => p.id !== id) });
      return json({ success: true });
    }
  }

  // --- import ------------------------------------------
  if (path === "/api/import" && method === "POST") {
    const rows = await readJson(init);
    if (!Array.isArray(rows)) {
      return json({ imported: 0, skipped: 0, productsCreated: 0, error: "No data received." }, 400);
    }
    const db = loadDB();
    const valid: ImportRow[] = [];
    let skipped = 0;
    for (const r of rows) {
      const parsed = ImportRowSchema.safeParse(r);
      if (parsed.success) valid.push(parsed.data);
      else skipped++;
    }
    if (valid.length === 0) {
      return json({ imported: 0, skipped, productsCreated: 0, error: "No valid rows to import." });
    }

    const nameToId = new Map(db.products.map((p) => [p.name.toLowerCase(), p.id]));
    const newProducts: MockProduct[] = [];
    for (const r of valid) {
      const key = r.productName.toLowerCase();
      if (!nameToId.has(key)) {
        const p: MockProduct = {
          id: uid(),
          name: r.productName,
          category: r.category,
          price: r.unitPrice,
          stock: 0,
          imageUrl: null,
          createdAt: new Date().toISOString(),
        };
        newProducts.push(p);
        nameToId.set(key, p.id);
      }
    }

    const newOrders: MockOrder[] = valid.map((r) => ({
      id: uid(),
      productId: nameToId.get(r.productName.toLowerCase()) ?? null,
      productName: r.productName,
      category: r.category,
      customerName: r.customerName,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      amount: r.amount,
      status: r.status,
      createdAt: r.date ? new Date(r.date).toISOString() : new Date().toISOString(),
    }));

    saveDB({
      ...db,
      products: [...newProducts, ...db.products],
      orders: [...newOrders, ...db.orders],
    });
    return json({ imported: valid.length, skipped, productsCreated: newProducts.length });
  }

  // Unknown /api path while offline — 404 rather than a confusing network call.
  return json({ error: "Not found (offline)." }, 404);
}
