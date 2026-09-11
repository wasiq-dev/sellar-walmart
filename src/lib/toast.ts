// Minimal, dependency-free toast. One transient pill at the bottom-center of
// the screen, styled inline so it needs no CSS classes to be present.

let hideTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string, ms = 1600): void {
  if (typeof document === "undefined") return;

  let el = document.getElementById("wm-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "wm-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    Object.assign(el.style, {
      position: "fixed",
      left: "50%",
      bottom: "28px",
      transform: "translateX(-50%) translateY(8px)",
      zIndex: "2147483647",
      maxWidth: "90vw",
      padding: "10px 16px",
      borderRadius: "9999px",
      background: "rgba(15, 23, 42, 0.92)",
      color: "#fff",
      font: "600 13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
      opacity: "0",
      transition: "opacity 160ms ease, transform 160ms ease",
      pointerEvents: "none",
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
  }

  el.textContent = message;
  // next frame so the transition runs
  requestAnimationFrame(() => {
    if (!el) return;
    el.style.opacity = "1";
    el.style.transform = "translateX(-50%) translateY(0)";
  });

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!el) return;
    el.style.opacity = "0";
    el.style.transform = "translateX(-50%) translateY(8px)";
  }, ms);
}
