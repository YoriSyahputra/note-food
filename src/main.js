import Dexie from "dexie";

// ==========================================================================
// 1. DATABASE SETUP (DEXIE.JS V3)
// ==========================================================================
export const db = new Dexie("NoteFoodDB");

db.version(1).stores({
  transactions: "++id, type, date, amount, category",
});

db.version(2).stores({
  transactions: "++id, date, createdAt",
  settings: "key",
  checklist: "++id, checked, createdAt",
});

// Versi 3: Dukungan riwayat sub-belanja bertahap dan Modul Catatan Keep
db.version(3)
  .stores({
    transactions: "++id, date, createdAt",
    notes: "++id, createdAt, updatedAt",
    settings: "key",
  })
  .upgrade(async (tx) => {
    const oldTx = await tx.table("transactions").toArray();
    for (const t of oldTx) {
      if (!Array.isArray(t.expenses)) {
        const expAmount = Number(t.expense) || 0;
        t.expenses =
          expAmount > 0
            ? [
                {
                  id: Date.now(),
                  amount: expAmount,
                  name: t.note || "Belanja Awal",
                  time: "00:00",
                },
              ]
            : [];
        t.totalExpense = expAmount;
        t.net = (Number(t.income) || 0) - expAmount;
        await tx.table("transactions").put(t);
      }
    }
  });

const DEFAULT_PRICE_PER_BOX = 15000;

// ==========================================================================
// 2. STATE APLIKASI
// ==========================================================================
let currentActiveView = "dashboard";
let globalSettings = { pricePerBox: DEFAULT_PRICE_PER_BOX };
let historyFilterState = { search: "", start: "", end: "" };
let notesSearchQuery = "";
let currentEditingChecklistItems = [];

// ==========================================================================
// 3. UTILITY & FORMATTER
// ==========================================================================
const formatRupiah = (n) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const getTodayISO = () => new Date().toISOString().slice(0, 10);

const getFormattedDateLong = (d = new Date()) => {
  return new Date(d).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const getFormattedTimeShort = (d = new Date()) => {
  return new Date(d)
    .toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(".", ":");
};

function getStartOfWeek(targetDate = new Date()) {
  const d = new Date(targetDate);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 350);
  }, 2200);
}

function bindRupiahInputMask(inputEl) {
  inputEl.addEventListener("input", () => {
    const rawVal = inputEl.value.replace(/\D/g, "");
    inputEl.value = rawVal ? Number(rawVal).toLocaleString("id-ID") : "";
    inputEl.dispatchEvent(new Event("rupiah-masked"));
  });
}

function extractRawNumber(inputEl) {
  return Number((inputEl.value || "").replace(/\D/g, "")) || 0;
}

// ==========================================================================
// 4. SISTEM NAVIGASI MULTI-VIEW
// ==========================================================================
function switchView(viewName) {
  currentActiveView = viewName;
  const viewPanels = ["dashboard", "history", "notes", "settings"];

  viewPanels.forEach((v) => {
    const el = document.getElementById("view-" + v);
    if (el) el.classList.toggle("hidden", v !== viewName);
  });

  document.querySelectorAll(".nav-tab-btn").forEach((btn) => {
    btn.classList.toggle("active-nav", btn.dataset.target === viewName);
  });

  if (viewName === "dashboard") renderDashboardView();
  if (viewName === "history") renderHistoryView();
  if (viewName === "notes") renderNotesView();
  if (viewName === "settings") loadSettingsView();
}

// ==========================================================================
// 5. MANAJEMEN MODAL
// ==========================================================================
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove("hidden");
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add("hidden");
}

// ==========================================================================
// 6. LOGIKA PENGATURAN HARGA & BACKUP
// ==========================================================================
async function loadSettingsView() {
  const rec = await db.settings.get("main");
  globalSettings = rec ? rec.value : { pricePerBox: DEFAULT_PRICE_PER_BOX };
  document.getElementById("settings-current-price").textContent = formatRupiah(
    globalSettings.pricePerBox,
  );
  document.getElementById("preview-calc-rate").textContent =
    `Harga per box: ${formatRupiah(globalSettings.pricePerBox)}`;
}

async function saveSettingsPrice(newPrice) {
  globalSettings = { pricePerBox: newPrice };
  await db.settings.put({ key: "main", value: globalSettings });
  showToast("✅ Harga per box berhasil disimpan");
  await loadSettingsView();
  renderDashboardView();
}

