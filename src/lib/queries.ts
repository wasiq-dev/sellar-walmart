import "server-only";
import { prisma } from "@/lib/prisma";
import type { Period } from "@/app/(app)/payments/PaymentsClient";
import type { Metric } from "@/app/(app)/performance/PerformanceCards";
import {
  computeDashboardData,
  computeHomeData,
  computePaymentPeriods,
  computePerformanceMetrics,
  resolveDashboardWindow,
  formatMoney,
  type DateWindow,
  type DashboardData,
  type HomeData,
} from "@/lib/analytics";

// The number-crunching lives in `@/lib/analytics` (pure, no DB) so it can also
// run in the browser for the offline store. This file just fetches rows from
// Prisma and hands them to those functions. Types and pure helpers are
// re-exported here so existing `@/lib/queries` imports keep working.
export {
  computeDashboardData,
  computeHomeData,
  computePaymentPeriods,
  computePerformanceMetrics,
  resolveDashboardWindow,
  formatMoney,
};
export type {
  MetricKey,
  Kpi,
  SeriesPoint,
  DeptSlice,
  TopItem,
  PerfStatus,
  PerfMetric,
  DateWindow,
  DashboardData,
  HomeData,
  DashboardWindowParams,
  AnalyticsOrder,
  AnalyticsProduct,
} from "@/lib/analytics";

export async function getDashboardData(
  userId: string,
  current: DateWindow,
  compare: DateWindow,
): Promise<DashboardData> {
  const orders = await prisma.order.findMany({ where: { userId } });
  return computeDashboardData(orders, current, compare);
}

export async function getHomeData(userId: string, userName: string): Promise<HomeData> {
  const [orders, products] = await Promise.all([
    prisma.order.findMany({
      where: { userId },
      select: { amount: true, quantity: true, status: true, category: true, productName: true, createdAt: true },
    }),
    prisma.product.findMany({
      where: { userId },
      orderBy: { stock: "asc" },
      select: { id: true, name: true, category: true, price: true, stock: true },
    }),
  ]);
  return computeHomeData(orders, products, userName);
}

export async function getPaymentPeriods(userId: string): Promise<Period[]> {
  const orders = await prisma.order.findMany({
    where: { userId },
    select: { amount: true, quantity: true, status: true, category: true, productName: true, createdAt: true },
  });
  return computePaymentPeriods(orders);
}

export async function getPerformanceMetrics(userId: string): Promise<Metric[]> {
  const orders = await prisma.order.findMany({
    where: { userId },
    select: { amount: true, quantity: true, status: true, category: true, productName: true, createdAt: true },
  });
  return computePerformanceMetrics(orders);
}
