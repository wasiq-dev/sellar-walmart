"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, clearToken, apiFetch } from "@/lib/client-auth";

export function useProtectedFetch<T>(path: string) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    let cancelled = false;

    Promise.resolve()
      .then(() => {
        setLoading(true);
        setError(null);
      })
      .then(() => apiFetch(path))
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          clearToken();
          router.replace("/login");
          return;
        }
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError((body && (body.error || body.message)) || "Something went wrong.");
          return;
        }
        setData(body as T);
      })
      .catch(() => {
        if (!cancelled) setError("Something went wrong. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick]);

  // The offline store fires this whenever it's written to (e.g. orders
  // generated) — re-pull so the page reflects the new data immediately.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("wm-demo-change", refetch);
    return () => window.removeEventListener("wm-demo-change", refetch);
  }, [refetch]);

  return { data, loading, error, refetch };
}
