/**
 * LUXURY@FINGERTIPS — ORDER FORM BACKEND (v2)
 * -----------------------------------------------------------------
 * FIRST-TIME SETUP (in the business owner's own Google account):
 * 1. Create a new Google Sheet, e.g. "Luxury Orders".
 * 2. In that Sheet: Extensions > Apps Script. Delete the placeholder code,
 *    paste this whole file in, and click Save.
 * 3. Pick "sortOrdersNewestFirst" in the function dropdown and click Run once.
 *    Approve the permissions Google asks for. This also creates the "Orders" tab.
 * 4. Deploy > New deployment > type: Web app.
 *      Execute as: Me    Who has access: Anyone
 *    Copy the Web App URL into script.js (WEB_APP_URL).
 *
 * LATER CODE UPDATES: Deploy > Manage deployments > pencil icon >
 * Version: New version > Deploy. The URL stays the same.
 * -----------------------------------------------------------------
 */

// ---------------- Settings ----------------

// Leave "" when this script was opened from the Sheet itself
// (Extensions > Apps Script): it then uses that Sheet automatically.
// Only fill this in (the long code in the Sheet's URL) for a standalone script.
const SPREADSHEET_ID = "";
const SHEET_NAME = "Orders";

// Google Drive FOLDER ID for uploaded files: open the folder in Drive and copy
// the code after /folders/ in the address bar. This must be a folder ID,
// never an email address. Leave "" to save uploads in the root of your Drive.
const DRIVE_FOLDER_ID = "";

// false = only you can open uploaded files (recommended: customer receipts
//         and photos stay private).
// true  = anyone with the link can open them (only needed if someone else
//         you share the Sheet with must open uploads).
const PUBLIC_FILE_LINKS = false;

// Where new-order alerts go. Leave "" to switch alerts off.
const NOTIFY_EMAIL = "sab@basantagro.com";

const MAX_FILE_BASE64_CHARS = 6 * 1024 * 1024;  // about 4.5 MB of real file data
const MAX_ORDERS_PER_MINUTE = 20;               // stops scripted floods
const DUPLICATE_WINDOW_SECONDS = 120;           // same order twice within 2 min = saved once

const HEADERS = [
  "Timestamp", "First Name", "Last Name", "Street Address", "Postal Code",
  "City", "State", "Country", "Phone", "Email", "Price",
  "Advance Payment Made", "Payment Mode", "Date", "File Upload Link", "Status"
];

const REQUIRED_FIELDS = [
  "firstName", "lastName", "address", "postalCode", "city", "state", "country",
  "phone", "email", "price", "advance", "paymentMode", "orderDate"
];

const PAYMENT_MODES = ["UPI", "Cash", "Card", "Bank Transfer"];

const ALLOWED_FILE_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"
];
const ALLOWED_FILE_EXT = /\.(jpe?g|png|webp|heic|heif|pdf)$/i;

// ---------------- Web app entry points ----------------

function doPost(e) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    locked = lock.tryLock(30000);  // one order written at a time
    if (!locked) {
      return reply_("error", "We're getting a lot of orders right now. Please try again in a minute.");
    }

    if (!e || !e.postData || !e.postData.contents) {
      return reply_("error", "Empty submission.");
    }

    let data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return reply_("error", "Malformed submission.");
    }

    // Spam trap: real people never see this field. Pretend it worked.
    if (data && data.website) {
      return reply_("success", "Order saved.");
    }

    if (isRateLimited_()) {
      return reply_("error", "Too many orders at once. Please try again in a few minutes.");
    }

    const problem = validateOrder_(data);
    if (problem) {
      return reply_("error", problem);
    }

    // A double tap or a retry after a slow connection: don't save it twice.
    const dupKey = duplicateKey_(data);
    const cache = CacheService.getScriptCache();
    if (cache.get(dupKey)) {
      return reply_("success", "Order already received.");
    }

    const sheet = getOrCreateSheet_();
    const fullName = (String(data.firstName) + " " + String(data.lastName)).trim();

    // A failed upload must not lose the order itself.
    let fileLink = "";
    if (data.photoBase64) {
      try {
        fileLink = saveFileToDrive_(data.photoBase64, data.photoName, data.photoType, fullName);
      } catch (fileErr) {
        console.error("File upload failed: " + fileErr);
        fileLink = "Upload failed";
      }
    }

    sheet.appendRow([
      new Date(),                        // Timestamp
      clean_(data.firstName, 80),
      clean_(data.lastName, 80),
      clean_(data.address, 300),
      String(data.postalCode).trim(),
      clean_(data.city, 80),
      clean_(data.state, 80),
      clean_(data.country, 60),
      String(data.phone).trim(),
      clean_(data.email, 120),
      Number(data.price),
      Number(data.advance),
      clean_(data.paymentMode, 30),
      String(data.orderDate).trim(),
      fileLink,
      "New"                              // Status: edit by hand later
    ]);

    sortNewestFirst_(sheet);
    SpreadsheetApp.flush();
    cache.put(dupKey, "1", DUPLICATE_WINDOW_SECONDS);

    // The order is already saved. If the alert email fails (for example the
    // daily Gmail quota is used up), still tell the customer it worked, so
    // they don't resubmit and create a duplicate.
    if (NOTIFY_EMAIL) {
      try {
        sendNotification_(data, fullName, fileLink, sheet.getParent().getUrl());
      } catch (mailErr) {
        console.error("Alert email failed: " + mailErr);
      }
    }

    return reply_("success", "Order saved.");

  } catch (err) {
    console.error(err);
    return reply_("error", "Your order wasn't saved because of a server problem. Please try again, or message us on WhatsApp.");
  } finally {
    if (locked) lock.releaseLock();
  }
}

