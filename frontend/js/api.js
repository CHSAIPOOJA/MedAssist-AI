// api.js — small fetch wrapper shared by every page.
// Talks to the backend on the same origin it's served from, so there's
// nothing to configure when you run `npm start` in backend/.

const API_BASE = "/api";

function getToken() {
  return localStorage.getItem("medassist_token");
}
function setSession(token, user) {
  localStorage.setItem("medassist_token", token);
  localStorage.setItem("medassist_user", JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem("medassist_token");
  localStorage.removeItem("medassist_user");
}
function getUser() {
  try {
    return JSON.parse(localStorage.getItem("medassist_user"));
  } catch {
    return null;
  }
}

async function api(path, { method = "GET", body, isForm = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!isForm && body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearSession();
    window.location.href = "index.html";
    return null;
  }

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Something went wrong. Try again.");
  }
  return data;
}
