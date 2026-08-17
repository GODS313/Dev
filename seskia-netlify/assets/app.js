const DOWNLOAD_URL = "https://github.com/GODS313/Dev/releases/latest/download/hamkare.apk";
const shell = document.querySelector(".site-shell");
const themeButtons = [...document.querySelectorAll("[data-select-theme]")];
const preferredTheme = new URLSearchParams(window.location.search).get("theme");

function setTheme(theme) {
  if (!["violet", "night", "sunset"].includes(theme)) return;
  shell.dataset.theme = theme;
  themeButtons.forEach((button) => {
    const active = button.dataset.selectTheme === theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const url = new URL(window.location.href);
  url.searchParams.set("theme", theme);
  window.history.replaceState({}, "", url);
}

if (preferredTheme) setTheme(preferredTheme);
themeButtons.forEach((button) => button.addEventListener("click", () => setTheme(button.dataset.selectTheme)));

document.querySelector(".download-button").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const label = button.querySelector("b");
  button.classList.add("downloading");
  label.textContent = "در حال انتقال...";
  window.setTimeout(() => {
    button.classList.remove("downloading");
    label.textContent = "دانلود مستقیم اپلیکیشن";
  }, 2400);
});

document.querySelector("#copy-link").addEventListener("click", async (event) => {
  const label = event.currentTarget.querySelector(".copy-label");
  try {
    await navigator.clipboard.writeText(DOWNLOAD_URL);
    label.textContent = "لینک کپی شد";
  } catch {
    label.textContent = DOWNLOAD_URL;
  }
  window.setTimeout(() => (label.textContent = "کپی لینک دانلود"), 1800);
});