// Visit the Web App URL in a browser to check it's live.
function doGet() {
  return reply_("ok", "Luxury@fingertips order endpoint is live.");
}

// ---------------- Run this once by hand ----------------

/**
 * Sorts every existing order so the newest is on top.
 * New orders are sorted automatically; run this once after pasting the code.
 */
function sortOrdersNewestFirst() {
  const sheet = getOrCreateSheet_();
  sortNewestFirst_(sheet);
  SpreadsheetApp.flush();
  console.log("Sorted " + Math.max(sheet.getLastRow() - 1, 0) + " orders, newest first.");
}

// ---------------- Helpers ----------------

function getOrCreateSheet_() {
  const ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Newest on top: rows 2+ sorted by Timestamp (column A), newest first.
 * Sorting whole rows keeps any Status edits or extra columns you add
 * attached to the right order.
 */
function sortNewestFirst_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;  // header + 0 or 1 order: nothing to sort
  sheet
    .getRange(2, 1, lastRow - 1, sheet.getLastColumn())
    .sort({ column: 1, ascending: false });
}

/** Returns an error message, or null if the order is fine. */
function validateOrder_(data) {
  if (!data || typeof data !== "object") {
    return "Malformed submission.";
  }

  for (const field of REQUIRED_FIELDS) {
    const value = data[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      return "Missing required field: " + field;
    }
    if (String(value).length > 300) {
      return "The " + field + " field is too long.";
    }
  }

  if (!/^[0-9]{6}$/.test(String(data.postalCode).trim())) {
    return "PIN code must be 6 digits.";
  }
  if (!/^[0-9]{10}$/.test(String(data.phone).trim())) {
    return "Mobile number must be 10 digits.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email).trim())) {
    return "Please enter a valid email address.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.orderDate).trim())) {
    return "Please enter a valid order date.";
  }
  if (PAYMENT_MODES.indexOf(String(data.paymentMode)) === -1) {
    return "Please choose a payment mode.";
  }

  const price = Number(data.price);
  const advance = Number(data.advance);
  if (!isFinite(price) || price <= 0) {
    return "Price must be more than zero.";
  }
  if (!isFinite(advance) || advance < 0) {
    return "Advance can't be negative.";
  }
  if (advance > price) {
    return "Advance can't be more than the price.";
  }

  if (data.photoBase64) {
    if (typeof data.photoBase64 !== "string" || data.photoBase64.length > MAX_FILE_BASE64_CHARS) {
      return "The attached file is too large. Please use one under 4 MB.";
    }
    const typeOk = ALLOWED_FILE_TYPES.indexOf(String(data.photoType)) !== -1 ||
                   ALLOWED_FILE_EXT.test(String(data.photoName || ""));
    if (!typeOk) {
      return "Please attach a JPG, PNG or PDF file.";
    }
  }

  return null;
}

/**
 * Makes text safe for the Sheet. A value starting with = + - or @ would be
 * run as a formula; a leading apostrophe stores it as plain text instead.
 */
function clean_(value, maxLen) {
  let s = (value === undefined || value === null) ? "" : String(value);
  s = s.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, maxLen || 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function isRateLimited_() {
  const cache = CacheService.getScriptCache();
  const key = "rate_" + Math.floor(Date.now() / 60000);
  const count = Number(cache.get(key) || 0);
  if (count >= MAX_ORDERS_PER_MINUTE) return true;
  cache.put(key, String(count + 1), 120);
  return false;
}

function duplicateKey_(data) {
  return "dup_" + [
    String(data.phone).trim(),
    Number(data.price),
    Number(data.advance),
    String(data.orderDate).trim()
  ].join("_");
}

function saveFileToDrive_(base64Data, fileName, mimeType, customerName) {
  const bytes = Utilities.base64Decode(base64Data);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmm");
  const safeCustomer = String(customerName || "customer").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40);
  const safeFile = String(fileName || "upload").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  const blob = Utilities.newBlob(
    bytes,
    mimeType || "application/octet-stream",
    stamp + "_" + safeCustomer + "_" + safeFile
  );

  let folder = DriveApp.getRootFolder();
  if (DRIVE_FOLDER_ID) {
    try {
      folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    } catch (folderErr) {
      console.error("DRIVE_FOLDER_ID is not a valid folder, using My Drive instead: " + folderErr);
    }
  }

  const file = folder.createFile(blob);
  if (PUBLIC_FILE_LINKS) {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }
  return file.getUrl();
}

function sendNotification_(data, fullName, fileLink, sheetUrl) {
  const price = Number(data.price);
  const advance = Number(data.advance);
  const subject = "New order: " + (fullName || "Unknown customer") + ", \u20B9" + price;

  const body =
    "New order on Luxury@fingertips\n\n" +
    "Name: " + fullName + "\n" +
    "Mobile: " + data.phone + "  (WhatsApp: https://wa.me/91" + data.phone + ")\n" +
    "Email: " + data.email + "\n" +
    "Address: " + data.address + ", " + data.city + ", " + data.state + " " + data.postalCode + ", " + data.country + "\n\n" +
    "Price: \u20B9" + price + "\n" +
    "Advance paid: \u20B9" + advance + " (" + data.paymentMode + ")\n" +
    "Balance due: \u20B9" + (price - advance) + "\n" +
    "Order date: " + data.orderDate + "\n" +
    (fileLink ? "File: " + fileLink + "\n" : "") +
    "\nAll orders: " + sheetUrl + "\n";

  MailApp.sendEmail(NOTIFY_EMAIL, subject, body, {
    name: "Luxury@fingertips Orders",
    replyTo: String(data.email).trim()
  });
}

function reply_(status, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: status, message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
