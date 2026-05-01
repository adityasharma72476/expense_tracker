const state = {
  expenses: [],
  availableCategories: [],
  totalAmount: "0.00",
  filterCategory: "",
  sortNewest: true,
  isLoadingList: false,
  isSubmitting: false,
  listError: "",
  formStatus: null,
  pendingSubmission: readPendingSubmission(),
  latestListRequestId: 0
};

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR"
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium"
});

const amountInput = document.querySelector("#amountInput");
const categoryInput = document.querySelector("#categoryInput");
const dateInput = document.querySelector("#dateInput");
const descriptionInput = document.querySelector("#descriptionInput");
const form = document.querySelector("#expenseForm");
const formStatus = document.querySelector("#formStatus");
const submitButton = document.querySelector("#submitButton");
const totalAmount = document.querySelector("#totalAmount");
const expenseCount = document.querySelector("#expenseCount");
const listStatus = document.querySelector("#listStatus");
const categoryFilter = document.querySelector("#categoryFilter");
const sortNewestInput = document.querySelector("#sortNewestInput");
const expenseTableBody = document.querySelector("#expenseTableBody");
const categorySuggestions = document.querySelector("#categorySuggestions");
const refreshButton = document.querySelector("#refreshButton");
const pendingBanner = document.querySelector("#pendingBanner");
const pendingMessage = document.querySelector("#pendingMessage");
const retryPendingButton = document.querySelector("#retryPendingButton");
const discardPendingButton = document.querySelector("#discardPendingButton");

// Wire UI interactions to the main data-loading and submission flows.
form.addEventListener("submit", handleSubmit);
categoryFilter.addEventListener("change", async () => {
  state.filterCategory = categoryFilter.value;
  await loadExpenses();
});
sortNewestInput.addEventListener("change", async () => {
  state.sortNewest = sortNewestInput.checked;
  await loadExpenses();
});
refreshButton.addEventListener("click", async () => {
  await loadExpenses();
});
retryPendingButton.addEventListener("click", async () => {
  await submitExpense({ reusePending: true });
});
discardPendingButton.addEventListener("click", () => {
  clearPendingSubmission();
  showFormStatus("success", "The unfinished request was discarded locally.");
  render();
});

initialize();

// Prime the UI, load the first list, and safely resume any interrupted submission.
async function initialize() {
  if (!dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  render();
  await loadExpenses();

  if (state.pendingSubmission) {
    showFormStatus("warning", "An unfinished submission was found. Retrying it safely now.");
    await submitExpense({ reusePending: true });
  }
}

// Funnel every form submit through the same retry-safe creation flow.
async function handleSubmit(event) {
  event.preventDefault();
  await submitExpense();
}

// Create a new expense or replay a pending one while preserving its idempotency key.
async function submitExpense({ reusePending = false } = {}) {
  if (state.isSubmitting) {
    return;
  }

  const payload = reusePending && state.pendingSubmission
    ? state.pendingSubmission.payload
    : readFormPayload();

  const clientValidationError = validatePayload(payload);

  if (clientValidationError) {
    showFormStatus("error", clientValidationError);
    return;
  }

  const pending = resolvePendingSubmission(payload, reusePending);

  if (!pending) {
    showFormStatus(
      "warning",
      "Finish or discard the unfinished submission before creating a different expense."
    );
    return;
  }

  state.isSubmitting = true;
  showFormStatus("warning", "Saving expense...");
  render();

  try {
    const response = await fetch("/expenses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": pending.key
      },
      body: JSON.stringify(pending.payload)
    });

    const result = await readJson(response);

    if (!response.ok) {
      const error = new Error(result.error || "Unable to save the expense.");
      error.status = response.status;
      throw error;
    }

    clearPendingSubmission();
    form.reset();
    dateInput.value = new Date().toISOString().slice(0, 10);
    showFormStatus(
      "success",
      result.replayed
        ? "The original expense was already recorded, so the retry safely reused it."
        : "Expense saved successfully."
    );
    await loadExpenses();
  } catch (error) {
    if (error.status && error.status < 500) {
      clearPendingSubmission();
    }

    showFormStatus("error", error.message || "Unable to save the expense.");
  } finally {
    state.isSubmitting = false;
    render();
  }
}

