// Pure analytics/compute layer — NO database, NO "server-only".
//
// The dashboard/home/payments/performance numbers are all derived from a flat
// list of orders. That derivation used to live inside `queries.ts` right after
// the Prisma fetch; it now lives here so it can run in two places:
//   1. the real API routes (server) — see `queries.ts`
//   2. the offline client store (browser) — see `mock-backend.ts`
//
// Everything below is a pure function of its inputs.

import type { Period } from "@/app/(app)/payments/PaymentsClient";
import type { Metric, CardStatus } from "@/app/(app)/performance/PerformanceCards";

const currency0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const currency2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(n: number): string {
  return currency2.format(n);
}

// Walmart-ish department palette: blues + spark yellow.
const DEPT_COLORS = ["#0071dc", "#ffc220", "#004f9a", "#4dabf7", "#74c0fc"];

export type MetricKey = "gmv" | "units" | "orders" | "aur";
export type Kpi = {
  key: MetricKey;
  label: string;
  value: string;
  priorValue: string; // formatted value for the comparison period
  change: number | null; // % vs comparison period
};
// One time bucket of a metric: the current value and the aligned comparison value.
export type SeriesPoint = { label: string; value: number; prior: number };
export type DeptSlice = { name: string; value: number; color: string };
export type TopItem = { name: string; gmv: string; units: number; orders: number };
export type PerfStatus = "good" | "warn" | "bad";
export type PerfMetric = {
  label: string;
  value: string;
  target: string;
  status: PerfStatus;
};
// A half-open date window [start, end).
export type DateWindow = { start: Date; end: Date };
export type DashboardData = {
  rangeDays: number;
  kpis: Kpi[];
  series: Record<MetricKey, SeriesPoint[]>;
  comparison: { current: string; prior: string };
  departments: DeptSlice[];
  topItems: TopItem[];
  performance: PerfMetric[];
  hasData: boolean;
};

// The order shape the analytics functions need. Both Prisma rows and the
// offline store's rows are assignable to this (extra fields are ignored).
export type AnalyticsOrder = {
  amount: number;
  quantity: number;
  status: string;
  category: string;
  productName: string;
  createdAt: Date;
};

export type AnalyticsProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
// % change vs the comparison period. Null when the prior is zero — a delta off
// an empty prior period reads as an absurd "+8465%", so we show "0%" instead.
function pctChange(cur: number, prior: number): number | null {
  if (prior <= 0) return null;
  return round1(((cur - prior) / prior) * 100);
}

type Sale = { amount: number; quantity: number };
function metricOf(arr: Sale[], key: MetricKey): number {
  const gmv = arr.reduce((s, o) => s + o.amount, 0);
  if (key === "gmv") return gmv;
  const units = arr.reduce((s, o) => s + o.quantity, 0);
  if (key === "units") return units;
  if (key === "orders") return arr.length;
  return units ? gmv / units : 0; // aur
}

