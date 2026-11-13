const root = document.documentElement;
root.classList.add("js");

const THEME_KEY = "noenv-theme";
const MODES = ["system", "light", "dark"];

function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY) ?? "system";
  } catch {
    return "system";
  }
}

function applyTheme(mode) {
  if (mode === "system") delete root.dataset.theme;
  else root.dataset.theme = mode;
  for (const button of document.querySelectorAll(".theme-toggle")) {
    button.dataset.mode = mode;
    button.setAttribute("aria-label", `Theme: ${mode}. Change theme`);
  }
}

applyTheme(readTheme());
for (const button of document.querySelectorAll(".theme-toggle")) {
  button.addEventListener("click", () => {
    const next = MODES[(MODES.indexOf(button.dataset.mode) + 1) % MODES.length];
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    applyTheme(next);
  });
}

const toast = document.getElementById("toast");
for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
    } catch {
      return;
    }
    button.classList.add("copied");
    toast?.classList.add("show");
    setTimeout(() => {
      button.classList.remove("copied");
      toast?.classList.remove("show");
    }, 1400);
  });
}

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!reduced && "IntersectionObserver" in window) {
  const reveals = document.querySelectorAll(".reveal");
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove("pending");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -80px 0px" },
  );
  for (const element of reveals) {
    if (element.getBoundingClientRect().top > innerHeight) {
      element.classList.add("pending");
      observer.observe(element);
    }
  }
}

const heroVideo = document.querySelector("video[data-reduced-controls]");
if (heroVideo && reduced) {
  heroVideo.removeAttribute("autoplay");
  heroVideo.pause();
  heroVideo.controls = true;
}

const stage = document.querySelector("[data-stage]");
if (stage) runHero(stage);

function runHero(stage) {
  const windowEl = stage.querySelector("[data-window]");
  const rows = [...stage.querySelectorAll("[data-rows] li")];
  const path = stage.querySelector("[data-path]");
  const status = stage.querySelector("[data-status]");
  const teammate = stage.querySelector("[data-teammate]");
  const command = stage.querySelector("[data-cmd]");
  const stripe = stage.querySelector("[data-stripe]");
  const version = stage.querySelector("[data-ver]");
  if (reduced) {
    teammate.classList.remove("hidden");
    return;
  }

  let visible = true;
  new IntersectionObserver(([entry]) => (visible = entry.isIntersecting)).observe(stage);
  const wait = (ms) =>
    new Promise((resolve) => {
      const tick = () => (visible && !document.hidden ? setTimeout(resolve, ms) : setTimeout(tick, 250));
      tick();
    });

  const loop = async () => {
    let current = 4;
    for (;;) {
      windowEl.dataset.state = "out";
      path.textContent = "~/code";
      status.textContent = "No secrets loaded";
      command.textContent = "cd api";
      rows.forEach((row) => row.classList.add("pending"));
      await wait(900);

      windowEl.dataset.state = "in";
      path.textContent = "~/code/api";
      status.textContent = "12 secrets loaded";
      for (const row of rows) {
        row.classList.remove("pending");
        await wait(70);
      }
      await wait(1800);

      current += 1;
      teammate.classList.remove("hidden");
      await wait(1100);
      version.textContent = `v${current}`;
      stripe.classList.add("flash");
      status.textContent = "12 secrets updated";
      await wait(2200);
      teammate.classList.add("hidden");
      stripe.classList.remove("flash");
      await wait(900);

      command.textContent = "cd ..";
      await wait(700);
      windowEl.dataset.state = "out";
      path.textContent = "~/code";
      status.textContent = "Secrets unloaded";
      await wait(2200);
      if (current > 9) current = 4;
    }
  };
  loop();
}
