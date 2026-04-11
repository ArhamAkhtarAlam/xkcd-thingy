// ===================== CONFIG =====================
const PROXY = "https://corsproxy.io/?";
const XKCD  = "https://xkcd.com";

const STORAGE_KEY = "xkcd_read";
const FAV_KEY     = "xkcd_fav";
const INDEX_KEY   = "xkcd_index";
const RATINGS_KEY = "xkcd_ratings";
const NOTES_KEY   = "xkcd_notes";
const HISTORY_KEY = "xkcd_history";
const SETTINGS_KEY= "xkcd_settings";

// ===================== STATE =====================
let latestNum      = 0;
let currentNum     = 1;
let activeTab      = "read";
let isLoading      = false;
let slideshowActive= false;
let slideshowTimer = null;
let autoMarkTimer  = null;
const comicCache   = new Map();

// ===================== STORAGE =====================
function getRead()    { try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY)) || []); } catch { return new Set(); } }
function saveRead(s)  { localStorage.setItem(STORAGE_KEY, JSON.stringify([...s])); }
function getFavs()    { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY)) || []); } catch { return new Set(); } }
function saveFavs(s)  { localStorage.setItem(FAV_KEY, JSON.stringify([...s])); }

function getIndex() {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(INDEX_KEY)) || {})); }
  catch { return new Map(); }
}
function saveIndex(map) {
  const obj = {};
  for (const [k, v] of map) obj[k] = v;
  localStorage.setItem(INDEX_KEY, JSON.stringify(obj));
}

function getRatings()   { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(RATINGS_KEY)) || {})); } catch { return new Map(); } }
function saveRatings(m) { const o = {}; for (const [k,v] of m) o[k]=v; localStorage.setItem(RATINGS_KEY, JSON.stringify(o)); }
function getNotes()     { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(NOTES_KEY)) || {})); } catch { return new Map(); } }
function saveNotes(m)   { const o = {}; for (const [k,v] of m) o[k]=v; localStorage.setItem(NOTES_KEY, JSON.stringify(o)); }
function getHistory()   { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; } }
function saveHistory(a) { localStorage.setItem(HISTORY_KEY, JSON.stringify(a)); }
function getSettings()  {
  try { return { autoMarkRead: false, slideshowDelay: 2, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) }; }
  catch { return { autoMarkRead: false, slideshowDelay: 2 }; }
}
function saveSettings(o) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(o)); }

// ===================== FETCH & CACHE =====================
async function fetchComic(num) {
  const endpoint = num ? `${XKCD}/${num}/info.0.json` : `${XKCD}/info.0.json`;
  const res = await fetch(`${PROXY}${encodeURIComponent(endpoint)}`);
  if (!res.ok) throw new Error("Not found");
  return res.json();
}

function getComic(num) {
  if (!comicCache.has(num)) {
    comicCache.set(num, fetchComic(num).catch(err => { comicCache.delete(num); throw err; }));
  }
  return comicCache.get(num);
}

function prefetch(center) {
  if (!center || !latestNum) return;
  for (const n of [center-2, center-1, center+1, center+2]) {
    if (n >= 1 && n <= latestNum && n !== 404 && !comicCache.has(n)) {
      comicCache.set(n, fetchComic(n).catch(() => comicCache.delete(n)));
    }
  }
}

// ===================== STATUS =====================
function setStatus(msg, duration = 2500) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  if (duration) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, duration);
}

// ===================== PROGRESS =====================
function updateProgress() {
  const read = getRead(), favs = getFavs();
  const count = read.size;
  const pct   = latestNum ? Math.min(100, (count / latestNum) * 100) : 0;
  document.getElementById("progress-bar").style.width = pct.toFixed(1) + "%";
  document.getElementById("progress-text").textContent = `${count} of ${latestNum} read (${pct.toFixed(1)}%)`;
  document.getElementById("stat-read").textContent    = `📖 ${count} read`;
  document.getElementById("stat-fav").textContent     = `⭐ ${favs.size} favorites`;
  document.getElementById("stat-unread").textContent  = `💤 ${Math.max(0, latestNum - count)} unread`;
}

// ===================== INDEX =====================
let indexingInProgress = false;

function storeInIndex(data) {
  const idx = getIndex();
  idx.set(String(data.num), { title: data.title, year: data.year, month: data.month, day: data.day });
  saveIndex(idx);
}

