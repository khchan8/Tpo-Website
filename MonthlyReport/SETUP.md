# TPO Monthly Report — setup and monthly workflow

The website reads Google Sheets and calculates validated report figures. Apps Script prepares a prompt for your chosen AI chat and imports its response into Commentary. No Gemini, OpenAI, or other LLM API key is required.

## Install or update the Google Sheets script

Use the existing reporting workbook; updating the script does not require importing or replacing the workbook.

1. In Google Sheets, open **Extensions → Apps Script**.
2. Replace the complete contents of the existing report script with the repository's **apps-script/Code.gs**. Do not append another copy or keep duplicate report functions in other script files.
3. Save and reload Google Sheets. Authorize the script when Google requests it.
4. Run **📊 TPO → Set up / repair workflow sheets**, then **Repair calculated sheets** and **Format & verify all sheets**. Review **Data Validation** and resolve reported errors.
5. Open **📊 TPO → Report settings…** to create or edit the shared **Report Settings** configuration. Saving settings also refreshes derived formulas.

The script maintains **LLM-Input**, **LLM Output**, and **Commentary**. Commentary uses **View | Commentary | Status** in A:C; the removed D:G columns are not needed. Input/output rows 1–7 contain metadata; prompt and response text start at A8.

Copying Code.gs into GitHub does not install it in Google Sheets. The website and the bound Apps Script are updated separately.

## Website configuration and publication

Keep the existing **config.js** with its **SHEET_ID** and Sheets **API_KEY**. The static website requires a Sheets API key and a workbook readable through that API. The API key is for loading spreadsheet data, not generating AI commentary. Keep its API and website referrer restrictions configured in Google Cloud.

