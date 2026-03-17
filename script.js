/* =============================================================
   DATA SOURCES
   Edit content in:
   - data/projects.csv
   - data/publications.csv
   - data/news.csv
   ============================================================= */

const DATA_FILES = {
  projects: "data/projects.csv",
  publications: "data/publications.csv",
  news: "data/news.csv",
};

let PROJECTS = [];
let PUBLICATIONS = [];
let NEWS_ITEMS = [];

async function fetchCsvRows(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }

  return parseCsv(await response.text());
}

function parseCsv(text) {
  const normalizedText = String(text || "").replace(/^\uFEFF/, "");
  const delimiter = detectCsvDelimiter(normalizedText);
  const rows = [];
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;

  for (let index = 0; index < normalizedText.length; index += 1) {
    const char = normalizedText[index];

    if (inQuotes) {
      if (char === '"') {
        if (normalizedText[index + 1] === '"') {
          currentField += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if (char === "\n") {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
      continue;
    }

    if (char !== "\r") {
      currentField += char;
    }
  }

  if (currentField.length || currentRow.length) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  if (!rows.length) return [];

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((value) => value.trim());

  return dataRows
    .filter((row) => row.some((cell) => String(cell || "").trim() !== ""))
    .map((row) => {
      const entry = {};
      headers.forEach((header, index) => {
        entry[header] = String(row[index] || "").trim();
      });
      return entry;
    });
}

function detectCsvDelimiter(text) {
  const firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function parseOptionalNumber(value) {
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalBoolean(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function parseListField(value) {
  return String(value || "")
    .split(";;")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLinkField(value) {
  return parseListField(value)
    .map((item) => {
      const [label = "", href = "", newTab = ""] = item.split("::").map((part) => part.trim());
      return {
        label,
        href,
        newTab: parseOptionalBoolean(newTab),
      };
    })
    .filter((link) => link.href);
}

function normalizeProjects(projectRows) {
  return projectRows.map((row) => ({
    title: row.title,
    tags: parseListField(row.tags),
    status: row.status || "",
    award: row.award || "",
    description: row.description || "",
    images: parseListField(row.images),
    video: row.video || "",
    links: parseLinkField(row.links),
    year: parseOptionalNumber(row.year),
  }));
}

function normalizePublications(publicationRows) {
  return publicationRows.map((row) => ({
    title: row.title,
    authors: row.authors || "",
    venue: row.venue || "",
    award: row.award || "",
    year: parseOptionalNumber(row.year),
    abstract: row.abstract || "",
    thumb: row.thumb || "",
    links: parseLinkField(row.links),
  }));
}

function normalizeNews(newsRows) {
  return newsRows.map((row) => ({
    date: row.date || "",
    note: row.note || "",
    links: parseLinkField(row.links),
  }));
}

async function loadPortfolioData() {
  const [projectRows, publicationRows, newsRows] = await Promise.all([
    fetchCsvRows(DATA_FILES.projects),
    fetchCsvRows(DATA_FILES.publications),
    fetchCsvRows(DATA_FILES.news),
  ]);

  PROJECTS = normalizeProjects(projectRows);
  PUBLICATIONS = normalizePublications(publicationRows);
  NEWS_ITEMS = normalizeNews(newsRows);
}

function showDataLoadError() {
  const projectGrid = document.getElementById("projectGrid");
  const pubList = document.getElementById("pubList");
  const newsList = document.getElementById("newsList");

  if (projectGrid) {
    projectGrid.innerHTML = '<p class="projects-empty">Unable to load projects right now.</p>';
  }

  if (pubList) {
    pubList.innerHTML = '<p class="projects-empty">Unable to load publications right now.</p>';
  }

  if (newsList) {
    newsList.innerHTML = '<li class="news-empty">Unable to load news right now.</li>';
  }
}


/* =============================================================
   RENDERING
   ============================================================= */

// Global registry: galleryId → array of { type, src } used by the lightbox
window._GALLERIES = {};
let _galleryCounter = 0;

const projectViewState = {
  tag: "all",
  year: "all",
  sort: "desc",
  visibleCount: 3,
};

const PROJECT_PREVIEW_COUNT = 3;
const PROJECT_SHOW_MORE_STEP = 3;

const publicationViewState = {
  sort: "desc",
  visibleCount: 3,
};

const PUBLICATION_PREVIEW_COUNT = 3;
const PUBLICATION_SHOW_MORE_STEP = 3;

const newsViewState = {
  visibleCount: 5,
};

const NEWS_PREVIEW_COUNT = 5;
const NEWS_SHOW_MORE_STEP = 7;

function parseNewsDate(value) {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const [, year, month, day] = match;
      return new Date(Number(year), Number(month) - 1, Number(day));
    }
  }

  return new Date(value);
}

function formatNewsDate(value) {
  const date = parseNewsDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

function getVisibleNews() {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  return [...NEWS_ITEMS]
    .filter((item) => {
      const itemTime = parseNewsDate(item.date).getTime();
      return Number.isNaN(itemTime) || itemTime <= todayStart;
    })
    .sort((a, b) => {
      const aTime = parseNewsDate(a.date).getTime();
      const bTime = parseNewsDate(b.date).getTime();
      return bTime - aTime;
    });
}

function buildNewsNoteElement(item) {
  const note = document.createElement("p");
  note.className = "news-note";
  note.textContent = item.note || "";

  const links = Array.isArray(item.links) ? item.links : [];
  if (!links.length) return note;

  const linksWrap = document.createElement("span");
  linksWrap.className = "news-note-links";

  links.forEach((link, idx) => {
    if (!link || !link.href) return;
    if (idx > 0) linksWrap.append(document.createTextNode(" · "));

    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    anchor.textContent = link.label || link.href;
    linksWrap.appendChild(anchor);
  });

  if (linksWrap.childNodes.length) {
    note.append(document.createTextNode(" "));
    note.appendChild(linksWrap);
  }

  return note;
}

function animateContainerUpdate(container, updateFn) {
  if (!container || typeof updateFn !== "function") {
    if (typeof updateFn === "function") updateFn();
    return;
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) {
    updateFn();
    return;
  }

  container.classList.add("content-animate");
  container.classList.add("is-updating");

  setTimeout(() => {
    updateFn();
    requestAnimationFrame(() => {
      container.classList.remove("is-updating");
    });
  }, 120);
}

function renderNews(options = {}) {
  const { animate = false } = options;
  const list = document.getElementById("newsList");
  if (!list) return;

  if (animate) {
    animateContainerUpdate(list, () => renderNews());
    return;
  }

  list.innerHTML = "";
  const items = getVisibleNews();

  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "news-empty";
    empty.textContent = "No news updates yet.";
    list.appendChild(empty);
    updateNewsShowMoreButton(0);
    return;
  }

  const limitedCount = Math.min(newsViewState.visibleCount, items.length);
  const itemsToRender = items.slice(0, limitedCount);

  itemsToRender.forEach((item) => {
    const row = document.createElement("li");
    row.className = "news-item reveal";
    const date = document.createElement("span");
    date.className = "news-date";
    date.textContent = formatNewsDate(item.date);

    const note = buildNewsNoteElement(item);

    row.appendChild(date);
    row.appendChild(note);
    list.appendChild(row);
  });

  updateNewsShowMoreButton(items.length);

  initReveal();
}

function updateNewsShowMoreButton(totalItems) {
  const list = document.getElementById("newsList");
  if (!list) return;

  let wrap = document.getElementById("newsShowMoreWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "newsShowMoreWrap";
    wrap.className = "news-more-wrap";
    list.insertAdjacentElement("afterend", wrap);
  }

  wrap.innerHTML = "";

  const shouldShowButton = totalItems > NEWS_PREVIEW_COUNT;
  if (!shouldShowButton) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-secondary";
  const atEnd = newsViewState.visibleCount >= totalItems;
  if (atEnd) {
    btn.textContent = "Show less";
  } else {
    const remaining = Math.max(0, totalItems - newsViewState.visibleCount);
    const stepAmount = Math.min(NEWS_SHOW_MORE_STEP, remaining);
    btn.textContent = `Show ${stepAmount} more (${remaining} left)`;
  }
  btn.addEventListener("click", () => {
    if (atEnd) {
      newsViewState.visibleCount = Math.max(
        NEWS_PREVIEW_COUNT,
        newsViewState.visibleCount - NEWS_SHOW_MORE_STEP
      );
    } else {
      newsViewState.visibleCount = Math.min(
        totalItems,
        newsViewState.visibleCount + NEWS_SHOW_MORE_STEP
      );
    }
    renderNews({ animate: true });
  });

  wrap.appendChild(btn);

  if (!atEnd) {
    const showAllBtn = document.createElement("button");
    showAllBtn.type = "button";
    showAllBtn.className = "btn btn-secondary";
    showAllBtn.textContent = "Show all";
    showAllBtn.addEventListener("click", () => {
      newsViewState.visibleCount = totalItems;
      renderNews({ animate: true });
    });
    wrap.appendChild(showAllBtn);
  }
}

function buildProjectCard(project) {
  const galleryId = `gallery-${_galleryCounter++}`;

  // Build ordered media list: video first (if present), then images
  const mediaList = [];
  if (project.video) {
    const isYT = project.video.includes("youtube");
    mediaList.push({ type: isYT ? "iframe" : "video", src: project.video });
  }
  (project.images || []).forEach((src) => mediaList.push({ type: "image", src }));

  window._GALLERIES[galleryId] = mediaList;

  const total = mediaList.length;

  // Build slide HTML
  const slidesHtml = mediaList.map((item, i) => {
    let inner;
    if (item.type === "iframe") {
      inner = `<img src="https://img.youtube.com/vi/${extractYoutubeId(item.src)}/hqdefault.jpg"
               alt="${project.title} preview" loading="lazy" />`;
    } else if (item.type === "video") {
      inner = `<video src="${item.src}" autoplay loop muted playsinline preload="metadata"></video>`;
    } else {
      inner = `<img src="${item.src}" alt="${project.title} — image ${i + 1}" loading="lazy" />`;
    }
    const icon = (item.type !== "image") ? playIcon() : expandIcon();
    const videoBadge = (item.type === "video" || item.type === "iframe")
      ? `<span class="gallery-video-badge">VIDEO</span>` : "";
    return `<div class="gallery-slide${i === 0 ? " active" : ""}"
                 data-gallery-id="${galleryId}"
                 data-gallery-idx="${i}"
                 role="button" tabindex="0"
                 aria-label="${item.type !== 'image' ? 'Open video' : 'Expand image'} ${i + 1} of ${total}">
        ${videoBadge}
        ${inner}
        <div class="gallery-slide-overlay">${icon}</div>
      </div>`;
  }).join("");

  const navHtml = total > 1 ? `
    <button class="gallery-btn gallery-btn-prev" aria-label="Previous slide">&#8249;</button>
    <button class="gallery-btn gallery-btn-next" aria-label="Next slide">&#8250;</button>
    <div class="gallery-dots">
      ${mediaList.map((_, i) => `<span class="gallery-dot${i === 0 ? " active" : ""}"></span>`).join("")}
    </div>
    <span class="gallery-count">${total} images</span>` : "";

  const tagsHtml  = project.tags.map((t) => `<span class="card-tag">${t}</span>`).join("");
  const yearLabel = Number.isFinite(project.year) ? project.year : "n/a";
  const awardHtml  = project.award
    ? `<span class="award-badge"><span class="award-badge-icon" aria-hidden="true">🏆</span>${project.award}</span>`
    : "";
  const statusHtml = project.status
    ? `<span class="card-status card-status-${project.status}">${formatStatusLabel(project.status)}</span>`
    : "";
  const linksHtml = project.links.map((l) =>
    `<a class="card-link" href="${l.href}" target="_blank" rel="noopener">${l.label}</a>`
  ).join("");

  const card = document.createElement("article");
  card.className = "project-card reveal";
  card.dataset.tags = project.tags.join(",").toLowerCase();
  card.innerHTML = `
    <div class="card-gallery">
      <div class="gallery-track">${slidesHtml}</div>
      ${navHtml}
    </div>
    <div class="card-body">
      <div class="card-meta-row">
        <span class="card-year">${yearLabel}</span>
        <div class="card-meta-badges">${statusHtml}${awardHtml}</div>
      </div>
      <h3 class="card-title">${project.title}</h3>
      <p class="card-desc">${project.description}</p>
      <div class="card-footer">
        <div class="card-tags">${tagsHtml}</div>
        <div class="card-links">${linksHtml}</div>
      </div>
    </div>
  `;

  initCardGallery(card, galleryId, total);
  return card;
}

function initCardGallery(card, galleryId, total) {
  if (total <= 1) return;

  const track  = card.querySelector(".gallery-track");
  const slides = card.querySelectorAll(".gallery-slide");
  const dots   = card.querySelectorAll(".gallery-dot");
  const prev   = card.querySelector(".gallery-btn-prev");
  const next   = card.querySelector(".gallery-btn-next");
  let current  = 0;

  function goTo(idx) {
    slides[current].classList.remove("active");
    dots[current].classList.remove("active");
    current = (idx + total) % total;
    slides[current].classList.add("active");
    dots[current].classList.add("active");
    track.style.transform = `translateX(-${current * 100}%)`;
    // Manage video play/pause
    slides.forEach((slide, i) => {
      const vid = slide.querySelector("video");
      if (!vid) return;
      if (i === current) vid.play().catch(() => {});
      else { vid.pause(); vid.currentTime = 0; }
    });
  }

  prev.addEventListener("click",  (e) => { e.stopPropagation(); goTo(current - 1); });
  next.addEventListener("click",  (e) => { e.stopPropagation(); goTo(current + 1); });
  dots.forEach((dot, i) => dot.addEventListener("click", (e) => { e.stopPropagation(); goTo(i); }));
}

function buildPublicationItem(pub) {
  const linksHtml = pub.links
    .map((l) => {
      const isExternal = /^(https?:)?\/\//i.test(l.href) || l.href.startsWith("mailto:");
      const openInNewTab = Boolean(l.newTab) || isExternal;
      const targetAttrs = openInNewTab ? ' target="_blank" rel="noopener"' : "";
      return `<a class="pub-link" href="${l.href}"${targetAttrs}>${l.label}</a>`;
    })
    .join("");

  const item = document.createElement("div");
  item.className = "pub-item reveal";
  item.innerHTML = `
    <img
      class="pub-thumb"
      src="${pub.thumb}"
      alt="${pub.title} thumbnail"
      loading="lazy"
      data-lightbox-type="image"
      data-lightbox-src="${pub.thumb}"
      role="button"
      tabindex="0"
      aria-label="Expand thumbnail"
    />
    <div class="pub-body">
      <div class="pub-badges">
        <span class="pub-venue-badge">${pub.venue}</span>
        ${pub.award ? `<span class="award-badge"><span class="award-badge-icon" aria-hidden="true">🏆</span>${pub.award}</span>` : ""}
      </div>
      <h3 class="pub-title">${pub.title}</h3>
      <p class="pub-authors">${pub.authors}</p>
      <div class="pub-links">
        ${linksHtml}
        <button class="pub-abstract-toggle" aria-expanded="false">Abstract ▾</button>
      </div>
      <p class="pub-abstract">${pub.abstract}</p>
    </div>
  `;

  // Abstract toggle
  const btn = item.querySelector(".pub-abstract-toggle");
  const abstract = item.querySelector(".pub-abstract");
  btn.addEventListener("click", () => {
    const open = abstract.classList.toggle("open");
    btn.setAttribute("aria-expanded", open);
    btn.textContent = open ? "Abstract ▴" : "Abstract ▾";
  });

  return item;
}

/* =============================================================
   FILTERS
   ============================================================= */
function buildFilters() {
  const allTags = new Set();
  PROJECTS.forEach((p) => p.tags.forEach((t) => allTags.add(t)));

  const bar = document.getElementById("projectFilters");
  const yearSelect = document.getElementById("projectYearFilter");
  const sortSelect = document.getElementById("projectSortOrder");

  allTags.forEach((tag) => {
    const btn = document.createElement("button");
    btn.className = "filter-btn";
    btn.dataset.filter = tag.toLowerCase();
    btn.textContent = tag;
    bar.appendChild(btn);
  });

  // Build distinct year options (latest first in dropdown)
  const years = [...new Set(PROJECTS.map((p) => p.year).filter(Number.isFinite))].sort((a, b) => b - a);
  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.appendChild(option);
  });

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    bar.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    projectViewState.tag = btn.dataset.filter;
    projectViewState.visibleCount = PROJECT_PREVIEW_COUNT;
    renderProjects({ animate: true });
  });

  yearSelect.addEventListener("change", () => {
    projectViewState.year = yearSelect.value;
    projectViewState.visibleCount = PROJECT_PREVIEW_COUNT;
    renderProjects();
  });

  sortSelect.addEventListener("change", () => {
    projectViewState.sort = sortSelect.value;
    projectViewState.visibleCount = PROJECT_PREVIEW_COUNT;
    renderProjects();
  });
}

function updateProjectShowMoreButton(totalVisibleProjects) {
  const grid = document.getElementById("projectGrid");
  let wrap = document.getElementById("projectShowMoreWrap");

  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "projectShowMoreWrap";
    wrap.className = "project-show-more-wrap";
    grid.insertAdjacentElement("afterend", wrap);
  }

  wrap.innerHTML = "";

  const shouldShowButton = totalVisibleProjects > PROJECT_PREVIEW_COUNT;
  if (!shouldShowButton) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-secondary";
  const atEnd = projectViewState.visibleCount >= totalVisibleProjects;
  if (atEnd) {
    btn.textContent = "Show less";
  } else {
    const remaining = Math.max(0, totalVisibleProjects - projectViewState.visibleCount);
    const stepAmount = Math.min(PROJECT_SHOW_MORE_STEP, remaining);
    btn.textContent = `Show ${stepAmount} more (${remaining} left)`;
  }
  btn.addEventListener("click", () => {
    if (atEnd) {
      projectViewState.visibleCount = Math.max(
        PROJECT_PREVIEW_COUNT,
        projectViewState.visibleCount - PROJECT_SHOW_MORE_STEP
      );
    } else {
      projectViewState.visibleCount = Math.min(
        totalVisibleProjects,
        projectViewState.visibleCount + PROJECT_SHOW_MORE_STEP
      );
    }
    renderProjects();
  });

  wrap.appendChild(btn);

  if (!atEnd) {
    const showAllBtn = document.createElement("button");
    showAllBtn.type = "button";
    showAllBtn.className = "btn btn-secondary";
    showAllBtn.textContent = "Show all";
    showAllBtn.addEventListener("click", () => {
      projectViewState.visibleCount = totalVisibleProjects;
      renderProjects({ animate: true });
    });
    wrap.appendChild(showAllBtn);
  }
}

