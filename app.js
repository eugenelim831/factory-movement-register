const state = { records: [], openDeliveries: [], selectedDelivery: null, drafts: [], editingDraftId: null };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const config = {
  get apiUrl() { return localStorage.getItem("movementApiUrl") || ""; },
  get pin() { return localStorage.getItem("movementAppPin") || ""; }
};

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show${error ? " error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.className = "toast", 4000);
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
    headers: { "Content-Type": "application/json", "X-App-Pin": config.pin, ...(options.headers || {}) }
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
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    const saved = hasInk ? canvas.toDataURL() : null;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.strokeStyle = "#18312b";
    if (saved) { const image = new Image(); image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height); image.src = saved; }
  }
  function point(event) { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  canvas.addEventListener("pointerdown", event => { drawing = true; hasInk = true; canvas.setPointerCapture(event.pointerId); const p = point(event); context.beginPath(); context.moveTo(p.x, p.y); });
  canvas.addEventListener("pointermove", event => { if (!drawing) return; const p = point(event); context.lineTo(p.x, p.y); context.stroke(); });
  canvas.addEventListener("pointerup", () => drawing = false);
  canvas.addEventListener("pointercancel", () => drawing = false);
  canvas.clearSignature = () => { context.clearRect(0, 0, canvas.width, canvas.height); hasInk = false; };
  canvas.signatureData = () => hasInk ? canvas.toDataURL("image/png") : "";
  new ResizeObserver(resize).observe(canvas);
}

function switchView(view) {
  $$(".tab").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  $$(".panel").forEach(panel => panel.classList.toggle("active", panel.id === view));
  if (view === "receive") loadOpenDeliveries();
  if (view === "dispatch") loadDrafts();
}

$$(".tab").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
$$(".signature").forEach(setupSignature);
$$(".clear-signature").forEach(button => button.addEventListener("click", () => document.getElementById(button.dataset.canvas).clearSignature()));

$("#settingsButton").addEventListener("click", () => { $("#apiUrl").value = config.apiUrl; $("#appPin").value = config.pin; $("#settingsDialog").showModal(); });
$("#saveSettings").addEventListener("click", event => { event.preventDefault(); localStorage.setItem("movementApiUrl", $("#apiUrl").value.trim()); localStorage.setItem("movementAppPin", $("#appPin").value); $("#settingsDialog").close(); showToast("Settings saved."); loadDrafts(); });

function addDispatchItem(initial = {}) {
  const fragment = $("#dispatchItemTemplate").content.cloneNode(true);
  const card = fragment.querySelector(".item-card");
  $("#dispatchItems").appendChild(fragment);
  const type = card.querySelector(".item-type");
  const unit = card.querySelector(".item-unit");
  type.value = initial.type || "BATCH";
  card.querySelector(".batch-number").value = initial.batchNumber || "";
  card.querySelector(".item-size").value = initial.size || "";
  card.querySelector(".item-description").value = initial.description || "";
  card.querySelector(".item-quantity").value = initial.quantity || "";
  unit.value = initial.unit || "pieces";
  card.querySelector(".pieces-per-unit").value = initial.piecesPerUnit || "";
  type.addEventListener("change", () => updateItemCard(card));
  unit.addEventListener("change", () => updateItemCard(card));
  card.querySelector(".remove-item").addEventListener("click", () => { card.remove(); renumberItems(); });
  updateItemCard(card);
  renumberItems();
}

function updateItemCard(card) {
  const isBatch = card.querySelector(".item-type").value === "BATCH";
  card.querySelectorAll(".batch-field").forEach(element => element.classList.toggle("hidden", !isBatch));
  card.querySelector(".batch-number").required = isBatch;
  card.querySelector(".item-size").required = isBatch;
  const isBag = card.querySelector(".item-unit").value === "bags";
  card.querySelector(".per-unit-field").classList.toggle("hidden", !isBag);
  card.querySelector(".pieces-per-unit").required = isBag;
}

function renumberItems() {
  $$("#dispatchItems .item-card").forEach((card, index) => card.querySelector(".item-number").textContent = `Item ${index + 1}`);
  $$("#dispatchItems .remove-item").forEach(button => button.disabled = $$("#dispatchItems .item-card").length === 1);
}

