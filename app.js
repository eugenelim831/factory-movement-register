const state = { records: [], returnRecord: null };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const config = {
  get apiUrl() { return localStorage.getItem("movementApiUrl") || ""; },
  get pin() { return localStorage.getItem("movementAppPin") || ""; }
};

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show${error ? " error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.className = "toast", 3500);
}

function requireSettings() {
  if (config.apiUrl && config.pin) return true;
  $("#settingsDialog").showModal();
  showToast("Enter the API address and application PIN first.", true);
  return false;
}

async function api(path, options = {}) {
  if (!requireSettings()) throw new Error("Connection settings are missing.");
  const response = await fetch(`${config.apiUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-App-Pin": config.pin,
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function setupSignature(canvas) {
  const context = canvas.getContext("2d");
  let drawing = false;
  let hasInk = false;

  function resize() {
    const saved = hasInk ? canvas.toDataURL() : null;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.strokeStyle = "#18312b";
    if (saved) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
      image.src = saved;
    }
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  canvas.addEventListener("pointerdown", (event) => {
    drawing = true;
    hasInk = true;
    canvas.setPointerCapture(event.pointerId);
    const p = point(event);
    context.beginPath();
    context.moveTo(p.x, p.y);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const p = point(event);
    context.lineTo(p.x, p.y);
    context.stroke();
  });
  canvas.addEventListener("pointerup", () => drawing = false);
  canvas.addEventListener("pointercancel", () => drawing = false);
  canvas.clearSignature = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    hasInk = false;
  };
  canvas.signatureData = () => hasInk ? canvas.toDataURL("image/png") : "";
  new ResizeObserver(resize).observe(canvas);
}

function switchView(view) {
  $$(".tab").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  $$(".panel").forEach(panel => panel.classList.toggle("active", panel.id === view));
}

$$(".tab").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
$$(".signature").forEach(setupSignature);
$$(".clear-signature").forEach(button => button.addEventListener("click", () => {
  document.getElementById(button.dataset.canvas).clearSignature();
}));

$("#settingsButton").addEventListener("click", () => {
  $("#apiUrl").value = config.apiUrl;
  $("#appPin").value = config.pin;
  $("#settingsDialog").showModal();
});

$("#saveSettings").addEventListener("click", (event) => {
  event.preventDefault();
  localStorage.setItem("movementApiUrl", $("#apiUrl").value.trim());
  localStorage.setItem("movementAppPin", $("#appPin").value);
  $("#settingsDialog").close();
  showToast("Settings saved.");
});

$("#timeoutForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const signature = $("#outSignature").signatureData();
  if (!signature) return showToast("Driver signature is required.", true);
  const data = Object.fromEntries(new FormData(form));
  data.quantityOut = Number(data.quantityOut);
  data.signature = signature;

  const button = form.querySelector("[type=submit]");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const result = await api("/records", { method: "POST", body: JSON.stringify(data) });
    form.reset();
    $("#outSignature").clearSignature();
    showToast(`Saved ${result.record.id}`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Submit Time Out";
  }
});

async function findReturnRecord() {
  const id = $("#returnMovementId").value.trim().toUpperCase();
  if (!id) return showToast("Enter a movement ID.", true);
  try {
    const record = await api(`/records/${encodeURIComponent(id)}`);
    state.returnRecord = record;
    $("#timeinForm [name=quantityReturned]").max = record.quantityOut;
    $("#timeinForm [name=quantityReturned]").value = record.quantityOut;
    $("#returnSummary").classList.remove("empty");
    $("#returnSummary").innerHTML = `<dl>
      <div><dt>Batch</dt><dd>${escapeHtml(record.batchNumber)}</dd></div>
      <div><dt>Description</dt><dd>${escapeHtml(record.description)}</dd></div>
      <div><dt>Quantity out</dt><dd>${record.quantityOut} ${escapeHtml(record.unit)}</dd></div>
      <div><dt>Driver</dt><dd>${escapeHtml(record.driverName)}</dd></div>
      <div><dt>Time out</dt><dd>${formatDate(record.timeOut)}</dd></div>
      <div><dt>Status</dt><dd>${record.status}</dd></div>
    </dl>`;
  } catch (error) {
    state.returnRecord = null;
    $("#returnSummary").className = "record-summary empty";
    $("#returnSummary").textContent = error.message;
    showToast(error.message, true);
  }
}

$("#findRecord").addEventListener("click", findReturnRecord);
$("#returnMovementId").addEventListener("change", findReturnRecord);

$("#timeinForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.returnRecord) return showToast("Find the movement record first.", true);
  const form = event.currentTarget;
  const signature = $("#inSignature").signatureData();
  if (!signature) return showToast("Receiving signature is required.", true);
  const data = Object.fromEntries(new FormData(form));
  data.quantityReturned = Number(data.quantityReturned);
  data.signature = signature;
  delete data.movementId;

  const button = form.querySelector("[type=submit]");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    await api(`/records/${encodeURIComponent(state.returnRecord.id)}`, { method: "PATCH", body: JSON.stringify(data) });
    form.reset();
    state.returnRecord = null;
    $("#returnSummary").className = "record-summary empty";
    $("#returnSummary").textContent = "Enter a movement ID to load its details.";
    $("#inSignature").clearSignature();
    showToast("Return recorded successfully.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Submit Time In";
  }
});

async function loadRecords() {
  $("#recordsBody").innerHTML = `<tr><td colspan="9" class="empty-cell">Loading records…</td></tr>`;
  try {
    state.records = await api("/records");
    renderRecords();
  } catch (error) {
    $("#recordsBody").innerHTML = `<tr><td colspan="9" class="empty-cell">${escapeHtml(error.message)}</td></tr>`;
    showToast(error.message, true);
  }
}

function filteredRecords() {
  const term = $("#recordSearch").value.trim().toLowerCase();
  const status = $("#statusFilter").value;
  return state.records.filter(record => {
    const haystack = [record.id, record.batchNumber, record.driverName, record.description].join(" ").toLowerCase();
    return (!term || haystack.includes(term)) && (!status || record.status === status);
  });
}

function renderRecords() {
  const records = filteredRecords();
  $("#recordsBody").innerHTML = records.length ? records.map(record => `<tr>
    <td>${escapeHtml(record.id)}</td>
    <td>${escapeHtml(record.batchNumber)}</td>
    <td>${escapeHtml(record.description)}</td>
    <td>${record.quantityOut} ${escapeHtml(record.unit)}</td>
    <td>${record.quantityReturned ?? "—"}</td>
    <td>${escapeHtml(record.driverName)}</td>
    <td>${formatDate(record.timeOut)}</td>
    <td>${record.timeIn ? formatDate(record.timeIn) : "—"}</td>
    <td class="status-cell ${record.status}">${record.status}</td>
  </tr>`).join("") : `<tr><td colspan="9" class="empty-cell">No matching records.</td></tr>`;
}

$("#refreshRecords").addEventListener("click", loadRecords);
$("#recordSearch").addEventListener("input", renderRecords);
$("#statusFilter").addEventListener("change", renderRecords);

$("#exportCsv").addEventListener("click", () => {
  if (!state.records.length) return showToast("Load the records before exporting.", true);
  const fields = ["id","batchNumber","size","description","quantityOut","unit","purpose","driverName","vehicleNumber","timeOut","quantityReturned","receivedBy","timeIn","status","remarks","returnRemarks"];
  const rows = [fields, ...filteredRecords().map(record => fields.map(field => record[field] ?? ""))];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = `movement-register-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[character]);
}

if (!config.apiUrl || !config.pin) setTimeout(() => $("#settingsDialog").showModal(), 350);
