/**
 * InvestMate — Analytics page logic (analytics.html)
 */

(async function () {
  "use strict";

  const user = await Utils.requireAuthOrRedirect();
  if (!user) return;

  Utils.renderUserChip(user);
  Utils.markActiveNav();
  Utils.initSidebarToggle();
  Utils.initLogout();

  async function load() {
    const [returnsByAsset, movers, allRows, summary] = await Promise.all([
      InvestMateAPI.analytics.getReturnsByAsset(),
      InvestMateAPI.analytics.getTopMovers(5),
      InvestMateAPI.investments.list({ status: "active" }),
      InvestMateAPI.analytics.getSummary(),
    ]);

    if (summary.holdings_count === 0) {
      Utils.qs("main.main").innerHTML = `
        <div class="topbar"><div><div class="topbar__eyebrow">Returns &amp; insight</div><h1>Analytics</h1></div></div>
        <div class="panel empty-state">
          <div class="empty-state__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19V9M11 19V4M18 19v-6"/></svg></div>
          <h3>Nothing to analyze yet</h3>
          <p>Add a few holdings and your returns, allocation and top performers will show up here.</p>
          <a class="btn btn--primary" href="holdings.html?add=1" style="margin:0 auto;">Add an investment</a>
        </div>`;
      return;
    }

    renderInsight(summary, returnsByAsset);
    ChartsUI.renderReturnsBar("returns-bar-chart", returnsByAsset);
    ChartsUI.renderInvestedVsCurrent("invested-current-chart", returnsByAsset);
    renderMovers(movers.gainers, "#gainers-list", true);
    renderMovers(movers.losers, "#losers-list", false);
    renderAllReturnsTable(allRows);
  }

  function renderInsight(summary, returnsByAsset) {
    const best = [...returnsByAsset].sort((a, b) => b.percent_return - a.percent_return)[0];
    const isGain = summary.absolute_return >= 0;
    Utils.qs("#insight-banner-slot").innerHTML = `
      <div class="insight-banner">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 00-4 12.7V17a2 2 0 002 2h4a2 2 0 002-2v-2.3A7 7 0 0012 2z"/><path d="M9.5 22h5"/></svg>
        <p>
          Your portfolio is <strong>${isGain ? "up" : "down"} ${Utils.formatPercent(summary.percent_return)}</strong> overall
          ${best ? ` — <strong>${Utils.escapeHtml(best.label)}</strong> is your strongest asset class at ${Utils.formatPercent(best.percent_return)}.` : "."}
        </p>
      </div>
    `;
  }

  function renderMovers(rows, selector, isGainer) {
    const el = Utils.qs(selector);
    if (!rows.length) {
      el.innerHTML = `<p style="color: var(--paper-ink-soft); font-size: var(--fs-sm);">No ${isGainer ? "gainers" : "losers"} yet.</p>`;
      return;
    }
    el.innerHTML = rows.map((r, i) => `
      <div class="rank-row">
        <span class="rank-row__idx">${i + 1}</span>
        <span>
          <span class="rank-row__name">${Utils.escapeHtml(r.name)}</span>
          <span class="rank-row__sub">${InvestMateAPI.ASSET_TYPES[r.asset_type]?.label || r.asset_type}</span>
        </span>
        <span class="rank-row__val">
          <span class="num ${r.percent_return >= 0 ? "text-positive" : "text-negative"}">${Utils.formatPercent(r.percent_return)}</span>
        </span>
      </div>
    `).join("");
  }

  function renderAllReturnsTable(rows) {
    const tbody = Utils.qs("#all-returns-table tbody");
    const sorted = [...rows].sort((a, b) => b.percent_return - a.percent_return);
    if (!sorted.length) { tbody.innerHTML = `<tr><td colspan="6" class="text-muted">No active holdings.</td></tr>`; return; }
    tbody.innerHTML = sorted.map((r) => `
      <tr>
        <td><span class="cell-primary">${Utils.escapeHtml(r.name)}</span><span class="cell-sub">${Utils.escapeHtml(r.identifier || "")}</span></td>
        <td><span class="seal seal--${r.asset_type}"><i class="seal__dot"></i>${InvestMateAPI.ASSET_TYPES[r.asset_type]?.label || r.asset_type}</span></td>
        <td class="num">${Utils.formatCurrency(r.invested_amount, user.currency)}</td>
        <td class="num">${Utils.formatCurrency(r.current_value, user.currency)}</td>
        <td class="num ${r.absolute_return >= 0 ? "text-positive" : "text-negative"}">${Utils.formatCurrency(r.absolute_return, user.currency)}</td>
        <td class="num ${r.percent_return >= 0 ? "text-positive" : "text-negative"}">${Utils.formatPercent(r.percent_return)}</td>
      </tr>
    `).join("");
  }

  load().catch((err) => Utils.toast(err.message || "Couldn't load analytics.", "error"));
})();
