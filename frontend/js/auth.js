// auth.js — login/register page behavior.

if (getToken()) {
  window.location.href = "app.html";
}

const tabLogin = document.getElementById("tabLogin");
const tabRegister = document.getElementById("tabRegister");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const authError = document.getElementById("authError");

function showError(message) {
  authError.textContent = message;
  authError.classList.add("show");
}
function hideError() {
  authError.classList.remove("show");
}

tabLogin.addEventListener("click", () => {
  tabLogin.classList.add("active");
  tabRegister.classList.remove("active");
  loginForm.style.display = "block";
  registerForm.style.display = "none";
  hideError();
});

tabRegister.addEventListener("click", () => {
  tabRegister.classList.add("active");
  tabLogin.classList.remove("active");
  registerForm.style.display = "block";
  loginForm.style.display = "none";
  hideError();
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;

  try {
    const data = await api("/auth/login", { method: "POST", body: { email, password } });
    if (data) {
      setSession(data.token, data.user);
      window.location.href = "app.html";
    }
  } catch (err) {
    showError(err.message);
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();
  const name = document.getElementById("regName").value;
  const email = document.getElementById("regEmail").value;
  const password = document.getElementById("regPassword").value;

  try {
    const data = await api("/auth/register", { method: "POST", body: { name, email, password } });
    if (data) {
      setSession(data.token, data.user);
      window.location.href = "app.html";
    }
  } catch (err) {
    showError(err.message);
  }
});
