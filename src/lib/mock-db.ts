// Offline store — the whole app's data, kept in localStorage. No backend.
//
// Everything the API routes would persist (user, products, orders) lives here.
// `mock-backend.ts` reads/writes this to answer `apiFetch` calls.

import { STARTER_CATALOG } from "@/lib/starter-catalog";
import type { AnalyticsOrder } from "@/lib/analytics";

const KEY = "wm_offline_db_v1";
export const CHANGE_EVENT = "wm-demo-change";

export type MockUser = { id: string; name: string; email: string };
export type MockProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  imageUrl: string | null;
  createdAt: string; // ISO
};
export type MockOrder = {
  id: string;
  productId: string | null;
  productName: string;
  category: string;
  customerName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  status: string;
  createdAt: string; // ISO
};
export type MockDB = {
  user: MockUser | null;
  products: MockProduct[];
  orders: MockOrder[];
};

const uid = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

function emptyDB(): MockDB {
  return { user: null, products: [], orders: [] };
}

export function loadDB(): MockDB {
  if (typeof window === "undefined") return emptyDB();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyDB();
    const parsed = JSON.parse(raw) as MockDB;
    return {
      user: parsed.user ?? null,
      products: parsed.products ?? [],
      orders: parsed.orders ?? [],
    };
  } catch {
    return emptyDB();
  }
}

export function saveDB(db: MockDB): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(db));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function toAnalyticsOrders(orders: MockOrder[]): AnalyticsOrder[] {
  return orders.map((o) => ({
    amount: o.amount,
    quantity: o.quantity,
    status: o.status,
    category: o.category,
    productName: o.productName,
    createdAt: new Date(o.createdAt),
  }));
}

// ---- auth (fully local) ---------------------------------------------------

export const DUMMY_TOKEN = "offline-session";

export function currentUser(): MockUser | null {
  return loadDB().user;
}

export function signIn(email: string, name?: string): MockUser {
  const db = ensureSeeded();
  const cleanEmail = email.trim().toLowerCase();
  const user: MockUser = {
    id: db.user?.id ?? uid(),
    email: cleanEmail || db.user?.email || "seller@example.com",
    name: name?.trim() || db.user?.name || cleanEmail.split("@")[0] || "Seller",
  };
  saveDB({ ...db, user });
  return user;
}

// ---- seeding ------------------------------------------------------------

export function ensureSeeded(): MockDB {
  const db = loadDB();
  if (db.products.length > 0) return db;

  const now = Date.now();
  const products: MockProduct[] = STARTER_CATALOG.map((p, i) => ({
    id: uid(),
    name: p.name,
    category: p.category,
    price: p.price,
    stock: p.stock,
    imageUrl: p.imageUrl ?? null,
    createdAt: new Date(now - (STARTER_CATALOG.length - i) * 3_600_000).toISOString(),
  }));

  const seeded: MockDB = { user: db.user, products, orders: [] };
  // Seed ~90 days of history so every page looks populated on first load.
  seeded.orders = buildOrders(seeded.products, {
    gmv: 16_500,
    units: 320,
    orders: 120,
    from: isoDaysAgo(90),
    to: isoDaysAgo(0),
  });
  saveDB(seeded);
  return seeded;
}

// ---- order generation (ported from /api/orders/generate) -----------------

