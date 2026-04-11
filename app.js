const PROXY = "https://corsproxy.io/?";
const XKCD  = "https://xkcd.com";

const STORAGE_KEY = "xkcd_read";
const FAV_KEY     = "xkcd_fav";

let latestNum  = 0;
let currentNum = 1;
let activeTab  = "read";
let isLoading  = false;

// --- Storage ---
function getRead() {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY)) || []); }
  catch { return new Set(); }
}
function saveRead(set) { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])); }

function getFavs() {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY)) || []); }
  catch { return new Set(); }
}
function saveFavs(set) { localStorage.setItem(FAV_KEY, JSON.stringify([...set])); }

// --- Cache & Fetch ---
const comicCache = new Map(); // num -> comic data object

async function fetchComic(num) {
  const endpoint = num ? `${XKCD}/${num}/info.0.json` : `${XKCD}/info.0.json`;
  const res = await fetch(`${PROXY}${encodeURIComponent(endpoint)}`);
  if (!res.ok) throw new Error("Not found");
  return res.json();
}

// Get from cache or fetch, caching the result
function getComic(num) {
  if (num === null) return fetchComic(null); // latest — don't cache by null
  if (!comicCache.has(num)) {
    comicCache.set(num, fetchComic(num).catch(err => {
      comicCache.delete(num); // remove failed entries so they can be retried
      throw err;
    }));
  }
  return comicCache.get(num);
}

// Silently prefetch neighbours without blocking anything
function prefetch(centerNum) {
  if (!centerNum || !latestNum) return;
  const targets = [centerNum - 2, centerNum - 1, centerNum + 1, centerNum + 2];
  for (const n of targets) {
    if (n >= 1 && n <= latestNum && n !== 404 && !comicCache.has(n)) {
      comicCache.set(n, fetchComic(n).catch(() => { comicCache.delete(n); }));
    }
  }
}

// --- Status ---
function setStatus(msg, duration = 2500) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  if (duration) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, duration);
}

// --- Progress & stats ---
function updateProgress() {
  const read = getRead();
  const favs = getFavs();
  const count = read.size;
  const pct   = latestNum ? Math.min(100, (count / latestNum) * 100) : 0;

  document.getElementById("progress-bar").style.width = pct.toFixed(1) + "%";
  document.getElementById("progress-text").textContent =
    `${count} of ${latestNum} read (${pct.toFixed(1)}%)`;
  document.getElementById("stat-read").textContent    = `📖 ${count} read`;
  document.getElementById("stat-fav").textContent     = `⭐ ${favs.size} favorites`;
  document.getElementById("stat-unread").textContent  = `💤 ${Math.max(0, latestNum - count)} unread`;
}

// --- Chip lists ---
function renderList(tab) {
  if (tab === "read") {
    const read = getRead();
    const grid  = document.getElementById("read-list-grid");
    const empty = document.getElementById("read-list-empty");
    grid.innerHTML = "";
    if (read.size === 0) { empty.classList.remove("hidden"); return; }
    empty.classList.add("hidden");
    [...read].sort((a, b) => a - b).forEach(num => {
      const chip = document.createElement("button");
      chip.className = "read-chip";
      chip.textContent = `#${num}`;
      chip.addEventListener("click", () => loadComic(num));
      grid.appendChild(chip);
    });
  } else {
    const favs  = getFavs();
    const grid  = document.getElementById("fav-list-grid");
    const empty = document.getElementById("fav-list-empty");
    grid.innerHTML = "";
    if (favs.size === 0) { empty.classList.remove("hidden"); return; }
    empty.classList.add("hidden");
    [...favs].sort((a, b) => a - b).forEach(num => {
      const chip = document.createElement("button");
      chip.className = "fav-chip";
      chip.textContent = `⭐ #${num}`;
      chip.addEventListener("click", () => loadComic(num));
      grid.appendChild(chip);
    });
  }
}