async function buildFullIndex() {
  if (indexingInProgress || !latestNum) return;
  indexingInProgress = true;
  const progressWrap = document.getElementById("index-progress");
  const progressText = document.getElementById("index-progress-text");
  progressWrap.classList.remove("hidden");

  const idx = getIndex();
  const missing = [];
  for (let i = 1; i <= latestNum; i++) {
    if (i !== 404 && !idx.has(String(i))) missing.push(i);
  }

  if (missing.length === 0) {
    progressWrap.classList.add("hidden");
    indexingInProgress = false;
    setStatus("Index already complete!");
    return;
  }

  let done = 0;
  const BATCH = 8;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(n =>
      fetchComic(n).then(d => { storeInIndex(d); done++; })
    ));
    progressText.textContent = `Indexing… ${done + (missing.length - done > 0 ? "" : "")} ${done}/${missing.length}`;
    await new Promise(r => setTimeout(r, 150));
  }

  progressWrap.classList.add("hidden");
  indexingInProgress = false;
  setStatus(`Index complete! ${getIndex().size} comics.`);
  renderList(activeTab);
}

// ===================== HISTORY / STREAKS =====================
// Always use local date strings (YYYY-MM-DD) to avoid UTC timezone mismatches
function localDateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function recordReadToday() {
  const today = localDateStr();
  const h = getHistory();
  if (!h.includes(today)) { h.push(today); saveHistory(h); }
}

function computeCurrentStreak() {
  const history = new Set(getHistory());
  let streak = 0;
  // Start from today; if today has no reads yet, start from yesterday
  // so the streak stays alive as long as yesterday was read
  const startOffset = history.has(localDateStr(0)) ? 0 : 1;
  for (let i = startOffset; i < 365; i++) {
    if (history.has(localDateStr(i))) streak++;
    else break;
  }
  return streak;
}

function computeLongestStreak() {
  const dates = [...new Set(getHistory())].sort();
  if (!dates.length) return 0;
  let longest = 1, cur = 1;
  for (let i = 1; i < dates.length; i++) {
    // Compare as local date strings — subtract by parsing them directly
    const [y1,m1,d1] = dates[i-1].split("-").map(Number);
    const [y2,m2,d2] = dates[i].split("-").map(Number);
    const diff = (new Date(y2,m2-1,d2) - new Date(y1,m1-1,d1)) / 86400000;
    if (diff === 1) { cur++; longest = Math.max(longest, cur); }
    else if (diff > 1) cur = 1;
    // diff === 0 means duplicate date, skip
  }
  return longest;
}

// ===================== RATING =====================
function setRating(num, stars) {
  const r = getRatings();
  if (r.get(String(num)) === stars) r.delete(String(num));
  else r.set(String(num), stars);
  saveRatings(r);
  renderRatingUI(num);
  if (activeTab === "read" || activeTab === "favorites") renderList(activeTab);
}

function renderRatingUI(num) {
  const current = getRatings().get(String(num)) || 0;
  document.querySelectorAll(".star-btn").forEach(btn => {
    btn.classList.toggle("filled", parseInt(btn.dataset.star) <= current);
  });
}

// ===================== UNREAD HELPERS =====================
function getFirstUnread() {
  const read = getRead();
  for (let i = 1; i <= latestNum; i++) { if (i !== 404 && !read.has(i)) return i; }
  return null;
}
function getLatestUnread() {
  const read = getRead();
  for (let i = latestNum; i >= 1; i--) { if (i !== 404 && !read.has(i)) return i; }
  return null;
}

// ===================== CHIP / LIST RENDERING =====================
function makeChip(num, type) {
  const r   = getRatings().get(String(num)) || 0;
  const idx = getIndex().get(String(num));
  const chip = document.createElement("button");
  chip.className = type === "fav" ? "fav-chip" : "read-chip";
  const stars = r ? " " + "★".repeat(r) : "";
  const title = idx ? ` ${idx.title}` : "";
  chip.innerHTML = `<span class="chip-num">${type === "fav" ? "⭐ " : ""}#${num}${stars}</span>${title ? `<span class="chip-title">${title}</span>` : ""}`;
  chip.addEventListener("click", () => loadComic(num));
  return chip;
}