function collectDispatchItems() {
  return $$("#dispatchItems .item-card").map((card, index) => {
    const type = card.querySelector(".item-type").value;
    const batchNumber = card.querySelector(".batch-number").value.trim().replaceAll(" ", "");
    const size = card.querySelector(".item-size").value.trim().replace(/[×x]/gi, "*").replaceAll(" ", "");
    if (type === "BATCH" && !/^\d+\/\d+$/.test(batchNumber)) throw new Error(`Item ${index + 1}: batch number must look like 1234/56.`);
    if (type === "BATCH" && !/^0\.\d+\*\d+\*\d+$/.test(size)) throw new Error(`Item ${index + 1}: size must look like 0.23*950*740.`);
    return {
      itemId: `ITEM-${index + 1}`,
      type,
      batchNumber: type === "BATCH" ? batchNumber : "",
      size: type === "BATCH" ? size : "",
      description: card.querySelector(".item-description").value.trim(),
      quantity: Number(card.querySelector(".item-quantity").value),
      unit: card.querySelector(".item-unit").value,
      piecesPerUnit: card.querySelector(".item-unit").value === "bags" ? Number(card.querySelector(".pieces-per-unit").value) : null
    };
  });
}

function collectDraftItems() {
  return $$("#dispatchItems .item-card").map((card, index) => ({
    itemId: `ITEM-${index + 1}`,
    type: card.querySelector(".item-type").value,
    batchNumber: card.querySelector(".batch-number").value.trim().replaceAll(" ", ""),
    size: card.querySelector(".item-size").value.trim().replace(/[×x]/gi, "*").replaceAll(" ", ""),
    description: card.querySelector(".item-description").value.trim(),
    quantity: card.querySelector(".item-quantity").value ? Number(card.querySelector(".item-quantity").value) : null,
    unit: card.querySelector(".item-unit").value,
    piecesPerUnit: card.querySelector(".pieces-per-unit").value ? Number(card.querySelector(".pieces-per-unit").value) : null
  }));
}

function dispatchHeaderData(form) {
  const data = Object.fromEntries(new FormData(form));
  return { direction: data.direction || "", driverName: data.driverName || "", vehicleNumber: data.vehicleNumber || "", releasedBy: data.releasedBy || "", purpose: data.purpose || "", remarks: data.remarks || "" };
}

function resetDispatchForm() {
  $("#dispatchForm").reset();
  $("#dispatchItems").innerHTML = "";
  addDispatchItem();
  $("#releaseSignature").clearSignature();
  state.editingDraftId = null;
  $("#draftId").value = "";
  $("#draftState").textContent = "You are preparing a new delivery.";
}

function populateDraft(record) {
  const form = $("#dispatchForm");
  form.elements.direction.value = record.direction || "";
  form.elements.driverName.value = record.driverName || "";
  form.elements.vehicleNumber.value = record.vehicleNumber || "";
  form.elements.releasedBy.value = record.releasedBy || "";
  form.elements.purpose.value = record.purpose || "";
  form.elements.remarks.value = record.remarks || "";
  $("#dispatchItems").innerHTML = "";
  (record.items?.length ? record.items : [{}]).forEach(addDispatchItem);
  $("#releaseSignature").clearSignature();
  state.editingDraftId = record.id;
  $("#draftState").textContent = `Editing saved draft ${record.id}. Changes are not saved until you select Save Draft.`;
}

async function loadDrafts(selectedId = state.editingDraftId) {
  try {
    const records = await api("/records");
    state.drafts = records.filter(record => record.status === "DRAFT");
    $("#draftId").innerHTML = `<option value="">New unsaved delivery</option>` + state.drafts.map(record => `<option value="${escapeHtml(record.id)}">${escapeHtml(record.id)} — ${escapeHtml(record.direction || "Direction not set")} — ${record.items?.length || 0} item(s)</option>`).join("");
    if (selectedId && state.drafts.some(record => record.id === selectedId)) $("#draftId").value = selectedId;
  } catch (error) { showToast(error.message, true); }
}

