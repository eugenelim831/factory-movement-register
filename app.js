const state = { records: [], openDeliveries: [], selectedDelivery: null, drafts: [], editingDraftId: null, autoSaveTimer: null, autoSaveBusy: false, correctionRecord: null };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const config = {
  get apiUrl() { return localStorage.getItem("movementApiUrl") || ""; },
  get token() { return sessionStorage.getItem("movementSessionToken") || ""; },
  get user() { return sessionStorage.getItem("movementSessionUser") || ""; }
};

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show${error ? " error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.className = "toast", 4000);
}

function requireSettings() {
  if (config.apiUrl && config.token) return true;
  if (config.apiUrl && !config.token) { showLogin(); return false; }
  $("#settingsDialog").showModal();
  showToast("Enter the API address first.", true);
  return false;
}

async function api(path, options = {}) {
  if (!requireSettings()) throw new Error("Connection settings are missing.");
  const response = await fetch(`${config.apiUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.token}`, ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) { sessionStorage.removeItem("movementSessionToken"); sessionStorage.removeItem("movementSessionUser"); updateCurrentUser(); showLogin(); }
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

$("#settingsButton").addEventListener("click", () => { $("#apiUrl").value = config.apiUrl; $("#settingsDialog").showModal(); });
$("#saveSettings").addEventListener("click", event => { event.preventDefault(); localStorage.setItem("movementApiUrl", $("#apiUrl").value.trim()); $("#settingsDialog").close(); showToast("Settings saved."); showLogin(); });

function updateCurrentUser() { $("#currentUser").textContent = config.user ? `Signed in: ${config.user}` : "Not signed in"; }
function showLogin() {
  $("#loginApiUrl").value = config.apiUrl;
  if ($("#settingsDialog").open) $("#settingsDialog").close();
  if (!$("#loginDialog").open) $("#loginDialog").showModal();
}
$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("#loginButton"); button.disabled = true; button.textContent = "Logging in…";
  try {
    const apiUrl = $("#loginApiUrl").value.trim().replace(/\/$/, "");
    if (!/^https:\/\/[^\s]+$/i.test(apiUrl)) throw new Error("Enter the complete API address beginning with https://");
    localStorage.setItem("movementApiUrl", apiUrl);
    let response;
    try { response = await fetch(`${apiUrl}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: $("#loginName").value, pin: $("#loginPin").value }) }); }
    catch { throw new Error("Could not connect to the API. Check the Cloudflare Worker address and internet connection."); }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Login failed.");
    sessionStorage.setItem("movementSessionToken", body.token); sessionStorage.setItem("movementSessionUser", body.user);
    $("#loginPin").value = ""; $("#loginDialog").close(); updateCurrentUser(); showToast(`Logged in as ${body.user}.`); new URLSearchParams(location.search).get("delivery") ? switchView("receive") : loadDrafts();
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; button.textContent = "Log in"; }
});
$("#logoutButton").addEventListener("click", () => { sessionStorage.removeItem("movementSessionToken"); sessionStorage.removeItem("movementSessionUser"); updateCurrentUser(); showLogin(); });

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
  card.querySelector(".remove-item").addEventListener("click", () => { card.remove(); renumberItems(); scheduleAutoSave(); });
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

function pendingDispatchRequestId() {
  let id = sessionStorage.getItem("pendingDispatchRequestId");
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem("pendingDispatchRequestId", id); }
  return id;
}

function resetDispatchForm() {
  clearTimeout(state.autoSaveTimer);
  $("#dispatchForm").reset();
  $("#dispatchItems").innerHTML = "";
  addDispatchItem();
  $("#releaseSignature").clearSignature();
  state.editingDraftId = null;
  $("#draftId").value = "";
  $("#draftState").textContent = "You are preparing a new delivery.";
  $("#abandonDraft").disabled = true; $("#deleteDraft").disabled = true;
  updateOnBehalf();
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
  $("#draftState").textContent = `Editing saved draft ${record.id}. Changes will save automatically after you make edits.`;
  $("#abandonDraft").disabled = false; $("#deleteDraft").disabled = false;
  updateOnBehalf();
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

async function saveDraft(automatic = false) {
  if (automatic && (!state.editingDraftId || state.autoSaveBusy)) return;
  const form = $("#dispatchForm");
  const data = { ...dispatchHeaderData(form), items: collectDraftItems() };
  const button = $("#saveDraft");
  state.autoSaveBusy = true; button.disabled = true; button.textContent = automatic ? "Auto-saving…" : "Saving Draft…";
  try {
    const result = state.editingDraftId
      ? await api(`/drafts/${encodeURIComponent(state.editingDraftId)}`, { method: "PUT", body: JSON.stringify(data) })
      : await api("/drafts", { method: "POST", body: JSON.stringify(data) });
    state.editingDraftId = result.record.id;
    $("#draftState").textContent = `Draft ${result.record.id} saved at ${new Date().toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" })}. Future edits save automatically.`;
    $("#abandonDraft").disabled = false; $("#deleteDraft").disabled = false;
    await loadDrafts(result.record.id);
    if (!automatic) showToast(`Draft ${result.record.id} saved. Automatic saving is now active.`);
  } catch (error) { showToast(error.message, true); }
  finally { state.autoSaveBusy = false; button.disabled = false; button.textContent = "Save Draft"; }
}
$("#saveDraft").addEventListener("click", () => saveDraft(false));
function scheduleAutoSave() {
  if (!state.editingDraftId) return;
  clearTimeout(state.autoSaveTimer);
  $("#draftState").textContent = `Draft ${state.editingDraftId} has unsaved changes. Auto-saving shortly…`;
  state.autoSaveTimer = setTimeout(() => saveDraft(true), 15000);
}
$("#dispatchForm").addEventListener("input", scheduleAutoSave);
$("#dispatchForm").addEventListener("change", scheduleAutoSave);
$("#abandonDraft").addEventListener("click", async () => {
  if (!state.editingDraftId || !confirm(`Abandon draft ${state.editingDraftId}? It will remain in the audit record.`)) return;
  try { await api(`/drafts/${encodeURIComponent(state.editingDraftId)}/abandon`, { method: "POST", body: "{}" }); resetDispatchForm(); await loadDrafts(); showToast("Draft abandoned."); } catch (error) { showToast(error.message, true); }
});
$("#deleteDraft").addEventListener("click", async () => {
  if (!state.editingDraftId || !confirm(`Permanently delete draft ${state.editingDraftId}?`)) return;
  try { await api(`/drafts/${encodeURIComponent(state.editingDraftId)}`, { method: "DELETE" }); resetDispatchForm(); await loadDrafts(); showToast("Draft deleted."); } catch (error) { showToast(error.message, true); }
});

function updateOnBehalf() {
  const release = $("#dispatchForm").elements.releasedBy?.value;
  const receive = $("#receiveForm").elements.receivedBy?.value;
  $("#dispatchOnBehalf").classList.toggle("hidden", !release || release === config.user);
  $("#receiveOnBehalf").classList.toggle("hidden", !receive || receive === config.user);
  if (!release || release === config.user) $("#dispatchOnBehalfCheck").checked = false;
  if (!receive || receive === config.user) $("#receiveOnBehalfCheck").checked = false;
}
$("#dispatchForm").elements.releasedBy.addEventListener("change", updateOnBehalf);
$("#receiveForm").elements.receivedBy.addEventListener("change", updateOnBehalf);

$("#addItem").addEventListener("click", () => { addDispatchItem(); scheduleAutoSave(); });
addDispatchItem();

$("#dispatchForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const signature = $("#releaseSignature").signatureData();
  if (!signature) return showToast("Releasing person-in-charge signature is required.", true);
  let items;
  try { items = collectDispatchItems(); } catch (error) { return showToast(error.message, true); }
  const data = dispatchHeaderData(form);
  if (data.releasedBy !== config.user && !$("#dispatchOnBehalfCheck").checked) return showToast("Confirm that you are entering this dispatch on behalf of the selected PIC.", true);
  data.items = items;
  data.signature = signature;
  data.requestId = pendingDispatchRequestId();
  data.enteredOnBehalf = data.releasedBy !== config.user;
  const button = form.querySelector("[type=submit]");
  button.disabled = true; button.textContent = "Saving…";
  try {
    const result = state.editingDraftId
      ? await api(`/drafts/${encodeURIComponent(state.editingDraftId)}/dispatch`, { method: "POST", body: JSON.stringify(data) })
      : await api("/records", { method: "POST", body: JSON.stringify(data) });
    sessionStorage.removeItem("pendingDispatchRequestId"); showQr(result.record.id); resetDispatchForm(); await loadDrafts();
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
    const requested = new URLSearchParams(location.search).get("delivery");
    if (requested && state.openDeliveries.some(record => record.id === requested)) { select.value = requested; select.dispatchEvent(new Event("change")); history.replaceState({}, "", location.pathname); }
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
  const totals = cumulativeTotals(record);
  $("#receiveItems").innerHTML = normalizedItems(record).map((item, index) => {
    const priorQuantity = totals.get(item.itemId) || 0;
    const outstanding = Math.max(Number(item.quantity) - priorQuantity, 0);
    const complete = outstanding === 0;
    return `<article class="receive-card${complete ? " item-complete" : ""}" data-item-id="${escapeHtml(item.itemId)}" data-prior="${priorQuantity}">
      <div class="receive-card-title"><div><span>Item ${index + 1}</span><strong>${escapeHtml(item.description)}</strong></div><label class="present-check"><input class="item-present" type="checkbox" ${complete ? "checked disabled" : ""}> ${complete ? "Complete" : "Item present"}</label></div>
      <div class="expected-grid">
        <div><span>Type</span><strong>${item.type === "BATCH" ? "Tinplate batch" : "Component"}</strong></div>
        ${item.type === "BATCH" ? `<div><span>Batch</span><strong>${escapeHtml(item.batchNumber)}</strong></div><div><span>Size</span><strong>${escapeHtml(item.size)}</strong></div>` : ""}
        <div><span>Expected</span><strong>${item.quantity} ${escapeHtml(item.unit)}${item.piecesPerUnit ? ` × ${item.piecesPerUnit} pieces` : ""}</strong></div><div><span>Previously received</span><strong>${priorQuantity}</strong></div><div><span>Outstanding</span><strong>${outstanding}</strong></div>
      </div>
      <div class="form-grid check-fields">
        <label>Quantity received this time<input class="actual-quantity" type="number" min="0" step="0.01" value="${complete ? 0 : outstanding}" ${complete ? "readonly" : "required"}></label>
        ${item.piecesPerUnit ? `<label>Actual pieces per bag<input class="actual-per-unit" type="number" min="0" step="1" value="${item.piecesPerUnit}" ${complete ? "readonly" : "required"}></label>` : ""}
        <label>Discrepancy reason<select class="discrepancy-reason" ${complete ? "disabled" : ""}><option value="">Select when item is incomplete</option><option>Item missing</option><option>Quantity short</option><option>Quantity excess</option><option>Wrong item</option><option>Wrong batch/size</option><option>Damaged</option><option>Packaging broken</option><option>Other</option></select></label>
      </div>
      <div class="match-result" aria-live="polite"></div>
    </article>`;
  }).join("");
  $$("#receiveItems input, #receiveItems select").forEach(input => input.addEventListener("input", updateReceiveMatches));
  updateReceiveMatches();
}

function cumulativeTotals(record) {
  const totals = new Map();
  const attempts = record.receiptAttempts || [];
  if (attempts.length) attempts.forEach(attempt => (attempt.items || []).forEach(item => totals.set(item.itemId, (totals.get(item.itemId) || 0) + Number(item.quantityReceived || 0))));
  else (record.receivedItems || []).forEach(item => totals.set(item.itemId, Number(item.cumulativeQuantity ?? item.quantityReceived ?? 0)));
  return totals;
}

function collectReceivedItems() {
  const expected = normalizedItems(state.selectedDelivery);
  return $$("#receiveItems .receive-card").map(card => {
    const item = expected.find(value => value.itemId === card.dataset.itemId);
    const present = card.querySelector(".item-present").checked;
    const quantityReceived = Number(card.querySelector(".actual-quantity").value || 0);
    const piecesPerUnitReceived = card.querySelector(".actual-per-unit") ? Number(card.querySelector(".actual-per-unit").value || 0) : null;
    const priorQuantity = Number(card.dataset.prior || 0);
    const cumulativeQuantity = priorQuantity + quantityReceived;
    const matched = (present || priorQuantity >= Number(item.quantity)) && cumulativeQuantity === Number(item.quantity) && (item.piecesPerUnit == null || quantityReceived === 0 || piecesPerUnitReceived === Number(item.piecesPerUnit));
    return { itemId: item.itemId, present: present || priorQuantity >= Number(item.quantity), quantityReceived, piecesPerUnitReceived, priorQuantity, cumulativeQuantity, matched, discrepancyReason: card.querySelector(".discrepancy-reason")?.value || "" };
  });
}

function updateReceiveMatches() {
  if (!state.selectedDelivery) return;
  const results = collectReceivedItems();
  results.forEach((result, index) => {
    const box = $$("#receiveItems .match-result")[index];
    box.className = `match-result ${result.matched ? "matched" : "mismatch"}`;
    const expected = normalizedItems(state.selectedDelivery).find(item => item.itemId === result.itemId);
    box.textContent = result.matched ? "✓ Cumulative quantity complete" : result.cumulativeQuantity > Number(expected.quantity) ? `! Quantity exceeds expected by ${result.cumulativeQuantity - Number(expected.quantity)}` : `! ${Number(expected.quantity) - result.cumulativeQuantity} still outstanding`;
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
  if (data.receivedBy !== config.user && !$("#receiveOnBehalfCheck").checked) return showToast("Confirm that you are entering this receipt on behalf of the selected PIC.", true);
  if (receivedItems.some(item => !item.matched && !item.discrepancyReason)) return showToast("Select a discrepancy reason for every incomplete item.", true);
  if ((!allMatched || data.receiptCondition !== "Good") && !data.receivingRemarks.trim()) return showToast("Remarks are required for an incomplete or damaged delivery.", true);
  data.receivedItems = receivedItems;
  data.signature = signature;
  data.enteredOnBehalf = data.receivedBy !== config.user;
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
  $("#recordsBody").innerHTML = `<tr><td colspan="11" class="empty-cell">Loading records…</td></tr>`;
  try { state.records = await api("/records"); renderRecords(); }
  catch (error) { $("#recordsBody").innerHTML = `<tr><td colspan="11" class="empty-cell">${escapeHtml(error.message)}</td></tr>`; showToast(error.message, true); }
}

function recordSearchText(record) { return [record.id, record.direction, record.driverName, record.vehicleNumber, ...normalizedItems(record).flatMap(item => [item.batchNumber, item.size, item.description])].join(" ").toLowerCase(); }
function filteredRecords() { const term = $("#recordSearch").value.trim().toLowerCase(); const status = $("#statusFilter").value; return state.records.filter(record => (!term || recordSearchText(record).includes(term)) && (!status || normalizedStatus(record.status) === status)); }
function renderRecords() {
  const records = filteredRecords();
  $("#recordsBody").innerHTML = records.length ? records.map(record => `<tr><td>${escapeHtml(record.id)}</td><td>${escapeHtml(record.direction || "—")}</td><td>${normalizedItems(record).length}</td><td>${escapeHtml(record.driverName)}</td><td>${escapeHtml(record.vehicleNumber || "—")}</td><td>${escapeHtml(record.dispatchedBy || record.createdBy || "—")}</td><td>${escapeHtml(record.lastUpdatedBy || "—")}</td><td>${formatDate(record.timeOut)}</td><td>${record.timeReceived || record.timeIn ? formatDate(record.timeReceived || record.timeIn) : "—"}</td><td class="status-cell ${normalizedStatus(record.status)}">${normalizedStatus(record.status).replaceAll("_", " ")}</td><td><button class="secondary correct-record" data-id="${escapeHtml(record.id)}" type="button">Correct</button></td></tr>`).join("") : `<tr><td colspan="11" class="empty-cell">No matching records.</td></tr>`;
}
$("#recordsBody").addEventListener("click", event => { const button = event.target.closest(".correct-record"); if (button) openCorrection(state.records.find(record => record.id === button.dataset.id)); });

const deliveryCorrectionFields = ["direction","driverName","vehicleNumber","releasedBy","purpose","remarks"];
const itemCorrectionFields = ["batchNumber","size","description","quantity","unit","piecesPerUnit"];
function openCorrection(record) {
  state.correctionRecord = record;
  $("#correctionDeliveryId").value = record.id;
  $("#correctionTarget").innerHTML = `<option value="DELIVERY">Delivery details</option>` + normalizedItems(record).map((item, index) => `<option value="${escapeHtml(item.itemId)}">Item ${index + 1}: ${escapeHtml(item.description)}</option>`).join("");
  updateCorrectionFields(); $("#correctionReason").value = ""; $("#correctionDialog").showModal();
}
function updateCorrectionFields() {
  const fields = $("#correctionTarget").value === "DELIVERY" ? deliveryCorrectionFields : itemCorrectionFields;
  $("#correctionField").innerHTML = fields.map(field => `<option value="${field}">${field.replace(/([A-Z])/g, " $1")}</option>`).join("");
  updateCorrectionValueControl();
}
const correctionOptions = {
  direction: ["Store/Slitter → Power Press", "Power Press → Store/Slitter"],
  driverName: ["Maidin", "Deva", "Gopi"],
  vehicleNumber: ["WC 3268N", "WTL8236", "BMY3682"],
  releasedBy: ["Aung King", "Nadia", "Lina", "Lalit", "Yati"],
  unit: ["pieces", "blanks", "bags", "sets", "pallets", "sheets"]
};
function correctionCurrentValue() {
  const target = $("#correctionTarget").value;
  const source = target === "DELIVERY" ? state.correctionRecord : normalizedItems(state.correctionRecord).find(item => item.itemId === target);
  return source?.[$("#correctionField").value] ?? "";
}
function updateCorrectionValueControl() {
  const field = $("#correctionField").value;
  const current = correctionCurrentValue();
  let control;
  if (correctionOptions[field]) {
    control = document.createElement("select");
    correctionOptions[field].forEach(value => { const option = document.createElement("option"); option.value = value; option.textContent = value.charAt(0).toUpperCase() + value.slice(1); control.appendChild(option); });
    control.value = String(current);
  } else if (["quantity", "piecesPerUnit"].includes(field)) {
    control = document.createElement("input"); control.type = "number"; control.min = field === "piecesPerUnit" ? "1" : "0.01"; control.step = field === "piecesPerUnit" ? "1" : "0.01"; control.value = current;
  } else if (field === "batchNumber") {
    control = document.createElement("input"); control.type = "text"; control.inputMode = "text"; control.pattern = "[0-9]+/[0-9]+"; control.placeholder = "e.g. 1234/56"; control.value = current;
  } else if (field === "size") {
    control = document.createElement("input"); control.type = "text"; control.inputMode = "decimal"; control.pattern = "0\\.[0-9]+[*x×][0-9]+[*x×][0-9]+"; control.placeholder = "e.g. 0.23*950*740"; control.value = current;
  } else {
    control = document.createElement("input"); control.type = "text"; control.maxLength = 500; control.value = current;
  }
  control.id = "correctionValue"; control.required = true; $("#correctionValueControl").replaceChildren(control);
}
$("#correctionTarget").addEventListener("change", updateCorrectionFields);
$("#correctionField").addEventListener("change", updateCorrectionValueControl);
$("#closeCorrection").addEventListener("click", () => $("#correctionDialog").close());
$("#correctionForm").addEventListener("submit", async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector("[type=submit]"); button.disabled = true;
  try { await api(`/records/${encodeURIComponent($("#correctionDeliveryId").value)}/corrections`, { method: "POST", body: JSON.stringify({ target: $("#correctionTarget").value, field: $("#correctionField").value, value: $("#correctionValue").value, reason: $("#correctionReason").value.trim() }) }); $("#correctionDialog").close(); await loadRecords(); showToast("Correction saved with its audit history."); } catch (error) { showToast(error.message, true); } finally { button.disabled = false; }
});

function showQr(id) {
  const url = new URL(location.href); url.search = ""; url.hash = ""; url.searchParams.set("delivery", id);
  const qr = qrcode(0, "M"); qr.addData(url.toString()); qr.make();
  $("#qrDeliveryId").textContent = id; $("#qrCode").innerHTML = qr.createImgTag(6, 8); $("#qrDialog").showModal();
}
$("#closeQr").addEventListener("click", () => $("#qrDialog").close());
$("#printQr").addEventListener("click", () => window.print());
$("#refreshRecords").addEventListener("click", loadRecords);
$("#recordSearch").addEventListener("input", renderRecords);
$("#statusFilter").addEventListener("change", renderRecords);
$("#exportCsv").addEventListener("click", () => {
  if (!state.records.length) return showToast("Load the records before exporting.", true);
  const headings = ["Delivery ID","Direction","Driver","Vehicle","Logged-in Dispatch User","Released By PIC","Dispatched","Logged-in Receiving User","Received By PIC","Received Time","Status","Item Type","Batch Number","Size","Description","Expected Quantity","Unit","Pieces Per Bag","Present","Received Quantity","Matched","Condition","Remarks"];
  const rows = [headings];
  filteredRecords().forEach(record => {
    const received = new Map((record.receivedItems || []).map(item => [item.itemId, item]));
    normalizedItems(record).forEach(item => { const check = received.get(item.itemId) || {}; rows.push([record.id,record.direction,record.driverName,record.vehicleNumber,record.dispatchedBy || record.createdBy,record.releasedBy,record.timeOut,record.lastUpdatedBy,record.receivedBy,record.timeReceived || record.timeIn,normalizedStatus(record.status),item.type,item.batchNumber,item.size,item.description,item.quantity,item.unit,item.piecesPerUnit ?? "",check.present == null ? "" : check.present ? "Yes" : "No",check.quantityReceived ?? "",check.matched == null ? "" : check.matched ? "Yes" : "No",record.receiptCondition,record.receivingRemarks]); });
  });
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = `transfer-register-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
});

function formatDate(value) { return value ? new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
function escapeHtml(value = "") { return String(value).replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" })[character]); }
updateCurrentUser();
if (!config.apiUrl || !config.token) setTimeout(showLogin, 350);
else new URLSearchParams(location.search).get("delivery") ? switchView("receive") : loadDrafts();