async function exportFullJSON() {
  const transactions = await db.transactions.toArray();
  const notes = await db.notes.toArray();
  const settings = await db.settings.toArray();

  const payload = {
    app: "Note Food",
    version: "3.0",
    exportedAt: new Date().toISOString(),
    transactions,
    notes,
    settings,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `note-food-backup-${getTodayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("⬇️ Cadangan JSON berhasil diunduh");
}

async function importFullJSON(file) {
  try {
    const text = await file.text();
    const json = JSON.parse(text);

    await db.transaction(
      "rw",
      db.transactions,
      db.notes,
      db.settings,
      async () => {
        if (Array.isArray(json.transactions)) {
          for (const t of json.transactions) {
            const clone = { ...t };
            delete clone.id;
            if (!Array.isArray(clone.expenses)) clone.expenses = [];
            await db.transactions.add(clone);
          }
        }
        if (Array.isArray(json.notes)) {
          for (const n of json.notes) {
            const clone = { ...n };
            delete clone.id;
            await db.notes.add(clone);
          }
        }
        if (Array.isArray(json.settings)) {
          for (const s of json.settings) {
            await db.settings.put(s);
          }
        }
      },
    );

    showToast("✅ Pemulihan data selesai");
    await loadSettingsView();
    renderDashboardView();
    if (currentActiveView === "history") renderHistoryView();
    if (currentActiveView === "notes") renderNotesView();
  } catch (err) {
    showToast("❌ Format berkas JSON tidak valid");
  }
}

async function wipeDatabase() {
  if (
    confirm(
      "Konfirmasi: Hapus seluruh data transaksi, catatan, dan pengaturan?",
    )
  ) {
    await db.transactions.clear();
    await db.notes.clear();
    await db.settings.clear();
    showToast("🗑️ Seluruh data lokal telah dikosongkan");
    await loadSettingsView();
    renderDashboardView();
    if (currentActiveView === "history") renderHistoryView();
    if (currentActiveView === "notes") renderNotesView();
  }
}

// ==========================================================================
// 7. TRANSAKSI JUMAT BERKAH & BELANJA BERTAHAP
// ==========================================================================
async function createNewIncomeTransaction(incomeAmount) {
  const price = globalSettings.pricePerBox || DEFAULT_PRICE_PER_BOX;
  const boxCount = price > 0 ? Math.floor(incomeAmount / price) : 0;

  await db.transactions.add({
    date: getTodayISO(),
    createdAt: Date.now(),
    income: incomeAmount,
    pricePerBox: price,
    boxCount,
    expenses: [],
    totalExpense: 0,
    net: incomeAmount,
  });

  showToast("✅ Donasi Jumat Berkah tercatat");
  renderDashboardView();
}

async function addSubExpenseToTransaction(txId, expenseAmount, expenseName) {
  const tx = await db.transactions.get(Number(txId));
  if (!tx) return;

  const newSubItem = {
    id: Date.now(),
    amount: expenseAmount,
    name: expenseName || "Belanja",
    time: getFormattedTimeShort(),
  };

  const updatedExpenses = Array.isArray(tx.expenses)
    ? [...tx.expenses, newSubItem]
    : [newSubItem];
  const newTotalExpense = updatedExpenses.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );
  const newNet = Number(tx.income || 0) - newTotalExpense;

  await db.transactions.update(tx.id, {
    expenses: updatedExpenses,
    totalExpense: newTotalExpense,
    net: newNet,
  });

  showToast("🛒 Pengeluaran belanja berhasil dipotong");
  renderDashboardView();
  if (currentActiveView === "history") renderHistoryView();
}

async function deleteSubExpense(txId, expenseSubId) {
  const tx = await db.transactions.get(Number(txId));
  if (!tx) return;

  const updatedExpenses = (tx.expenses || []).filter(
    (e) => e.id !== Number(expenseSubId),
  );
  const newTotalExpense = updatedExpenses.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );
  const newNet = Number(tx.income || 0) - newTotalExpense;

  await db.transactions.update(tx.id, {
    expenses: updatedExpenses,
    totalExpense: newTotalExpense,
    net: newNet,
  });

  showToast("🗑️ Rincian belanja dihapus");
  renderDashboardView();
  if (currentActiveView === "history") renderHistoryView();
}

async function deleteWholeTransaction(txId) {
  if (
    confirm("Hapus transaksi donasi ini beserta seluruh rincian belanjanya?")
  ) {
    await db.transactions.delete(Number(txId));
    showToast("🗑️ Transaksi berhasil dihapus");
    renderDashboardView();
    if (currentActiveView === "history") renderHistoryView();
  }
}

function createTransactionCardElement(t) {
  const card = document.createElement("div");
  card.className = "glass-card p-4 item-pop-in space-y-3";

  const expensesList = Array.isArray(t.expenses) ? t.expenses : [];
  const hasExpenses = expensesList.length > 0;

  let subExpensesHTML = "";
  if (hasExpenses) {
    subExpensesHTML = `
      <div class="pt-2 border-t border-white/5 space-y-1.5">
        <p class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Rincian Belanja (${expensesList.length}):</p>
        <div class="space-y-1 max-h-32 overflow-y-auto pr-1">
          ${expensesList
            .map(
              (e) => `
            <div class="flex items-center justify-between bg-white/[0.03] rounded-lg px-2.5 py-1.5 text-xs">
              <div class="flex items-center gap-2">
                <span class="text-[10px] text-slate-500 font-mono">${e.time || ""}</span>
                <span class="text-slate-200 font-medium">${e.name}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="font-bold text-rose-300">- ${formatRupiah(e.amount)}</span>
                <button class="btn-del-sub text-slate-500 hover:text-rose-400 text-xs px-1" data-txid="${t.id}" data-subid="${e.id}">✕</button>
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    `;
  }

  card.innerHTML = `
    <div class="flex items-start justify-between">
      <div class="flex items-center gap-2.5">
        <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500/20 to-sky-500/20 border border-emerald-500/30 flex items-center justify-center text-base">
          🍱
        </div>
        <div>
          <h4 class="text-sm font-extrabold text-slate-100">Jumat Berkah</h4>
          <p class="text-[11px] text-slate-400 font-medium">${getFormattedDateLong(t.date)} • <span class="text-emerald-300 font-bold">${t.boxCount || 0} box</span></p>
        </div>
      </div>
      <div class="flex items-center gap-1.5">
        <button class="btn-open-add-expense px-2.5 py-1 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs font-bold flex items-center gap-1 transition" data-id="${t.id}">
          <span>+</span> Belanja
        </button>
        <button class="btn-del-tx text-slate-500 hover:text-rose-400 text-sm px-1.5 py-1" data-id="${t.id}" title="Hapus">
          ✕
        </button>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-2 text-center pt-1">
      <div class="bg-white/5 rounded-xl py-2 px-1">
        <p class="text-[10px] text-slate-400 font-medium">Uang Masuk</p>
        <p class="text-xs font-bold text-emerald-300 tabular-nums">${formatRupiah(t.income)}</p>
      </div>
      <div class="bg-white/5 rounded-xl py-2 px-1">
        <p class="text-[10px] text-slate-400 font-medium">Total Belanja</p>
        <p class="text-xs font-bold text-rose-300 tabular-nums">${formatRupiah(t.totalExpense || 0)}</p>
      </div>
      <div class="bg-white/5 rounded-xl py-2 px-1">
        <p class="text-[10px] text-slate-400 font-medium">Sisa Bersih</p>
        <p class="text-xs font-black ${(t.net || 0) >= 0 ? "text-sky-300" : "text-rose-400"} tabular-nums">${formatRupiah(t.net || 0)}</p>
      </div>
    </div>

    ${subExpensesHTML}
  `;

  card.querySelector(".btn-open-add-expense").addEventListener("click", () => {
    document.getElementById("input-expense-parent-id").value = t.id;
    document.getElementById("modal-expense-tx-info").textContent =
      `Transaksi: ${getFormattedDateLong(t.date)} (Masuk: ${formatRupiah(t.income)})`;
    document.getElementById("form-add-expense").reset();
    document.getElementById("preview-expense-impact").textContent = "- Rp 0";
    openModal("modal-add-expense");
  });

  card
    .querySelector(".btn-del-tx")
    .addEventListener("click", () => deleteWholeTransaction(t.id));

  card.querySelectorAll(".btn-del-sub").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSubExpense(btn.dataset.txid, btn.dataset.subid);
    });
  });

  return card;
}

