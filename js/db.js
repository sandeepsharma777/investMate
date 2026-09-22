/**
 * InvestMate — Data Layer (db.js)
 * ------------------------------------------------------------------
 * This file is the ONLY place that touches storage. Every other JS
 * file talks to `InvestMateAPI`, never to localStorage directly.
 *
 * Why it's shaped this way:
 *   - Every method is `async` and returns a Promise, exactly like a
 *     `fetch()` call to a real backend would. When a real API exists,
 *     you can replace the body of each method with a `fetch(...)`
 *     and nothing in dashboard.js / holdings.js / analytics.js needs
 *     to change.
 *   - Records mirror a normalized relational schema (see SCHEMA below)
 *     so this maps cleanly onto real DB tables: users, investments,
 *     transactions. Field names are already snake_case / DB-friendly.
 *   - IDs, timestamps and validation live here — the "server" layer —
 *     not scattered across page scripts.
 *
 * SCHEMA (mirrors suggested SQL tables)
 * ------------------------------------------------------------------
 * users
 *   id (pk), name, email (unique), password_hash, currency,
 *   tracked_asset_types (json array), created_at
 *
 * investments   -- one row per holding, one table for every asset type
 *   id (pk), user_id (fk -> users.id), asset_type (enum), name,
 *   identifier, quantity, unit, purchase_price, purchase_date,
 *   current_price, current_price_updated_at, platform, notes,
 *   fees_paid, taxes_paid, status (active|sold), sold_price, sold_date,
 *   type_fields (json — asset-specific attributes, see ASSET_TYPES),
 *   created_at, updated_at
 *
 * transactions  -- optional finer-grained log per holding
 *   id (pk), investment_id (fk), user_id (fk), type (buy|sell|dividend|
 *   interest|fee|tax), amount, date, notes, created_at
 * ------------------------------------------------------------------
 */