const FIRST_NAMES = [
  "Aarav", "Diya", "Vihaan", "Anaya", "Kabir", "Ananya", "Vivaan", "Isha",
  "Rohan", "Saanvi", "Arjun", "Myra", "Reyansh", "Aadhya", "Krishna", "Ira",
  "Aditya", "Pari", "Sai", "Riya", "Dhruv", "Tara", "Yash", "Kiara",
  "Ishaan", "Navya", "Ayaan", "Zara", "Rudra", "Avni", "Karan", "Nisha",
  "Rahul", "Sneha", "Manav", "Tanvi", "Veer", "Pooja", "Neil", "Mira",
  "Liam", "Emma", "Noah", "Olivia", "Ethan", "Sophia", "Lucas", "Mia",
];
const LAST_NAMES = [
  "Sharma", "Patel", "Gupta", "Singh", "Rao", "Mehta", "Das", "Nair",
  "Iyer", "Reddy", "Kapoor", "Bose", "Jain", "Khan", "Verma", "Joshi",
  "Malhotra", "Chopra", "Agarwal", "Bhat", "Menon", "Pillai", "Saxena",
  "Sinha", "Desai", "Shah", "Kulkarni", "Mishra", "Nanda", "Chauhan",
  "Sethi", "Banerjee", "Ghosh", "Trivedi", "Dubey", "Bhatia", "Naidu",
  "Roy", "Varma", "Anand",
];

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function weightedSplit(total: number, n: number, lo: number, hi: number): number[] {
  const factors = Array.from({ length: n }, () => lo + Math.random() * (hi - lo));
  const fsum = factors.reduce((s, f) => s + f, 0);
  const parts = factors.map((f) => Math.max(1, Math.floor((total * f) / fsum)));

  let diff = total - parts.reduce((s, p) => s + p, 0);
  let guard = 0;
  while (diff > 0) {
    parts[Math.floor(Math.random() * n)]++;
    diff--;
  }
  while (diff < 0 && guard++ < n * 1000) {
    const j = Math.floor(Math.random() * n);
    if (parts[j] > 1) {
      parts[j]--;
      diff++;
    }
  }
  return parts;
}

export type GenerateTargets = {
  gmv: number;
  units: number;
  orders: number;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
};

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function buildOrders(products: MockProduct[], t: GenerateTargets): MockOrder[] {
  const orders = Math.max(1, Math.round(t.orders));
  const units = Math.max(orders, Math.round(t.units));
  const qtys = weightedSplit(units, orders, 0.45, 1.9);
  const cents = weightedSplit(Math.round(t.gmv * 100), orders, 0.3, 2.4);

  const dayMs = 86_400_000;
  const nowMs = Date.now();
  const fromMs = new Date(`${t.from}T00:00:00`).getTime();
  const upperMs = Math.min(new Date(`${t.to}T00:00:00`).getTime() + dayMs, nowMs);
  const spanMs = Math.max(1, upperMs - fromMs);

  const pool = products.length > 0 ? products : null;

  return Array.from({ length: orders }, (_, i) => {
    const product = pool ? pick(pool) : null;
    const quantity = qtys[i];
    const amount = cents[i] / 100;
    const unitPrice = Math.round((amount / quantity) * 100) / 100;
    const r = Math.random();
    return {
      id: uid(),
      productId: product?.id ?? null,
      productName: product?.name ?? "Wireless Headphones",
      category: product?.category ?? "Electronics",
      customerName: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      quantity,
      unitPrice,
      amount,
      status: r < 0.15 ? "Unshipped" : r < 0.5 ? "Shipped" : "Delivered",
      createdAt: new Date(fromMs + Math.random() * spanMs).toISOString(),
    };
  });
}

// Replace all orders with a fresh generated set (same semantics as the route).
export function generateOrders(targets?: Partial<GenerateTargets>): void {
  const db = ensureSeeded();
  const t: GenerateTargets = {
    gmv: targets?.gmv ?? 9_000 + Math.round(Math.random() * 12_000),
    units: targets?.units ?? 0,
    orders: targets?.orders ?? 60 + Math.round(Math.random() * 90),
    from: targets?.from ?? isoDaysAgo(90),
    to: targets?.to ?? isoDaysAgo(0),
  };
  if (!targets?.units) t.units = Math.round(t.orders * (2.4 + Math.random() * 1.4));
  saveDB({ ...db, orders: buildOrders(db.products, t) });
}

// ---- generic CRUD helpers used by mock-backend --------------------------

export { uid };