// ==========================================================================
// 8. RENDER VIEW: DASHBOARD
// ==========================================================================
async function renderDashboardView() {
  const allTx = await db.transactions.toArray();

  const totalIncome = allTx.reduce((sum, t) => sum + Number(t.income || 0), 0);
  const totalExpense = allTx.reduce(
    (sum, t) => sum + Number(t.totalExpense || 0),
    0,
  );
  const totalNet = totalIncome - totalExpense;

  const monday = getStartOfWeek(new Date());
  const weekTx = allTx.filter((t) => new Date(t.date) >= monday);
  const weekIncome = weekTx.reduce((sum, t) => sum + Number(t.income || 0), 0);
  const weekBox = weekTx.reduce((sum, t) => sum + Number(t.boxCount || 0), 0);

  document.getElementById("stat-net").textContent = formatRupiah(totalNet);
  document.getElementById("stat-income").textContent =
    formatRupiah(totalIncome);
  document.getElementById("stat-expense").textContent =
    formatRupiah(totalExpense);
  document.getElementById("stat-week-income").textContent =
    formatRupiah(weekIncome);
  document.getElementById("stat-week-box").textContent =
    `${weekBox} box terjual minggu ini`;

  const targetBoxRef = Math.max(weekBox, 50);
  const progressPct = Math.min(100, Math.round((weekBox / targetBoxRef) * 100));
  document.getElementById("week-progress-fill").style.width = `${progressPct}%`;

  const listContainer = document.getElementById("dashboard-tx-list");
  listContainer.innerHTML = "";

  const recentTx = allTx
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 5);
  if (recentTx.length === 0) {
    listContainer.innerHTML = `
      <div class="text-center py-8 glass-card border-dashed">
        <p class="text-2xl mb-1">🍱</p>
        <p class="text-xs text-slate-400 font-medium">Belum ada catatan Jumat Berkah.</p>
        <p class="text-[10px] text-slate-500 mt-0.5">Tekan tombol (+) di pojok kanan bawah untuk mencatat donasi baru.</p>
      </div>
    `;
    return;
  }

  recentTx.forEach((t) =>
    listContainer.appendChild(createTransactionCardElement(t)),
  );
}