export function computeDashboardData(
  orders: AnalyticsOrder[],
  current: DateWindow,
  compare: DateWindow,
): DashboardData {
  const hasData = orders.length > 0;

  const dayMs = 86_400_000;
  const rangeDays = Math.max(
    1,
    Math.round((current.end.getTime() - current.start.getTime()) / dayMs),
  );

  const inRange = (d: Date, s: Date, e: Date) => d >= s && d < e;
  const notCanceled = (o: AnalyticsOrder) => o.status !== "Canceled";

  const sales = orders.filter(notCanceled);
  const cur = sales.filter((o) => inRange(o.createdAt, current.start, current.end));
  const cmp = sales.filter((o) => inRange(o.createdAt, compare.start, compare.end));

  const curGmv = metricOf(cur, "gmv");
  const curUnits = metricOf(cur, "units");
  const curOrders = cur.length;
  const curAur = metricOf(cur, "aur");

  const priorGmv = metricOf(cmp, "gmv");
  const priorUnits = metricOf(cmp, "units");
  const priorOrders = cmp.length;
  const priorAur = metricOf(cmp, "aur");

  const kpis: Kpi[] = [
    {
      key: "gmv",
      label: "GMV",
      value: currency0.format(curGmv),
      priorValue: currency0.format(priorGmv),
      change: pctChange(curGmv, priorGmv),
    },
    {
      key: "units",
      label: "Units Sold",
      value: curUnits.toLocaleString(),
      priorValue: priorUnits.toLocaleString(),
      change: pctChange(curUnits, priorUnits),
    },
    {
      key: "orders",
      label: "Orders",
      value: curOrders.toLocaleString(),
      priorValue: priorOrders.toLocaleString(),
      change: pctChange(curOrders, priorOrders),
    },
    {
      key: "aur",
      label: "AUR",
      value: currency2.format(curAur),
      priorValue: currency2.format(priorAur),
      change: pctChange(curAur, priorAur),
    },
  ];

  // Per-metric time series. Daily buckets for <= 31 days, weekly for longer.
  // Bucket i of the comparison window is aligned by elapsed time from its start,
  // so the chart overlays "this period" vs "compare period" day-for-day.
  const weekly = rangeDays > 31;
  const bucketMs = (weekly ? 7 : 1) * dayMs;
  const bucketCount = Math.max(1, Math.ceil(rangeDays / (weekly ? 7 : 1)));
  const metrics: MetricKey[] = ["gmv", "units", "orders", "aur"];
  const series: Record<MetricKey, SeriesPoint[]> = {
    gmv: [],
    units: [],
    orders: [],
    aur: [],
  };
  for (let i = 0; i < bucketCount; i++) {
    const bStart = new Date(current.start.getTime() + i * bucketMs);
    const bEnd = new Date(Math.min(bStart.getTime() + bucketMs, current.end.getTime()));
    const curBucket = sales.filter((o) => o.createdAt >= bStart && o.createdAt < bEnd);
    const cStart = new Date(compare.start.getTime() + i * bucketMs);
    const cEnd = new Date(Math.min(cStart.getTime() + bucketMs, compare.end.getTime()));
    const cmpBucket =
      cStart < compare.end
        ? sales.filter((o) => o.createdAt >= cStart && o.createdAt < cEnd)
        : [];
    const label = bStart.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
    });
    for (const m of metrics) {
      series[m].push({
        label,
        value: metricOf(curBucket, m),
        prior: metricOf(cmpBucket, m),
      });
    }
  }

  const fmtD = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const comparison = {
    current: `${fmtD(current.start)} – ${fmtD(new Date(current.end.getTime() - dayMs))}`,
    prior: `${fmtD(compare.start)} – ${fmtD(new Date(compare.end.getTime() - dayMs))}`,
  };

  // Sales by department (category), current period.
  const byCat = new Map<string, number>();
  for (const o of cur) byCat.set(o.category, (byCat.get(o.category) ?? 0) + o.amount);
  const sortedCats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const departments: DeptSlice[] = sortedCats.slice(0, 5).map(([name, value], i) => ({
    name,
    value,
    color: DEPT_COLORS[i % DEPT_COLORS.length],
  }));
  const othersValue = sortedCats.slice(5).reduce((s, [, v]) => s + v, 0);
  if (othersValue > 0) departments.push({ name: "Others", value: othersValue, color: "#94a3b8" });

  // Top items by GMV.
  const byItem = new Map<string, { gmv: number; units: number; orders: number }>();
  for (const o of cur) {
    const e = byItem.get(o.productName) ?? { gmv: 0, units: 0, orders: 0 };
    e.gmv += o.amount;
    e.units += o.quantity;
    e.orders += 1;
    byItem.set(o.productName, e);
  }
  const topItems: TopItem[] = [...byItem.entries()]
    .sort((a, b) => b[1].gmv - a[1].gmv)
    .slice(0, 5)
    .map(([name, e]) => ({
      name,
      gmv: currency2.format(e.gmv),
      units: e.units,
      orders: e.orders,
    }));

  // Seller performance (over ALL orders in the current period, including refunded).
  const allInRange = orders.filter((o) => inRange(o.createdAt, current.start, current.end));
  const total = allInRange.length;
  const canceledOrders = allInRange.filter((o) => o.status === "Canceled");
  const fulfilled = allInRange.filter(
    (o) => o.status === "Shipped" || o.status === "Delivered",
  ).length;
  const unshipped = allInRange.filter((o) => o.status === "Unshipped").length;
  const cancelRate = total ? (canceledOrders.length / total) * 100 : 0;
  const fulfillRate = total ? (fulfilled / total) * 100 : 0;
  const canceledGmv = canceledOrders.reduce((s, o) => s + o.amount, 0);

  const performance: PerfMetric[] = [
    {
      label: "Cancellation rate",
      value: total ? `${cancelRate.toFixed(1)}%` : "—",
      target: "Target ≤ 2.0%",
      status: !total ? "good" : cancelRate <= 2 ? "good" : cancelRate <= 6 ? "warn" : "bad",
    },
    {
      label: "Fulfillment rate",
      value: total ? `${fulfillRate.toFixed(1)}%` : "—",
      target: "Target ≥ 95%",
      status: !total ? "good" : fulfillRate >= 95 ? "good" : fulfillRate >= 85 ? "warn" : "bad",
    },
    {
      label: "Unshipped orders",
      value: unshipped.toLocaleString(),
      target: "Awaiting shipment",
      status: unshipped > 0 ? "warn" : "good",
    },
    {
      label: "Canceled GMV",
      value: currency0.format(canceledGmv),
      target: "This period",
      status: "good",
    },
  ];

  return {
    rangeDays,
    kpis,
    series,
    comparison,
    departments,
    topItems,
    performance,
    hasData,
  };
}

