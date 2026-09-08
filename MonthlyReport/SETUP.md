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

## Monthly workflow

1. Run **Prepare Next Month Slots (Fill in the blanks)** and enter the source figures. Repeated runs preserve entered values. Future blank rows are allowed; enter zero only for an actual zero.
2. Run **Format & verify all sheets**, review **Data Validation**, and resolve errors. Use **Repair calculated sheets** if derived formulas need restoration. Enter manually maintained dashboard metrics in **Dashboard Inputs**.
3. Run **1. Prepare LLM Input + Copy… → Copy all**. Paste the complete prompt into Gemini, ChatGPT, DeepSeek, or another AI chat.
4. Copy the AI's JSON response. Use **Paste AI response…**, or paste into **LLM Output** starting at A8.
5. Run **3. Import LLM Output**. The importer validates the batch and writes each response to its matching Commentary row. Review the prose for factual accuracy.
6. Use **Reload data** on the website's **Setup & data health** page.

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
