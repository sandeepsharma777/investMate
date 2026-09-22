/**
 * InvestMate — Signup page logic (signup.html)
 */

(async function () {
  "use strict";

  await Utils.redirectIfAuthed();

  const step1 = Utils.qs("#step-1");
  const step2 = Utils.qs("#step-2");
  const stepCurrent = Utils.qs("#step-current");
  const stepNameLabel = Utils.qs("#step-name-label");
  const stepHeading = Utils.qs("#step-heading");
  const stepSub = Utils.qs("#step-subheading");
  const tracks = Utils.qsa(".step-track__item");

  const collected = {};

  const ASSET_ICONS = {
    stocks: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/></svg>`,
    mutual_fund: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="4" height="12"/><rect x="10" y="4" width="4" height="16"/><rect x="17" y="11" width="4" height="9"/></svg>`,
    gold: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M9 12h6M12 9v6"/></svg>`,
    fixed_deposit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M8 15h4"/></svg>`,
    crypto: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 8h3.2a2.3 2.3 0 010 4.6H9.5m0 0h3.6a2.3 2.3 0 010 4.6H9.5m1-9.2V7m0 10v1.2"/></svg>`,
    other: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20"/></svg>`,
  };

  /* ---- Render asset-type picker from the single source of truth in db.js ---- */
  const picker = Utils.qs("#asset-picker");
  Object.values(InvestMateAPI.ASSET_TYPES).forEach((type, i) => {
    const label = document.createElement("label");
    label.className = "asset-option";
    label.dataset.type = type.key;
    label.innerHTML = `
      <input type="checkbox" name="asset_type" value="${type.key}" ${i < 3 ? "checked" : ""} />
      <span class="asset-option__icon" style="background: rgba(201,162,75,0.14); color: var(--gold-500);">${ASSET_ICONS[type.key] || ASSET_ICONS.other}</span>
      <span class="asset-option__label">${type.label}</span>
      <span class="asset-option__desc">${type.description}</span>
    `;
    if (i < 3) label.classList.add("is-selected");
    label.addEventListener("click", (e) => {
      // allow the click to toggle the underlying checkbox, then sync style
      setTimeout(() => {
        const checked = label.querySelector("input").checked;
        label.classList.toggle("is-selected", checked);
      }, 0);
    });
    picker.appendChild(label);
  });

  function setFieldError(fieldId, hasError) {
    const field = document.getElementById(fieldId);
    if (field) field.classList.toggle("has-error", hasError);
  }

  /* ---- Password strength meter ---- */
  const pwInput = Utils.qs("#password");
  const pwMeter = Utils.qs("#pw-strength");
  pwInput.addEventListener("input", () => {
    const v = pwInput.value;
    let level = 0;
    if (v.length >= 6) level = 1;
    if (v.length >= 8 && /[0-9]/.test(v)) level = 2;
    if (v.length >= 10 && /[0-9]/.test(v) && /[^A-Za-z0-9]/.test(v)) level = 3;
    pwMeter.dataset.level = String(level);
  });

  /* ---- Step 1 -> Step 2 ---- */
  step1.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = Utils.qs("#name").value.trim();
    const email = Utils.qs("#email").value.trim();
    const password = Utils.qs("#password").value;
    const password2 = Utils.qs("#password2").value;
    const currency = Utils.qs("#currency").value;

    let valid = true;
    if (!name) { setFieldError("field-name", true); valid = false; } else setFieldError("field-name", false);
    if (!/^\S+@\S+\.\S+$/.test(email)) { setFieldError("field-email", true); valid = false; } else setFieldError("field-email", false);
    if (password.length < 6) { setFieldError("field-password", true); valid = false; } else setFieldError("field-password", false);
    if (password !== password2) { setFieldError("field-password2", true); valid = false; } else setFieldError("field-password2", false);
    if (!Utils.qs("#agree-terms").checked) { Utils.toast("Please confirm you understand InvestMate is manual-entry.", "error"); valid = false; }
    if (!valid) return;

    Object.assign(collected, { name, email, password, currency });

    step1.style.display = "none";
    step2.style.display = "block";
    stepCurrent.textContent = "2";
    stepNameLabel.textContent = "What do you invest in?";
    stepHeading.textContent = "What would you like to track?";
    stepSub.textContent = "Pick everything that applies — you can change this later.";
    tracks[0].classList.add("is-done");
    tracks[1].classList.add("is-active");
  });

  Utils.qs("#back-to-step-1").addEventListener("click", () => {
    step2.style.display = "none";
    step1.style.display = "block";
    stepCurrent.textContent = "1";
    stepNameLabel.textContent = "Account details";
    stepHeading.textContent = "Create your account";
    stepSub.textContent = "Start with the basics — you're two steps from your dashboard.";
    tracks[0].classList.remove("is-done");
    tracks[1].classList.remove("is-active");
  });

  /* ---- Step 2 submit -> create account ---- */
  step2.addEventListener("submit", async (e) => {
    e.preventDefault();
    const selected = Utils.qsa('input[name="asset_type"]:checked').map((i) => i.value);
    const errorEl = Utils.qs("#asset-picker-error");
    if (selected.length === 0) {
      errorEl.style.display = "block";
      return;
    }
    errorEl.style.display = "none";

    const submitBtn = Utils.qs("#signup-submit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account…";

    try {
      await InvestMateAPI.auth.signup({ ...collected, tracked_asset_types: selected });
      Utils.toast("Account created — welcome to InvestMate!", "success");
      window.location.href = "dashboard.html";
    } catch (err) {
      Utils.toast(err.message || "Couldn't create your account.", "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Create account";
    }
  });
})();