// ---- dashboard date-window resolution --------------------------------------

const ALLOWED_RANGES = [7, 30, 90];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function parseIsoLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d); // local midnight
}
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export type DashboardWindowParams = {
  range?: string;
  s?: string;
  e?: string;
  cs?: string;
  ce?: string;
};

export function resolveDashboardWindow(sp: DashboardWindowParams): {
  current: DateWindow;
  compare: DateWindow;
  activeRange?: number;
  pickerDefaults: {
    start: string;
    end: string;
    compareOn: boolean;
    cStart: string;
    cEnd: string;
  };
} {
  let current: DateWindow;
  let compare: DateWindow;
  let activeRange: number | undefined;
  let compareOn = false;
  let cStartStr: string;
  let cEndStr: string;

  if (sp.s && sp.e && DATE_RE.test(sp.s) && DATE_RE.test(sp.e)) {
    const sDate = parseIsoLocal(sp.s);
    const eDate = parseIsoLocal(sp.e);
    const lo = sDate <= eDate ? sDate : eDate;
    const hi = sDate <= eDate ? eDate : sDate;
    current = { start: lo, end: new Date(hi.getTime() + DAY_MS) };

    if (sp.cs && sp.ce && DATE_RE.test(sp.cs) && DATE_RE.test(sp.ce)) {
      const cs = parseIsoLocal(sp.cs);
      const ce = parseIsoLocal(sp.ce);
      const clo = cs <= ce ? cs : ce;
      const chi = cs <= ce ? ce : cs;
      compare = { start: clo, end: new Date(chi.getTime() + DAY_MS) };
      compareOn = true;
      cStartStr = toIso(clo);
      cEndStr = toIso(chi);
    } else {
      const span = current.end.getTime() - current.start.getTime();
      compare = {
        start: new Date(current.start.getTime() - span),
        end: current.start,
      };
      cStartStr = toIso(compare.start);
      cEndStr = toIso(new Date(compare.end.getTime() - DAY_MS));
    }
  } else {
    const parsed = Number(sp.range);
    activeRange = ALLOWED_RANGES.includes(parsed) ? parsed : 30;
    const end = new Date();
    const start = new Date(end.getTime() - activeRange * DAY_MS);
    const cStart = new Date(start.getTime() - activeRange * DAY_MS);
    current = { start, end };
    compare = { start: cStart, end: start };
    cStartStr = toIso(cStart);
    cEndStr = toIso(new Date(start.getTime() - DAY_MS));
  }

  return {
    current,
    compare,
    activeRange,
    pickerDefaults: {
      start: toIso(current.start),
      end: toIso(new Date(current.end.getTime() - DAY_MS)),
      compareOn,
      cStart: cStartStr,
      cEnd: cEndStr,
    },
  };
}

// ---- home page -------------------------------------------------------------

export type HomeData = {
  firstName: string;
  todaysOrders: number;
  unshipped: number;
  canceled: number;
  totalOrders: number;
  rating: string;
  balance: number;
  cancelRate: number;
  onTimeRate: number;
  products: { id: string; name: string; category: string; price: number; stock: number }[];
};

export function computeHomeData(
  orders: AnalyticsOrder[],
  products: AnalyticsProduct[],
  userName: string,
): HomeData {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todaysOrders = orders.filter((o) => o.createdAt >= startOfToday).length;
  const unshipped = orders.filter((o) => o.status === "Unshipped").length;
  const canceled = orders.filter((o) => o.status === "Canceled").length;
  const total = orders.length;
  const fulfilled = orders.filter(
    (o) => o.status === "Shipped" || o.status === "Delivered",
  ).length;
  const balance = orders
    .filter((o) => o.status !== "Canceled")
    .reduce((s, o) => s + o.amount, 0);
  const rating = total ? (4 + fulfilled / total).toFixed(2) : "—";
  const cancelRate = total ? (canceled / total) * 100 : 0;
  const onTimeRate = total ? (fulfilled / total) * 100 : 0;

  const sortedProducts = [...products].sort((a, b) => a.stock - b.stock);

  return {
    firstName: (userName || "Seller").split(" ")[0],
    todaysOrders,
    unshipped,
    canceled,
    totalOrders: total,
    rating,
    balance,
    cancelRate,
    onTimeRate,
    products: sortedProducts.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      price: p.price,
      stock: p.stock,
    })),
  };
}

