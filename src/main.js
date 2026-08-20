import Dexie from "dexie";

// ---------- DATABASE ----------
export const db = new Dexie("NoteFoodDB");
db.version(1).stores({
  transactions: "++id, type, date, amount, category",
});

// ---------- STATE ----------
let currentView = "dashboard";
let filterState = { search: "", start: "", end: "" };

// ---------- UTIL ----------
const rupiah = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");

const todayStr = () => new Date().toISOString().slice(0, 10);

function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Senin sebagai awal minggu
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 1800);
}

// ---------- VIEW SWITCH ----------
function switchView(view) {
  currentView = view;
  ["dashboard", "history", "backup"].forEach((v) => {
    document.getElementById("view-" + v).classList.toggle("hidden", v !== view);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active-nav", btn.dataset.view === view);
  });
  if (view === "history") renderHistory();
  if (view === "dashboard") renderDashboard();
}

// ---------- MODALS ----------
function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
}
function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
}

// ---------- CRUD ----------
async function addTransaction(tx) {
  await db.transactions.add(tx);
  showToast("✅ Data tersimpan");
  renderDashboard();
}

async function deleteTransaction(id) {
  await db.transactions.delete(id);
  showToast("🗑️ Data dihapus");
  renderDashboard();
  if (currentView === "history") renderHistory();
}

// ---------- RENDER: DASHBOARD ----------
async function renderDashboard() {
  const all = await db.transactions.toArray();

  const income = all.filter((t) => t.type === "income");
  const expense = all.filter((t) => t.type === "expense");

  const totalIncome = income.reduce((s, t) => s + t.amount, 0);
  const totalExpense = expense.reduce((s, t) => s + t.amount, 0);
  const net = totalIncome - totalExpense;

  const monday = startOfWeek(new Date());
  const weekIncome = income.filter((t) => new Date(t.date) >= monday);
  const weekTotal = weekIncome.reduce((s, t) => s + t.amount, 0);
  const weekBox = weekIncome.reduce((s, t) => s + (t.boxCount || 0), 0);

  document.getElementById("stat-net").textContent = rupiah(net);
  document.getElementById("stat-income").textContent = rupiah(totalIncome);
  document.getElementById("stat-expense").textContent = rupiah(totalExpense);
  document.getElementById("stat-week-income").textContent = rupiah(weekTotal);
  document.getElementById("stat-week-box").textContent =
    weekBox + " box terjual minggu ini";

  const recent = all.sort((a, b) => b.id - a.id).slice(0, 6);
  renderList(document.getElementById("recent-list"), recent);
}

// ---------- RENDER: LIST ITEM ----------
function txRow(t) {
  const isIncome = t.type === "income";
  const div = document.createElement("div");
  div.className = "tx-item glass-card p-3 flex items-center justify-between";
  div.innerHTML = `
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-full flex items-center justify-center text-lg ${isIncome ? "bg-emerald-500/20" : "bg-rose-500/20"}">
        ${isIncome ? "💰" : "🛒"}
      </div>
      <div>
        <p class="text-sm font-medium">${isIncome ? t.note || "Uang Masuk" : t.category || "Belanja"}</p>
        <p class="text-[11px] text-slate-400">${t.date}${isIncome && t.boxCount ? " • " + t.boxCount + " box" : ""}</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <span class="text-sm font-semibold ${isIncome ? "text-emerald-300" : "text-rose-300"}">${isIncome ? "+" : "-"}${rupiah(t.amount)}</span>
      <button class="btn-del text-slate-500 text-xs px-1" data-id="${t.id}">✕</button>
    </div>
  `;
  div
    .querySelector(".btn-del")
    .addEventListener("click", () => deleteTransaction(t.id));
  return div;
}

function renderList(container, items) {
  container.innerHTML = "";
  if (items.length === 0) {
    container.innerHTML =
      '<p class="text-center text-xs text-slate-500 py-6">Belum ada data</p>';
    return;
  }
  items.forEach((t) => container.appendChild(txRow(t)));
}

// ---------- RENDER: HISTORY ----------
async function renderHistory() {
  let all = await db.transactions.orderBy("date").reverse().toArray();

  if (filterState.start) all = all.filter((t) => t.date >= filterState.start);
  if (filterState.end) all = all.filter((t) => t.date <= filterState.end);
  if (filterState.search) {
    const q = filterState.search.toLowerCase();
    all = all.filter(
      (t) =>
        (t.note || "").toLowerCase().includes(q) ||
        (t.category || "").toLowerCase().includes(q),
    );
  }
  renderList(document.getElementById("history-list"), all);
}

