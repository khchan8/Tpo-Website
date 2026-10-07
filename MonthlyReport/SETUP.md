# TPO Monthly Report — setup and monthly workflow

The website reads Google Sheets and calculates validated report figures. Apps Script prepares a prompt for your chosen AI chat and imports its response into Commentary. No Gemini, OpenAI, or other LLM API key is required.

## Install or update the Google Sheets script

Use the existing reporting workbook; updating the script does not require importing or replacing the workbook.

1. In Google Sheets, open **Extensions → Apps Script**.
2. Replace the complete contents of the existing report script with the repository's **apps-script/Code.gs**. Do not append another copy or keep duplicate report functions in other script files.
3. Save and reload Google Sheets. Authorize the script when Google requests it.
4. Run **📊 TPO → 2. Check & calculate**. This sets up the workflow sheets, normalizes numeric text, repairs calculated sheets, performs obsolete-content cleanup, and writes **Data Validation**. Resolve reported errors.
5. Open **📊 TPO → Tools & settings → Report settings…** to create or edit the shared **Report Settings** configuration. Saving settings also refreshes derived formulas.

The script maintains **LLM-Input**, **LLM Output**, and **Commentary**. Commentary uses **View | Commentary | Status** in A:C; the removed D:G columns are not needed. Input/output rows 1–7 contain metadata; prompt and response text start at A8.

Copying Code.gs into GitHub does not install it in Google Sheets. The website and the bound Apps Script are updated separately.

### v8: guided monthly workflow and one-step response import

Install build **`2026-10-07-v8`** (replace the whole bound script, save, reload). Then run **TPO → 2. Check & calculate**, or **TPO → Tools & settings → Clean up obsolete information**. Cleanup clears the retired Assumptions D10:E13 reconciliation block (original formulas are recorded in **Repair Backup**), refreshes the README/Glossary guides, and removes the empty **Old Commentary** header in D1; custom content is preserved and reported. Prepare a **new** AI prompt afterwards if source helper cells were cleared. The menu is now ordered around the monthly flow: **1. Enter monthly data → 2. Check & calculate → 3. Prepare AI prompt + copy → 4. Paste AI response & update Commentary → 5. Review Commentary**, with the remaining tools under **Tools & settings**. Step 4 saves the JSON response in **LLM Output** and updates Commentary in one action.

### v7: calculate customer quarters from monthly revenue

Install build **`2026-10-07-v7`**, then run **TPO → Repair calculated sheets** even if you previously repaired v6. This backs up old quarterly totals, replaces `CustomerRevenueQuarterly` revenue cells with formulas, and rewrites the `Report Model` arguments so the quarterly output cannot feed back into itself. Wait for custom-function recalculation, then run **Format & verify all sheets** and regenerate commentary.

Enter customer revenue only in **CustomerRevenueMonthly**. Historical quarters require one valid amount for every calendar month; the current quarter sums quarter-start through the latest financial reporting month. A missing month leaves the quarter blank, not zero. Current August Q3 totals should be Mana **774,820**, Auntie Aloha **1,145,367**, Fuzzies **857,842**, Tyson **904,933**, and Private Label **546,010**.

Four historical totals need missing monthly figures before they can be calculated: Auntie Aloha **Apr-24**, Fuzzies **Jul-24**, Tyson **Jan/Feb-25**, and Private Label **Jan-25**. Confirm whether each amount was genuinely zero or enter the actual revenue; do not infer it from the old quarter totals.

Keep the red tabs for **Assumptions**, **Dashboard Inputs**, **MonthlyFinancials**, **CustomerRevenueMonthly**, **CustomerCount**, and **1. Working Capital**. Do not mark `CustomerRevenueQuarterly` as a routine manual-input tab. Dashboard Inputs column C is the actual `Value`; column D examples are ignored by the calculation. Repair restores **Cash Balance As Of** and **Inventory Period** on the Strategic Dashboard, not in Dashboard Inputs.

No XLSX import is needed. Keep the downloaded workbook as the pre-migration snapshot, update the existing bound script, and download a fresh copy after repairing the live sheet. Importing XLSX does not install Apps Script and exported spill caches may block recalculation.


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

1. Run **📊 TPO → 1. Enter monthly data → Prepare next month slots**. This creates empty row slots for the new period across all input sheets. **Input checklist…** in the same submenu shows what to type and links to the input tabs.
2. Enter raw figures into the **manual input sheets** (leave unknown future slots blank; enter `0` only for a genuine zero):
   - **`MonthlyFinancials`**: Enter `Total Revenue`, `COGS`, `SG&A`, and `Net Income`. (`Gross Profit`, `EBIT`, and `Quarter` are calculated automatically).
   - **`CustomerRevenueMonthly`**: Enter monthly `Revenue` for each customer.
   - **`CustomerCount`**: Enter `Customer Count` for the month.
   - **`1. Working Capital`**: Enter `Cash Balance`, `Accounts Receivable`, `Inventory Value`, and `Accounts Payable`. (`Net Working Capital` calculates automatically).
   - **`Dashboard Inputs`** *(optional)*: Enter `New Accounts Opened`, `Customer Retention Rate`, and other non-calculated operational metrics as `Quarter | Metric | Value`. Enter retention as a percentage (e.g. `94%`) or fraction (`0.94`); leave unknown values blank. **Do not enter Inventory Turns**—it calculates automatically from COGS and inventory balances.

   > [!IMPORTANT]
   > **Do not type into derived sheets:** **`CustomerRevenueQuarterly`**, **`Quarterly Financials`**, **`2. Customer Economics`**, **`3. Strategic Dashboard`**, and **`4. Forward-Looking Risk`** are calculated automatically from the input sheets via `Report Model`. Manual edits to these sheets overwrite their formulas.

3. Run **📊 TPO → 2. Check & calculate**, review the **Data Validation** sheet, and resolve any reported errors; wait for recalculation to finish. Use **Tools & settings → Repair calculated sheets** if derived formulas ever need restoration.
4. Run **📊 TPO → 3. Prepare AI prompt + copy… → Copy all**. Paste the complete prompt into Gemini, ChatGPT, DeepSeek, or another AI chat.
5. Copy the AI's JSON response and run **📊 TPO → 4. Paste AI response & update Commentary…**. This validates the response against the prepared batch, saves it in **LLM Output**, and writes each entry to its matching Commentary row in one action (or paste the JSON into **LLM Output** at A8 and re-run step 4).
6. Run **📊 TPO → 5. Review Commentary** and check the prose for factual accuracy.
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