// Fetch the current list from the API using the active filter and sort controls.
async function loadExpenses() {
  const requestId = ++state.latestListRequestId;
  state.isLoadingList = true;
  state.listError = "";
  render();

  const query = new URLSearchParams();

  if (state.filterCategory) {
    query.set("category", state.filterCategory);
  }

  if (state.sortNewest) {
    query.set("sort", "date_desc");
  }

  try {
    const endpoint = query.toString() ? `/expenses?${query}` : "/expenses";
    const response = await fetch(endpoint);
    const result = await readJson(response);

    if (requestId !== state.latestListRequestId) {
      return;
    }

    if (!response.ok) {
      throw new Error(result.error || "Unable to load expenses.");
    }

    state.expenses = Array.isArray(result.expenses) ? result.expenses : [];
    state.availableCategories = Array.isArray(result.available_categories)
      ? result.available_categories
      : [];
    state.totalAmount = result.total_amount || "0.00";
    state.listError = "";
  } catch (error) {
    if (requestId !== state.latestListRequestId) {
      return;
    }

    state.listError = error.message || "Unable to load expenses.";
  } finally {
    if (requestId === state.latestListRequestId) {
      state.isLoadingList = false;
      render();
    }
  }
}

// Redraw all UI pieces from the current client-side state.
function render() {
  submitButton.disabled = state.isSubmitting;
  submitButton.textContent = state.isSubmitting ? "Saving..." : "Save expense";

  totalAmount.textContent = formatCurrency(state.totalAmount);
  expenseCount.textContent = String(state.expenses.length);

  renderFormStatus();
  renderListStatus();
  renderTable();
  renderCategoryFilter();
  renderCategorySuggestions();
  renderPendingBanner();
}

function renderFormStatus() {
  if (!state.formStatus) {
    formStatus.className = "status hidden";
    formStatus.textContent = "";
    return;
  }

  formStatus.className = `status status-${state.formStatus.kind}`;
  formStatus.textContent = state.formStatus.message;
}

function renderListStatus() {
  if (state.listError) {
    listStatus.className = "status status-error";
    listStatus.textContent = state.listError;
    return;
  }

  if (state.isLoadingList) {
    listStatus.className = "status status-warning";
    listStatus.textContent = "Loading expenses...";
    return;
  }

  listStatus.className = "status hidden";
  listStatus.textContent = "";
}

function renderTable() {
  if (!state.expenses.length) {
    expenseTableBody.innerHTML =
      '<tr><td colspan="4" class="empty-row">No expenses match the current view.</td></tr>';
    return;
  }

  expenseTableBody.innerHTML = state.expenses
    .map(
      (expense) => `
        <tr>
          <td>
            ${escapeHtml(formatDate(expense.date))}
            <span class="meta-line">Saved ${escapeHtml(formatTimestamp(expense.created_at))}</span>
          </td>
          <td>${escapeHtml(expense.category)}</td>
          <td>${escapeHtml(expense.description)}</td>
          <td class="amount-cell">${escapeHtml(formatCurrency(expense.amount))}</td>
        </tr>
      `
    )
    .join("");
}

function renderCategoryFilter() {
  const previousValue = categoryFilter.value;
  const options = ['<option value="">All categories</option>']
    .concat(
      state.availableCategories.map(
        (category) =>
          `<option value="${escapeAttribute(category)}">${escapeHtml(category)}</option>`
      )
    )
    .join("");

  categoryFilter.innerHTML = options;

  const nextValue = state.availableCategories.includes(state.filterCategory)
    ? state.filterCategory
    : "";

  state.filterCategory = nextValue;
  categoryFilter.value = nextValue || previousValue;

  if (categoryFilter.value !== state.filterCategory) {
    categoryFilter.value = state.filterCategory;
  }
}