function getVisibleProjects() {
  const filtered = PROJECTS.filter((project) => {
    const tagMatch = projectViewState.tag === "all"
      || project.tags.some((tag) => tag.toLowerCase() === projectViewState.tag);
    const yearMatch = projectViewState.year === "all"
      || String(project.year) === projectViewState.year;
    return tagMatch && yearMatch;
  });

  return filtered.sort((a, b) => {
    const aYear = Number.isFinite(a.year) ? a.year : -Infinity;
    const bYear = Number.isFinite(b.year) ? b.year : -Infinity;
    if (aYear === bYear) return a.title.localeCompare(b.title);
    return projectViewState.sort === "asc" ? aYear - bYear : bYear - aYear;
  });
}

function renderProjects(options = {}) {
  const { animate = false } = options;
  const grid = document.getElementById("projectGrid");
  if (!grid) return;

  if (animate) {
    animateContainerUpdate(grid, () => renderProjects());
    return;
  }

  window._GALLERIES = {};
  _galleryCounter = 0;
  grid.innerHTML = "";

  const visibleProjects = getVisibleProjects();
  if (!visibleProjects.length) {
    const empty = document.createElement("p");
    empty.className = "projects-empty";
    empty.textContent = "No projects match the selected filters.";
    grid.appendChild(empty);
    updateProjectShowMoreButton(0);
    return;
  }

  const limitedCount = Math.min(projectViewState.visibleCount, visibleProjects.length);
  const projectsToRender = visibleProjects.slice(0, limitedCount);

  projectsToRender.forEach((project) => {
    grid.appendChild(buildProjectCard(project));
  });

  updateProjectShowMoreButton(visibleProjects.length);

  applySmartImageFit();

  // Re-bind reveal animation for newly rendered cards (after sort/filter changes).
  initReveal();
}