function renderList(tab) {
  const sortBy = document.getElementById("list-sort")?.value || "num";

  if (tab === "read") {
    const read  = getRead();
    const grid  = document.getElementById("read-list-grid");
    const empty = document.getElementById("read-list-empty");
    grid.innerHTML = "";
    if (!read.size) { empty.classList.remove("hidden"); return; }
    empty.classList.add("hidden");
    let items = [...read];
    if (sortBy === "rating") {
      const r = getRatings();
      items.sort((a,b) => (r.get(String(b))||0)-(r.get(String(a))||0) || a-b);
    } else items.sort((a,b) => a-b);
    items.forEach(n => grid.appendChild(makeChip(n, "read")));

  } else if (tab === "favorites") {
    const favs  = getFavs();
    const grid  = document.getElementById("fav-list-grid");
    const empty = document.getElementById("fav-list-empty");
    grid.innerHTML = "";
    if (!favs.size) { empty.classList.remove("hidden"); return; }
    empty.classList.add("hidden");
    let items = [...favs];
    if (sortBy === "rating") {
      const r = getRatings();
      items.sort((a,b) => (r.get(String(b))||0)-(r.get(String(a))||0) || a-b);
    } else items.sort((a,b) => a-b);
    items.forEach(n => grid.appendChild(makeChip(n, "fav")));

  } else if (tab === "browse") {
    renderBrowseByYear();
  } else if (tab === "stats") {
    renderStats();
  }
}

// ===================== BROWSE BY YEAR =====================
function renderBrowseByYear() {
  const container = document.getElementById("browse-content");
  container.innerHTML = "";
  const idx = getIndex();

  if (!idx.size) {
    container.innerHTML = `<p class="list-empty">No index yet. <button class="inline-btn" onclick="buildFullIndex()">Build index</button> to browse by year.</p>`;
    return;
  }

  const read = getRead(), favs = getFavs(), ratings = getRatings();
  const byYear = {};
  for (const [numStr, info] of idx) {
    const y = info.year;
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push({ num: parseInt(numStr), ...info });
  }

  Object.entries(byYear).sort(([a],[b]) => b-a).forEach(([year, comics]) => {
    comics.sort((a,b) => a.num - b.num);
    const readCount = comics.filter(c => read.has(c.num)).length;
    const pct = Math.round(readCount / comics.length * 100);

    const section = document.createElement("div");
    section.className = "year-section";

    const header = document.createElement("button");
    header.className = "year-header";
    header.innerHTML = `
      <span class="year-name">${year}</span>
      <div class="year-bar-mini"><div class="year-bar-fill-mini" style="width:${pct}%"></div></div>
      <span class="year-meta">${readCount}/${comics.length}</span>
      <span class="year-chevron">▸</span>`;

    const grid = document.createElement("div");
    grid.className = "year-grid hidden";

    comics.forEach(comic => {
      const chip = document.createElement("button");
      const isRead = read.has(comic.num), isFav = favs.has(comic.num);
      const r = ratings.get(String(comic.num)) || 0;
      chip.className = "browse-chip" + (isRead ? " is-read" : "") + (isFav ? " is-fav" : "");
      chip.innerHTML = `<span class="browse-num">#${comic.num}</span><span class="browse-title">${comic.title}</span>${r ? `<span class="browse-stars">${"★".repeat(r)}</span>` : ""}`;
      chip.addEventListener("click", () => loadComic(comic.num));
      grid.appendChild(chip);
    });

    header.addEventListener("click", () => {
      const open = !grid.classList.contains("hidden");
      grid.classList.toggle("hidden", open);
      header.querySelector(".year-chevron").textContent = open ? "▸" : "▾";
    });

    section.append(header, grid);
    container.appendChild(section);
  });

  const note = document.createElement("p");
  note.className = "list-empty";
  note.style.marginTop = "0.75rem";
  const total = idx.size;
  note.innerHTML = `${total} of ${latestNum} comics indexed.${total < latestNum ? ` <button class="inline-btn" onclick="buildFullIndex()">Index all</button>` : " ✓"}`;
  container.appendChild(note);
}

// ===================== STATS =====================
function statCard(value, label, color) {
  return `<div class="stat-card" style="--card-color:${color}">
    <div class="stat-card-val">${value}</div>
    <div class="stat-card-lbl">${label}</div>
  </div>`;
}