// --- Apply comic data to UI ---
function applyComic(data) {
  currentNum = data.num;
  // Always keep latestNum up to date — matters when Latest is clicked after a failed init
  if (data.num > latestNum) latestNum = data.num;

  document.getElementById("comic-num").textContent = `#${data.num}`;
  document.getElementById("comic-date").textContent =
    `${data.year}-${String(data.month).padStart(2,"0")}-${String(data.day).padStart(2,"0")}`;
  document.getElementById("comic-title").textContent = data.title;
  const imgEl = document.getElementById("comic-img");
  const skeleton = document.getElementById("img-skeleton");
  imgEl.classList.add("loading");
  skeleton.classList.add("active");
  imgEl.onload = () => { imgEl.classList.remove("loading"); skeleton.classList.remove("active"); };
  imgEl.onerror = () => { skeleton.classList.remove("active"); imgEl.classList.remove("loading"); };
  imgEl.src = data.img;
  document.getElementById("comic-img").alt = data.alt;
  document.getElementById("comic-alt").textContent = data.alt;
  document.getElementById("comic-input").value = data.num;

  // External links
  document.getElementById("link-xkcd").href    = `https://xkcd.com/${data.num}/`;
  document.getElementById("link-explain").href = `https://www.explainxkcd.com/wiki/index.php/${data.num}`;

  // Lightbox image
  document.getElementById("lightbox-img").src = data.img;

  // Read button
  const read    = getRead();
  const btnRead = document.getElementById("btn-read");
  if (read.has(data.num)) { btnRead.textContent = "Read ✓"; btnRead.classList.add("read"); }
  else { btnRead.textContent = "Mark as Read"; btnRead.classList.remove("read"); }

  // Fav button
  const favs   = getFavs();
  const btnFav = document.getElementById("btn-fav");
  if (favs.has(data.num)) { btnFav.textContent = "⭐ Favorited"; btnFav.classList.add("fav"); }
  else { btnFav.textContent = "⭐ Favorite"; btnFav.classList.remove("fav"); }

  // Reset copy button
  const copyBtn = document.getElementById("btn-copy-alt");
  copyBtn.textContent = "Copy";
  copyBtn.classList.remove("copied");

  updateProgress();
  renderList(activeTab);

  // Cache the current comic data and prefetch neighbours
  comicCache.set(data.num, Promise.resolve(data));
  prefetch(data.num);
}

function setLoadingState() {
  document.getElementById("comic-title").textContent = "Loading...";
  document.getElementById("comic-alt").textContent   = "";
  document.getElementById("comic-img").src           = "";
  document.getElementById("comic-num").textContent   = "";
  document.getElementById("comic-date").textContent  = "";
  document.getElementById("img-skeleton").classList.add("active");
}

async function loadComic(num) {
  if (isLoading) return;
  isLoading = true;

  const card   = document.getElementById("comic-card");
  const cached = num !== null && comicCache.has(num);

  // Fade out card before switching
  card.classList.add("fading");

  // For non-cached comics, also show the loading skeleton
  const skeletonTimer = cached ? null : setTimeout(setLoadingState, 80);

  try {
    const data = await (num === null ? fetchComic(null) : getComic(num));
    clearTimeout(skeletonTimer);
    applyComic(data);
    // Small delay lets the CSS transition reset, then fade back in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => card.classList.remove("fading"));
    });
  } catch {
    clearTimeout(skeletonTimer);
    card.classList.remove("fading");
    setStatus("Could not load comic.", 3000);
    document.getElementById("comic-title").textContent = "Error loading comic.";
    document.getElementById("img-skeleton").classList.remove("active");
  } finally {
    isLoading = false;
  }
}

// --- Controls ---
document.getElementById("btn-first").addEventListener("click",  () => loadComic(1));
document.getElementById("btn-prev").addEventListener("click",   () => { if (currentNum > 1) loadComic(currentNum - 1); });
document.getElementById("btn-next").addEventListener("click",   () => { if (currentNum < latestNum) loadComic(currentNum + 1); });
document.getElementById("btn-latest").addEventListener("click", () => loadComic(null));

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
  const read   = getRead();
  const unread = [];
  for (let i = 1; i <= latestNum; i++) { if (i !== 404 && !read.has(i)) unread.push(i); }
  if (!unread.length) { setStatus("You've read everything! 🎉"); return; }
  loadComic(unread[Math.floor(Math.random() * unread.length)]);
});