function getVisiblePublications() {
  return [...PUBLICATIONS].sort((a, b) => {
    const aYear = Number.isFinite(a.year) ? a.year : -Infinity;
    const bYear = Number.isFinite(b.year) ? b.year : -Infinity;
    if (aYear === bYear) return a.title.localeCompare(b.title);
    return publicationViewState.sort === "asc" ? aYear - bYear : bYear - aYear;
  });
}

function renderPublications(options = {}) {
  const { animate = false } = options;
  const pubList = document.getElementById("pubList");
  if (!pubList) return;

  if (animate) {
    animateContainerUpdate(pubList, () => renderPublications());
    return;
  }

  pubList.innerHTML = "";

  const visiblePublications = getVisiblePublications();
  const limitedCount = Math.min(publicationViewState.visibleCount, visiblePublications.length);
  const publicationsToRender = visiblePublications.slice(0, limitedCount);

  publicationsToRender.forEach((publication) => {
    pubList.appendChild(buildPublicationItem(publication));
  });

  updatePublicationShowMoreButton(visiblePublications.length);

  applySmartImageFit();

  initReveal();
}

function updatePublicationShowMoreButton(totalVisiblePublications) {
  const list = document.getElementById("pubList");
  if (!list) return;

  let wrap = document.getElementById("publicationShowMoreWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "publicationShowMoreWrap";
    wrap.className = "publication-show-more-wrap";
    list.insertAdjacentElement("afterend", wrap);
  }

  wrap.innerHTML = "";

  const shouldShowButton = totalVisiblePublications > PUBLICATION_PREVIEW_COUNT;
  if (!shouldShowButton) return;

  const atEnd = publicationViewState.visibleCount >= totalVisiblePublications;

  const stagedBtn = document.createElement("button");
  stagedBtn.type = "button";
  stagedBtn.className = "btn btn-secondary";
  if (atEnd) {
    stagedBtn.textContent = "Show less";
  } else {
    const remaining = Math.max(0, totalVisiblePublications - publicationViewState.visibleCount);
    const stepAmount = Math.min(PUBLICATION_SHOW_MORE_STEP, remaining);
    stagedBtn.textContent = `Show ${stepAmount} more (${remaining} left)`;
  }

  stagedBtn.addEventListener("click", () => {
    if (atEnd) {
      publicationViewState.visibleCount = Math.max(
        PUBLICATION_PREVIEW_COUNT,
        publicationViewState.visibleCount - PUBLICATION_SHOW_MORE_STEP
      );
    } else {
      publicationViewState.visibleCount = Math.min(
        totalVisiblePublications,
        publicationViewState.visibleCount + PUBLICATION_SHOW_MORE_STEP
      );
    }
    renderPublications({ animate: true });
  });

  wrap.appendChild(stagedBtn);

  if (!atEnd) {
    const showAllBtn = document.createElement("button");
    showAllBtn.type = "button";
    showAllBtn.className = "btn btn-secondary";
    showAllBtn.textContent = "Show all";
    showAllBtn.addEventListener("click", () => {
      publicationViewState.visibleCount = totalVisiblePublications;
      renderPublications({ animate: true });
    });
    wrap.appendChild(showAllBtn);
  }
}