The publication folder is **Tpo-Website/MonthlyReport/**. It must include **js/settings.js**, the other JavaScript modules, and the styles referenced by **index.html**. Run these checks from MonthlyReport:

```text
node --test tests/*.test.cjs
```

If Apps Script source modules were changed, run `node tools/build-apps-script.cjs` before testing and installing the resulting bundle. Review the changes, commit the intended MonthlyReport files, and push through the existing GitHub Pages workflow. Check deployment completion in GitHub Actions, then reload the website; a hard refresh can clear older cached assets.

Sheet sharing and page visibility are different controls. Show/Hide does not restrict access to loaded data. A public workbook and its report URL should not be treated as confidential access controls. Changing sharing does not erase downloaded snapshots or data already loaded by a viewer.

## Password protection (Cloudflare Worker)

Visitors must enter credentials before the browser receives anything from `/MonthlyReport/` — including the page source and **config.js**. The gate is a Cloudflare Worker running in front of GitHub Pages; no website code changes, and removing it later only removes the prompt.

1. **Create the Worker**:
   - In Cloudflare sidebar: **Compute → Workers & Pages → Create an app** (or **Create**).
   - Under **Make something new**, click **Start with Hello World** (do *not* select "Connect GitHub", which creates a Pages project that lacks path routes).
   - Name it (for example `monthly-report-gate`) and click **Deploy**.
2. **Deploy the gate code**:
   - On the Worker overview, click **Edit code** (or **Quick edit**).
   - Replace the entire template code with **tools/cloudflare/password-gate.js** and click **Save and deploy**.
3. **Attach the Route**:
   - On the Worker page, open **Settings → Domains & Routes**.
   - Under **Routes**, click **Add → Route** (or **Add Route**).
   - Configure:
     - **Zone**: `tpowellness.com`
     - **Route**: `*tpowellness.com/MonthlyReport*`
     - **Failure mode**: `Fail closed (block)` (recommended for auth gates)
   - Click **Add Route**. *(Alternatively, configure from **Domains → tpowellness.com → Workers Routes → Add route**).*
4. **Configure credentials (Variables and Secrets)**:
   - Worker **Settings → Variables and Secrets → Add**:
     - `PASSWORD`: Custom password (overrides default `Tpo888`).
     - `USERNAME` *(optional)*: Specific username to require (e.g. `admin`). If left unset, any username is accepted.
5. **DNS prerequisite**:
   - In **Domains → tpowellness.com → DNS → Records**, ensure the record pointing to GitHub Pages has **Proxy status: Proxied (Orange Cloud ☁️)**. If set to DNS-only (Grey Cloud), traffic bypasses Cloudflare Workers.

Browsers cache and resend the HTTP Basic credentials automatically until the browser is closed. The gate protects the website URL, not the workbook: the Google Sheet remains readable through its public API key, as noted above. Hiding the financials themselves would additionally require restricting the sheet and changing how the site loads data.

## Monthly workflow

1. Run **Prepare Next Month Slots (Fill in the blanks)**. This creates empty row slots for the new period across all input sheets.
2. Enter raw figures into the **manual input sheets** (leave unknown future slots blank; enter `0` only for a genuine zero):
   - **`MonthlyFinancials`**: Enter `Total Revenue`, `COGS`, `SG&A`, and `Net Income`. (`Gross Profit`, `EBIT`, and `Quarter` are calculated automatically).
   - **`CustomerRevenueMonthly`**: Enter monthly `Revenue` for each customer.
   - **`CustomerRevenueQuarterly`**: Enter quarter-to-date (QTD) `Revenue` for each customer under the quarter row (e.g. enter `Jul + Aug` for `Q3 2026`; update with full quarter when September closes).
   - **`CustomerCount`**: Enter `Customer Count` for the month.
   - **`1. Working Capital`**: Enter `Cash Balance`, `Accounts Receivable`, `Inventory Value`, and `Accounts Payable`. (`Net Working Capital` calculates automatically).
   - **`Dashboard Inputs`** *(optional)*: Enter `New Accounts Opened`, `Customer Retention Rate`, and other non-calculated operational metrics as `Quarter | Metric | Value`. Enter retention as a percentage (e.g. `94%`) or fraction (`0.94`); leave unknown values blank. **Do not enter Inventory Turns**—it calculates automatically from COGS and inventory balances.

   > [!IMPORTANT]
   > **Do not type into derived sheets:** **`Quarterly Financials`**, **`2. Customer Economics`**, **`3. Strategic Dashboard`**, and **`4. Forward-Looking Risk`** are calculated automatically from the input sheets via `Report Model`. Manual edits to these sheets overwrite their formulas.

3. Run **Format & verify all sheets**, review the **Data Validation** sheet, and resolve any reported errors. Use **Repair calculated sheets** if derived formulas ever need restoration.
4. Run **1. Prepare LLM Input + Copy… → Copy all**. Paste the complete prompt into Gemini, ChatGPT, DeepSeek, or another AI chat.
5. Copy the AI's JSON response. Use **Paste AI response…**, or paste into **LLM Output** starting at A8.
6. Run **3. Import LLM Output**. The importer validates the batch and writes each response to its matching Commentary row. Review the prose for factual accuracy.
7. Use **Reload data** on the website's **Setup & data health** page.

Prepare a new prompt if source data, the shared reporting cut-off, or selected AI sections change. **Run diagnostics…** and **Show last error…** provide action, stack, timezone, and available source-cell context when troubleshooting.

## Report controls

Open **Setup & data health** (`#/setup`) to configure tab/customer Show, Hide, or Auto, labels, ordering, opening page, reporting cut-off, chart ranges, amount display, decimals, and table spacing. Hidden customers still contribute to company totals. Blank future periods do not advance the latest actual reporting month.

- **Apply in this browser** saves personal preferences across browser sessions. They override shared defaults until **Reset to shared defaults** is used.
- **Prepare shared settings** selects JSON for copying. In Google Sheets, open **Report settings…**, paste it, and click **Save pasted configuration**. Website visitors without personal overrides receive those defaults when they reload data.
- **AI input** selects the commentary sections requested in the next prompt. Normalized supporting tables remain included for context. Personal website preferences do not change the script's AI selection; save shared settings for that.
- **Export** selects visible sections for print/CSV. Hidden sections are excluded from those report exports.
- **Save preset** stores a named configuration and immediately selects it in the dropdown. Save again with the same name to replace it. **Apply preset** loads the selected configuration. Presets are stored in the current browser.

## Snapshots and exports

Print exports include tables, key figures, and briefings; they omit interactive charts. CSV contains numeric report data for selected visible sections.

**Save report snapshot** exports all loaded source data, including hidden customers, plus commentary, settings, capture time, and a calculation fingerprint. Importing the JSON validates the calculation version and fingerprint and uses the captured data without refreshing Google Sheets. Use **Return to live report** to resume live data.

A historical cut-off recalculates the currently loaded source data; it does not restore earlier source revisions. The snapshot fingerprint detects calculation differences, not authenticity. Snapshots are not a fully offline application: loading the website and external chart/font assets may still require a connection.

See **README.md** for data contracts, calculation rules, and import protections.