// ==========================================================================
// 9. RENDER VIEW: RIWAYAT
// ==========================================================================
async function renderHistoryView() {
  let list = await db.transactions.orderBy("date").reverse().toArray();

  if (historyFilterState.start) {
    list = list.filter((t) => t.date >= historyFilterState.start);
  }
  if (historyFilterState.end) {
    list = list.filter((t) => t.date <= historyFilterState.end);
  }
  if (historyFilterState.search) {
    const q = historyFilterState.search.toLowerCase();
    list = list.filter((t) => {
      const matchDate = t.date.includes(q);
      const matchExpenses = (t.expenses || []).some((e) =>
        (e.name || "").toLowerCase().includes(q),
      );
      return matchDate || matchExpenses;
    });
  }

  const container = document.getElementById("history-full-list");
  container.innerHTML = "";

  if (list.length === 0) {
    container.innerHTML =
      '<p class="text-center text-xs text-slate-500 py-10">Tidak ada riwayat transaksi yang cocok.</p>';
    return;
  }

  list.forEach((t) => container.appendChild(createTransactionCardElement(t)));
}

// ==========================================================================
// 10. MODUL CATATAN KEEP NOTE (DYNAMIC CHECKLIST & SYNC TIMESTAMP)
// ==========================================================================
function renderChecklistBuilderRows() {
  const container = document.getElementById("note-checklist-builder");
  container.innerHTML = "";

  currentEditingChecklistItems.forEach((item, index) => {
    const row = document.createElement("div");
    row.className =
      "flex items-center gap-2 py-1 px-1.5 rounded-xl bg-white/[0.02]";
    row.innerHTML = `
      <div class="checkbox-custom ${item.done ? "checked" : ""}" data-idx="${index}">
        ${item.done ? "✓" : ""}
      </div>
      <input type="text" value="${item.text}" class="input-field py-1 text-xs flex-1 ${item.done ? "line-through text-slate-500" : ""}" data-idx="${index}" />
      <button type="button" class="btn-remove-row text-slate-500 hover:text-rose-400 text-xs px-1" data-idx="${index}">✕</button>
    `;

    row.querySelector(".checkbox-custom").addEventListener("click", () => {
      currentEditingChecklistItems[index].done =
        !currentEditingChecklistItems[index].done;
      renderChecklistBuilderRows();
    });

    row.querySelector("input").addEventListener("input", (e) => {
      currentEditingChecklistItems[index].text = e.target.value;
    });

    row.querySelector(".btn-remove-row").addEventListener("click", () => {
      currentEditingChecklistItems.splice(index, 1);
      renderChecklistBuilderRows();
    });

    container.appendChild(row);
  });
}