function applySmartImageFit() {
  const thresholdRatio = 2.35;
  const images = document.querySelectorAll(".gallery-slide img, .pub-thumb");

  images.forEach((img) => {
    const updateFitClass = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const ratio = img.naturalWidth / img.naturalHeight;
      img.classList.toggle("media-wide", ratio >= thresholdRatio);
    };

    if (img.complete) {
      updateFitClass();
    } else {
      img.addEventListener("load", updateFitClass, { once: true });
    }
  });
}

function initPublicationControls() {
  const sortSelect = document.getElementById("publicationSortOrder");
  sortSelect.addEventListener("change", () => {
    publicationViewState.sort = sortSelect.value;
    publicationViewState.visibleCount = PUBLICATION_PREVIEW_COUNT;
    renderPublications();
  });
}

/* =============================================================
   LIGHTBOX  (with gallery prev/next navigation)
   ============================================================= */
function initLightbox() {
  const lightbox = document.getElementById("lightbox");
  const content  = document.getElementById("lightboxContent");
  const closeBtn = document.getElementById("lightboxClose");
  const prevBtn  = document.getElementById("lightboxPrev");
  const nextBtn  = document.getElementById("lightboxNext");
  const counter  = document.getElementById("lightboxCounter");

  let currentList = null;
  let currentIdx  = 0;

  function renderItem(item) {
    content.innerHTML = "";
    if (item.type === "image") {
      const img = document.createElement("img");
      img.src = item.src;
      img.alt = "Full size preview";
      content.appendChild(img);
    } else if (item.type === "video") {
      const vid = document.createElement("video");
      vid.src = item.src;
      vid.controls = true;
      vid.autoplay = true;
      content.appendChild(vid);
    } else if (item.type === "iframe") {
      const frame = document.createElement("iframe");
      frame.src = item.src + "?autoplay=1";
      frame.allow = "autoplay; fullscreen";
      frame.style.cssText = "width:min(860px,90vw);height:min(480px,50vh);border:none;border-radius:12px";
      content.appendChild(frame);
    }
  }

  function updateNav() {
    const multi = currentList && currentList.length > 1;
    prevBtn.style.display = multi ? "" : "none";
    nextBtn.style.display = multi ? "" : "none";
    counter.style.display = multi ? "" : "none";
    if (multi) counter.textContent = `${currentIdx + 1} / ${currentList.length}`;
  }

  function openGallery(list, idx) {
    currentList = list;
    currentIdx  = idx;
    renderItem(currentList[currentIdx]);
    updateNav();
    lightbox.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function navigate(dir) {
    if (!currentList || currentList.length < 2) return;
    currentIdx = (currentIdx + dir + currentList.length) % currentList.length;
    renderItem(currentList[currentIdx]);
    counter.textContent = `${currentIdx + 1} / ${currentList.length}`;
  }

  function close() {
    lightbox.classList.remove("open");
    content.innerHTML = "";
    document.body.style.overflow = "";
    currentList = null;
  }

  closeBtn.addEventListener("click", close);
  prevBtn.addEventListener("click",  () => navigate(-1));
  nextBtn.addEventListener("click",  () => navigate(1));
  lightbox.addEventListener("click", (e) => { if (e.target === lightbox) close(); });

  document.addEventListener("keydown", (e) => {
    if (!lightbox.classList.contains("open")) return;
    if (e.key === "Escape")     close();
    if (e.key === "ArrowLeft")  navigate(-1);
    if (e.key === "ArrowRight") navigate(1);
  });

  // Click on a gallery slide
  document.addEventListener("click", (e) => {
    const slide = e.target.closest("[data-gallery-id]");
    if (slide) {
      const list = window._GALLERIES[slide.dataset.galleryId];
      const idx  = parseInt(slide.dataset.galleryIdx, 10);
      if (list) { openGallery(list, idx); return; }
    }
    // Single-item trigger (publication thumbnails etc.)
    const trigger = e.target.closest("[data-lightbox-type]");
    if (trigger) {
      openGallery([{ type: trigger.dataset.lightboxType, src: trigger.dataset.lightboxSrc }], 0);
    }
  });

  // Keyboard activation for slides / single triggers
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const slide = e.target.closest("[data-gallery-id]");
    if (slide) {
      const list = window._GALLERIES[slide.dataset.galleryId];
      const idx  = parseInt(slide.dataset.galleryIdx, 10);
      if (list) { openGallery(list, idx); return; }
    }
    const trigger = e.target.closest("[data-lightbox-type]");
    if (trigger) {
      openGallery([{ type: trigger.dataset.lightboxType, src: trigger.dataset.lightboxSrc }], 0);
    }
  });
}

