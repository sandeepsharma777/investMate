/**
 * InvestMate — Shared utilities used across every page.
 */

const Utils = (() => {
  "use strict";

  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function formatCurrency(amount, currency = "INR") {
    const symbols = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };
    const symbol = symbols[currency] || currency + " ";
    const n = Number(amount) || 0;
    const formatted = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${n < 0 ? "-" : ""}${symbol}${formatted}`;
  }

  function formatCompact(amount, currency = "INR") {
    const symbols = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };
    const symbol = symbols[currency] || currency + " ";
    const n = Number(amount) || 0;
    const abs = Math.abs(n);
    let out;
    if (abs >= 1e7) out = (abs / 1e7).toFixed(2) + "Cr";
    else if (abs >= 1e5) out = (abs / 1e5).toFixed(2) + "L";
    else if (abs >= 1e3) out = (abs / 1e3).toFixed(1) + "K";
    else out = abs.toFixed(2);
    return `${n < 0 ? "-" : ""}${symbol}${out}`;
  }

  function formatPercent(value) {
    const n = Number(value) || 0;
    return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
  }

  function formatDate(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  function initials(name) {
    if (!name) return "?";
    return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  }

  function debounce(fn, wait = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  /* ---- Toasts ---- */
  function ensureToastStack() {
    let stack = qs(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      stack.setAttribute("aria-live", "polite");
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, type = "default", timeout = 3200) {
    const stack = ensureToastStack();
    const el = document.createElement("div");
    el.className = `toast${type === "error" ? " is-error" : ""}${type === "success" ? " is-success" : ""}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateX(16px)";
      el.style.transition = "all 200ms ease";
      setTimeout(() => el.remove(), 220);
    }, timeout);
  }

  /* ---- Auth guard for protected pages ---- */
  async function requireAuthOrRedirect() {
    const user = await InvestMateAPI.auth.getCurrentUser();
    if (!user) {
      window.location.href = "index.html";
      return null;
    }
    return user;
  }

  async function redirectIfAuthed() {
    const user = await InvestMateAPI.auth.getCurrentUser();
    if (user) window.location.href = "dashboard.html";
    return user;
  }

  /* ---- Modal helpers ---- */
  function openModal(id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
    const focusable = overlay.querySelector("input, select, textarea, button");
    if (focusable) setTimeout(() => focusable.focus(), 60);
  }

  function closeModal(id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  function initModalDismiss() {
    qsa(".modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.classList.remove("is-open"), (document.body.style.overflow = "");
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        qsa(".modal-overlay.is-open").forEach((o) => (o.classList.remove("is-open")));
        document.body.style.overflow = "";
      }
    });
  }

  /* ---- Sidebar / mobile nav ---- */
  function initSidebarToggle() {
    const toggle = qs(".nav-toggle");
    const sidebar = qs(".sidebar");
    const scrim = qs(".sidebar-scrim");
    if (!toggle || !sidebar) return;
    const open = () => { sidebar.classList.add("is-open"); scrim?.classList.add("is-open"); };
    const close = () => { sidebar.classList.remove("is-open"); scrim?.classList.remove("is-open"); };
    toggle.addEventListener("click", () => sidebar.classList.contains("is-open") ? close() : open());
    scrim?.addEventListener("click", close);
  }

  /* ---- Render user chip + active nav link (shared shell logic) ---- */
  function renderUserChip(user) {
    const nameEl = qs("[data-user-name]");
    const emailEl = qs("[data-user-email]");
    const avatarEl = qs("[data-user-avatar]");
    if (nameEl) nameEl.textContent = user.name;
    if (emailEl) emailEl.textContent = user.email;
    if (avatarEl) avatarEl.textContent = initials(user.name);
  }

  function markActiveNav() {
    const page = window.location.pathname.split("/").pop() || "dashboard.html";
    qsa(".nav-link").forEach((link) => {
      const href = link.getAttribute("href");
      link.classList.toggle("is-active", href === page);
    });
  }

  function initLogout() {
    qsa("[data-logout]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        await InvestMateAPI.auth.logout();
        window.location.href = "index.html";
      });
    });
  }

  return {
    qs, qsa, formatCurrency, formatCompact, formatPercent, formatDate, initials,
    debounce, escapeHtml, toast, requireAuthOrRedirect, redirectIfAuthed,
    openModal, closeModal, initModalDismiss, initSidebarToggle,
    renderUserChip, markActiveNav, initLogout,
  };
})();
