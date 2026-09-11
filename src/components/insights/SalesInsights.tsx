"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { DashboardData, MetricKey } from "@/lib/queries";
import { generateOrders } from "@/lib/mock-db";
import { showToast } from "@/lib/toast";
import KpiBar from "@/components/insights/KpiBar";
import AccountSalesChart from "@/components/insights/AccountSalesChart";
import DateRangePicker from "@/components/insights/DateRangePicker";
import FeedbackBanner from "@/components/insights/FeedbackBanner";
import TopItems from "@/components/TopItems";
import SalesByDepartment from "@/components/SalesByDepartment";
import PerformanceScorecard from "@/components/PerformanceScorecard";

type Tab = "account" | "item" | "department";

const TABS: { key: Tab; label: string }[] = [
  { key: "account", label: "Account Sales Report" },
  { key: "item", label: "Item Sales Report" },
  { key: "department", label: "Sales by Department" },
];

const RANGES = [
  { d: 7, label: "7D" },
  { d: 30, label: "30D" },
  { d: 90, label: "90D" },
];

const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const FORMATTERS: Record<MetricKey, (n: number) => string> = {
  gmv: (n) => usd0.format(n),
  units: (n) => int.format(n),
  orders: (n) => int.format(n),
  aur: (n) => usd2.format(n),
};

export default function SalesInsights({
  data,
  pickerDefaults,
  activeRange,
}: {
  data: DashboardData;
  pickerDefaults: {
    start: string;
    end: string;
    compareOn: boolean;
    cStart: string;
    cEnd: string;
  };
  activeRange?: number;
}) {
  const [tab, setTab] = useState<Tab>("account");
  const [metric, setMetric] = useState<MetricKey>("gmv");
  const lastTap = useRef(0);

  // Hidden shortcut: double-tap / double-click the section heading to refresh
  // the generated sales dataset. The store fires "wm-demo-change" on write, so
  // useProtectedFetch re-pulls and every number here updates.
  function regenerate() {
    generateOrders();
    showToast("Sales data refreshed ✨");
  }
  function onHeadingTap() {
    const now = Date.now();
    if (now - lastTap.current < 400) {
      lastTap.current = 0;
      regenerate();
    } else {
      lastTap.current = now;
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">
        Sales Insights
      </h1>

      {/* tabs */}
      <div className="flex gap-7 border-b border-slate-200">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 pb-3 text-sm font-semibold uppercase tracking-wide transition-colors ${
                active
                  ? "border-wm-navy text-wm-navy"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <FeedbackBanner />

      {tab === "account" && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                className="select-none text-lg font-bold text-slate-900"
                onDoubleClick={regenerate}
                onTouchEnd={onHeadingTap}
              >
                Account sales summary
              </h2>

              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-full border border-slate-200 p-0.5">
                  {RANGES.map((r) => {
                    const on = r.d === activeRange;
                    return (
                      <Link
                        key={r.d}
                        href={`/?range=${r.d}`}
                        scroll={false}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                          on ? "bg-wm-blue text-white" : "text-slate-500 hover:bg-slate-100"
                        }`}
                      >
                        {r.label}
                      </Link>
                    );
                  })}
                </div>

                <DateRangePicker
                  currentLabel={data.comparison.current}
                  priorLabel={data.comparison.prior}
                  defaults={pickerDefaults}
                />
              </div>
            </div>

            <div className="mt-5">
              <KpiBar kpis={data.kpis} active={metric} onSelect={setMetric} />
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-end gap-5 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-5 rounded bg-violet-500" />
                  This period
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0 w-5 border-t-2 border-dashed border-violet-300" />
                  Prior period
                </span>
              </div>
              <AccountSalesChart
                points={data.series[metric]}
                format={FORMATTERS[metric]}
              />
            </div>
          </section>

          <PerformanceScorecard metrics={data.performance} />
        </>
      )}

      {tab === "item" && <TopItems items={data.topItems} />}

      {tab === "department" && <SalesByDepartment data={data.departments} />}
    </div>
  );
}
