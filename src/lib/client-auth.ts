const TOKEN_KEY = "session_token";

// sessionStorage is unique per browser tab (and survives a reload of that same
// tab), unlike a cookie — that's what lets two tabs on the identical URL hold
// two different logged-in accounts. Every access is guarded: a "use client"
// component's first render still runs server-side in the App Router, where
// `window` doesn't exist.
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  // Offline store first — when it handles the request, no network call is made.
  const { mockFetch } = await import("@/lib/mock-backend");
  const mocked = await mockFetch(input, init);
  if (mocked) return mocked;

  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(input, { ...init, headers });
}

export async function apiFetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (body && (body.error || body.message)) || `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return body as T;
}