function renderCategorySuggestions() {
  categorySuggestions.innerHTML = state.availableCategories
    .map((category) => `<option value="${escapeAttribute(category)}"></option>`)
    .join("");
}

function renderPendingBanner() {
  if (!state.pendingSubmission) {
    pendingBanner.className = "status status-warning hidden";
    pendingMessage.textContent =
      "Retrying is safe because the request keeps the same idempotency key.";
    return;
  }

  pendingBanner.className = "status status-warning";
  pendingMessage.textContent = `Created ${formatTimestamp(
    state.pendingSubmission.createdAt
  )}. Retrying will not create duplicates.`;
}

function showFormStatus(kind, message) {
  state.formStatus = { kind, message };
  renderFormStatus();
}

function readFormPayload() {
  return {
    amount: amountInput.value.trim(),
    category: categoryInput.value.trim(),
    description: descriptionInput.value.trim(),
    date: dateInput.value
  };
}

// Reuse an existing pending request when possible so retries stay duplicate-safe.
function resolvePendingSubmission(payload, reusePending) {
  if (reusePending && state.pendingSubmission) {
    return state.pendingSubmission;
  }

  if (!state.pendingSubmission) {
    const newSubmission = {
      key: createIdempotencyKey(),
      payload,
      createdAt: new Date().toISOString()
    };

    persistPendingSubmission(newSubmission);
    return newSubmission;
  }

  if (samePayload(state.pendingSubmission.payload, payload)) {
    return state.pendingSubmission;
  }

  return null;
}

// Catch obvious input issues in the browser before making the API request.
function validatePayload(payload) {
  if (!payload.amount) {
    return "Amount is required.";
  }

  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(payload.amount) || Number(payload.amount) <= 0) {
    return "Amount must be greater than 0 and use at most 2 decimal places.";
  }

  if (!payload.category) {
    return "Category is required.";
  }

  if (!payload.description) {
    return "Description is required.";
  }

  if (!payload.date) {
    return "Date is required.";
  }

  return null;
}

// Persist unfinished submissions locally so a refresh can continue safely.
function persistPendingSubmission(pendingSubmission) {
  state.pendingSubmission = pendingSubmission;

  try {
    localStorage.setItem("fenmo.pendingExpense", JSON.stringify(pendingSubmission));
  } catch {
    // Local storage is a resilience enhancement, so failures should not block submission.
  }
}

// Clear the saved pending request once it has succeeded or been discarded.
function clearPendingSubmission() {
  state.pendingSubmission = null;

  try {
    localStorage.removeItem("fenmo.pendingExpense");
  } catch {
    // Ignore storage cleanup failures and keep the in-memory state authoritative.
  }
}

// Restore a pending request from local storage during page load.
function readPendingSubmission() {
  try {
    const rawValue = localStorage.getItem("fenmo.pendingExpense");

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);

    if (!parsedValue || typeof parsedValue !== "object") {
      return null;
    }

    if (!parsedValue.key || !parsedValue.payload || !parsedValue.createdAt) {
      return null;
    }

    return parsedValue;
  } catch {
    return null;
  }
}

// Generate a client-side key that the server can use to deduplicate safe retries.
function createIdempotencyKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `fallback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function samePayload(left, right) {
  return (
    left.amount === right.amount &&
    left.category === right.category &&
    left.description === right.description &&
    left.date === right.date
  );
}

function formatCurrency(amount) {
  return currencyFormatter.format(Number(amount));
}

function formatDate(dateValue) {
  return dateFormatter.format(new Date(`${dateValue}T00:00:00`));
}

function formatTimestamp(timestamp) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