function renderStats() {
  const container = document.getElementById("stats-content");
  container.innerHTML = "";

  const read = getRead(), favs = getFavs(), ratings = getRatings();
  const streak  = computeCurrentStreak();
  const longest = computeLongestStreak();
  const idx = getIndex();
  const pct = latestNum ? (read.size / latestNum * 100).toFixed(1) : "0.0";

  // --- stat cards ---
  const cardsHTML = `<div class="stats-grid">
    ${statCard(read.size,    "Comics Read",   "#4a9eff")}
    ${statCard(latestNum - read.size, "Unread", "#8b6fff")}
    ${statCard(pct + "%",   "Complete",      "#14b8a6")}
    ${statCard(favs.size,   "Favorites",     "#fbbf24")}
    ${statCard(streak + (streak === 1 ? " day" : " days"), "Streak 🔥", "#f97316")}
    ${statCard(longest + (longest === 1 ? " day" : " days"), "Best Streak", "#ec4899")}
  </div>`;

  // --- rating distribution ---
  const ratingDist = [0,0,0,0,0];
  for (const [,v] of ratings) ratingDist[v-1]++;
  const maxR = Math.max(...ratingDist, 1);
  const ratingHTML = ratings.size > 0 ? `
    <div class="stats-section">
      <div class="stats-section-title">⭐ Ratings  <span class="stats-section-sub">${ratings.size} rated</span></div>
      ${ratingDist.map((count, i) => `
        <div class="dist-row">
          <span class="dist-label gold">${i+1}★</span>
          <div class="dist-bar-wrap">
            <div class="dist-bar gold-bar" style="width:${count ? Math.max(3, count/maxR*100) : 0}%"></div>
          </div>
          <span class="dist-count">${count}</span>
        </div>`).join("")}
    </div>` : "";

  // --- by year ---
  const byYear = {};
  for (const [numStr, info] of idx) {
    const y = info.year;
    if (!byYear[y]) byYear[y] = { total: 0, read: 0 };
    byYear[y].total++;
    if (read.has(parseInt(numStr))) byYear[y].read++;
  }
  const maxYearRead = Math.max(...Object.values(byYear).map(d => d.read), 1);

  const yearHTML = Object.keys(byYear).length ? `
    <div class="stats-section">
      <div class="stats-section-title">📅 Read by Year  <span class="stats-section-sub">${idx.size} of ${latestNum} indexed ${idx.size < latestNum ? `— <button class="inline-btn" onclick="buildFullIndex()">index all</button>` : "✓"}</span></div>
      ${Object.entries(byYear).sort(([a],[b]) => a-b).map(([year, data]) => {
        const pctYear = data.total ? (data.read / data.total * 100).toFixed(0) : 0;
        return `<div class="dist-row">
          <span class="dist-label muted">${year}</span>
          <div class="dist-bar-wrap">
            <div class="dist-bar teal-bar" style="width:${data.read ? Math.max(3, data.read/maxYearRead*100) : 0}%"></div>
          </div>
          <span class="dist-count">${data.read}/${data.total} <span class="dist-pct">${pctYear}%</span></span>
        </div>`;
      }).join("")}
    </div>` : `
    <div class="stats-section">
      <div class="stats-section-title">📅 Read by Year</div>
      <p class="list-empty">Build the index first to see year-by-year stats.
        <button class="inline-btn" onclick="buildFullIndex()">Start indexing</button></p>
    </div>`;

  container.innerHTML = cardsHTML + ratingHTML + yearHTML;
}

// ===================== SEARCH =====================
function openSearch() {
  document.getElementById("search-modal").classList.remove("hidden");
  setTimeout(() => document.getElementById("search-input").focus(), 50);
  document.getElementById("search-input").value = "";
  document.getElementById("search-results").innerHTML = "";
}
function closeSearch() {
  document.getElementById("search-modal").classList.add("hidden");
}