function openNoteEditorForCreate() {
  document.getElementById("input-note-id").value = "";
  document.getElementById("input-note-title").value = "";
  document.getElementById("note-modal-title").textContent =
    "📝 Buat Catatan Baru";

  const now = new Date();
  const dateFormatted = getFormattedDateLong(now);
  const timeFormatted = getFormattedTimeShort(now);
  document.getElementById("note-sync-timestamp").textContent =
    `Sync: ${dateFormatted} • ${timeFormatted}`;

  currentEditingChecklistItems = [];
  renderChecklistBuilderRows();
  openModal("modal-note-editor");
}

async function openNoteEditorForEdit(noteId) {
  const note = await db.notes.get(Number(noteId));
  if (!note) return;

  document.getElementById("input-note-id").value = note.id;
  document.getElementById("input-note-title").value = note.title;
  document.getElementById("note-modal-title").textContent = "✏️ Edit Catatan";
  document.getElementById("note-sync-timestamp").textContent =
    `Dibuat: ${note.dateFormatted} • ${note.timeFormatted}`;

  currentEditingChecklistItems = JSON.parse(JSON.stringify(note.items || []));
  renderChecklistBuilderRows();
  openModal("modal-note-editor");
}

async function saveKeepNote() {
  const noteId = document.getElementById("input-note-id").value;
  const title =
    document.getElementById("input-note-title").value.trim() || "Tanpa Judul";
  const cleanedItems = currentEditingChecklistItems.filter(
    (i) => i.text.trim() !== "",
  );

  const now = new Date();
  const dateFormatted = getFormattedDateLong(now);
  const timeFormatted = getFormattedTimeShort(now);

  if (noteId) {
    await db.notes.update(Number(noteId), {
      title,
      items: cleanedItems,
      updatedAt: Date.now(),
    });
    showToast("✅ Catatan diperbarui");
  } else {
    await db.notes.add({
      title,
      items: cleanedItems,
      dateFormatted,
      timeFormatted,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    showToast("✅ Catatan Keep berhasil dibuat");
  }

  closeModal("modal-note-editor");
  renderNotesView();
}

async function toggleNoteChecklistItemDirect(noteId, itemIndex) {
  const note = await db.notes.get(Number(noteId));
  if (!note || !note.items || !note.items[itemIndex]) return;

  note.items[itemIndex].done = !note.items[itemIndex].done;
  await db.notes.update(note.id, {
    items: note.items,
    updatedAt: Date.now(),
  });
  renderNotesView();
}

async function deleteKeepNote(noteId) {
  if (confirm("Hapus catatan ini?")) {
    await db.notes.delete(Number(noteId));
    showToast("🗑️ Catatan dihapus");
    renderNotesView();
  }
}

async function renderNotesView() {
  let allNotes = await db.notes.orderBy("createdAt").reverse().toArray();

  if (notesSearchQuery) {
    const q = notesSearchQuery.toLowerCase();
    allNotes = allNotes.filter((n) => {
      const matchTitle = (n.title || "").toLowerCase().includes(q);
      const matchItems = (n.items || []).some((i) =>
        (i.text || "").toLowerCase().includes(q),
      );
      return matchTitle || matchItems;
    });
  }

  const grid = document.getElementById("notes-grid");
  grid.innerHTML = "";

  if (allNotes.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full text-center py-12 glass-card border-dashed">
        <p class="text-3xl mb-2">📝</p>
        <p class="text-xs text-slate-400 font-medium">Belum ada catatan tersimpan.</p>
        <button id="btn-empty-create-note" class="mt-3 glass-btn-primary px-4 py-2 rounded-xl text-xs font-bold">
          + Buat Catatan Pertama
        </button>
      </div>
    `;
    const emptyBtn = document.getElementById("btn-empty-create-note");
    if (emptyBtn) emptyBtn.addEventListener("click", openNoteEditorForCreate);
    return;
  }

  allNotes.forEach((n) => {
    const card = document.createElement("div");
    card.className =
      "glass-card p-4 item-pop-in space-y-3 flex flex-col justify-between";

    const items = n.items || [];
    const itemsHTML =
      items.length > 0
        ? items
            .map(
              (it, idx) => `
        <div class="flex items-start gap-2 text-xs py-0.5">
          <div class="checkbox-custom mt-0.5 ${it.done ? "checked" : ""}" data-noteid="${n.id}" data-idx="${idx}">
            ${it.done ? "✓" : ""}
          </div>
          <span class="flex-1 ${it.done ? "line-through text-slate-500" : "text-slate-200"}">${it.text}</span>
        </div>
      `,
            )
            .join("")
        : '<p class="text-[11px] text-slate-500 italic">Catatan tanpa butir periksa.</p>';

    card.innerHTML = `
      <div class="space-y-2">
        <div class="flex items-start justify-between gap-2">
          <h3 class="font-extrabold text-sm text-slate-100 leading-snug">${n.title}</h3>
          <span class="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold shrink-0">
            ${n.timeFormatted || ""}
          </span>
        </div>
        <p class="text-[10px] text-slate-400 font-medium">📅 ${n.dateFormatted || ""}</p>
        <div class="space-y-1.5 pt-1">
          ${itemsHTML}
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 pt-3 border-t border-white/5">
        <button class="btn-edit-note glass-btn px-2.5 py-1 rounded-lg text-xs text-slate-300 hover:text-emerald-300" data-id="${n.id}">
          ✏️ Edit
        </button>
        <button class="btn-del-note text-slate-500 hover:text-rose-400 text-xs px-2 py-1" data-id="${n.id}">
          🗑️
        </button>
      </div>
    `;

    card.querySelectorAll(".checkbox-custom").forEach((box) => {
      box.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleNoteChecklistItemDirect(box.dataset.noteid, box.dataset.idx);
      });
    });

    card
      .querySelector(".btn-edit-note")
      .addEventListener("click", () => openNoteEditorForEdit(n.id));
    card
      .querySelector(".btn-del-note")
      .addEventListener("click", () => deleteKeepNote(n.id));

    grid.appendChild(card);
  });
}

// ==========================================================================
// 11. KONTROL ANIMASI PEMBUKA SPLASH SCREEN
// ==========================================================================
function initInteractiveSplashScreen() {
  const splashScreen = document.getElementById("splash-screen");
  const splashBrand = document.getElementById("splash-brand");
  const skipBtn = document.getElementById("btn-skip-splash");

  setTimeout(() => {
    if (splashBrand) splashBrand.classList.add("splash-brand-reveal");
  }, 1900);

  const autoDismissTimer = setTimeout(() => {
    dismissSplashScreen();
  }, 3300);

  function dismissSplashScreen() {
    clearTimeout(autoDismissTimer);
    if (!splashScreen || splashScreen.classList.contains("splash-fade-out"))
      return;
    splashScreen.classList.add("splash-fade-out");
    setTimeout(() => {
      splashScreen.remove();
    }, 600);
  }

  if (skipBtn) skipBtn.addEventListener("click", dismissSplashScreen);
  splashScreen.addEventListener("click", dismissSplashScreen);
}

// ==========================================================================
// 12. INITIALIZATION EVENT LISTENERS & BOOTSTRAP
// ==========================================================================
function initEventListeners() {
  document.getElementById("today-label").textContent = getFormattedDateLong();
  document.getElementById("modal-income-date-label").textContent =
    getFormattedDateLong();

  document.querySelectorAll(".nav-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.target));
  });

  document
    .getElementById("btn-header-settings")
    .addEventListener("click", () => switchView("settings"));
  document
    .getElementById("btn-quick-view-history")
    .addEventListener("click", () => switchView("history"));

  document.getElementById("fab-action").addEventListener("click", () => {
    if (currentActiveView === "notes") {
      openNoteEditorForCreate();
    } else {
      document.getElementById("form-new-income").reset();
      document.getElementById("preview-new-income-box").textContent = "0 box";
      openModal("modal-new-income");
    }
  });

  const incomeInput = document.getElementById("input-new-income-amount");
  bindRupiahInputMask(incomeInput);

  incomeInput.addEventListener("rupiah-masked", () => {
    const rawVal = extractRawNumber(incomeInput);
    const price = globalSettings.pricePerBox || DEFAULT_PRICE_PER_BOX;
    const box = price > 0 ? Math.floor(rawVal / price) : 0;
    document.getElementById("preview-new-income-box").textContent =
      `${box} box`;
  });

  document
    .getElementById("form-new-income")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const amount = extractRawNumber(incomeInput);
      if (amount <= 0) {
        showToast("❌ Masukkan nominal uang masuk");
        return;
      }
      await createNewIncomeTransaction(amount);
      closeModal("modal-new-income");
    });

  const expenseInput = document.getElementById("input-expense-amount");
  bindRupiahInputMask(expenseInput);

  expenseInput.addEventListener("rupiah-masked", () => {
    const rawVal = extractRawNumber(expenseInput);
    document.getElementById("preview-expense-impact").textContent =
      `- ${formatRupiah(rawVal)}`;
  });

  document
    .getElementById("form-add-expense")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const parentId = document.getElementById("input-expense-parent-id").value;
      const amount = extractRawNumber(expenseInput);
      const name = document.getElementById("input-expense-name").value.trim();

      if (amount <= 0) {
        showToast("❌ Masukkan nominal belanja");
        return;
      }

      await addSubExpenseToTransaction(parentId, amount, name);
      closeModal("modal-add-expense");
    });

  document
    .getElementById("btn-create-note-banner")
    .addEventListener("click", openNoteEditorForCreate);

  document
    .getElementById("btn-add-checklist-row")
    .addEventListener("click", () => {
      const inputRow = document.getElementById("input-new-checklist-row");
      const text = inputRow.value.trim();
      if (!text) return;
      currentEditingChecklistItems.push({ text, done: false });
      inputRow.value = "";
      renderChecklistBuilderRows();
    });

  document
    .getElementById("input-new-checklist-row")
    .addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("btn-add-checklist-row").click();
      }
    });

  document
    .getElementById("form-keep-note")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      await saveKeepNote();
    });

  document
    .getElementById("search-history-input")
    .addEventListener("input", (e) => {
      historyFilterState.search = e.target.value;
      renderHistoryView();
    });

  document
    .getElementById("filter-history-start")
    .addEventListener("change", (e) => {
      historyFilterState.start = e.target.value;
      renderHistoryView();
    });

  document
    .getElementById("filter-history-end")
    .addEventListener("change", (e) => {
      historyFilterState.end = e.target.value;
      renderHistoryView();
    });

  document
    .getElementById("btn-reset-history-filter")
    .addEventListener("click", () => {
      historyFilterState = { search: "", start: "", end: "" };
      document.getElementById("search-history-input").value = "";
      document.getElementById("filter-history-start").value = "";
      document.getElementById("filter-history-end").value = "";
      renderHistoryView();
    });

  document
    .getElementById("search-notes-input")
    .addEventListener("input", (e) => {
      notesSearchQuery = e.target.value;
      renderNotesView();
    });

  const priceInput = document.getElementById("settings-price-input");
  bindRupiahInputMask(priceInput);

  document
    .getElementById("btn-save-box-price")
    .addEventListener("click", async () => {
      const price = extractRawNumber(priceInput);
      if (price <= 0) {
        showToast("❌ Masukkan harga per box yang valid");
        return;
      }
      await saveSettingsPrice(price);
      priceInput.value = "";
    });

  document
    .getElementById("btn-export-json")
    .addEventListener("click", exportFullJSON);

  document
    .getElementById("input-import-json")
    .addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) importFullJSON(file);
      e.target.value = "";
    });

  document
    .getElementById("btn-wipe-database")
    .addEventListener("click", wipeDatabase);

  document.querySelectorAll("[data-modal-dismiss]").forEach((btn) => {
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

// ==========================================================================
// 13. BOOTSTRAP APLIKASI
// ==========================================================================
async function bootstrapApp() {
  initInteractiveSplashScreen();
  initEventListeners();
  await loadSettingsView();
  renderDashboardView();
}

document.addEventListener("DOMContentLoaded", bootstrapApp);
