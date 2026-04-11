const STORAGE_KEY = "xkcd_read";
const API = "/.netlify/functions/comic";

let latestNum = 1;
let currentNum = 1;

// --- Storage helpers ---
function getRead() {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY)) || []); }
  catch { return new Set(); }
}

function saveRead(set) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

function markRead(num, set) {
  set.add(num);
  saveRead(set);
}

function unmarkRead(num, set) {
  set.delete(num);
  saveRead(set);
}

// --- UI helpers ---
function updateProgress() {
  const read = getRead();
  const count = read.size;
  const pct = latestNum ? Math.min(100, (count / latestNum) * 100) : 0;
  document.getElementById("progress-bar").style.width = pct.toFixed(1) + "%";
  document.getElementById("progress-text").textContent =
    `${count} of ${latestNum} read (${pct.toFixed(1)}%)`;
}

function setStatus(msg, duration = 2500) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  if (duration) setTimeout(() => { el.textContent = ""; }, duration);
}

function showLoading() {
  document.getElementById("comic-title").textContent = "Loading...";
  document.getElementById("comic-alt").textContent = "";
  document.getElementById("comic-num").textContent = "";
  document.getElementById("comic-date").textContent = "";
  document.getElementById("comic-img").src = "";
}

// --- Fetch & render ---
async function loadComic(num) {
  showLoading();
  const url = num ? `${API}?num=${num}` : API;
  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) { setStatus("Comic not found.", 3000); return; }
    data = await res.json();
  } catch {
    setStatus("Network error.", 3000);
    return;
  }

  currentNum = data.num;
  document.getElementById("comic-num").textContent = `#${data.num}`;
  document.getElementById("comic-date").textContent =
    `${data.year}-${String(data.month).padStart(2,"0")}-${String(data.day).padStart(2,"0")}`;
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

// --- Button wiring ---
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
document.getElementById("comic-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-go").click();
});
document.getElementById("btn-random").addEventListener("click", () => {
  const n = Math.floor(Math.random() * latestNum) + 1;
  loadComic(n);
});

document.getElementById("btn-read").addEventListener("click", () => {
  const read = getRead();
  const btn = document.getElementById("btn-read");
  if (read.has(currentNum)) {
    unmarkRead(currentNum, read);
    btn.textContent = "Mark as Read";
    btn.classList.remove("read");
  } else {
    markRead(currentNum, read);
    btn.textContent = "Read ✓";
    btn.classList.add("read");
  }
  updateProgress();
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

document.getElementById("btn-import").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      const nums = Array.isArray(data.read) ? data.read : [];
      const set = new Set(nums.filter(n => typeof n === "number"));
      saveRead(set);
      updateProgress();
      setStatus(`Imported ${set.size} comics!`);
    } catch {
      setStatus("Invalid backup file.", 3000);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

// --- Init ---
(async () => {
  const res = await fetch(API).catch(() => null);
  if (res && res.ok) {
    const data = await res.json();
    latestNum = data.num;
    currentNum = data.num;
    document.getElementById("comic-num").textContent = `#${data.num}`;
    document.getElementById("comic-date").textContent =
      `${data.year}-${String(data.month).padStart(2,"0")}-${String(data.day).padStart(2,"0")}`;
    document.getElementById("comic-title").textContent = data.title;
    document.getElementById("comic-img").src = data.img;
    document.getElementById("comic-img").alt = data.alt;
    document.getElementById("comic-alt").textContent = data.alt;
    document.getElementById("comic-input").value = data.num;

    const read = getRead();
    const btn = document.getElementById("btn-read");
    if (read.has(data.num)) { btn.textContent = "Read ✓"; btn.classList.add("read"); }
    updateProgress();
  } else {
    setStatus("Could not load latest comic.", 0);
  }
})();
