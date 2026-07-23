// ====================================================================
// STEP A (required): Paste your Google Apps Script Web App URL below.
// You get this after deploying Code.gs — see README.md for the steps.
// It looks like: https://script.google.com/macros/s/AKfycb.../exec
// ====================================================================
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwvGBpotHl0pIAUXQbBa4w_lPth3BJaf2gZN1oG0tqZqKBBk25JcODH8L1PIAZChsA-zQ/exec";

// Hard cap on uploaded photo size (bytes) before it's even sent — keeps a
// single bad upload from bloating the request or your Drive storage.
const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // 4 MB

document.getElementById("year").textContent = new Date().getFullYear();

const form = document.getElementById("orderForm");
const submitBtn = document.getElementById("submitBtn");
const messageBox = document.getElementById("formMessage");

function setMessage(text, type) {
  messageBox.textContent = text;
  messageBox.className = "form-message " + (type || "");
}

// --------------------------------------------------------------------
// PIN code lookup — fills in City, State and Country from a 6-digit
// Indian PIN. This is a free, public, no-API-key endpoint. If it's down
// or the PIN isn't found, the person just types City and State in
// manually, so nothing here blocks submission.
// --------------------------------------------------------------------
const postalInput = document.getElementById("postalCode");
const cityInput = document.getElementById("city");
const stateSelect = document.getElementById("state");
const countryInput = document.getElementById("country");
const pinMessage = document.getElementById("pinMessage");

function setPinMessage(text, type) {
  pinMessage.textContent = text;
  pinMessage.className = "field-message " + (type || "");
}

// Selects the <option> in the State dropdown matching the API's state
// name, ignoring case (the API returns different casing than our list).
function selectMatchingState(apiStateName) {
  if (!apiStateName) return;
  const target = apiStateName.trim().toLowerCase();
  for (const opt of stateSelect.options) {
    if (opt.value.toLowerCase() === target) {
      stateSelect.value = opt.value;
      return;
    }
  }
}

async function lookupPincode(pin) {
  setPinMessage("Looking up PIN code...", "");
  try {
    const res = await fetch("https://api.postalpincode.in/pincode/" + encodeURIComponent(pin));
    const data = await res.json();
    const result = data && data[0];

    if (!result || result.Status !== "Success" || !result.PostOffice || result.PostOffice.length === 0) {
      setPinMessage("Couldn't find that PIN code — please fill City and State in yourself.", "error");
      return;
    }

    const first = result.PostOffice[0];
    cityInput.value = first.District || "";
    countryInput.value = first.Country || "India";
    selectMatchingState(first.State);
    setPinMessage("City, State and Country filled in — please check they're correct.", "success");
  } catch (err) {
    setPinMessage("Couldn't reach the PIN lookup service — please fill City and State in yourself.", "error");
  }
}

postalInput.addEventListener("blur", () => {
  const pin = postalInput.value.trim();
  if (/^[0-9]{6}$/.test(pin)) {
    lookupPincode(pin);
  }
});

// --------------------------------------------------------------------
// File upload (optional)
// --------------------------------------------------------------------

// Converts an uploaded file into a base64 string so it can be sent as
// plain JSON (Apps Script decodes it on the other end and saves it to Drive).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      reject(new Error("That file is too large. Please use a file under 4 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // result looks like "data:image/png;base64,AAAA..." — strip the prefix
      const base64 = reader.result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

form.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (WEB_APP_URL.includes("PASTE_YOUR")) {
    setMessage("Setup incomplete: add your Apps Script Web App URL in script.js first.", "error");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting...";
  setMessage("Submitting your order, please wait...", "loading");

  try {
    const photoFile = document.getElementById("photo").files[0];
    const photoBase64 = await fileToBase64(photoFile);

    const payload = {
      firstName: document.getElementById("firstName").value.trim(),
      lastName: document.getElementById("lastName").value.trim(),
      address: document.getElementById("address").value.trim(),
      postalCode: document.getElementById("postalCode").value.trim(),
      city: document.getElementById("city").value.trim(),
      state: document.getElementById("state").value,
      country: document.getElementById("country").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      email: document.getElementById("email").value.trim(),
      price: document.getElementById("price").value,
      advance: document.getElementById("advance").value,
      paymentMode: document.getElementById("paymentMode").value,
      orderDate: document.getElementById("orderDate").value,
      photoBase64: photoBase64,
      photoName: photoFile ? photoFile.name : "",
      photoType: photoFile ? photoFile.type : "",
      submittedAt: new Date().toISOString()
    };

    // Content-Type "text/plain" avoids a CORS preflight request, which
    // Apps Script Web Apps do not handle. Code.gs still parses this as JSON.
    const response = await fetch(WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (result.status === "success") {
      setMessage("Order confirmed — we've received your details.", "success");
      form.reset();
      countryInput.value = "India";
    } else {
      throw new Error(result.message || "Unknown error from server.");
    }
  } catch (err) {
    console.error(err);
    setMessage("Something went wrong: " + err.message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Confirm Order";
  }
});