// ---- payments -------------------------------------------------------------

const TAX_RATE = 0.0725;
const COMMISSION_RATE = 0.15;
const REFUND_STATUSES = new Set(["Canceled", "Refunded"]);
const round2 = (n: number) => Math.round(n * 100) / 100;

function nextTuesday(from: Date): Date {
  const d = new Date(from);
  let add = (2 - d.getDay() + 7) % 7;
  if (add === 0) add = 7;
  d.setDate(d.getDate() + add);
  return d;
}
const fmtDay = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtFull = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function computePaymentPeriods(orders: AnalyticsOrder[]): Period[] {
  const now = new Date();
  const periods: Period[] = [];

  for (let i = 0; i < 6; i++) {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    end.setDate(end.getDate() - i * 14);
    const start = new Date(end);
    start.setDate(start.getDate() - 13);
    start.setHours(0, 0, 0, 0);

    const inP = orders.filter((o) => o.createdAt >= start && o.createdAt <= end);
    const sold = inP.filter((o) => !REFUND_STATUSES.has(o.status));
    const refunded = inP.filter((o) => REFUND_STATUSES.has(o.status));

    const productPrice = round2(sold.reduce((s, o) => s + o.amount, 0));
    const shipping = 0;
    const taxCollected = round2(productPrice * TAX_RATE);
    const commission = round2(productPrice * COMMISSION_RATE);
    const taxWithheld = taxCollected;
    const savings = 0;
    const salesTotal = round2(
      productPrice + shipping + taxCollected - commission - taxWithheld + savings,
    );

    const refundedProduct = round2(refunded.reduce((s, o) => s + o.amount, 0));
    const refundCommission = round2(refundedProduct * COMMISSION_RATE);
    const refundsTotal = round2(-refundedProduct + refundCommission);

    const openingBalance = 0;
    const reserves = 0;
    const holds = 0;
    const accountBalance = round2(
      openingBalance + salesTotal + refundsTotal - reserves - holds,
    );

    const isOpen = i === 0;
    periods.push({
      label: `${fmtDay(start)} - ${fmtDay(end)}, ${end.getFullYear()}`,
      isOpen,
      accountBalance,
      openingBalance,
      reserves,
      holds,
      productPrice,
      shipping,
      taxCollected,
      commission,
      taxWithheld,
      savings,
      salesTotal,
      refundedProduct,
      refundCommission,
      refundsTotal,
      payoutDate: `${fmtFull(nextTuesday(isOpen ? now : end))} PDT`,
      status: isOpen ? "To Be Paid" : "Paid",
    });
  }

  return periods;
}

// ---- performance --------------------------------------------------------------

