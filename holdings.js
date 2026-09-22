/**
 * InvestMate — Holdings page logic (holdings.html)
 */

(async function () {
  "use strict";

  const user = await Utils.requireAuthOrRedirect();
  if (!user) return;

  Utils.renderUserChip(user);
  Utils.markActiveNav();
  Utils.initSidebarToggle();
  Utils.initModalDismiss();
  Utils.initLogout();

  const trackedTypes = user.tracked_asset_types?.length ? user.tracked_asset_types : Object.keys(InvestMateAPI.ASSET_TYPES);

  const state = { activeTab: "all", search: "", sort: "recent", rows: [] };

  /* ---------------------------------------------------------
     Tabs
     --------------------------------------------------------- */
  function renderTabs(counts) {
    const tabsEl = Utils.qs("#asset-tabs");
    const allCount = Object.values(counts).reduce((a, b) => a + b, 0);
    const tabs = [{ key: "all", label: "All holdings", count: allCount }, ...trackedTypes.map((key) => ({
      key, label: InvestMateAPI.ASSET_TYPES[key].label, count: counts[key] || 0,
    }))];
    tabsEl.innerHTML = tabs.map((t) => `
      <button class="tab-btn ${state.activeTab === t.key ? "is-active" : ""}" data-tab="${t.key}">
        ${t.label} <span class="count">${t.count}</span>
      </button>
    `).join("");
    Utils.qsa(".tab-btn", tabsEl).forEach((btn) => {
      btn.addEventListener("click", () => { state.activeTab = btn.dataset.tab; refresh(); });
    });
  }

  /* ---------------------------------------------------------
     Table
     --------------------------------------------------------- */
  function applySort(rows) {
    const sorted = [...rows];
    switch (state.sort) {
      case "value-desc": return sorted.sort((a, b) => b.current_value - a.current_value);
      case "return-desc": return sorted.sort((a, b) => b.percent_return - a.percent_return);
      case "return-asc": return sorted.sort((a, b) => a.percent_return - b.percent_return);
      case "name": return sorted.sort((a, b) => a.name.localeCompare(b.name));
      default: return sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
  }

  function renderTable(rows) {
    const tbody = Utils.qs("#holdings-table tbody");
    const empty = Utils.qs("#holdings-empty");
    const table = Utils.qs("#holdings-table");

    if (rows.length === 0) {
      table.style.display = "none";
      empty.style.display = "block";
      return;
    }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = applySort(rows).map((r) => `
      <tr data-id="${r.id}">
        <td>
          <span class="cell-primary">${Utils.escapeHtml(r.name)}</span>
          <span class="cell-sub">${Utils.escapeHtml(r.identifier || r.platform || "—")}${r.status === "sold" ? " · Sold" : ""}</span>
        </td>
        <td><span class="seal seal--${r.asset_type}"><i class="seal__dot"></i>${InvestMateAPI.ASSET_TYPES[r.asset_type]?.label || r.asset_type}</span></td>
        <td class="num">${r.quantity}</td>
        <td class="num">${Utils.formatCurrency(r.purchase_price, user.currency)}</td>
        <td class="num">${Utils.formatCurrency(r.status === "sold" ? r.sold_price : r.current_price, user.currency)}</td>
        <td class="num">${Utils.formatCurrency(r.invested_amount, user.currency)}</td>
        <td class="num">${Utils.formatCurrency(r.current_value, user.currency)}</td>
        <td class="num ${r.absolute_return >= 0 ? "text-positive" : "text-negative"}">${Utils.formatPercent(r.percent_return)}</td>
        <td>
          <div class="row-actions">
            ${r.status === "active" ? `<button class="icon-btn" data-action="sell" title="Mark as sold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></button>` : ""}
            <button class="icon-btn" data-action="edit" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></button>
            <button class="icon-btn" data-action="delete" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6h16z"/></svg></button>
          </div>
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("tr").forEach((tr) => {
      const id = tr.dataset.id;
      tr.querySelector('[data-action="edit"]')?.addEventListener("click", () => openEditModal(id));
      tr.querySelector('[data-action="delete"]')?.addEventListener("click", () => openDeleteModal(id));
      tr.querySelector('[data-action="sell"]')?.addEventListener("click", () => openSellModal(id));
    });
  }

  async function refresh() {
    const all = await InvestMateAPI.investments.list({ status: "active" });
    const soldRows = await InvestMateAPI.investments.list({ status: "sold" });
    const everything = [...all, ...soldRows];

    const counts = {};
    everything.forEach((r) => { counts[r.asset_type] = (counts[r.asset_type] || 0) + 1; });
    renderTabs(counts);

    let rows = state.activeTab === "all" ? everything : everything.filter((r) => r.asset_type === state.activeTab);
    if (state.search) {
      const q = state.search.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.identifier || "").toLowerCase().includes(q) || (r.platform || "").toLowerCase().includes(q));
    }
    state.rows = rows;
    renderTable(rows);
  }

  Utils.qs("#search-input").addEventListener("input", Utils.debounce((e) => { state.search = e.target.value.trim(); refresh(); }, 200));
  Utils.qs("#sort-select").addEventListener("change", (e) => { state.sort = e.target.value; renderTable(state.rows); });

  /* ---------------------------------------------------------
     Add / Edit modal
     --------------------------------------------------------- */
  const typeSelect = Utils.qs("#f-asset-type");
  typeSelect.innerHTML = trackedTypes.map((key) => `<option value="${key}">${InvestMateAPI.ASSET_TYPES[key].label}</option>`).join("");

  function renderTypeSpecificFields(assetType, values = {}) {
    const container = Utils.qs("#type-specific-fields");
    const def = InvestMateAPI.ASSET_TYPES[assetType];
    Utils.qs("#unit-label").textContent = `(${def.unitLabel})`;
    if (!def.fields.length) { container.innerHTML = ""; return; }

    container.innerHTML = `
      <div class="form-section-title">${def.label} details</div>
      <div class="field-row">
        ${def.fields.map((f) => `
          <div class="field" style="${def.fields.length === 1 ? "grid-column: 1 / -1;" : ""}">
            <label class="field__label" for="tf-${f.name}">${f.label}</label>
            ${f.type === "select"
              ? `<select class="input" id="tf-${f.name}">${f.options.map((o) => `<option value="${o}" ${values[f.name] === o ? "selected" : ""}>${o}</option>`).join("")}</select>`
              : `<input class="input ${f.type === "number" ? "input--mono" : ""}" type="${f.type}" id="tf-${f.name}" ${f.step ? `step="${f.step}"` : ""} placeholder="${f.placeholder || ""}" value="${Utils.escapeHtml(values[f.name] || "")}" />`
            }
          </div>
        `).join("")}
      </div>
    `;
  }

  typeSelect.addEventListener("change", () => renderTypeSpecificFields(typeSelect.value));

  function clearFieldErrors() {
    Utils.qsa(".field.has-error", Utils.qs("#holding-form")).forEach((f) => f.classList.remove("has-error"));
  }

  function openAddModal(presetType) {
    clearFieldErrors();
    Utils.qs("#modal-title").textContent = "Add investment";
    Utils.qs("#modal-sub").textContent = "Enter the details exactly as they appear on your statement.";
    Utils.qs("#save-holding-btn").textContent = "Save investment";
    Utils.qs("#holding-form").reset();
    Utils.qs("#holding-id").value = "";
    typeSelect.value = presetType && trackedTypes.includes(presetType) ? presetType : trackedTypes[0];
    Utils.qs("#f-purchase-date").value = new Date().toISOString().slice(0, 10);
    renderTypeSpecificFields(typeSelect.value);
    Utils.openModal("holding-modal");
  }

  async function openEditModal(id) {
    clearFieldErrors();
    const row = state.rows.find((r) => r.id === id) || (await InvestMateAPI.investments.get(id));
    Utils.qs("#modal-title").textContent = "Edit investment";
    Utils.qs("#modal-sub").textContent = "Update figures as your holding changes.";
    Utils.qs("#save-holding-btn").textContent = "Save changes";
    Utils.qs("#holding-id").value = row.id;
    typeSelect.value = row.asset_type;
    Utils.qs("#f-name").value = row.name;
    Utils.qs("#f-identifier").value = row.identifier || "";
    Utils.qs("#f-quantity").value = row.quantity;
    Utils.qs("#f-platform").value = row.platform || "";
    Utils.qs("#f-purchase-price").value = row.purchase_price;
    Utils.qs("#f-purchase-date").value = row.purchase_date;
    Utils.qs("#f-current-price").value = row.current_price;
    Utils.qs("#f-fees").value = row.fees_paid || "";
    Utils.qs("#f-taxes").value = row.taxes_paid || "";
    Utils.qs("#f-notes").value = row.notes || "";
    renderTypeSpecificFields(row.asset_type, row.type_fields || {});
    Utils.openModal("holding-modal");
  }

  Utils.qs("#open-add-modal").addEventListener("click", () => openAddModal());
  Utils.qs("#close-modal").addEventListener("click", () => Utils.closeModal("holding-modal"));
  Utils.qs("#cancel-modal").addEventListener("click", () => Utils.closeModal("holding-modal"));

  Utils.qs("#holding-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors();

    const assetType = typeSelect.value;
    const def = InvestMateAPI.ASSET_TYPES[assetType];
    const type_fields = {};
    def.fields.forEach((f) => { const el = document.getElementById(`tf-${f.name}`); if (el) type_fields[f.name] = el.value; });

    const payload = {
      asset_type: assetType,
      name: Utils.qs("#f-name").value,
      identifier: Utils.qs("#f-identifier").value,
      quantity: Utils.qs("#f-quantity").value,
      platform: Utils.qs("#f-platform").value,
      purchase_price: Utils.qs("#f-purchase-price").value,
      purchase_date: Utils.qs("#f-purchase-date").value,
      current_price: Utils.qs("#f-current-price").value,
      fees_paid: Utils.qs("#f-fees").value,
      taxes_paid: Utils.qs("#f-taxes").value,
      notes: Utils.qs("#f-notes").value,
      type_fields,
    };

    const id = Utils.qs("#holding-id").value;
    const btn = Utils.qs("#save-holding-btn");
    btn.disabled = true;
    try {
      if (id) await InvestMateAPI.investments.update(id, payload);
      else await InvestMateAPI.investments.create(payload);
      Utils.closeModal("holding-modal");
      Utils.toast(id ? "Holding updated." : "Holding added.", "success");
      refresh();
    } catch (err) {
      if (err.code === "VALIDATION") {
        Utils.toast(err.message, "error");
        if (/name/i.test(err.message)) Utils.qs("#field-name").classList.add("has-error");
        if (/quantity/i.test(err.message)) Utils.qs("#field-quantity").classList.add("has-error");
        if (/price/i.test(err.message)) Utils.qs("#field-purchase-price").classList.add("has-error");
        if (/date/i.test(err.message)) Utils.qs("#field-purchase-date").classList.add("has-error");
      } else {
        Utils.toast(err.message || "Couldn't save holding.", "error");
      }
    } finally {
      btn.disabled = false;
    }
  });

  /* ---------------------------------------------------------
     Sell modal
     --------------------------------------------------------- */
  function openSellModal(id) {
    const row = state.rows.find((r) => r.id === id);
    Utils.qs("#sell-id").value = id;
    Utils.qs("#sell-sub").textContent = `Record the exit price for ${row?.name || "this holding"}.`;
    Utils.qs("#sell-price").value = row?.current_price || "";
    Utils.qs("#sell-date").value = new Date().toISOString().slice(0, 10);
    Utils.openModal("sell-modal");
  }
  Utils.qs("#close-sell-modal").addEventListener("click", () => Utils.closeModal("sell-modal"));
  Utils.qs("#cancel-sell").addEventListener("click", () => Utils.closeModal("sell-modal"));
  Utils.qs("#sell-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = Utils.qs("#sell-id").value;
    try {
      await InvestMateAPI.investments.markSold(id, { sold_price: Utils.qs("#sell-price").value, sold_date: Utils.qs("#sell-date").value });
      Utils.closeModal("sell-modal");
      Utils.toast("Holding marked as sold.", "success");
      refresh();
    } catch (err) {
      Utils.toast(err.message || "Couldn't record the sale.", "error");
    }
  });

  /* ---------------------------------------------------------
     Delete modal
     --------------------------------------------------------- */
  let pendingDeleteId = null;
  function openDeleteModal(id) { pendingDeleteId = id; Utils.openModal("delete-modal"); }
  Utils.qs("#cancel-delete").addEventListener("click", () => Utils.closeModal("delete-modal"));
  Utils.qs("#confirm-delete").addEventListener("click", async () => {
    if (!pendingDeleteId) return;
    try {
      await InvestMateAPI.investments.remove(pendingDeleteId);
      Utils.closeModal("delete-modal");
      Utils.toast("Holding deleted.", "success");
      refresh();
    } catch (err) {
      Utils.toast(err.message || "Couldn't delete holding.", "error");
    }
  });

  /* ---------------------------------------------------------
     Deep-link support: holdings.html?add=1&type=gold
     --------------------------------------------------------- */
  const params = new URLSearchParams(window.location.search);
  if (params.get("add") === "1") openAddModal(params.get("type"));

  await refresh();
})();