function doSearch(query) {
  const results = document.getElementById("search-results");
  if (!query.trim()) { results.innerHTML = ""; return; }

  const idx = getIndex(), read = getRead();
  const q = query.toLowerCase();
  const matches = [];
  for (const [numStr, info] of idx) {
    if (info.title.toLowerCase().includes(q))
      matches.push({ num: parseInt(numStr), ...info });
  }
  matches.sort((a,b) => {
    const aS = a.title.toLowerCase().startsWith(q);
    const bS = b.title.toLowerCase().startsWith(q);
    if (aS !== bS) return aS ? -1 : 1;
    return b.num - a.num;
  });

  if (!matches.length) {
    results.innerHTML = `<p class="search-empty">No matches in ${idx.size} indexed comics.${idx.size < latestNum ? ` <button class="inline-btn" onclick="buildFullIndex()">Index all</button>` : ""}</p>`;
    return;
  }

  results.innerHTML = "";
  matches.slice(0, 50).forEach(m => {
    const i = m.title.toLowerCase().indexOf(q);
    const highlighted = m.title.slice(0,i) + `<mark>${m.title.slice(i,i+q.length)}</mark>` + m.title.slice(i+q.length);
    const item = document.createElement("button");
    item.className = "search-result" + (read.has(m.num) ? " is-read" : "");
    item.innerHTML = `<span class="sr-num">#${m.num}</span><span class="sr-title">${highlighted}</span><span class="sr-year">${m.year}</span>`;
    item.addEventListener("click", () => { closeSearch(); loadComic(m.num); });
    results.appendChild(item);
  });
  if (matches.length > 50) {
    const more = document.createElement("p");
    more.className = "search-empty";
    more.textContent = `…and ${matches.length - 50} more. Refine your search.`;
    results.appendChild(more);
  }
}

// ===================== SLIDESHOW =====================
async function runSlideshowStep() {
  if (!slideshowActive) return;

  const read   = getRead();
  const unread = [];
  for (let i = 1; i <= latestNum; i++) { if (i !== 404 && !read.has(i)) unread.push(i); }
  if (!unread.length) { stopSlideshow(); setStatus("You've read everything! 🎉", 4000); return; }

  const n = unread[Math.floor(Math.random() * unread.length)];
  await loadComic(n);

  // Auto-mark as read
  const r2 = getRead();
  r2.add(n);
  saveRead(r2);
  recordReadToday();
  updateProgress();
  renderList(activeTab);
  applyReadButtonState(n);
  document.getElementById("slideshow-counter").textContent = `${getRead().size} read`;

  if (slideshowActive) {
    const delay = (parseFloat(document.getElementById("slideshow-delay").value) || 2) * 1000;
    slideshowTimer = setTimeout(runSlideshowStep, delay);
  }
}

function startSlideshow() {
  slideshowActive = true;
  document.getElementById("slideshow-panel").classList.add("active");
  document.getElementById("btn-slideshow-toggle").textContent = "⏸ Pause";
  document.getElementById("btn-slideshow").textContent = "■ Stop Slideshow";
  runSlideshowStep();
}

function pauseSlideshow() {
  clearTimeout(slideshowTimer);
  slideshowActive = false;
  document.getElementById("btn-slideshow-toggle").textContent = "▶ Resume";
}

function stopSlideshow() {
  clearTimeout(slideshowTimer);
  slideshowActive = false;
  document.getElementById("slideshow-panel").classList.remove("active");
  document.getElementById("btn-slideshow").textContent = "▶ Slideshow";
  document.getElementById("btn-slideshow-toggle").textContent = "⏸ Pause";
}

// ===================== AUTO-MARK =====================
function startAutoMarkTimer() {
  clearTimeout(autoMarkTimer);
  if (!getSettings().autoMarkRead) return;
  autoMarkTimer = setTimeout(() => {
    const read = getRead();
    if (!read.has(currentNum)) {
      read.add(currentNum);
      saveRead(read);
      recordReadToday();
      updateProgress();
      renderList(activeTab);
      applyReadButtonState(currentNum);
      setStatus("Auto-marked as read ✓", 1500);
    }
  }, 3000);
}

// ===================== APPLY COMIC =====================
function applyReadButtonState(num) {
  const btnRead = document.getElementById("btn-read");
  const isRead  = getRead().has(num);
  btnRead.textContent = isRead ? "Read ✓" : "Mark as Read";
  btnRead.classList.toggle("read", isRead);
}

function setLoadingState() {
  document.getElementById("comic-title").textContent = "Loading…";
  document.getElementById("comic-alt").textContent   = "";
  document.getElementById("comic-img").src           = "";
  document.getElementById("comic-num").textContent   = "";
  document.getElementById("comic-date").textContent  = "";
  document.getElementById("img-skeleton").classList.add("active");
}

