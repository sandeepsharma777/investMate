/**
 * InvestMate — Login page logic (index.html)
 */

(async function () {
  "use strict";

  // If already logged in, skip straight to the dashboard.
  await Utils.redirectIfAuthed();

  const form = Utils.qs("#login-form");
  const submitBtn = Utils.qs("#login-submit");
  const demoBtn = Utils.qs("#demo-login");

  function setFieldError(fieldId, hasError) {
    const field = document.getElementById(fieldId);
    if (field) field.classList.toggle("has-error", hasError);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = Utils.qs("#email").value.trim();
    const password = Utils.qs("#password").value;

    let valid = true;
    if (!/^\S+@\S+\.\S+$/.test(email)) { setFieldError("field-email", true); valid = false; } else setFieldError("field-email", false);
    if (!password) { setFieldError("field-password", true); valid = false; } else setFieldError("field-password", false);
    if (!valid) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in…";
    try {
      await InvestMateAPI.auth.login({ email, password });
      window.location.href = "dashboard.html";
    } catch (err) {
      Utils.toast(err.message || "Couldn't log in. Try again.", "error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Log in";
    }
  });

  // "Explore with demo data" — creates (or reuses) a sample account so
  // reviewers/backend devs can see the UI fully populated instantly.
  demoBtn.addEventListener("click", async () => {
    demoBtn.disabled = true;
    demoBtn.textContent = "Preparing demo…";
    const demoEmail = "demo@investmate.app";
    const demoPassword = "demo123";
    try {
      let user;
      try {
        user = await InvestMateAPI.auth.login({ email: demoEmail, password: demoPassword });
      } catch {
        user = await InvestMateAPI.auth.signup({
          name: "Asha Verma",
          email: demoEmail,
          password: demoPassword,
          currency: "INR",
          tracked_asset_types: ["stocks", "mutual_fund", "gold", "fixed_deposit", "crypto"],
        });
        await InvestMateAPI._dev.seedDemoData(user.id);
      }
      window.location.href = "dashboard.html";
    } catch (err) {
      Utils.toast(err.message || "Couldn't start demo.", "error");
      demoBtn.disabled = false;
      demoBtn.textContent = "Explore with demo data";
    }
  });
})();
