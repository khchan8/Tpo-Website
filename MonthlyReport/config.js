/* =========================================================
   config.js — KH fills these once after creating the sheet.
   These two values are the ONLY site-specific config.
   The API key is read-only and referrer-restricted to this
   site's Pages URL — harmless if seen.
   ========================================================= */
window.TPO_CONFIG = {
  SHEET_ID: "1cn8wokYQyLX7jcZApPdgXEk5YjIsXSgQ9y9Pbr-ZgbE",          // e.g. "1AbCdEfGhIjKlMnOpQrStUvWxYz_-1234567890"
  API_KEY:  "AIzaSyD6IdWaxKvhA3OvDSh4cmIT8VcVseXIKNU",  // restricted: Sheets API only; HTTP referrer = this Pages URL

  // Optional override (rare). Default uses the Sheets API v4 endpoint.
  SHEETS_ENDPOINT: "https://sheets.googleapis.com/v4/spreadsheets",

  // Tabs we read from the sheet, in the order they're laid out.
  // (Adjust only if you renamed a tab in the sheet.)
  TABS: [
    "Assumptions",
    "MonthlyFinancials",
    "CustomerRevenueMonthly",
    "CustomerRevenueQuarterly",
    "CustomerCount",
    "Quarterly Financials",
    "1. Working Capital",
    "2. Customer Economics",
    "3. Strategic Dashboard",
    "4. Forward-Looking Risk",
    "Commentary",
  ],

  // Site identity (purely cosmetic).
  COMPANY: "TPO Wellness",
  CURRENCY: "THB",
  REPORT_TITLE: "Monthly Performance — Board Briefing",
};