function applyComic(data) {
  currentNum = data.num;
  if (data.num > latestNum) latestNum = data.num;
  storeInIndex(data);

  document.getElementById("comic-num").textContent = `#${data.num}`;
  document.getElementById("comic-date").textContent =
    `${data.year}-${String(data.month).padStart(2,"0")}-${String(data.day).padStart(2,"0")}`;
  document.getElementById("comic-title").textContent = data.title;

  const imgEl   = document.getElementById("comic-img");
  const skeleton = document.getElementById("img-skeleton");
  imgEl.classList.add("loading");
  skeleton.classList.add("active");
  imgEl.onload  = () => { imgEl.classList.remove("loading"); skeleton.classList.remove("active"); };
  imgEl.onerror = () => { skeleton.classList.remove("active"); imgEl.classList.remove("loading"); };
  imgEl.src = data.img;
  imgEl.alt = data.alt;

  document.getElementById("comic-alt").textContent   = data.alt;
  document.getElementById("comic-input").value       = data.num;
  document.getElementById("link-xkcd").href          = `https://xkcd.com/${data.num}/`;
  document.getElementById("link-explain").href       = `https://www.explainxkcd.com/wiki/index.php/${data.num}`;
  document.getElementById("lightbox-img").src        = data.img;

  // Notes
  const notes = getNotes();
  const noteVal = notes.get(String(data.num)) || "";
  document.getElementById("comic-note").value = noteVal;
  const noteToggle = document.getElementById("note-toggle");
  const noteWrap   = document.getElementById("note-wrap");
  if (noteVal) {
    noteWrap.classList.remove("hidden");
    noteToggle.textContent = "📝 Note";
  } else {
    noteWrap.classList.add("hidden");
    noteToggle.textContent = "📝 Add note";
  }

  applyReadButtonState(data.num);

  const favs   = getFavs();
  const btnFav = document.getElementById("btn-fav");
  btnFav.textContent = favs.has(data.num) ? "⭐ Favorited" : "⭐ Favorite";
  btnFav.classList.toggle("fav", favs.has(data.num));

  const copyBtn = document.getElementById("btn-copy-alt");
  copyBtn.textContent = "Copy";
  copyBtn.classList.remove("copied");

  renderRatingUI(data.num);
  updateProgress();
  renderList(activeTab);

  comicCache.set(data.num, Promise.resolve(data));
  prefetch(data.num);
  startAutoMarkTimer();
}

// ===================== LOAD COMIC =====================
async function loadComic(num) {
  if (isLoading) return;
  isLoading = true;
  clearTimeout(autoMarkTimer);

  const card   = document.getElementById("comic-card");
  const cached = num !== null && comicCache.has(num);

  card.classList.add("fading");
  const skeletonTimer = cached ? null : setTimeout(setLoadingState, 80);

  try {
    const data = await (num === null ? fetchComic(null) : getComic(num));
    clearTimeout(skeletonTimer);
    applyComic(data);
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove("fading")));
  } catch {
    clearTimeout(skeletonTimer);
    card.classList.remove("fading");
    document.getElementById("img-skeleton").classList.remove("active");
    setStatus("Could not load comic.", 3000);
    document.getElementById("comic-title").textContent = "Error loading comic.";
  } finally {
    isLoading = false;
  }
}

// ===================== CONTROLS =====================
document.getElementById("btn-first").addEventListener("click",  () => loadComic(1));
document.getElementById("btn-prev").addEventListener("click",   () => { if (currentNum > 1) loadComic(currentNum - 1); });
document.getElementById("btn-next").addEventListener("click",   () => { if (currentNum < latestNum) loadComic(currentNum + 1); });
document.getElementById("btn-latest").addEventListener("click", () => loadComic(null));

document.getElementById("btn-first-unread").addEventListener("click", () => {
  const n = getFirstUnread();
  if (n) loadComic(n); else setStatus("No unread comics!");
});
document.getElementById("btn-latest-unread-nav").addEventListener("click", () => {
  const n = getLatestUnread();
  if (n) loadComic(n); else setStatus("No unread comics!");
});

document.getElementById("btn-go").addEventListener("click", () => {
  const v = parseInt(document.getElementById("comic-input").value);
  if (v >= 1 && v <= latestNum) loadComic(v);
});
document.getElementById("comic-input").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("btn-go").click();
});

document.getElementById("btn-random").addEventListener("click", () => {
  let n; do { n = Math.floor(Math.random() * latestNum) + 1; } while (n === 404);
  loadComic(n);
});
document.getElementById("btn-random-unread").addEventListener("click", () => {
  const read = getRead(), unread = [];
  for (let i = 1; i <= latestNum; i++) { if (i !== 404 && !read.has(i)) unread.push(i); }
  if (!unread.length) { setStatus("You've read everything! 🎉"); return; }
  loadComic(unread[Math.floor(Math.random() * unread.length)]);
});
document.getElementById("btn-random-fav").addEventListener("click", () => {
  const favs = [...getFavs()];
  if (!favs.length) { setStatus("No favorites yet!"); return; }
  loadComic(favs[Math.floor(Math.random() * favs.length)]);
});

