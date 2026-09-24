// ====================================================================
// Luxury@fingertips — order form
// ====================================================================

// Your Apps Script Web App URL.
// Apps Script > Deploy > Manage deployments > your deployment > Web app URL > Copy.
// Paste it between the quotes. It must end in /exec.
// Later updates: edit THIS deployment (pencil > New version) so the URL never changes.
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyPUoivNL9mRKbG4e0YdJ6OXH5SQhFN6db9ivsdN7-sPWLrpVN8kdpKA0zRdrjR0-Xwyw/exec";

// WhatsApp number in international format, digits only.
const WHATSAPP_NUMBER = "918623976355";

const MAX_FILE_BYTES = 4 * 1024 * 1024;               // 4 MB
const ALLOWED_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
const ALLOWED_FILE_EXT = /\.(jpe?g|png|webp|heic|heif|pdf)$/i;

// Customers switch to Instagram/WhatsApp mid-form. Their typing is kept
// on their own phone so it's still there when they come back.
const DRAFT_KEY = "lf-order-draft-v1";
const DRAFT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;     // 3 days
const DRAFT_FIELDS = [
  "firstName", "lastName", "address", "postalCode", "city", "state",
  "phone", "email", "price", "advance", "paymentMode", "orderDate"
];

// --------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const form        = $("orderForm");
const submitBtn   = $("submitBtn");
const formMessage = $("formMessage");
const pinInput    = $("postalCode");
const pinMessage  = $("pinMessage");
const cityInput   = $("city");
const stateSelect = $("state");
const phoneInput  = $("phone");
const priceInput  = $("price");
const advInput    = $("advance");
const balanceMsg  = $("balanceMessage");
const fileInput   = $("photo");
const fileMsg     = $("fileMessage");
const draftNote   = $("draftNote");
const doneBox     = $("orderDone");

const PIN_HINT  = pinMessage.textContent;
const FILE_HINT = fileMsg.textContent;

$("year").textContent = new Date().getFullYear();

function setHint(el, text, tone) {
  el.textContent = text;
  el.classList.toggle("is-error", tone === "error");
  el.classList.toggle("is-ok", tone === "ok");
}

function showFormMessage(text, tone) {
  formMessage.textContent = text;
  formMessage.classList.toggle("is-busy", tone === "busy");
  formMessage.hidden = !text;
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function rupees(n) {
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// --------------------------------------------------------------------
// Draft: save while typing, restore on return
// --------------------------------------------------------------------
let draftTimer = null;

function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try {
      const values = {};
      let hasContent = false;
      DRAFT_FIELDS.forEach((id) => {
        values[id] = $(id).value;
        if (id !== "orderDate" && values[id]) hasContent = true;
      });
      if (hasContent) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), values }));
      }
    } catch (_) { /* storage blocked (private mode): nothing to do */ }
  }, 400);
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    if (!draft || !draft.values || Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(DRAFT_KEY);
      return false;
    }
    DRAFT_FIELDS.forEach((id) => {
      if (draft.values[id]) $(id).value = draft.values[id];
    });
    return true;
  } catch (_) {
    return false;
  }
}

function clearDraft() {
  clearTimeout(draftTimer);
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
}

function resetForm() {
  form.reset();
  form.classList.remove("was-validated");
  $("country").value = "India";
  $("orderDate").value = todayISO();
  setHint(pinMessage, PIN_HINT);
  setHint(fileMsg, FILE_HINT);
  updateBalance();
  showFormMessage("");
  draftNote.hidden = true;
  clearDraft();
}

form.addEventListener("input", saveDraft);
form.addEventListener("change", saveDraft);

$("clearDraftBtn").addEventListener("click", () => { resetForm(); $("firstName").focus(); });
$("clearBtn").addEventListener("click", () => {
  if (confirm("Clear everything you've entered?")) { resetForm(); $("firstName").focus(); }
});

// --------------------------------------------------------------------
// PIN code → city and state (free public API, no key)
// --------------------------------------------------------------------
let lastPinLooked = "";

function normaliseState(name) {
  return String(name || "").toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ").trim();
}

function selectState(apiName) {
  const target = normaliseState(apiName);
  for (const opt of stateSelect.options) {
    if (opt.value && normaliseState(opt.value) === target) {
      stateSelect.value = opt.value;
      return true;
    }
  }
  return false;
}

async function lookupPin(pin) {
  lastPinLooked = pin;
  setHint(pinMessage, "Looking up PIN code…");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch("https://api.postalpincode.in/pincode/" + pin, { signal: controller.signal });
    const data = await res.json();
    if (pin !== pinInput.value.trim()) return;   // they changed the PIN meanwhile

    const result = data && data[0];
    const office = result && result.Status === "Success" && result.PostOffice && result.PostOffice[0];
    if (!office) {
      setHint(pinMessage, "We couldn't find this PIN code. Check it, or enter city and state yourself.", "error");
      return;
    }

    cityInput.value = office.District || "";
    const stateFound = selectState(office.State);
    setHint(pinMessage,
      stateFound ? "City and state filled in. Please check them." : "City filled in. Please select your state.",
      "ok");
    saveDraft();
  } catch (_) {
    if (pin === pinInput.value.trim()) {
      setHint(pinMessage, "PIN lookup isn't responding. Enter city and state yourself.", "error");
    }
  } finally {
    clearTimeout(timer);
  }
}

pinInput.addEventListener("input", () => {
  pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 6);
  const pin = pinInput.value;
  if (pin.length === 6 && pin !== lastPinLooked) lookupPin(pin);
  if (pin.length < 6) { lastPinLooked = ""; setHint(pinMessage, PIN_HINT); }
});