const InvestMateAPI = (() => {
  "use strict";

  const DB_KEY = "investmate_db_v1";
  const SESSION_KEY = "investmate_session_v1";
  const SIM_LATENCY_MS = 120; // simulated network delay, tune to 0 for instant

  /** Canonical asset-type definitions — single source of truth used by
   *  signup, holdings forms, seals/badges, and analytics grouping. */
  const ASSET_TYPES = {
    stocks: {
      key: "stocks",
      label: "Stocks",
      unitLabel: "shares",
      description: "Equity shares on any exchange",
      fields: [
        { name: "exchange", label: "Exchange", type: "text", placeholder: "NSE, BSE, NASDAQ…" },
        { name: "sector", label: "Sector", type: "text", placeholder: "IT, Banking, Energy…" },
      ],
    },
    mutual_fund: {
      key: "mutual_fund",
      label: "Mutual Funds",
      unitLabel: "units",
      description: "SIP or lump-sum fund units",
      fields: [
        { name: "fund_type", label: "Fund type", type: "select", options: ["Equity", "Debt", "Hybrid", "Index", "ELSS"] },
        { name: "folio_number", label: "Folio number", type: "text", placeholder: "Optional" },
      ],
    },
    gold: {
      key: "gold",
      label: "Gold",
      unitLabel: "grams",
      description: "Physical, digital gold or SGBs",
      fields: [
        { name: "gold_form", label: "Form", type: "select", options: ["Physical", "Digital", "Sovereign Gold Bond", "ETF"] },
        { name: "purity", label: "Purity", type: "text", placeholder: "24K, 22K…" },
      ],
    },
    fixed_deposit: {
      key: "fixed_deposit",
      label: "Fixed Deposits",
      unitLabel: "deposit",
      description: "Bank or corporate FDs",
      fields: [
        { name: "bank_name", label: "Bank / Institution", type: "text", placeholder: "e.g. HDFC Bank" },
        { name: "interest_rate", label: "Interest rate (% p.a.)", type: "number", step: "0.01" },
        { name: "maturity_date", label: "Maturity date", type: "date" },
        { name: "compounding", label: "Compounding", type: "select", options: ["Simple", "Quarterly", "Annually", "Cumulative"] },
      ],
    },
    crypto: {
      key: "crypto",
      label: "Cryptocurrency",
      unitLabel: "coins",
      description: "Any coin or token, any wallet",
      fields: [
        { name: "exchange_wallet", label: "Exchange / Wallet", type: "text", placeholder: "Binance, Ledger…" },
        { name: "network", label: "Network", type: "text", placeholder: "Optional" },
      ],
    },
    other: {
      key: "other",
      label: "Other",
      unitLabel: "units",
      description: "Bonds, real estate, PF, anything else",
      fields: [
        { name: "category_note", label: "Category", type: "text", placeholder: "Bond, REIT, PPF…" },
      ],
    },
  };

  /* ---------------------------------------------------------
     Low-level storage helpers
     --------------------------------------------------------- */

  function readDB() {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) {
      const seed = { users: [], investments: [], transactions: [], _seq: { users: 0, investments: 0, transactions: 0 } };
      localStorage.setItem(DB_KEY, JSON.stringify(seed));
      return seed;
    }
    return JSON.parse(raw);
  }

  function writeDB(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  function nextId(db, table) {
    db._seq[table] = (db._seq[table] || 0) + 1;
    return `${table.slice(0, 3)}_${db._seq[table]}`;
  }

  function delay(value) {
    return new Promise((resolve) => setTimeout(() => resolve(value), SIM_LATENCY_MS));
  }

  function nowISO() {
    return new Date().toISOString();
  }

  /** Very light mock hash so we never store plaintext, matching the
   *  shape a real backend response would have (never a real security
   *  measure — swap for server-side bcrypt/argon2 when a backend exists). */
  function mockHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
    return `h_${Math.abs(h)}`;
  }

  function getSession() {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function setSession(userId) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user_id: userId, issued_at: nowISO() }));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function sanitizeUser(user) {
    if (!user) return null;
    const { password_hash, ...safe } = user;
    return safe;
  }

  function requireAuth(db) {
    const session = getSession();
    if (!session) throw new ApiError("UNAUTHENTICATED", "No active session.");
    const user = db.users.find((u) => u.id === session.user_id);
    if (!user) throw new ApiError("UNAUTHENTICATED", "Session user not found.");
    return user;
  }

  class ApiError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  /* ---------------------------------------------------------
     AUTH
     --------------------------------------------------------- */

  const auth = {
    async signup({ name, email, password, tracked_asset_types, currency }) {
      const db = readDB();
      email = String(email || "").trim().toLowerCase();
      if (!name || !email || !password) throw new ApiError("VALIDATION", "Name, email and password are required.");
      if (password.length < 6) throw new ApiError("VALIDATION", "Password must be at least 6 characters.");
      if (db.users.some((u) => u.email === email)) throw new ApiError("CONFLICT", "An account with this email already exists.");

      const user = {
        id: nextId(db, "users"),
        name: name.trim(),
        email,
        password_hash: mockHash(password),
        currency: currency || "INR",
        tracked_asset_types: tracked_asset_types && tracked_asset_types.length ? tracked_asset_types : Object.keys(ASSET_TYPES).slice(0, 3),
        created_at: nowISO(),
      };
      db.users.push(user);
      writeDB(db);
      setSession(user.id);
      return delay(sanitizeUser(user));
    },

    async login({ email, password }) {
      const db = readDB();
      email = String(email || "").trim().toLowerCase();
      const user = db.users.find((u) => u.email === email);
      if (!user || user.password_hash !== mockHash(password)) {
        throw new ApiError("INVALID_CREDENTIALS", "Email or password is incorrect.");
      }
      setSession(user.id);
      return delay(sanitizeUser(user));
    },

    async logout() {
      clearSession();
      return delay({ ok: true });
    },

    async getCurrentUser() {
      const session = getSession();
      if (!session) return delay(null);
      const db = readDB();
      const user = db.users.find((u) => u.id === session.user_id);
      return delay(sanitizeUser(user));
    },

    async updateTrackedAssetTypes(types) {
      const db = readDB();
      const user = requireAuth(db);
      user.tracked_asset_types = types;
      writeDB(db);
      return delay(sanitizeUser(user));
    },

    isAuthenticated() {
      return !!getSession();
    },
  };

  /* ---------------------------------------------------------
     INVESTMENTS (holdings)
     --------------------------------------------------------- */

  const investments = {
    /** @param filters { asset_type?, status?, search? } */
    async list(filters = {}) {
      const db = readDB();
      const user = requireAuth(db);
      let rows = db.investments.filter((i) => i.user_id === user.id);

      if (filters.asset_type && filters.asset_type !== "all") {
        rows = rows.filter((i) => i.asset_type === filters.asset_type);
      }
      if (filters.status) {
        rows = rows.filter((i) => i.status === filters.status);
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        rows = rows.filter((i) =>
          i.name.toLowerCase().includes(q) ||
          (i.identifier || "").toLowerCase().includes(q) ||
          (i.platform || "").toLowerCase().includes(q)
        );
      }
      return delay(rows.map(computeHoldingMetrics).sort((a, b) => b.created_at.localeCompare(a.created_at)));
    },

    async get(id) {
      const db = readDB();
      const user = requireAuth(db);
      const row = db.investments.find((i) => i.id === id && i.user_id === user.id);
      if (!row) throw new ApiError("NOT_FOUND", "Investment not found.");
      return delay(computeHoldingMetrics(row));
    },

    async create(payload) {
      const db = readDB();
      const user = requireAuth(db);
      validateHoldingPayload(payload);

      const row = {
        id: nextId(db, "investments"),
        user_id: user.id,
        asset_type: payload.asset_type,
        name: payload.name.trim(),
        identifier: payload.identifier || "",
        quantity: Number(payload.quantity),
        unit: ASSET_TYPES[payload.asset_type]?.unitLabel || "units",
        purchase_price: Number(payload.purchase_price),
        purchase_date: payload.purchase_date,
        current_price: payload.current_price !== "" && payload.current_price != null ? Number(payload.current_price) : Number(payload.purchase_price),
        current_price_updated_at: nowISO(),
        platform: payload.platform || "",
        notes: payload.notes || "",
        fees_paid: Number(payload.fees_paid) || 0,
        taxes_paid: Number(payload.taxes_paid) || 0,
        status: "active",
        sold_price: null,
        sold_date: null,
        type_fields: payload.type_fields || {},
        created_at: nowISO(),
        updated_at: nowISO(),
      };
      db.investments.push(row);
      writeDB(db);
      return delay(computeHoldingMetrics(row));
    },

    async update(id, payload) {
      const db = readDB();
      const user = requireAuth(db);
      const row = db.investments.find((i) => i.id === id && i.user_id === user.id);
      if (!row) throw new ApiError("NOT_FOUND", "Investment not found.");
      validateHoldingPayload(payload, true);

      Object.assign(row, {
        asset_type: payload.asset_type ?? row.asset_type,
        name: payload.name?.trim() ?? row.name,
        identifier: payload.identifier ?? row.identifier,
        quantity: payload.quantity != null ? Number(payload.quantity) : row.quantity,
        unit: ASSET_TYPES[payload.asset_type ?? row.asset_type]?.unitLabel || row.unit,
        purchase_price: payload.purchase_price != null ? Number(payload.purchase_price) : row.purchase_price,
        purchase_date: payload.purchase_date ?? row.purchase_date,
        current_price: payload.current_price != null && payload.current_price !== "" ? Number(payload.current_price) : row.current_price,
        current_price_updated_at: payload.current_price != null ? nowISO() : row.current_price_updated_at,
        platform: payload.platform ?? row.platform,
        notes: payload.notes ?? row.notes,
        fees_paid: payload.fees_paid != null ? Number(payload.fees_paid) : row.fees_paid,
        taxes_paid: payload.taxes_paid != null ? Number(payload.taxes_paid) : row.taxes_paid,
        type_fields: payload.type_fields ?? row.type_fields,
        updated_at: nowISO(),
      });
      writeDB(db);
      return delay(computeHoldingMetrics(row));
    },

    async markSold(id, { sold_price, sold_date }) {
      const db = readDB();
      const user = requireAuth(db);
      const row = db.investments.find((i) => i.id === id && i.user_id === user.id);
      if (!row) throw new ApiError("NOT_FOUND", "Investment not found.");
      row.status = "sold";
      row.sold_price = Number(sold_price);
      row.sold_date = sold_date;
      row.updated_at = nowISO();
      writeDB(db);
      return delay(computeHoldingMetrics(row));
    },

    async remove(id) {
      const db = readDB();
      const user = requireAuth(db);
      const idx = db.investments.findIndex((i) => i.id === id && i.user_id === user.id);
      if (idx === -1) throw new ApiError("NOT_FOUND", "Investment not found.");
      db.investments.splice(idx, 1);
      db.transactions = db.transactions.filter((t) => t.investment_id !== id);
      writeDB(db);
      return delay({ ok: true });
    },
  };

  function validateHoldingPayload(p, partial = false) {
    if (!partial || p.asset_type !== undefined) {
      if (!p.asset_type || !ASSET_TYPES[p.asset_type]) throw new ApiError("VALIDATION", "A valid asset type is required.");
    }
    if (!partial || p.name !== undefined) {
      if (!p.name || !p.name.trim()) throw new ApiError("VALIDATION", "Name is required.");
    }
    if (!partial || p.quantity !== undefined) {
      if (p.quantity == null || Number(p.quantity) <= 0) throw new ApiError("VALIDATION", "Quantity must be greater than zero.");
    }
    if (!partial || p.purchase_price !== undefined) {
      if (p.purchase_price == null || Number(p.purchase_price) < 0) throw new ApiError("VALIDATION", "Purchase price must be zero or more.");
    }
    if (!partial || p.purchase_date !== undefined) {
      if (!p.purchase_date) throw new ApiError("VALIDATION", "Purchase date is required.");
    }
  }

  /** Derives all computed, display-ready metrics for a holding.
   *  Kept server-side (here) so every page gets identical numbers. */
  function computeHoldingMetrics(row) {
    const invested = row.quantity * row.purchase_price + (row.fees_paid || 0) + (row.taxes_paid || 0);
    const effectivePrice = row.status === "sold" ? row.sold_price : row.current_price;
    const currentValue = row.quantity * effectivePrice;
    const netValue = row.status === "sold" ? currentValue - (row.fees_paid || 0) - (row.taxes_paid || 0) : currentValue;
    const absoluteReturn = netValue - invested;
    const percentReturn = invested > 0 ? (absoluteReturn / invested) * 100 : 0;

    return {
      ...row,
      invested_amount: round2(invested),
      current_value: round2(currentValue),
      absolute_return: round2(absoluteReturn),
      percent_return: round2(percentReturn),
    };
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /* ---------------------------------------------------------
     ANALYTICS — aggregate queries a real backend would expose
     as dedicated endpoints (/api/analytics/summary, etc.)
     --------------------------------------------------------- */

  const analytics = {
    async getSummary() {
      const rows = await investments.list({ status: "active" });
      const totals = rows.reduce(
        (acc, r) => {
          acc.invested += r.invested_amount;
          acc.current += r.current_value;
          acc.fees += r.fees_paid || 0;
          acc.taxes += r.taxes_paid || 0;
          return acc;
        },
        { invested: 0, current: 0, fees: 0, taxes: 0 }
      );
      const absoluteReturn = totals.current - totals.invested;
      const percentReturn = totals.invested > 0 ? (absoluteReturn / totals.invested) * 100 : 0;
      return delay({
        total_invested: round2(totals.invested),
        total_current_value: round2(totals.current),
        absolute_return: round2(absoluteReturn),
        percent_return: round2(percentReturn),
        total_fees: round2(totals.fees),
        total_taxes: round2(totals.taxes),
        holdings_count: rows.length,
      });
    },

    async getAllocation() {
      const rows = await investments.list({ status: "active" });
      const byType = {};
      rows.forEach((r) => {
        byType[r.asset_type] = (byType[r.asset_type] || 0) + r.current_value;
      });
      const total = Object.values(byType).reduce((a, b) => a + b, 0);
      return delay(
        Object.entries(byType)
          .map(([asset_type, value]) => ({
            asset_type,
            label: ASSET_TYPES[asset_type]?.label || asset_type,
            value: round2(value),
            percent: total > 0 ? round2((value / total) * 100) : 0,
          }))
          .sort((a, b) => b.value - a.value)
      );
    },

    async getReturnsByAsset() {
      const rows = await investments.list({ status: "active" });
      const byType = {};
      rows.forEach((r) => {
        if (!byType[r.asset_type]) byType[r.asset_type] = { asset_type: r.asset_type, label: ASSET_TYPES[r.asset_type]?.label || r.asset_type, invested: 0, current: 0 };
        byType[r.asset_type].invested += r.invested_amount;
        byType[r.asset_type].current += r.current_value;
      });
      return delay(
        Object.values(byType).map((t) => ({
          ...t,
          invested: round2(t.invested),
          current: round2(t.current),
          absolute_return: round2(t.current - t.invested),
          percent_return: t.invested > 0 ? round2(((t.current - t.invested) / t.invested) * 100) : 0,
        }))
      );
    },

    async getTopMovers(limit = 5) {
      const rows = await investments.list({ status: "active" });
      const sorted = [...rows].sort((a, b) => b.percent_return - a.percent_return);
      return delay({
        gainers: sorted.filter((r) => r.percent_return > 0).slice(0, limit),
        losers: sorted.filter((r) => r.percent_return < 0).slice(-limit).reverse(),
      });
    },
  };

  /* ---------------------------------------------------------
     DEV / DEMO seed data — makes the UI feel alive on first run.
     Safe to delete once a real backend is wired up.
     --------------------------------------------------------- */

  async function seedDemoData(userId) {
    const db = readDB();
    const sample = [
      { asset_type: "stocks", name: "HDFC Bank Ltd", identifier: "HDFCBANK", quantity: 25, purchase_price: 1480, current_price: 1642, purchase_date: "2023-04-11", platform: "Zerodha", fees_paid: 45, taxes_paid: 12, type_fields: { exchange: "NSE", sector: "Banking" } },
      { asset_type: "stocks", name: "Tata Motors", identifier: "TATAMOTORS", quantity: 60, purchase_price: 610, current_price: 545, purchase_date: "2024-01-22", platform: "Zerodha", fees_paid: 30, taxes_paid: 8, type_fields: { exchange: "NSE", sector: "Auto" } },
      { asset_type: "mutual_fund", name: "Parag Parikh Flexi Cap", identifier: "PPFCF", quantity: 412.6, purchase_price: 58.2, current_price: 78.9, purchase_date: "2022-06-01", platform: "Groww", fees_paid: 0, taxes_paid: 0, type_fields: { fund_type: "Equity", folio_number: "88213311" } },
      { asset_type: "mutual_fund", name: "ICICI Pru Liquid Fund", identifier: "ICICILIQ", quantity: 1180.3, purchase_price: 305.1, current_price: 318.4, purchase_date: "2023-09-14", platform: "Groww", fees_paid: 0, taxes_paid: 0, type_fields: { fund_type: "Debt", folio_number: "44120098" } },
      { asset_type: "gold", name: "Sovereign Gold Bond 2029", identifier: "SGB-2029", quantity: 12, purchase_price: 5620, current_price: 7180, purchase_date: "2021-08-10", platform: "RBI Retail Direct", fees_paid: 0, taxes_paid: 0, type_fields: { gold_form: "Sovereign Gold Bond", purity: "999" } },
      { asset_type: "fixed_deposit", name: "HDFC Bank FD", identifier: "FD-2231", quantity: 1, purchase_price: 250000, current_price: 268750, purchase_date: "2023-03-01", platform: "HDFC Bank", fees_paid: 0, taxes_paid: 3200, type_fields: { bank_name: "HDFC Bank", interest_rate: "7.25", maturity_date: "2026-03-01", compounding: "Cumulative" } },
      { asset_type: "crypto", name: "Bitcoin", identifier: "BTC", quantity: 0.045, purchase_price: 3180000, current_price: 5720000, purchase_date: "2023-11-05", platform: "CoinDCX", fees_paid: 210, taxes_paid: 620, type_fields: { exchange_wallet: "CoinDCX", network: "Bitcoin" } },
      { asset_type: "crypto", name: "Ethereum", identifier: "ETH", quantity: 0.9, purchase_price: 168000, current_price: 152000, purchase_date: "2024-02-18", platform: "CoinDCX", fees_paid: 95, taxes_paid: 210, type_fields: { exchange_wallet: "CoinDCX", network: "Ethereum" } },
    ];

    for (const s of sample) {
      db.investments.push({
        id: nextId(db, "investments"),
        user_id: userId,
        unit: ASSET_TYPES[s.asset_type].unitLabel,
        current_price_updated_at: nowISO(),
        notes: "",
        status: "active",
        sold_price: null,
        sold_date: null,
        created_at: nowISO(),
        updated_at: nowISO(),
        ...s,
      });
    }
    writeDB(db);
  }

  return {
    ASSET_TYPES,
    ApiError,
    auth,
    investments,
    analytics,
    _dev: { seedDemoData },
  };
})();
