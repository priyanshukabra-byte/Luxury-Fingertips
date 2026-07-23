# Luxury@fingertips — Order Site

Standalone single-page site for Luxury@fingertips (Bags · Shoes · Accessories).
No relation to any other project — this has its own Apps Script backend and its
own Google Sheet.

## Files

- `index.html` — the landing page + order form (single page)
- `style.css` — all styling
- `script.js` — form submission logic (talks to your Apps Script Web App)
- `Code.gs` — Google Apps Script backend (writes to a Google Sheet, optionally saves photos to Drive and emails you)
- `assets/logo.jpg` — your logo

## 1. Set up the backend (Google Sheet + Apps Script)

1. Go to [sheets.google.com](https://sheets.google.com) and create a **new, blank spreadsheet**. Name it something like "Luxury@fingertips Orders".
2. In that sheet, go to **Extensions > Apps Script**.
3. Delete any placeholder code in the editor, then paste in the entire contents of `Code.gs`.
4. (Optional) Set `DRIVE_FOLDER_ID` if you want reference photos saved into a specific Drive folder instead of your Drive root.
5. (Optional) Set `NOTIFY_EMAIL` to your email if you want an email alert on every new order.
6. Click **Deploy > New deployment**.
   - Select type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Click **Deploy**. The first time, Google will ask you to authorize the script (Sheet + Drive + Gmail access) — approve it.
8. Copy the **Web app URL** it gives you (looks like `https://script.google.com/macros/s/AKfycb.../exec`).
9. You can test it's live by pasting that URL into a browser — you should see `{"status":"ok","message":"Luxury@fingertips order endpoint is live."}`.

## 2. Connect the frontend to the backend

Open `script.js` and replace:

```js
const WEB_APP_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
```

with the Web app URL you copied above.

## 3. Publish on GitHub Pages

1. Create a new GitHub repository (public, so Pages can serve it for free).
2. Upload `index.html`, `style.css`, `script.js`, and the `assets/` folder (with `logo.jpg` inside it) to the repo root.
3. In the repo, go to **Settings > Pages**.
4. Under **Source**, select the `main` branch and `/ (root)` folder, then **Save**.
5. GitHub will give you a live URL, typically `https://<your-username>.github.io/<repo-name>/`. It can take a minute or two to go live.

## Notes on what happens when someone orders

- Every submission is written as a new row in the **Orders** tab of your Sheet, with columns: Timestamp, First Name, Last Name, Street Address, Postal Code, City, State, Country, Phone, Email, Price, Advance Payment Made, Payment Mode, Date, File Upload Link, Status.
- Every field is required except the optional file upload.
- New orders get a **Status** of "New" — edit that cell manually as you process an order (e.g. "Confirmed", "Dispatched").
- Entering a 6-digit PIN code tries to auto-fill City, State and Country using a free public India Post lookup (`api.postalpincode.in`). If that service is down or the PIN isn't recognized, the customer just fills those fields in by hand — nothing blocks submission.
- `Code.gs` rejects a submission (with an error message, no row written) if required fields are missing, the phone/postal code/email are malformed, or the advance exceeds the price. This is basic server-side validation — it stops garbage data, not a determined attacker, since the Web App URL itself is publicly reachable by design (that's how the form talks to it). Don't put anything in this Sheet you wouldn't want a stranger directly hitting the endpoint to be able to write.
- A file upload is optional and capped at ~4 MB on the client and ~4.5 MB on the server.

## Testing locally before publishing

You can just open `index.html` directly in a browser to check layout on desktop.
For a closer-to-production test (and to check the file upload / relative paths work), run a tiny local server from this folder instead of opening the file directly:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000` in your browser, and test on your phone via your computer's local IP if it's on the same Wi-Fi (e.g. `http://192.168.1.x:8000`).