$("#refreshDrafts").addEventListener("click", () => loadDrafts());
$("#newDraft").addEventListener("click", resetDispatchForm);
$("#draftId").addEventListener("change", event => {
  if (!event.target.value) return resetDispatchForm();
  const draft = state.drafts.find(record => record.id === event.target.value);
  if (draft) populateDraft(draft);
});

$("#saveDraft").addEventListener("click", async () => {
  const form = $("#dispatchForm");
  const data = { ...dispatchHeaderData(form), items: collectDraftItems() };
  const button = $("#saveDraft");
  button.disabled = true; button.textContent = "Saving Draft…";
  try {
    const result = state.editingDraftId
      ? await api(`/drafts/${encodeURIComponent(state.editingDraftId)}`, { method: "PUT", body: JSON.stringify(data) })
      : await api("/drafts", { method: "POST", body: JSON.stringify(data) });
    state.editingDraftId = result.record.id;
    $("#draftState").textContent = `Draft ${result.record.id} is saved. You can close this page and continue later.`;
    await loadDrafts(result.record.id);
    showToast(`Draft ${result.record.id} saved.`);
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; button.textContent = "Save Draft"; }
});

$("#addItem").addEventListener("click", () => addDispatchItem());
addDispatchItem();

$("#dispatchForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const signature = $("#releaseSignature").signatureData();
  if (!signature) return showToast("Releasing person-in-charge signature is required.", true);
  let items;
  try { items = collectDispatchItems(); } catch (error) { return showToast(error.message, true); }
  const data = dispatchHeaderData(form);
  data.items = items;
  data.signature = signature;
  const button = form.querySelector("[type=submit]");
  button.disabled = true; button.textContent = "Saving…";
  try {
    const result = state.editingDraftId
      ? await api(`/drafts/${encodeURIComponent(state.editingDraftId)}/dispatch`, { method: "POST", body: JSON.stringify(data) })
      : await api("/records", { method: "POST", body: JSON.stringify(data) });
    resetDispatchForm(); await loadDrafts();
    showToast(`Delivery ${result.record.id} dispatched.`);
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; button.textContent = "Confirm Dispatch"; }
});

function normalizedStatus(status) { return ({ OUT: "IN_TRANSIT", RETURNED: "RECEIVED", PARTIAL: "INCOMPLETE", PARTIALLY_RECEIVED: "INCOMPLETE" })[status] || status; }
function normalizedItems(record) {
  if (Array.isArray(record.items)) return record.items;
  return [{ itemId: "ITEM-1", type: record.batchNumber ? "BATCH" : "COMPONENT", batchNumber: record.batchNumber || "", size: record.size || "", description: record.description || "Legacy item", quantity: Number(record.quantityOut || 0), unit: record.unit || "pieces", piecesPerUnit: null }];
}

async function loadOpenDeliveries() {
  const select = $("#deliveryId");
  select.innerHTML = `<option value="">Loading open deliveries…</option>`;
  try {
    const records = await api("/records");
    state.openDeliveries = records.filter(record => ["IN_TRANSIT", "INCOMPLETE"].includes(normalizedStatus(record.status)));
    select.innerHTML = `<option value="">Select Delivery ID</option>` + state.openDeliveries.map(record => `<option value="${escapeHtml(record.id)}">${escapeHtml(record.id)} — ${escapeHtml(record.direction || "Legacy transfer")} — ${normalizedItems(record).length} item(s) — ${normalizedStatus(record.status).replaceAll("_", " ")}</option>`).join("");
    if (!state.openDeliveries.length) select.innerHTML = `<option value="">No open deliveries</option>`;
  } catch (error) { select.innerHTML = `<option value="">Unable to load deliveries</option>`; showToast(error.message, true); }
}

