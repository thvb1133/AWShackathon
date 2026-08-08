/* Login and registration. One controller, two modes, real validation. */

import { initShell, toast, escapeHtml } from "./ui.js";
import { registerUser, loginUser, getUsers, currentUser, saveServerProfile } from "./store.js";
import { health as apiHealth, register as apiRegister, login as apiLogin } from "./api.js";
import { speak } from "./voice.js";

const mode = document.body.dataset.mode;
initShell(mode === "login" ? "login.html" : "register.html");

const form = document.getElementById("auth-form");
const field = (id) => document.getElementById(id);
const setError = (name, message) => {
  const el = document.getElementById(`err-${name}`);
  if (el) el.textContent = message || "";
  return !message;
};

if (currentUser()) {
  form.insertAdjacentHTML(
    "beforebegin",
    `<p class="chip gold">Already logged in as ${escapeHtml(currentUser().username)} — submitting will switch account.</p>`
  );
}

/* --------------------------------------------------- validation */
function validate() {
  let ok = true;
  const username = field("username").value.trim();
  const password = field("password").value;

  if (!username) ok = setError("username", "A cadet name is required.") && ok;
  else if (username.length < 3) ok = setError("username", "At least three characters, please.") && ok;
  else if (!/^[\w .'-]+$/.test(username)) ok = setError("username", "Letters, numbers, spaces, hyphens and apostrophes only.") && ok;
  else ok = setError("username", "") && ok;

  if (!password) ok = setError("password", "A password is required.") && ok;
  else if (mode === "register" && password.length < 6) ok = setError("password", "At least six characters.") && ok;
  else ok = setError("password", "") && ok;

  if (mode === "register") {
    const email = field("email").value.trim();
    const phone = field("phone").value.trim();
    const confirm = field("confirm").value;

    if (!email) ok = setError("email", "An email address is required.") && ok;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) ok = setError("email", "That does not look like an email address.") && ok;
    else ok = setError("email", "") && ok;

    if (phone && !/^[\d +()-]{6,20}$/.test(phone)) ok = setError("phone", "Digits, spaces and + ( ) - only.") && ok;
    else ok = setError("phone", "") && ok;

    if (confirm !== password) ok = setError("confirm", "The two passwords do not match.") && ok;
    else ok = setError("confirm", "") && ok;

    if (getUsers()[username.toUpperCase()]) {
      ok = setError("username", "That cadet name is already orbiting. Choose another.") && ok;
    }
  }
  return ok;
}

for (const input of form.querySelectorAll("input")) {
  input.addEventListener("blur", validate);
}

/* ------------------------------------------------------- submit */
form.addEventListener("submit", (e) => {
  handleSubmit(e);
});

async function handleSubmit(e) {
  e.preventDefault();
  setError("form", "");
  if (!validate()) {
    setError("form", "Please correct the fields marked above.");
    return;
  }

  try {
    /* Same page, two deployment modes:
       - PHP API is reachable: bcrypt account and database session.
       - Static Pages/Netlify deployment: local coursework account.
       The user sees which one was used in the success toast. */
    const backend = await apiHealth();
    if (mode === "register") {
      const payload = {
        username: field("username").value,
        email: field("email").value,
        phone: field("phone").value,
        address: field("address").value,
        password: field("password").value,
        avatar: field("avatar").value,
      };
      const user = backend.available
        ? (await apiRegister(payload)).user
        : registerUser(payload);
      if (backend.available) saveServerProfile(user);
      else loginUser(user.username, field("password").value);
      toast(
        `🚀 Welcome aboard, cadet ${escapeHtml(user.username)}.${backend.available ? " Your account is saved in the database." : " Saved in this browser."}`,
        "good"
      );
      speak(`Welcome aboard, cadet ${user.username}. The classroom is open.`, "thorn");
    } else {
      const user = backend.available
        ? (await apiLogin(field("username").value, field("password").value)).user
        : loginUser(field("username").value, field("password").value);
      if (backend.available) saveServerProfile(user);
      toast(
        `🛰️ Airlock open. Welcome back, ${escapeHtml(user.username)}.${backend.available ? " Server session active." : ""}`,
        "good"
      );
      speak(`Welcome back, cadet ${user.username}.`, "penguin");
    }
    // Give the toast a moment before the page changes underneath it.
    setTimeout(() => {
      window.location.href = "classroom.html";
    }, 900);
  } catch (error) {
    setError("form", error.message);
    toast(escapeHtml(error.message), "bad");
  }
}
