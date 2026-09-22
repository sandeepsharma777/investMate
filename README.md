# InvestMate — Frontend

A manual-entry, multi-asset investment tracker: stocks, mutual funds, gold,
fixed deposits, cryptocurrency, and a generic "other" bucket. Pure HTML/CSS/JS,
no framework, no build step — open `html/index.html` (via a local server, not
`file://`, so `localStorage` behaves consistently) and go.

## Folder structure

```
InvestMate/
├── html/
│   ├── index.html        Login
│   ├── signup.html        Signup (account details -> asset-type preferences)
│   ├── dashboard.html      Unified dashboard
│   ├── holdings.html       Full CRUD ledger, tabbed by asset type
│   └── analytics.html      Returns, allocation, gainers/losers
├── css/
│   ├── variables.css      Design tokens (colors, type, spacing)
│   ├── base.css           Resets + shared app shell (sidebar, topbar)
│   ├── components.css     Buttons, ledger cards, modals, tables, forms
│   ├── auth.css           Login/signup-only styles
│   ├── dashboard.css      Dashboard-only styles
│   ├── holdings.css       Holdings-only styles
│   └── analytics.css      Analytics-only styles
└── js/
    ├── db.js              Data layer — the ONLY file that touches storage
    ├── utils.js           Formatting, toasts, modals, auth-guard helpers
    ├── charts.js           Chart.js wrapper (allocation donut, returns bars)
    ├── auth.js            index.html logic
    ├── signup.js          signup.html logic
    ├── dashboard.js       dashboard.html logic
    ├── holdings.js        holdings.html logic
    └── analytics.js       analytics.html logic
```

## Why it's built this way (for the backend you're about to add)

**Everything talks to `InvestMateAPI`, never to `localStorage` directly.**
`db.js` exposes `InvestMateAPI.auth`, `InvestMateAPI.investments` and
`InvestMateAPI.analytics`, every method `async` and Promise-based — exactly
like a `fetch()` call. When your backend exists, you can replace the body of
each method with a real HTTP call and nothing in `dashboard.js`, `holdings.js`
or `analytics.js` has to change. Example, today:

```js
async list(filters) { /* reads localStorage, returns a Promise */ }
```

tomorrow:

```js
async list(filters) {
  const res = await fetch(`/api/investments?${new URLSearchParams(filters)}`);
  return res.json();
}
```

**The data shapes already mirror a normalized relational schema.** Suggested
tables:

```sql
users (
  id, name, email UNIQUE, password_hash, currency,
  tracked_asset_types JSON, created_at
)

investments (                 -- one table for every asset type
  id, user_id FK, asset_type ENUM(stocks, mutual_fund, gold,
    fixed_deposit, crypto, other),
  name, identifier, quantity, unit,
  purchase_price, purchase_date,
  current_price, current_price_updated_at,
  platform, notes, fees_paid, taxes_paid,
  status ENUM(active, sold), sold_price, sold_date,
  type_fields JSON,           -- asset-specific attributes (see below)
  created_at, updated_at
)

transactions (                -- optional, for a future finer-grained log
  id, investment_id FK, user_id FK,
  type ENUM(buy, sell, dividend, interest, fee, tax),
  amount, date, notes, created_at
)
```

`type_fields` keeps `investments` a single table instead of five near-duplicate
ones. It's a JSON column (Postgres `jsonb`, MySQL `JSON`, or just a stringified
column). The exact shape per asset type is defined once, in `db.js`:

```js
InvestMateAPI.ASSET_TYPES.fixed_deposit.fields
// [{ name: "bank_name", ... }, { name: "interest_rate", ... }, ...]
```

Every form (signup's asset picker, the add/edit holding modal) is *rendered
from* `ASSET_TYPES`, not hand-coded per type. Adding a new asset class (say,
"Real Estate") means adding one entry to `ASSET_TYPES` — every page picks it
up automatically.

**Computed metrics (`invested_amount`, `current_value`, `absolute_return`,
`percent_return`) are derived in one place** — `computeHoldingMetrics()` in
`db.js` — so the dashboard, holdings table and analytics page can never show
disagreeing numbers. Move this function server-side verbatim when you build
the real API; it's plain arithmetic with no DOM or storage dependency.

**Auth is session-token shaped**, not cookie/localStorage-shaped. `auth.login`
returns a sanitized user object (no password hash) and stores a session
pointer; swap the mock session for a real JWT/cookie without touching any
page script — they only ever call `InvestMateAPI.auth.getCurrentUser()`.

## Moving to React later

Nothing here assumes global mutable DOM state beyond what's necessary for a
static build:

- `db.js` has zero DOM dependencies — drop it into a React app unchanged as
  your API client / React Query fetcher source, or translate 1:1 into RTK
  Query / TanStack Query endpoints.
- `ASSET_TYPES` is a plain config object — reuse it to drive `<AssetPicker>`
  and `<HoldingForm>` components exactly as it drives the vanilla-JS forms.
- CSS is token-driven (`variables.css`) and component-scoped by class name
  (`.ledger-card`, `.seal`, `.stat-card`, …) — portable to CSS Modules,
  styled-components, or Tailwind config almost verbatim.
- Each page script (`dashboard.js`, `holdings.js`, `analytics.js`) is already
  organized as "load data → render section" functions — each one maps to a
  React component + `useEffect`/query hook.

## Demo data

On the login page, "Explore with demo data" creates (or reuses) a seeded
account (`demo@investmate.app` / `demo123`) with sample holdings across all
five asset types, via `InvestMateAPI._dev.seedDemoData()`. Delete that call
and the `_dev` export once a real backend exists.

## Notes

- No live market data, anywhere, on purpose — every price is user-entered.
- Currency formatting defaults to INR (₹) but is driven by `user.currency`,
  set at signup (USD/EUR/GBP also supported in `Utils.formatCurrency`).
- Fully responsive down to ~360px; sidebar collapses to a slide-in drawer.
- Keyboard focus is visible everywhere; modals close on `Esc` or overlay click.