$("#refreshDeliveries").addEventListener("click", loadOpenDeliveries);
$("#deliveryId").addEventListener("change", async event => {
  const id = event.target.value;
  if (!id) return;
  try {
    const record = await api(`/records/${encodeURIComponent(id)}`);
    state.selectedDelivery = record;
    $("#deliverySummary").classList.remove("empty");
    $("#deliverySummary").innerHTML = `<dl><div><dt>Direction</dt><dd>${escapeHtml(record.direction || "Legacy transfer")}</dd></div><div><dt>Driver</dt><dd>${escapeHtml(record.driverName)}</dd></div><div><dt>Vehicle</dt><dd>${escapeHtml(record.vehicleNumber || "—")}</dd></div><div><dt>Released by</dt><dd>${escapeHtml(record.releasedBy || "—")}</dd></div><div><dt>Dispatched</dt><dd>${formatDate(record.timeOut)}</dd></div><div><dt>Status</dt><dd>${normalizedStatus(record.status).replaceAll("_", " ")}</dd></div></dl>`;
    renderReceiveItems(record);
  } catch (error) { showToast(error.message, true); }
});

function renderReceiveItems(record) {
  const previous = new Map((record.receivedItems || []).map(item => [item.itemId, item]));
  $("#receiveItems").innerHTML = normalizedItems(record).map((item, index) => {
    const prior = previous.get(item.itemId) || {};
    return `<article class="receive-card" data-item-id="${escapeHtml(item.itemId)}">
      <div class="receive-card-title"><div><span>Item ${index + 1}</span><strong>${escapeHtml(item.description)}</strong></div><label class="present-check"><input class="item-present" type="checkbox" ${prior.present ? "checked" : ""}> Item present</label></div>
      <div class="expected-grid">
        <div><span>Type</span><strong>${item.type === "BATCH" ? "Tinplate batch" : "Component"}</strong></div>
        ${item.type === "BATCH" ? `<div><span>Batch</span><strong>${escapeHtml(item.batchNumber)}</strong></div><div><span>Size</span><strong>${escapeHtml(item.size)}</strong></div>` : ""}
        <div><span>Expected</span><strong>${item.quantity} ${escapeHtml(item.unit)}${item.piecesPerUnit ? ` × ${item.piecesPerUnit} pieces` : ""}</strong></div>
      </div>
      <div class="form-grid check-fields">
        <label>Actual quantity received<input class="actual-quantity" type="number" min="0" step="0.01" value="${prior.quantityReceived ?? item.quantity}" required></label>
        ${item.piecesPerUnit ? `<label>Actual pieces per bag<input class="actual-per-unit" type="number" min="0" step="1" value="${prior.piecesPerUnitReceived ?? item.piecesPerUnit}" required></label>` : ""}
      </div>
      <div class="match-result" aria-live="polite"></div>
    </article>`;
  }).join("");
  $$("#receiveItems input").forEach(input => input.addEventListener("input", updateReceiveMatches));
  updateReceiveMatches();
}

function collectReceivedItems() {
  const expected = normalizedItems(state.selectedDelivery);
  return $$("#receiveItems .receive-card").map(card => {
    const item = expected.find(value => value.itemId === card.dataset.itemId);
    const present = card.querySelector(".item-present").checked;
    const quantityReceived = Number(card.querySelector(".actual-quantity").value || 0);
    const piecesPerUnitReceived = card.querySelector(".actual-per-unit") ? Number(card.querySelector(".actual-per-unit").value || 0) : null;
    const matched = present && quantityReceived === Number(item.quantity) && (item.piecesPerUnit == null || piecesPerUnitReceived === Number(item.piecesPerUnit));
    return { itemId: item.itemId, present, quantityReceived, piecesPerUnitReceived, matched };
  });
}

function updateReceiveMatches() {
  if (!state.selectedDelivery) return;
  const results = collectReceivedItems();
  results.forEach((result, index) => {
    const box = $$("#receiveItems .match-result")[index];
    box.className = `match-result ${result.matched ? "matched" : "mismatch"}`;
    box.textContent = result.matched ? "✓ Item and quantity match" : "! Missing item or quantity mismatch";
  });
}

