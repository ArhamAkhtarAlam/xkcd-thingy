// XKCD API via CORS proxy (needed for GitHub Pages / static hosting)
const PROXY = "https://corsproxy.io/?";
const XKCD = "https://xkcd.com";

const STORAGE_KEY = "xkcd_read";

let latestNum = 1;
let currentNum = 1;

// --- Storage ---
function getRead() {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY)) || []); }
  catch { return new Set(); }
}

function saveRead(set) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

// --- Fetch comic ---
async function fetchComic(num) {
  const url = num
    ? `${PROXY}${encodeURIComponent(`${XKCD}/${num}/info.0.json`)}`
    : `${PROXY}${encodeURIComponent(`${XKCD}/info.0.json`)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Not found");
  return res.json();
}

// --- UI ---
function setStatus(msg, duration = 2500) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  if (duration) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, duration);
}

function updateProgress() {
  const read = getRead();
  const count = read.size;
  const pct = latestNum ? Math.min(100, (count / latestNum) * 100) : 0;
  document.getElementById("progress-bar").style.width = pct.toFixed(1) + "%";
  document.getElementById("progress-text").textContent =
    `${count} of ${latestNum} read (${pct.toFixed(1)}%)`;
  updateToggleBtn(count);
}

function updateToggleBtn(count) {
  const open = !document.getElementById("read-list").classList.contains("hidden");
  document.getElementById("btn-toggle-list").textContent =
    `${open ? "Hide" : "Show"} Read Comics (${count})`;
}

function renderReadList() {
  const read = getRead();
  const grid = document.getElementById("read-list-grid");
  const empty = document.getElementById("read-list-empty");
  grid.innerHTML = "";
  if (read.size === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  [...read].sort((a, b) => a - b).forEach(num => {
    const chip = document.createElement("button");
    chip.className = "read-chip";
    chip.textContent = `#${num}`;
    chip.title = `Go to comic #${num}`;
    chip.addEventListener("click", () => loadComic(num));
    grid.appendChild(chip);
  });
}

function applyComicToUI(data) {
  currentNum = data.num;
  document.getElementById("comic-num").textContent = `#${data.num}`;
  document.getElementById("comic-date").textContent =
    `${data.year}-${String(data.month).padStart(2, "0")}-${String(data.day).padStart(2, "0")}`;
  document.getElementById("comic-title").textContent = data.title;
  document.getElementById("comic-img").src = data.img;
  document.getElementById("comic-img").alt = data.alt;
  document.getElementById("comic-alt").textContent = data.alt;
  document.getElementById("comic-input").value = data.num;

  const read = getRead();
  const btn = document.getElementById("btn-read");
  if (read.has(data.num)) {
    btn.textContent = "Read ✓";
    btn.classList.add("read");
  } else {
    btn.textContent = "Mark as Read";
    btn.classList.remove("read");
  }
  updateProgress();
}

async function loadComic(num) {
  document.getElementById("comic-title").textContent = "Loading...";
  document.getElementById("comic-alt").textContent = "";
  document.getElementById("comic-img").src = "";
  try {
    const data = await fetchComic(num);
    applyComicToUI(data);
  } catch {
    setStatus("Could not load comic.", 3000);
    document.getElementById("comic-title").textContent = "Error loading comic.";
  }
}

// --- Controls ---
document.getElementById("btn-first").addEventListener("click", () => loadComic(1));

document.getElementById("btn-prev").addEventListener("click", () => {
  if (currentNum > 1) loadComic(currentNum - 1);
});

document.getElementById("btn-next").addEventListener("click", () => {
  if (currentNum < latestNum) loadComic(currentNum + 1);
});

document.getElementById("btn-latest").addEventListener("click", () => loadComic(null));

document.getElementById("btn-go").addEventListener("click", () => {
  const v = parseInt(document.getElementById("comic-input").value);
  if (v >= 1 && v <= latestNum) loadComic(v);
});

document.getElementById("comic-input").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("btn-go").click();
});

document.getElementById("btn-random").addEventListener("click", () => {
  // XKCD #404 doesn't exist — skip it
  let n;
  do { n = Math.floor(Math.random() * latestNum) + 1; } while (n === 404);
  loadComic(n);
});

document.getElementById("btn-random-unread").addEventListener("click", () => {
  const read = getRead();
  const unread = [];
  for (let i = 1; i <= latestNum; i++) {
    if (i !== 404 && !read.has(i)) unread.push(i);
  }
  if (unread.length === 0) { setStatus("You've read everything!"); return; }
  loadComic(unread[Math.floor(Math.random() * unread.length)]);
});

// --- Mark read ---
document.getElementById("btn-read").addEventListener("click", () => {
  const read = getRead();
  const btn = document.getElementById("btn-read");
  if (read.has(currentNum)) {
    read.delete(currentNum);
    btn.textContent = "Mark as Read";
    btn.classList.remove("read");
  } else {
    read.add(currentNum);
    btn.textContent = "Read ✓";
    btn.classList.add("read");
  }
  saveRead(read);
  updateProgress();
  if (!document.getElementById("read-list").classList.contains("hidden")) renderReadList();
});

// --- Read list toggle ---
document.getElementById("btn-toggle-list").addEventListener("click", () => {
  const list = document.getElementById("read-list");
  list.classList.toggle("hidden");
  if (!list.classList.contains("hidden")) renderReadList();
  updateToggleBtn(getRead().size);
});

// --- Export / Import ---
document.getElementById("btn-export").addEventListener("click", () => {
  const read = getRead();
  const data = { version: 1, read: [...read].sort((a, b) => a - b), exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
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
      const data = JSON.parse(ev.target.result);
      const nums = Array.isArray(data.read) ? data.read : [];
      const set = new Set(nums.filter(n => typeof n === "number" && n >= 1));
      saveRead(set);
      updateProgress();
      if (!document.getElementById("read-list").classList.contains("hidden")) renderReadList();
      setStatus(`Imported ${set.size} comics!`);
    } catch {
      setStatus("Invalid backup file.", 3000);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
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
  // Don't fire when typing in the number input
  if (document.activeElement === document.getElementById("comic-input")) return;

  switch (e.key) {
    case "ArrowLeft":
      e.preventDefault();
      if (currentNum > 1) loadComic(currentNum - 1);
      break;
    case "ArrowRight":
      e.preventDefault();
      if (currentNum < latestNum) loadComic(currentNum + 1);
      break;
    case "Home":
      e.preventDefault();
      loadComic(1);
      break;
    case "End":
      e.preventDefault();
      loadComic(null);
      break;
    case "r":
    case "R":
      document.getElementById("btn-random").click();
      break;
    case "u":
    case "U":
      document.getElementById("btn-random-unread").click();
      break;
    case "m":
    case "M":
      document.getElementById("btn-read").click();
      break;
    case "Escape":
      document.getElementById("shortcuts-modal").classList.add("hidden");
      break;
  }
});

// --- Init ---
(async () => {
  try {
    const data = await fetchComic(null);
    latestNum = data.num;
    applyComicToUI(data);
  } catch {
    setStatus("Could not load latest comic.", 0);
    document.getElementById("comic-title").textContent = "Failed to connect.";
    document.getElementById("progress-text").textContent = "Offline?";
  }
})();