// ===================== MARK READ =====================
document.getElementById("btn-read").addEventListener("click", () => {
  const read = getRead();
  if (read.has(currentNum)) read.delete(currentNum);
  else { read.add(currentNum); recordReadToday(); }
  saveRead(read);
  applyReadButtonState(currentNum);
  updateProgress();
  renderList("read");
});

// ===================== FAVORITE =====================
document.getElementById("btn-fav").addEventListener("click", () => {
  const favs   = getFavs();
  const btnFav = document.getElementById("btn-fav");
  if (favs.has(currentNum)) { favs.delete(currentNum); btnFav.textContent = "⭐ Favorite"; btnFav.classList.remove("fav"); }
  else { favs.add(currentNum); btnFav.textContent = "⭐ Favorited"; btnFav.classList.add("fav"); }
  saveFavs(favs);
  updateProgress();
  renderList("favorites");
});

// ===================== RATING =====================
document.querySelectorAll(".star-btn").forEach(btn => {
  btn.addEventListener("click", () => setRating(currentNum, parseInt(btn.dataset.star)));
  btn.addEventListener("mouseenter", () => {
    const val = parseInt(btn.dataset.star);
    document.querySelectorAll(".star-btn").forEach(b => b.classList.toggle("hover", parseInt(b.dataset.star) <= val));
  });
});
document.getElementById("star-rating").addEventListener("mouseleave", () => {
  document.querySelectorAll(".star-btn").forEach(b => b.classList.remove("hover"));
});

// ===================== NOTES =====================
document.getElementById("comic-note").addEventListener("input", e => {
  const notes = getNotes();
  const val = e.target.value;
  if (val.trim()) notes.set(String(currentNum), val);
  else notes.delete(String(currentNum));
  saveNotes(notes);
  document.getElementById("note-toggle").textContent = val.trim() ? "📝 Note" : "📝 Add note";
});
document.getElementById("note-toggle").addEventListener("click", () => {
  document.getElementById("note-wrap").classList.toggle("hidden");
});

// ===================== COPY ALT =====================
document.getElementById("btn-copy-alt").addEventListener("click", () => {
  const text = document.getElementById("comic-alt").textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("btn-copy-alt");
    btn.textContent = "Copied!"; btn.classList.add("copied");
    setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 2000);
  });
});

// ===================== TABS =====================
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("read-list").classList.toggle("hidden",    activeTab !== "read");
    document.getElementById("fav-list").classList.toggle("hidden",     activeTab !== "favorites");
    document.getElementById("browse-panel").classList.toggle("hidden", activeTab !== "browse");
    document.getElementById("stats-panel").classList.toggle("hidden",  activeTab !== "stats");
    document.getElementById("list-sort-row").classList.toggle("hidden", activeTab !== "read" && activeTab !== "favorites");
    renderList(activeTab);
  });
});

document.getElementById("list-sort").addEventListener("change", () => renderList(activeTab));

// ===================== LIGHTBOX =====================
document.getElementById("comic-img-wrap").addEventListener("click", () => {
  document.getElementById("lightbox").classList.remove("hidden");
});
function closeLightbox() { document.getElementById("lightbox").classList.add("hidden"); }
document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
document.getElementById("lightbox").addEventListener("click", e => { if (e.target === e.currentTarget) closeLightbox(); });

// ===================== SEARCH =====================
document.getElementById("btn-search").addEventListener("click", openSearch);
document.getElementById("search-input").addEventListener("input", e => doSearch(e.target.value));
document.getElementById("search-modal").addEventListener("click", e => { if (e.target === e.currentTarget) closeSearch(); });

// ===================== SLIDESHOW =====================
document.getElementById("btn-slideshow").addEventListener("click", () => {
  if (slideshowActive) stopSlideshow();
  else startSlideshow();
});
document.getElementById("btn-slideshow-toggle").addEventListener("click", () => {
  if (slideshowActive) pauseSlideshow();
  else { slideshowActive = true; document.getElementById("btn-slideshow-toggle").textContent = "⏸ Pause"; runSlideshowStep(); }
});
document.getElementById("btn-slideshow-stop").addEventListener("click", stopSlideshow);

