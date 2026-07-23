/**
 * LUXURY@FINGERTIPS — ORDER FORM BACKEND
 * -----------------------------------------------------------------
 * This is a standalone backend for the Luxury@fingertips order form.
 * It is unrelated to any other Apps Script project you may have —
 * deploy it against a fresh Google Sheet.
 *
 * SETUP (one-time):
 * 1. Create a new Google Sheet (or open one dedicated to this project).
 * 2. Extensions > Apps Script.
 * 3. Delete any placeholder code and paste this entire file in.
 * 4. Update DRIVE_FOLDER_ID and NOTIFY_EMAIL below if you want them.
 * 5. Click Deploy > New deployment > Type: Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 6. Copy the Web App URL it gives you and paste it into script.js
 *    as the value of WEB_APP_URL.
 * 7. The FIRST time you deploy, Google will ask you to authorize
 *    permissions (Sheet + Drive + Email access) — approve it.
 * -----------------------------------------------------------------
 */

// Optional: paste a Google Drive folder ID here to store uploaded photos.
// Leave blank ("") to store photos in the root of your Drive instead.
const DRIVE_FOLDER_ID = "";

// Where should new-order email alerts be sent? Leave blank ("") to disable.
const NOTIFY_EMAIL = "";

const SHEET_NAME = "Orders"; // the tab name inside your Google Sheet

// Fields that MUST be present and non-empty for an order to be accepted.
const REQUIRED_FIELDS = [
  "firstName", "lastName", "address", "postalCode", "city", "state", "country",
  "phone", "email", "price", "advance", "paymentMode", "orderDate"
];

const MAX_PHOTO_BASE64_CHARS = 6 * 1024 * 1024; // ~4.5 MB of actual file data

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000); // avoid two submissions writing at the same time

  try {
    const data = JSON.parse(e.postData.contents);

    const validationError = validateOrder_(data);
    if (validationError) {
      return jsonResponse_({ status: "error", message: validationError });
    }

    const sheet = getOrCreateSheet_();
    const fullName = (data.firstName + " " + data.lastName).trim();

    let photoUrl = "";
    if (data.photoBase64) {
      photoUrl = saveFileToDrive_(data.photoBase64, data.photoName || "upload", data.photoType, fullName);
    }

    sheet.appendRow([
      new Date(),               // Timestamp
      data.firstName,
      data.lastName,
      data.address,
      data.postalCode,
      data.city,
      data.state,
      data.country,
      data.phone,
      data.email,
      data.price,
      data.advance,
      data.paymentMode,
      data.orderDate,
      photoUrl,
      "New"                     // Order status column, editable manually later
    ]);

    if (NOTIFY_EMAIL) {
      sendNotification_(data, fullName, photoUrl);
    }

    return jsonResponse_({ status: "success", message: "Order saved." });

  } catch (err) {
    return jsonResponse_({ status: "error", message: err.message });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Returns a human-readable error string if the order is invalid,
 * or null if it passes all checks.
 */
function validateOrder_(data) {
  if (!data || typeof data !== "object") {
    return "Malformed submission.";
  }

  for (const field of REQUIRED_FIELDS) {
    const value = data[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      return "Missing required field: " + field;
    }
  }

  if (!/^[0-9]{6}$/.test(String(data.postalCode))) {
    return "Postal code must be 6 digits.";
  }

  if (!/^[0-9]{10}$/.test(String(data.phone))) {
    return "Phone number must be 10 digits.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email))) {
    return "Invalid email address.";
  }

  const price = Number(data.price);
  const advance = Number(data.advance);
  if (!isFinite(price) || price < 0) {
    return "Price must be a non-negative number.";
  }
  if (!isFinite(advance) || advance < 0) {
    return "Advance payment must be a non-negative number.";
  }
  if (advance > price) {
    return "Advance payment cannot exceed the price quoted.";
  }

  if (data.photoBase64 && data.photoBase64.length > MAX_PHOTO_BASE64_CHARS) {
    return "Uploaded file is too large.";
  }

  return null;
}

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      "Timestamp", "First Name", "Last Name", "Street Address", "Postal Code",
      "City", "State", "Country", "Phone", "Email", "Price",
      "Advance Payment Made", "Payment Mode", "Date", "File Upload Link", "Status"
    ]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function saveFileToDrive_(base64Data, fileName, mimeType, customerName) {
  const bytes = Utilities.base64Decode(base64Data);
  const safeName = (customerName || "customer").replace(/[^a-zA-Z0-9]/g, "_");
  const blob = Utilities.newBlob(bytes, mimeType || "application/octet-stream", safeName + "_" + fileName);

  const folder = DRIVE_FOLDER_ID
    ? DriveApp.getFolderById(DRIVE_FOLDER_ID)
    : DriveApp.getRootFolder();

  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function sendNotification_(data, fullName, photoUrl) {
  const subject = "New Order — " + (fullName || "Unknown customer");
  const body =
    "New order received on Luxury@fingertips:\n\n" +
    "Name: " + fullName + "\n" +
    "Phone: " + data.phone + "\n" +
    "Email: " + data.email + "\n" +
    "Address: " + data.address + ", " + data.postalCode + ", " + data.city + ", " + data.state + ", " + data.country + "\n" +
    "Price: \u20B9" + data.price + "\n" +
    "Advance Payment Made: \u20B9" + data.advance + "\n" +
    "Payment Mode: " + data.paymentMode + "\n" +
    "Date: " + data.orderDate + "\n" +
    (photoUrl ? "File Upload: " + photoUrl + "\n" : "");

  MailApp.sendEmail(NOTIFY_EMAIL, subject, body);
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Lets you sanity-check the deployment by visiting the Web App URL directly.
function doGet() {
  return jsonResponse_({ status: "ok", message: "Luxury@fingertips order endpoint is live." });
}