/* =============================================================
   SCROLL REVEAL
   ============================================================= */
function initReveal() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
}

/* =============================================================
   ACTIVE NAV LINK (scroll-spy)
   ============================================================= */
function initScrollSpy() {
  const sections = document.querySelectorAll("main section[id]");
  const header   = document.getElementById("site-header");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          document.querySelectorAll(".nav-links a").forEach((a) => {
            a.classList.toggle("active", a.getAttribute("href") === `#${entry.target.id}`);
          });
        }
      });
    },
    { rootMargin: `-${getComputedStyle(document.documentElement).getPropertyValue("--nav-height")} 0px -60% 0px` }
  );

  sections.forEach((s) => observer.observe(s));

  window.addEventListener("scroll", () => {
    header.classList.toggle("scrolled", window.scrollY > 10);
  });
}

/* =============================================================
   MOBILE NAV
   ============================================================= */
function initMobileNav() {
  const burger = document.getElementById("navBurger");
  const links  = document.querySelector(".nav-links");

  burger.addEventListener("click", () => {
    links.classList.toggle("open");
  });

  // Close on link click
  links.addEventListener("click", (e) => {
    if (e.target.tagName === "A") links.classList.remove("open");
  });
}

/* =============================================================
   HELPERS
   ============================================================= */
function playIcon() {
  return `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.4)"/><polygon points="10,8 17,12 10,16" fill="white"/></svg>`;
}
function expandIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
}
function extractYoutubeId(url) {
  const m = url.match(/(?:v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : "";
}

function formatStatusLabel(status) {
  const labels = {
    publication: "Publication",
    student: "Student project",
  };
  return labels[status] || status;
}

/* =============================================================
   INIT
   ============================================================= */
document.addEventListener("DOMContentLoaded", () => {
  async function initPage() {
    try {
      await loadPortfolioData();

      // Inject projects
      renderProjects();
      buildFilters();

      // Inject publications
      renderPublications();
      initPublicationControls();

      // Inject news
      renderNews();
    } catch (error) {
      console.error("Failed to initialize portfolio data.", error);
      showDataLoadError();
    }

    // Features
    initLightbox();
    initReveal();
    initScrollSpy();
    initMobileNav();

    // Footer year
    document.getElementById("footerYear").textContent = new Date().getFullYear();
  }

  initPage();
});