// --------------------------------------------------------------------
// Phone: accept +91 / leading 0 / spaces, keep 10 digits
// --------------------------------------------------------------------
phoneInput.addEventListener("input", () => {
  let d = phoneInput.value.replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("91")) d = d.slice(2);
  if (d.length > 10 && d.startsWith("0")) d = d.slice(1);
  phoneInput.value = d.slice(0, 10);
});

// --------------------------------------------------------------------
// Price / advance: show the balance, block advance > price
// --------------------------------------------------------------------
function updateBalance() {
  const price = parseFloat(priceInput.value);
  const adv = parseFloat(advInput.value);
  advInput.setCustomValidity("");

  if (isNaN(price) || isNaN(adv)) { setHint(balanceMsg, ""); return; }

  if (adv > price) {
    advInput.setCustomValidity("Advance can't be more than the price.");
    setHint(balanceMsg, "Advance can't be more than the price.", "error");
    return;
  }
  const balance = price - adv;
  setHint(balanceMsg, balance === 0 ? "Paid in full." : "Balance due: " + rupees(balance));
}
priceInput.addEventListener("input", updateBalance);
advInput.addEventListener("input", updateBalance);

// --------------------------------------------------------------------
// File (optional)
// --------------------------------------------------------------------
function fileProblem(file) {
  if (!file) return "";
  const typeOk = ALLOWED_FILE_TYPES.includes(file.type) || ALLOWED_FILE_EXT.test(file.name);
  if (!typeOk) return "Please choose a JPG, PNG or PDF file.";
  if (file.size > MAX_FILE_BYTES) return "This file is " + (file.size / 1048576).toFixed(1) + " MB. Please use one under 4 MB.";
  return "";
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  const problem = fileProblem(file);
  if (problem) {
    fileInput.value = "";
    setHint(fileMsg, problem, "error");
  } else if (file) {
    setHint(fileMsg, "Attached: " + file.name, "ok");
  } else {
    setHint(fileMsg, FILE_HINT);
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("We couldn't read the attached file. Try attaching it again."));
    reader.readAsDataURL(file);
  });
}

// --------------------------------------------------------------------
// Submit
// --------------------------------------------------------------------
function buildWhatsAppLink(p) {
  const lines = [
    "Hi Luxury@fingertips, I've just placed an order on your website.",
    "",
    "Name: " + p.firstName + " " + p.lastName,
    "Mobile: " + p.phone,
    "Price: " + rupees(p.price),
    "Advance paid: " + rupees(p.advance) + " (" + p.paymentMode + ")",
    "Order date: " + p.orderDate
  ];
  return "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(lines.join("\n"));
}

function showDone(payload) {
  $("doneText").textContent =
    "Thank you, " + payload.firstName + ". We've received your order and will confirm it on WhatsApp. " +
    "Send us your order details now so we can match your payment faster.";
  $("doneWhatsApp").href = buildWhatsAppLink(payload);
  form.hidden = true;
  draftNote.hidden = true;
  doneBox.hidden = false;
  doneBox.focus();
  doneBox.scrollIntoView({ block: "center" });
}

$("newOrderBtn").addEventListener("click", () => {
  resetForm();
  doneBox.hidden = true;
  form.hidden = false;
  $("firstName").focus();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  updateBalance();

  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(WEB_APP_URL)) {
    showFormMessage("Orders can't be sent yet: the site owner needs to add the Web App URL in script.js. Please message us on WhatsApp.");
    return;
  }

  if (!form.checkValidity()) {
    form.classList.add("was-validated");
    showFormMessage("Please fill in the highlighted fields.");
    const firstBad = form.querySelector("input:invalid, select:invalid");
    if (firstBad) { firstBad.focus(); firstBad.reportValidity(); }
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Placing order…";
  showFormMessage("Sending your order. This can take a few seconds with an attachment.", "busy");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const file = fileInput.files[0];
    const problem = fileProblem(file);
    if (problem) throw new Error(problem);
    const fileBase64 = await fileToBase64(file);

    const payload = {
      firstName:   $("firstName").value.trim(),
      lastName:    $("lastName").value.trim(),
      address:     $("address").value.trim(),
      postalCode:  pinInput.value.trim(),
      city:        cityInput.value.trim(),
      state:       stateSelect.value,
      country:     $("country").value.trim() || "India",
      phone:       phoneInput.value.trim(),
      email:       $("email").value.trim(),
      price:       priceInput.value,
      advance:     advInput.value,
      paymentMode: $("paymentMode").value,
      orderDate:   $("orderDate").value,
      photoBase64: fileBase64,
      photoName:   file ? file.name : "",
      photoType:   file ? file.type : "",
      website:     $("website").value          // spam trap, should be empty
    };

    // text/plain avoids a CORS preflight, which Apps Script can't answer.
    const response = await fetch(WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const raw = await response.text();
    let result;
    try { result = JSON.parse(raw); }
    catch (_) { throw new Error("The order system sent an unexpected reply. Please message us on WhatsApp to place your order."); }

    if (result.status !== "success") throw new Error(result.message || "Your order wasn't saved. Please try again.");

    clearDraft();
    showFormMessage("");
    showDone(payload);
  } catch (err) {
    const msg = err.name === "AbortError"
      ? "No reply from the order system. Check your internet connection and try again."
      : err.message;
    showFormMessage(msg);
  } finally {
    clearTimeout(timer);
    submitBtn.disabled = false;
    submitBtn.textContent = "Place order";
  }
});

// --------------------------------------------------------------------
// Start
// --------------------------------------------------------------------
if (restoreDraft()) {
  draftNote.hidden = false;
  if (/^\d{6}$/.test(pinInput.value)) lastPinLooked = pinInput.value;
}
if (!$("orderDate").value) $("orderDate").value = todayISO();
updateBalance();
