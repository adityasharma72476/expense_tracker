const state = {
  expenses: [],
  availableCategories: [],
  totalAmount: "0.00",
  filterCategory: "",
  sortNewest: true,
  isLoadingList: false,
  isSubmitting: false,
  listError: "",
  authStatus: null,
  formStatus: null,
  currentUser: readStoredUser(),
  pendingSubmission: null,
  latestListRequestId: 0
};

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR"
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium"
});

const authForm = document.querySelector("#authForm");
const userNameInput = document.querySelector("#userNameInput");
const currentUserLabel = document.querySelector("#currentUserLabel");
const authStatus = document.querySelector("#authStatus");
const switchUserButton = document.querySelector("#switchUserButton");
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

// Wire UI interactions to the main auth, list-loading, and submission flows.
authForm.addEventListener("submit", handleAuthSubmit);
switchUserButton.addEventListener("click", handleSwitchProfile);
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

// Prime the UI and restore the previously used simple profile if one exists.
async function initialize() {
  if (!dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  if (state.currentUser) {
    userNameInput.value = state.currentUser.name;
    persistAuthCookie(state.currentUser);
  }

  render();

  if (state.currentUser) {
    await activateCurrentUser();
  } else {
    showAuthStatus("warning", "Sign in with a simple name to keep your expenses separate.");
    render();
  }
}

// Save or restore the lightweight profile used to scope expenses per user.
async function handleAuthSubmit(event) {
  event.preventDefault();

  const normalizedName = normalizeUserName(userNameInput.value);

  if (!normalizedName) {
    showAuthStatus("error", "Your name is required.");
    render();
    return;
  }

  if (normalizedName.length > 50) {
    showAuthStatus("error", "Your name must be 50 characters or fewer.");
    render();
    return;
  }

  state.currentUser = {
    id: createUserId(normalizedName),
    name: normalizedName
  };
  persistCurrentUser(state.currentUser);
  persistAuthCookie(state.currentUser);
  await activateCurrentUser();
}

// Let someone switch to another lightweight profile on the same browser.
function handleSwitchProfile() {
  state.currentUser = null;
  state.pendingSubmission = null;
  state.expenses = [];
  state.availableCategories = [];
  state.totalAmount = "0.00";
  state.filterCategory = "";
  state.listError = "";
  state.formStatus = null;
  clearStoredUser();
  clearAuthCookie();
  userNameInput.value = "";
  showAuthStatus("warning", "Enter another name to view a different personal expense list.");
  render();
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

  if (!state.currentUser) {
    showAuthStatus("error", "Sign in before adding expenses.");
    render();
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
        "Idempotency-Key": pending.key,
        "X-User-Name": state.currentUser.name
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

// Fetch the current user's expense list from the API using the active filter and sort controls.
async function loadExpenses() {
  if (!state.currentUser) {
    state.expenses = [];
    state.availableCategories = [];
    state.totalAmount = "0.00";
    state.listError = "";
    state.isLoadingList = false;
    render();
    return;
  }

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
    const response = await fetch(endpoint, {
      headers: {
        "X-User-Name": state.currentUser.name
      }
    });
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
  const authLocked = !state.currentUser;

  submitButton.disabled = state.isSubmitting || authLocked;
  submitButton.textContent = state.isSubmitting ? "Saving..." : "Save expense";
  refreshButton.disabled = authLocked;
  categoryFilter.disabled = authLocked;
  sortNewestInput.disabled = authLocked;
  switchUserButton.classList.toggle("hidden", !state.currentUser);

  totalAmount.textContent = formatCurrency(state.totalAmount);
  expenseCount.textContent = String(state.expenses.length);

  renderCurrentUser();
  renderAuthStatus();
  renderFormStatus();
  renderListStatus();
  renderTable();
  renderCategoryFilter();
  renderCategorySuggestions();
  renderPendingBanner();
}

function renderCurrentUser() {
  if (!state.currentUser) {
    currentUserLabel.textContent = "Sign in with a name to start tracking your own expenses.";
    return;
  }

  currentUserLabel.textContent = `Signed in as ${state.currentUser.name}. Only this profile's expenses and totals are shown.`;
}

function renderAuthStatus() {
  if (!state.authStatus) {
    authStatus.className = "status hidden";
    authStatus.textContent = "";
    return;
  }

  authStatus.className = `status status-${state.authStatus.kind}`;
  authStatus.textContent = state.authStatus.message;
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
  if (!state.currentUser) {
    listStatus.className = "status status-warning";
    listStatus.textContent = "Sign in to load your personal expense list.";
    return;
  }

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
  if (!state.pendingSubmission || !state.currentUser) {
    pendingBanner.className = "status status-warning hidden";
    pendingMessage.textContent =
      "Retrying is safe because the request keeps the same idempotency key.";
    return;
  }

  pendingBanner.className = "status status-warning";
  pendingMessage.textContent = `Created ${formatTimestamp(
    state.pendingSubmission.createdAt
  )}. Retrying will not create duplicates for ${state.currentUser.name}.`;
}

function showAuthStatus(kind, message) {
  state.authStatus = { kind, message };
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

  if (!state.pendingSubmission && state.currentUser) {
    const newSubmission = {
      key: createIdempotencyKey(),
      payload,
      createdAt: new Date().toISOString(),
      userId: state.currentUser.id
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

// Persist unfinished submissions locally so a refresh can continue safely for the same profile.
function persistPendingSubmission(pendingSubmission) {
  state.pendingSubmission = pendingSubmission;

  if (!state.currentUser) {
    return;
  }

  try {
    localStorage.setItem(getPendingStorageKey(state.currentUser.id), JSON.stringify(pendingSubmission));
  } catch {
    // Local storage is a resilience enhancement, so failures should not block submission.
  }
}

// Clear the saved pending request once it has succeeded or been discarded.
function clearPendingSubmission() {
  const userId = state.currentUser?.id ?? state.pendingSubmission?.userId;
  state.pendingSubmission = null;

  if (!userId) {
    return;
  }

  try {
    localStorage.removeItem(getPendingStorageKey(userId));
  } catch {
    // Ignore storage cleanup failures and keep the in-memory state authoritative.
  }
}

// Restore a pending request from local storage during page load for the current profile only.
function readPendingSubmission(userId) {
  if (!userId) {
    return null;
  }

  try {
    const rawValue = localStorage.getItem(getPendingStorageKey(userId));

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);

    if (!parsedValue || typeof parsedValue !== "object") {
      return null;
    }

    if (
      !parsedValue.key ||
      !parsedValue.payload ||
      !parsedValue.createdAt ||
      parsedValue.userId !== userId
    ) {
      return null;
    }

    return parsedValue;
  } catch {
    return null;
  }
}

// Restore the last-used lightweight profile from local storage.
function readStoredUser() {
  try {
    const rawValue = localStorage.getItem("fenmo.currentUser");

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);

    if (!parsedValue || typeof parsedValue !== "object") {
      return null;
    }

    if (!parsedValue.id || !parsedValue.name) {
      return null;
    }

    return parsedValue;
  } catch {
    return null;
  }
}

function persistCurrentUser(currentUser) {
  try {
    localStorage.setItem("fenmo.currentUser", JSON.stringify(currentUser));
  } catch {
    // Ignore storage failures and keep the in-memory identity authoritative for this session.
  }
}

function clearStoredUser() {
  try {
    localStorage.removeItem("fenmo.currentUser");
  } catch {
    // Ignore storage cleanup failures and rely on the in-memory state.
  }
}

function persistAuthCookie(currentUser) {
  document.cookie = `fenmo_user_name=${encodeURIComponent(currentUser.name)}; path=/; max-age=31536000; samesite=lax`;
}

function clearAuthCookie() {
  document.cookie = "fenmo_user_name=; path=/; max-age=0; samesite=lax";
}

function getPendingStorageKey(userId) {
  return `fenmo.pendingExpense.${userId}`;
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

function normalizeUserName(rawValue) {
  return rawValue.trim().replace(/\s+/g, " ");
}

function createUserId(userName) {
  return userName.toLocaleLowerCase();
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

async function activateCurrentUser() {
  if (!state.currentUser) {
    return;
  }

  state.expenses = [];
  state.availableCategories = [];
  state.totalAmount = "0.00";
  state.filterCategory = "";
  state.listError = "";
  state.formStatus = null;
  state.pendingSubmission = readPendingSubmission(state.currentUser.id);
  showAuthStatus("success", `Signed in as ${state.currentUser.name}.`);
  render();
  await loadExpenses();

  if (state.pendingSubmission) {
    showFormStatus(
      "warning",
      "An unfinished submission was found for this profile. Retrying it safely now."
    );
    await submitExpense({ reusePending: true });
  }
}