// ---------- EXPORT / IMPORT ----------
async function exportData() {
  const all = await db.transactions.toArray();
  const blob = new Blob(
    [
      JSON.stringify(
        { exportedAt: new Date().toISOString(), transactions: all },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `note-food-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("⬇️ Backup berhasil diunduh");
}

async function importData(file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const items = Array.isArray(json) ? json : json.transactions;
    if (!Array.isArray(items)) throw new Error("invalid");

    await db.transaction("rw", db.transactions, async () => {
      for (const t of items) {
        const clone = { ...t };
        delete clone.id;
        await db.transactions.add(clone);
      }
    });
    showToast(`✅ ${items.length} data berhasil diimpor`);
    renderDashboard();
    if (currentView === "history") renderHistory();
  } catch (e) {
    showToast("❌ File tidak valid");
  }
}

async function resetAll() {
  await db.transactions.clear();
  showToast("🗑️ Semua data dihapus");
  renderDashboard();
}

// ---------- INIT ----------
function initClock() {
  const el = document.getElementById("today-label");
  el.textContent = new Date().toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function initNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
}

function initFabs() {
  document.getElementById("fab-income").addEventListener("click", () => {
    document.querySelector('#form-income [name="date"]').value = todayStr();
    openModal("modal-income");
  });
  document.getElementById("fab-expense").addEventListener("click", () => {
    document.querySelector('#form-expense [name="date"]').value = todayStr();
    openModal("modal-expense");
  });
  document
    .getElementById("btn-backup")
    .addEventListener("click", () => switchView("backup"));
}

function initModals() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.target.closest(".modal-overlay").classList.add("hidden");
    });
  });
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("hidden");
    });
  });
}

function initIncomeForm() {
  const form = document.getElementById("form-income");
  const amountInput = form.querySelector('[name="amount"]');
  const priceInput = form.querySelector('[name="pricePerBox"]');
  const preview = document.getElementById("income-box-preview");

  function updatePreview() {
    const amount = Number(amountInput.value || 0);
    const price = Number(priceInput.value || 0);
    const box = price > 0 ? Math.floor(amount / price) : 0;
    preview.textContent = box + " box";
  }
  amountInput.addEventListener("input", updatePreview);
  priceInput.addEventListener("input", updatePreview);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const amount = Number(fd.get("amount"));
    const pricePerBox = Number(fd.get("pricePerBox"));
    const boxCount = pricePerBox > 0 ? Math.floor(amount / pricePerBox) : 0;

    await addTransaction({
      type: "income",
      date: fd.get("date"),
      amount,
      pricePerBox,
      boxCount,
      note: fd.get("note") || "",
    });

    form.reset();
    preview.textContent = "0 box";
    closeModal("modal-income");
  });
}

function initExpenseForm() {
  const form = document.getElementById("form-expense");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    await addTransaction({
      type: "expense",
      date: fd.get("date"),
      amount: Number(fd.get("amount")),
      category: fd.get("category"),
      note: fd.get("note") || "",
    });
    form.reset();
    closeModal("modal-expense");
  });
}

function initHistoryFilters() {
  document.getElementById("search-input").addEventListener("input", (e) => {
    filterState.search = e.target.value;
    renderHistory();
  });
  document.getElementById("filter-start").addEventListener("change", (e) => {
    filterState.start = e.target.value;
    renderHistory();
  });
  document.getElementById("filter-end").addEventListener("change", (e) => {
    filterState.end = e.target.value;
    renderHistory();
  });
  document.getElementById("btn-clear-filter").addEventListener("click", () => {
    filterState = { search: "", start: "", end: "" };
    document.getElementById("search-input").value = "";
    document.getElementById("filter-start").value = "";
    document.getElementById("filter-end").value = "";
    renderHistory();
  });
}

function initBackup() {
  document.getElementById("btn-export").addEventListener("click", exportData);
  document.getElementById("import-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = "";
  });
  document.getElementById("btn-reset-all").addEventListener("click", () => {
    if (
      confirm(
        "Yakin ingin menghapus semua data? Tindakan ini tidak bisa dibatalkan.",
      )
    ) {
      resetAll();
    }
  });
}

function init() {
  initClock();
  initNav();
  initFabs();
  initModals();
  initIncomeForm();
  initExpenseForm();
  initHistoryFilters();
  initBackup();
  renderDashboard();
}

document.addEventListener("DOMContentLoaded", init);