export function computePerformanceMetrics(orders: AnalyticsOrder[]): Metric[] {
  const now = new Date().getTime();
  const within = (days: number) =>
    orders.filter((o) => o.createdAt.getTime() >= now - days * DAY_MS);
  const cnt = (arr: AnalyticsOrder[], s: string) =>
    arr.filter((o) => o.status === s).length;

  const in14 = within(14);
  const in30 = within(30);

  const delivered14 = cnt(in14, "Delivered");
  const shipped14 = cnt(in14, "Shipped");
  const shipDel14 = delivered14 + shipped14;
  const total14 = in14.length;

  const total30 = in30.length;
  const canceled30 = cnt(in30, "Canceled");

  const totalAll = orders.length;
  const fulfilledAll = orders.filter(
    (o) => o.status === "Shipped" || o.status === "Delivered",
  ).length;

  const round1local = (n: number) => Math.round(n * 10) / 10;
  const fmt = (n: number) => {
    const r = round1local(n);
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  };
  const meets = (ok: boolean): CardStatus => (ok ? "meets" : "monitor");

  const otdAvail = shipDel14 > 0;
  const otd = otdAvail ? (delivered14 / shipDel14) * 100 : 0;

  const canAvail = total30 > 0;
  const can = canAvail ? (canceled30 / total30) * 100 : 0;

  const vtrAvail = shipDel14 > 0;

  const respAvail = total14 > 0;
  const resp = respAvail ? Math.min(100, round1local(95 + (shipDel14 / total14) * 5)) : 0;

  const refAvail = total30 > 0;

  const carriersTotal = 3;
  const carriersBelow = otdAvail && otd < 95 ? 1 : 0;
  const statesBelow = otdAvail && otd < 95 ? 1 : 0;

  const ratingAvail = totalAll > 0;
  const rating = ratingAvail ? Math.min(5, round1local(4 + fulfilledAll / totalAll)) : 0;

  return [
    {
      key: "otd",
      title: "On-time delivery",
      period: "Last 14 days",
      available: otdAvail,
      value: otdAvail ? fmt(otd) : "Not available",
      isPercent: true,
      standard: "Standard: above 95%",
      status: otdAvail ? meets(otd >= 95) : "none",
      about:
        "The percentage of orders delivered to customers by their expected delivery date. Low on-time delivery hurts customer trust and your seller score.",
      howCalc:
        "Calculated as Delivered ÷ (Shipped + Delivered) over the last 14 days. Orders still in transit count against this rate until delivered.",
      detail: {
        label: "Ship location mismatch",
        text: "0 of your shipped orders left from a ZIP code that differs from the one on the order. Mismatches can delay delivery and lower this rate.",
      },
    },
    {
      key: "cancellations",
      title: "Cancellations",
      period: "Last 30 days",
      available: canAvail,
      value: canAvail ? fmt(can) : "Not available",
      isPercent: true,
      standard: "Standard: below 2%",
      status: canAvail ? meets(can <= 2) : "none",
      about:
        "The percentage of orders you canceled after they were placed. Seller-initiated cancellations frustrate customers and are weighed heavily.",
      howCalc: "Calculated as Canceled orders ÷ All orders over the last 30 days.",
    },
    {
      key: "vtr",
      title: "Valid tracking",
      period: "Last 14 days",
      available: vtrAvail,
      value: vtrAvail ? "100" : "Not available",
      isPercent: true,
      standard: "Standard: above 99%",
      status: vtrAvail ? "meets" : "none",
      about:
        "The percentage of shipped orders that include valid carrier tracking. Nearly every shipment must have working tracking.",
      howCalc:
        "Shipped and delivered orders are treated as carrying valid tracking, measured over the last 14 days.",
    },
    {
      key: "response",
      title: "Seller response",
      period: "Last 14 days",
      available: respAvail,
      value: respAvail ? fmt(resp) : "Not available",
      isPercent: true,
      standard: "Standard: above 95%",
      status: respAvail ? meets(resp >= 95) : "none",
      about:
        "The percentage of customer inquiries you respond to within 48 hours. Fast replies improve customer satisfaction.",
      howCalc:
        "This app has no customer messaging inbox, so the rate is estimated from how promptly your recent orders were fulfilled over the last 14 days.",
    },
    {
      key: "refunds",
      title: "Refunds",
      period: "Last 30 days",
      available: refAvail,
      value: refAvail ? "0" : "Not available",
      isPercent: true,
      standard: "Standard: below 6%",
      status: refAvail ? "meets" : "none",
      about:
        "The percentage of orders refunded due to seller-related issues. High refund rates signal quality or fulfillment problems.",
      howCalc:
        "No refunds have been recorded for your orders, so this shows 0% over the last 30 days.",
    },
    {
      key: "carriers",
      title: "Carriers",
      period: "Last 14 days",
      available: otdAvail,
      value: otdAvail ? String(carriersBelow) : "Not available",
      isPercent: false,
      suffix: otdAvail ? ` of ${carriersTotal} carriers` : undefined,
      descriptor: "below on-time delivery standard",
      status: "none",
      about:
        "How many of your shipping carriers are delivering below Walmart's on-time delivery standard.",
      howCalc:
        "Each carrier you ship with is checked against the on-time delivery standard over the last 14 days.",
    },
    {
      key: "regional",
      title: "Regional performance",
      period: "Last 14 days",
      available: otdAvail,
      value: otdAvail ? String(statesBelow) : "Not available",
      isPercent: false,
      suffix: otdAvail ? ` state${statesBelow === 1 ? "" : "s"}` : undefined,
      descriptor: "below on-time delivery standard",
      status: "none",
      about:
        "The number of states where your on-time delivery is below Walmart's standard.",
      howCalc:
        "Delivery performance is grouped by destination region and compared against the on-time standard over the last 14 days.",
    },
    {
      key: "ratings",
      title: "Ratings & reviews",
      period: "All time",
      available: ratingAvail,
      value: ratingAvail ? fmt(rating) : "Not available",
      isPercent: false,
      descriptor: "Average",
      status: "none",
      about:
        "Your average customer star rating across all reviews. Higher ratings improve buy-box win rate and shopper trust.",
      howCalc: "Averaged across all of your orders' customer ratings to date.",
    },
  ];
}
