/**
 * InvestMate — Dashboard page logic (dashboard.html)
 */

(async function () {
  "use strict";

  const user = await Utils.requireAuthOrRedirect();
  if (!user) return;

  Utils.renderUserChip(user);
  Utils.markActiveNav();
  Utils.initSidebarToggle();
  Utils.initLogout();

  Utils.qs("#greeting").textContent = `Good to see you, ${user.name.split(" ")[0]}`;

  const ASSET_ICONS = {
    stocks: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/></svg>`,
    mutual_fund: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="4" height="12"/><rect x="10" y="4" width="4" height="16"/><rect x="17" y="11" width="4" height="9"/></svg>`,
    gold: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M9 12h6M12 9v6"/></svg>`,
    fixed_deposit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M8 15h4"/></svg>`,
    crypto: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 8h3.2a2.3 2.3 0 010 4.6H9.5m0 0h3.6a2.3 2.3 0 010 4.6H9.5m1-9.2V7m0 10v1.2"/></svg>`,
    other: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20"/></svg>`,
  };

  async function load() {
    const [summary, allocation, movers, recent] = await Promise.all([
      InvestMateAPI.analytics.getSummary(),
      InvestMateAPI.analytics.getAllocation(),
      InvestMateAPI.analytics.getTopMovers(3),
      InvestMateAPI.investments.list({ status: "active" }),
    ]);

    if (summary.holdings_count === 0) {
      Utils.qs("#stat-cards").style.display = "none";
      Utils.qs("#dashboard-content").style.display = "none";
      Utils.qs("#empty-state").style.display = "block";
      renderQuickAdd();
      return;
    }

    renderStatCards(summary, user.currency);
    renderAllocation(allocation, summary, user.currency);
    renderFeeTax(summary, user.currency);
    renderPerformers(movers, user.currency);
    renderRecentTable(recent.slice(0, 6), user.currency);
    renderQuickAdd();

    Utils.qs("#dashboard-content").style.display = "block";
  }

  function renderStatCards(summary, currency) {
    const isGain = summary.absolute_return >= 0;
    Utils.qs("#stat-cards").innerHTML = `
      <div class="ledger-card stat-card">
        <span class="stat-card__label">Total portfolio value</span>
        <span class="stat-card__value num">${Utils.formatCurrency(summary.total_current_value, currency)}</span>
        <span class="text-muted" style="font-size: var(--fs-2xs);">${summary.holdings_count} active holding${summary.holdings_count === 1 ? "" : "s"}</span>
      </div>
      <div class="ledger-card stat-card">
        <span class="stat-card__label">Total invested</span>
        <span class="stat-card__value num">${Utils.formatCurrency(summary.total_invested, currency)}</span>
        <span class="text-muted" style="font-size: var(--fs-2xs);">Cost basis incl. fees &amp; taxes</span>
      </div>
      <div class="ledger-card stat-card">
        <span class="stat-card__label">Absolute return</span>
        <span class="stat-card__value num">${Utils.formatCurrency(summary.absolute_return, currency)}</span>
        <span class="stat-card__delta ${isGain ? "is-positive" : "is-negative"}">
          ${isGain ? "▲" : "▼"} ${Utils.formatPercent(summary.percent_return)}
        </span>
      </div>
      <div class="ledger-card stat-card">
        <span class="stat-card__label">Fees + taxes paid</span>
        <span class="stat-card__value num">${Utils.formatCurrency(summary.total_fees + summary.total_taxes, currency)}</span>
        <span class="text-muted" style="font-size: var(--fs-2xs);">${Utils.formatCurrency(summary.total_fees, currency)} fees · ${Utils.formatCurrency(summary.total_taxes, currency)} tax</span>
      </div>
    `;
  }

  function renderAllocation(allocation, summary, currency) {
    Utils.qs("#allocation-total").textContent = Utils.formatCompact(summary.total_current_value, currency);
    ChartsUI.renderAllocationDonut("allocation-chart", allocation);

    Utils.qs("#allocation-legend").innerHTML = allocation.map((row) => `
      <div class="legend__row">
        <span class="legend__swatch" style="background:${ChartsUI.PALETTE[row.asset_type] || ChartsUI.PALETTE.other}"></span>
        <span class="legend__name">${row.label}</span>
        <span class="legend__pct">${row.percent}%</span>
        <span class="legend__amt num">${Utils.formatCompact(row.value, currency)}</span>
      </div>
    `).join("");
  }

  function renderFeeTax(summary, currency) {
    Utils.qs("#fee-tax-summary").innerHTML = `
      <div class="fee-tax-summary__item">
        <div class="stat-card__label">Total fees</div>
        <div class="num">${Utils.formatCurrency(summary.total_fees, currency)}</div>
      </div>
      <div class="fee-tax-summary__item">
        <div class="stat-card__label">Total taxes</div>
        <div class="num">${Utils.formatCurrency(summary.total_taxes, currency)}</div>
      </div>
      <div class="fee-tax-summary__item">
        <div class="stat-card__label">% of invested capital</div>
        <div class="num">${summary.total_invested > 0 ? (((summary.total_fees + summary.total_taxes) / summary.total_invested) * 100).toFixed(2) : "0.00"}%</div>
      </div>
    `;
  }

  function renderPerformers(movers, currency) {
    const rows = [...movers.gainers, ...movers.losers];
    if (rows.length === 0) {
      Utils.qs("#performers-list").innerHTML = `<p class="text-muted" style="color:var(--ink-400);">Not enough data yet.</p>`;
      return;
    }
    Utils.qs("#performers-list").innerHTML = rows.map((r) => `
      <div class="perf-list__row">
        <span class="perf-list__name">
          <span class="seal seal--${r.asset_type}"><i class="seal__dot"></i></span>
          ${Utils.escapeHtml(r.name)}
        </span>
        <span class="perf-list__figures">
          <span class="num ${r.percent_return >= 0 ? "text-positive" : "text-negative"}">${Utils.formatPercent(r.percent_return)}</span>
          <small>${Utils.formatCompact(r.absolute_return, currency)}</small>
        </span>
      </div>
    `).join("");
  }

  function renderRecentTable(rows, currency) {
    const tbody = Utils.qs("#recent-table tbody");
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-muted">No holdings yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td>
          <span class="cell-primary">${Utils.escapeHtml(r.name)}</span>
          <span class="cell-sub">${Utils.escapeHtml(r.identifier || r.platform || "")}</span>
        </td>
        <td><span class="seal seal--${r.asset_type}"><i class="seal__dot"></i>${InvestMateAPI.ASSET_TYPES[r.asset_type]?.label || r.asset_type}</span></td>
        <td class="num">${Utils.formatCurrency(r.invested_amount, currency)}</td>
        <td class="num">${Utils.formatCurrency(r.current_value, currency)}</td>
        <td class="num ${r.absolute_return >= 0 ? "text-positive" : "text-negative"}">${Utils.formatPercent(r.percent_return)}</td>
      </tr>
    `).join("");
  }

  function renderQuickAdd() {
    const types = user.tracked_asset_types?.length ? user.tracked_asset_types : Object.keys(InvestMateAPI.ASSET_TYPES);
    Utils.qs("#quick-add").innerHTML = types.map((key) => {
      const t = InvestMateAPI.ASSET_TYPES[key];
      if (!t) return "";
      return `<a class="quick-add__btn" href="holdings.html?add=1&type=${key}">
        <span class="seal__dot" style="background:${ChartsUI.PALETTE[key] || ChartsUI.PALETTE.other}"></span>
        ${t.label}
      </a>`;
    }).join("");
  }

  load().catch((err) => Utils.toast(err.message || "Couldn't load dashboard.", "error"));
})();