document.getElementById("btn-random-fav").addEventListener("click", () => {
  const favs = [...getFavs()];
  if (!favs.length) { setStatus("No favorites yet — star some comics!"); return; }
  loadComic(favs[Math.floor(Math.random() * favs.length)]);
});

// --- Mark read ---
document.getElementById("btn-read").addEventListener("click", () => {
  const read    = getRead();
  const btnRead = document.getElementById("btn-read");
  if (read.has(currentNum)) {
    read.delete(currentNum);
    btnRead.textContent = "Mark as Read";
    btnRead.classList.remove("read");
  } else {
    read.add(currentNum);
    btnRead.textContent = "Read ✓";
    btnRead.classList.add("read");
  }
  saveRead(read);
  updateProgress();
  renderList("read");
});

// --- Favorite ---
document.getElementById("btn-fav").addEventListener("click", () => {
  const favs   = getFavs();
  const btnFav = document.getElementById("btn-fav");
  if (favs.has(currentNum)) {
    favs.delete(currentNum);
    btnFav.textContent = "⭐ Favorite";
    btnFav.classList.remove("fav");
  } else {
    favs.add(currentNum);
    btnFav.textContent = "⭐ Favorited";
    btnFav.classList.add("fav");
  }
  saveFavs(favs);
  updateProgress();
  renderList("favorites");
});

// --- Copy alt text ---
document.getElementById("btn-copy-alt").addEventListener("click", () => {
  const text = document.getElementById("comic-alt").textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("btn-copy-alt");
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 2000);
  });
});

// --- Tabs ---
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("read-list").classList.toggle("hidden", activeTab !== "read");
    document.getElementById("fav-list").classList.toggle("hidden",  activeTab !== "favorites");
    renderList(activeTab);
  });
});

// --- Lightbox ---
document.getElementById("comic-img-wrap").addEventListener("click", () => {
  document.getElementById("lightbox").classList.remove("hidden");
});
function closeLightbox() { document.getElementById("lightbox").classList.add("hidden"); }
document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
document.getElementById("lightbox").addEventListener("click", e => {
  if (e.target === e.currentTarget) closeLightbox();
});

// --- Shortcuts modal ---
document.getElementById("btn-shortcuts").addEventListener("click", () => {
  document.getElementById("shortcuts-modal").classList.remove("hidden");
});
document.getElementById("btn-close-modal").addEventListener("click", () => {
  document.getElementById("shortcuts-modal").classList.add("hidden");
});
document.getElementById("shortcuts-modal").addEventListener("click", e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});

// --- Keyboard shortcuts ---
document.addEventListener("keydown", e => {
  if (document.activeElement === document.getElementById("comic-input")) return;

  switch (e.key) {
    case "ArrowLeft":  e.preventDefault(); if (currentNum > 1) loadComic(currentNum - 1); break;
    case "ArrowRight": e.preventDefault(); if (currentNum < latestNum) loadComic(currentNum + 1); break;
    case "Home":       e.preventDefault(); loadComic(1); break;
    case "End":        e.preventDefault(); loadComic(null); break;
    case "r": case "R": document.getElementById("btn-random").click(); break;
    case "u": case "U": document.getElementById("btn-random-unread").click(); break;
    case "f": case "F": document.getElementById("btn-fav").click(); break;
    case "m": case "M": document.getElementById("btn-read").click(); break;
    case "z": case "Z": document.getElementById("comic-img-wrap").click(); break;
    case "Escape":
      closeLightbox();
      document.getElementById("shortcuts-modal").classList.add("hidden");
      break;
  }
});

// --- Export / Import ---
document.getElementById("btn-export").addEventListener("click", () => {
  const data = {
    version: 2,
    read: [...getRead()].sort((a, b) => a - b),
    favorites: [...getFavs()].sort((a, b) => a - b),
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = "xkcd-progress.json";
  a.click();
  setStatus("Progress exported!");
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
      saveRead(readSet);
      saveFavs(favSet);
      updateProgress();
      renderList(activeTab);
      setStatus(`Imported ${readSet.size} read, ${favSet.size} favorites!`);
    } catch {
      setStatus("Invalid backup file.", 3000);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

// --- Init ---
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