// ===================== AUTO-MARK TOGGLE =====================
const autoMarkToggle = document.getElementById("auto-mark-toggle");
autoMarkToggle.checked = getSettings().autoMarkRead;
autoMarkToggle.addEventListener("change", () => {
  const s = getSettings();
  s.autoMarkRead = autoMarkToggle.checked;
  saveSettings(s);
  if (!s.autoMarkRead) clearTimeout(autoMarkTimer);
});

// ===================== BUILD INDEX =====================
document.getElementById("btn-build-index").addEventListener("click", buildFullIndex);

// ===================== SHORTCUTS MODAL =====================
document.getElementById("btn-shortcuts").addEventListener("click", () => {
  document.getElementById("shortcuts-modal").classList.remove("hidden");
});
document.getElementById("btn-close-modal").addEventListener("click", () => {
  document.getElementById("shortcuts-modal").classList.add("hidden");
});
document.getElementById("shortcuts-modal").addEventListener("click", e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});

// ===================== KEYBOARD SHORTCUTS =====================
document.addEventListener("keydown", e => {
  const active = document.activeElement;
  const inInput = active === document.getElementById("comic-input")
               || active === document.getElementById("search-input")
               || active === document.getElementById("comic-note");
  const searchOpen = !document.getElementById("search-modal").classList.contains("hidden");

  if (e.key === "Escape") {
    closeSearch(); closeLightbox();
    document.getElementById("shortcuts-modal").classList.add("hidden");
    stopSlideshow();
    return;
  }
  if (inInput || searchOpen) return;

  switch (e.key) {
    case "ArrowLeft":  e.preventDefault(); if (currentNum > 1) loadComic(currentNum-1); break;
    case "ArrowRight": e.preventDefault(); if (currentNum < latestNum) loadComic(currentNum+1); break;
    case "Home":       e.preventDefault(); loadComic(1); break;
    case "End":        e.preventDefault(); loadComic(null); break;
    case "r": case "R": document.getElementById("btn-random").click(); break;
    case "u": case "U": document.getElementById("btn-random-unread").click(); break;
    case "f": case "F": document.getElementById("btn-fav").click(); break;
    case "m": case "M": document.getElementById("btn-read").click(); break;
    case "z": case "Z": document.getElementById("comic-img-wrap").click(); break;
    case "s": case "S": e.preventDefault(); openSearch(); break;
    case "[": { const n = getFirstUnread();  if (n) loadComic(n); else setStatus("No unread comics!"); break; }
    case "]": { const n = getLatestUnread(); if (n) loadComic(n); else setStatus("No unread comics!"); break; }
    case "1": case "2": case "3": case "4": case "5":
      setRating(currentNum, parseInt(e.key)); break;
  }
});

// ===================== EXPORT / IMPORT =====================
document.getElementById("btn-export").addEventListener("click", () => {
  const data = {
    version: 3,
    read:      [...getRead()].sort((a,b)=>a-b),
    favorites: [...getFavs()].sort((a,b)=>a-b),
    ratings:   Object.fromEntries(getRatings()),
    notes:     Object.fromEntries(getNotes()),
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "xkcd-progress.json";
  a.click();
  setStatus("Exported!");
});

document.getElementById("btn-import").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data    = JSON.parse(ev.target.result);
      const readSet = new Set((data.read || []).filter(n => typeof n === "number" && n >= 1));
      const favSet  = new Set((data.favorites || []).filter(n => typeof n === "number" && n >= 1));
      saveRead(readSet); saveFavs(favSet);
      if (data.ratings) saveRatings(new Map(Object.entries(data.ratings)));
      if (data.notes)   saveNotes(new Map(Object.entries(data.notes)));
      updateProgress(); renderList(activeTab);
      setStatus(`Imported ${readSet.size} read, ${favSet.size} favorites!`);
    } catch { setStatus("Invalid backup file.", 3000); }
  };
  reader.readAsText(file);
  e.target.value = "";
});

// ===================== INIT =====================
(async () => {
  isLoading = true;
  setLoadingState();
  try {
    const data = await fetchComic(null);
    latestNum  = data.num;
    applyComic(data);
  } catch {
    setStatus("Could not load latest comic.", 0);
    document.getElementById("comic-title").textContent = "Failed to connect — check your connection.";
    document.getElementById("progress-text").textContent = "Offline?";
    document.getElementById("img-skeleton").classList.remove("active");
  } finally {
    isLoading = false;
  }
})();
