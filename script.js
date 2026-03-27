/* =========================================================
   THEME TOGGLE INJECTION + THEME SYSTEM
   ========================================================= */

function injectThemeToggle() {
  const toggle = document.createElement("div");
  toggle.className = "theme-toggle";
  toggle.innerHTML = `<div class="theme-toggle-thumb"></div>`;
  document.body.appendChild(toggle);
}

function initThemeSystem() {
  const html = document.documentElement;
  const saved = localStorage.getItem("theme");

  if (saved) {
    html.classList.add(saved);
  } else {
    html.classList.add("theme-dark");
  }

  document.querySelector(".theme-toggle").addEventListener("click", () => {
    if (html.classList.contains("theme-dark")) {
      html.classList.remove("theme-dark");
      html.classList.add("theme-light");
      localStorage.setItem("theme", "theme-light");
    } else {
      html.classList.remove("theme-light");
      html.classList.add("theme-dark");
      localStorage.setItem("theme", "theme-dark");
    }
  });
}

/* =========================================================
   PUBLIC SITE RENDERING LOGIC
   ========================================================= */

async function renderSite() {
  const data = await fetch("content.json").then(r => r.json());

  // HERO
  document.querySelector(".hero-title").innerText = data.hero.headline;
  document.querySelector(".hero-subtitle").innerText = data.hero.subheadline;
  document.querySelector(".hero-video").src = data.hero.video;

  // PROCESS
  const processContainer = document.querySelector("#process");
  processContainer.innerHTML = "";
  data.process.forEach(step => {
    processContainer.innerHTML += `
      <div class="process-step">
        <img src="${step.icon}" />
        <h3>${step.title}</h3>
        <p>${step.description}</p>
      </div>
    `;
  });

  // PORTFOLIO
  const portfolio = document.querySelector("#portfolio");
  portfolio.innerHTML = "";
  data.portfolio.forEach(item => {
    portfolio.innerHTML += `
      <div class="portfolio-item">
        <iframe src="${item.video}" loading="lazy"></iframe>
        <h4>${item.title}</h4>
      </div>
    `;
  });

  // TESTIMONIALS
  const testimonials = document.querySelector("#testimonials");
  testimonials.innerHTML = "";
  data.testimonials.forEach(t => {
    testimonials.innerHTML += `
      <blockquote>
        “${t.quote}”
        <span>- ${t.name}, ${t.role}</span>
      </blockquote>
    `;
  });
}

/* =========================================================
   DOM READY
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  injectThemeToggle();
  initThemeSystem();
  renderSite();
});