$("#receiveForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.selectedDelivery) return showToast("Select a Delivery ID first.", true);
  const form = event.currentTarget;
  const signature = $("#receiveSignature").signatureData();
  if (!signature) return showToast("Receiving person-in-charge signature is required.", true);
  const receivedItems = collectReceivedItems();
  const allMatched = receivedItems.every(item => item.matched);
  const data = Object.fromEntries(new FormData(form));
  if ((!allMatched || data.receiptCondition !== "Good") && !data.receivingRemarks.trim()) return showToast("Remarks are required for an incomplete or damaged delivery.", true);
  data.receivedItems = receivedItems;
  data.signature = signature;
  delete data.deliveryId;
  const button = form.querySelector("[type=submit]"); button.disabled = true; button.textContent = "Saving…";
  try {
    const result = await api(`/records/${encodeURIComponent(state.selectedDelivery.id)}`, { method: "PATCH", body: JSON.stringify(data) });
    showToast(`Delivery marked ${normalizedStatus(result.record.status).replaceAll("_", " ")}.`);
    form.reset(); state.selectedDelivery = null; $("#deliverySummary").className = "record-summary empty"; $("#deliverySummary").textContent = "Select an open Delivery ID to view all items."; $("#receiveItems").innerHTML = ""; $("#receiveSignature").clearSignature(); await loadOpenDeliveries();
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; button.textContent = "Confirm Item Check"; }
});

async function loadRecords() {
  $("#recordsBody").innerHTML = `<tr><td colspan="8" class="empty-cell">Loading records…</td></tr>`;
  try { state.records = await api("/records"); renderRecords(); }
  catch (error) { $("#recordsBody").innerHTML = `<tr><td colspan="8" class="empty-cell">${escapeHtml(error.message)}</td></tr>`; showToast(error.message, true); }
}

function recordSearchText(record) { return [record.id, record.direction, record.driverName, record.vehicleNumber, ...normalizedItems(record).flatMap(item => [item.batchNumber, item.size, item.description])].join(" ").toLowerCase(); }
function filteredRecords() { const term = $("#recordSearch").value.trim().toLowerCase(); const status = $("#statusFilter").value; return state.records.filter(record => (!term || recordSearchText(record).includes(term)) && (!status || normalizedStatus(record.status) === status)); }
function renderRecords() {
  const records = filteredRecords();
  $("#recordsBody").innerHTML = records.length ? records.map(record => `<tr><td>${escapeHtml(record.id)}</td><td>${escapeHtml(record.direction || "—")}</td><td>${normalizedItems(record).length}</td><td>${escapeHtml(record.driverName)}</td><td>${escapeHtml(record.vehicleNumber || "—")}</td><td>${formatDate(record.timeOut)}</td><td>${record.timeReceived || record.timeIn ? formatDate(record.timeReceived || record.timeIn) : "—"}</td><td class="status-cell ${normalizedStatus(record.status)}">${normalizedStatus(record.status).replaceAll("_", " ")}</td></tr>`).join("") : `<tr><td colspan="8" class="empty-cell">No matching records.</td></tr>`;
}
$("#refreshRecords").addEventListener("click", loadRecords);
$("#recordSearch").addEventListener("input", renderRecords);
$("#statusFilter").addEventListener("change", renderRecords);
$("#exportCsv").addEventListener("click", () => {
  if (!state.records.length) return showToast("Load the records before exporting.", true);
  const headings = ["Delivery ID","Direction","Driver","Vehicle","Released By","Dispatched","Received By","Received Time","Status","Item Type","Batch Number","Size","Description","Expected Quantity","Unit","Pieces Per Bag","Present","Received Quantity","Matched","Condition","Remarks"];
  const rows = [headings];
  filteredRecords().forEach(record => {
    const received = new Map((record.receivedItems || []).map(item => [item.itemId, item]));
    normalizedItems(record).forEach(item => { const check = received.get(item.itemId) || {}; rows.push([record.id,record.direction,record.driverName,record.vehicleNumber,record.releasedBy,record.timeOut,record.receivedBy,record.timeReceived || record.timeIn,normalizedStatus(record.status),item.type,item.batchNumber,item.size,item.description,item.quantity,item.unit,item.piecesPerUnit ?? "",check.present == null ? "" : check.present ? "Yes" : "No",check.quantityReceived ?? "",check.matched == null ? "" : check.matched ? "Yes" : "No",record.receiptCondition,record.receivingRemarks]); });
  });
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = `transfer-register-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
});

function formatDate(value) { return value ? new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
function escapeHtml(value = "") { return String(value).replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[character]); }
if (!config.apiUrl || !config.pin) setTimeout(() => $("#settingsDialog").showModal(), 350);
else loadDrafts();
