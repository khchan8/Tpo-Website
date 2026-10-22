// V88 Google Apps Script for TPO Login System (Based on V87)
// Includes Login and Password Change functionality using GET requests (JSONP-compatible).
//
// V88 fixes vs V87:
//  1. doGet no longer crashes when the script is deployed standalone (not bound to a
//     spreadsheet): getActiveSpreadsheet() returned null and .setSpreadsheetTimeZone()
//     threw on every request, killing all logins. Now falls back to openById() and
//     never blocks request handling.
//  2. Password change works: the frontend sends action=handleChangePassword with
//     currentPassword, but V87 only routed action=changePassword reading oldPassword.
//     Both action names and both parameter names are now accepted.
//  3. After-login redirects survive the site rebrand: the 'Linked Page' column in the
//     Setups sheet may still contain pre-rebrand filenames that no longer exist.
//     LEGACY_PAGE_REDIRECTS maps them to the new pages so logins don't land on 404.
const SPREADSHEET_ID = '1kceGng_G15z6XL1nbEG4aLmnVKn_VbVJMNOvOeVXGEU'; // TPOlogin spreadsheet
const LOGIN_SHEET_NAME = 'Setups'; // Sheet for login credentials
const TIMEZONE = 'Asia/Bangkok';
const TOKEN_EXPIRATION_SECONDS = 14 * 24 * 60 * 60; // Session Token validity period (14 days in seconds)

// Website form submissions (contact / quote / meeting / newsletter) are emailed here.
const FORM_RECIPIENT_EMAIL = 'info@tpo-wellness.com';

// Old filename -> new filename (2026 rebrand). Applied to the 'Linked Page' value
// before it is returned to the frontend, so existing sheet rows keep working.
const LEGACY_PAGE_REDIRECTS = {
  'oem-edibles-manufacturing.html': 'oem-gummy-manufacturing.html',
  'oem-preroll-production.html': 'oem-herbal-manufacturing.html',
  'mana-cannabis-details.html': 'sleep-relax-details.html',
  'mike-tyson-2.0.html': 'performance-line-details.html',
  'Tyson-data.html': 'performance-line-data.html',
  'Fuzzies-product-details.html': 'daily-wellness-details.html',
  'Fuzzies-data.html': 'daily-wellness-data.html',
  'auntie-aloha-product-details.html': 'herbal-line-details.html',
  'auntie-aloha-dogwalker-details.html': 'herbal-line-data.html',
  'auntie-aloha-dashboard.html': 'herbal-line-dashboard.html',
  'MC-Sales-Tools.html': 'SR-Sales-Tools.html',
  'TY-Sales-Tools.html': 'PP-Sales-Tools.html',
  'TF-Sales-Tools.html': 'DW-Sales-Tools.html',
  'AA-Sales-Tools.html': 'HT-Sales-Tools.html',
  'dabpen/index.html': 'elixir/index.html',
  'dabpen/': 'elixir/'
};

/**
 * Rewrites any pre-rebrand filename inside a Linked Page value (works for bare
 * filenames like "Tyson-data.html" and absolute URLs like
 * "https://tpowellness.com/Fuzzies-data.html").
 * @param {string} linkedPage The raw Linked Page value from the sheet.
 * @return {string} The migrated (or unchanged) Linked Page value.
 */
function migrateLinkedPage(linkedPage) {
  if (!linkedPage) return linkedPage;
  let migrated = String(linkedPage).trim();
  for (const legacy in LEGACY_PAGE_REDIRECTS) {
    if (migrated.indexOf(legacy) !== -1) {
      migrated = migrated.split(legacy).join(LEGACY_PAGE_REDIRECTS[legacy]);
    }
  }
  return migrated;
}

// --- Debug Logging Function ---
/**
 * Appends a timestamped message to the 'DebugLog' sheet.
 * @param {string} message The message to log.
 */
function logToSheet(message) {
  try {
    // Ensure spreadsheet ID is accessible if this function is called outside doGet/doPost context
    const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
    const logSheet = ss.getSheetByName('DebugLog');
    if (!logSheet) {
      Logger.log("DebugLog sheet not found. Please create it.");
      return; // Exit if sheet doesn't exist or couldn't be created
    }
    const timestamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    logSheet.appendRow([timestamp, String(message)]); // Use appendRow for simplicity and safety
  } catch (e) {
    Logger.log(`Error logging to sheet: ${e} - Message: ${message}`); // Log error and message to standard logger
  }
}

// --- Helper Functions ---

/**
 * Validates a session token against CacheService.
 * @param {string} sessionToken The session token value to validate.
 * @return {object} An object { valid: boolean, email: string|null, tokens: string[]|null }
 */
function validateSessionToken(sessionToken) {
  if (!sessionToken) {
    Logger.log('Session token validation failed: No token provided.');
    return { valid: false, email: null, tokens: null };
  }
  try {
    const cache = CacheService.getScriptCache();
    const cachedDataString = cache.get(sessionToken);

    if (!cachedDataString) {
      Logger.log(`Session token validation failed: Token not found in cache (${sessionToken})`);
      return { valid: false, email: null, tokens: null };
    }

    const cachedData = JSON.parse(cachedDataString);

    // CacheService handles expiration automatically

    Logger.log(`Session token validation successful for ${cachedData.email} (Token: ${sessionToken})`);
    return { valid: true, email: cachedData.email, tokens: cachedData.tokens }; // Return email and tokens

  } catch (error) {
    Logger.log(`Error validating session token (${sessionToken}): ${error}`);
    return { valid: false, email: null, tokens: null };
  }
}


// --- Main Request Handler ---

function doGet(e) {
  // Log entry point and parameters to sheet
  let paramsString = "No params";
  try {
    paramsString = JSON.stringify(e.parameter);
  } catch (jsonErr) {
    paramsString = "Error stringifying params";
  }
  logToSheet(`doGet triggered. Params: ${paramsString}`);

  // FIX (V88): Works standalone AND container-bound. Never let timezone sync kill the request.
  try {
    const tzSheet = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
    if (tzSheet) tzSheet.setSpreadsheetTimeZone(TIMEZONE);
  } catch (tzError) {
    Logger.log(`Timezone sync skipped: ${tzError}`);
  }

  const action = e.parameter.action;
  const callback = e.parameter.callback; // Get callback parameter
  let resultObject;
  let resultString;
  let errorResultString;

  try {
    // --- Action Routing ---
    if (action === 'handleLogin') {
      const email = e.parameter.email;
      const password = e.parameter.password;
      resultObject = handleLogin(email, password);
    } else if (action === 'contact' || action === 'quote_request' || action === 'schedule_meeting' || action === 'newsletter') {
      // Website form submissions (index.html quote / meeting / contact / newsletter forms).
      resultObject = handleFormSubmit(e.parameter);
    } else if (action === 'validateSessionToken') {
      const sessionToken = e.parameter.sessionToken;
      resultObject = validateSessionToken(sessionToken);
    } else if (action === 'checkAccess') {
      const sessionToken = e.parameter.sessionToken;
      const requiredTokensString = e.parameter.requiredTokensString;
      resultObject = checkAccess(sessionToken, requiredTokensString);
    } else if (action === 'changePassword' || action === 'handleChangePassword') {
      // FIX (V88): frontends use both spellings and both parameter names.
      const email = e.parameter.email;
      const oldPassword = e.parameter.oldPassword || e.parameter.currentPassword;
      const newPassword = e.parameter.newPassword;
      resultObject = handleChangePassword(email, oldPassword, newPassword);
    } else {
      resultObject = { success: false, message: 'Invalid action' };
    }

    // --- Stringify Result ---
    resultString = JSON.stringify(resultObject);
    logToSheet(`Successfully stringified result in doGet try block.`);

    // --- Return Response (JSONP or JSON) ---
    if (callback) {
      logToSheet(`Returning JSONP response for callback: ${callback}`);
      return ContentService.createTextOutput(`${callback}(${resultString})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    } else {
      logToSheet(`Returning standard JSON response.`);
      return ContentService.createTextOutput(resultString)
        .setMimeType(ContentService.MimeType.JSON);
    }

  } catch (error) {
    // --- Handle Errors ---
    const errorMsg = `Error in doGet (Action: ${action}): ${error} Stack: ${error.stack}`;
    Logger.log(errorMsg);
    logToSheet(errorMsg); // Log error to sheet

    const errorResult = { success: false, valid: false, message: `Server error: ${error.message}` };
    try {
      errorResultString = JSON.stringify(errorResult);
    } catch (stringifyError) {
      logToSheet(`FATAL: Could not stringify error object in catch block: ${stringifyError}`);
      errorResultString = JSON.stringify({ success: false, message: "Fatal server error during error handling." });
    }

    // --- Return Error Response (JSONP or JSON) ---
    if (callback) {
      logToSheet(`Returning JSONP error response for callback: ${callback}`);
      return ContentService.createTextOutput(`${callback}(${errorResultString})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    } else {
      logToSheet(`Returning standard JSON error response.`);
      return ContentService.createTextOutput(errorResultString)
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
}

// --- Core Logic Functions ---

/**
 * V88: Handles public website form submissions and emails them to the company inbox.
 * Called via JSONP GET from index.html (the legacy form webhook rejected POST with 405).
 * @param {object} params The URL parameters of the request (form fields).
 * @return {object} { success: boolean, message: string }
 */
function handleFormSubmit(params) {
  const action = params.action;

  // Basic rate limiting: one submission per email per action per 2 minutes, and a
  // global hourly cap, to discourage abuse of this public endpoint.
  try {
    const cache = CacheService.getScriptCache();
    const submitter = String(params.email || '').toLowerCase().trim();
    if (submitter) {
      const perUserKey = 'formrl_' + action + '_' + Utilities.base64Encode(submitter).slice(0, 22);
      if (cache.get(perUserKey)) {
        return { success: false, message: 'You just submitted this form. Please wait a minute before trying again.' };
      }
      cache.put(perUserKey, '1', 120);
    }
    const hourBucket = 'formrl_hour_' + Math.floor(Date.now() / 3600000);
    const hourCount = Number(cache.get(hourBucket) || 0);
    if (hourCount >= 40) {
      return { success: false, message: 'Submission limit reached. Please email info@tpo-wellness.com directly.' };
    }
    cache.put(hourBucket, String(hourCount + 1), 3600);
  } catch (rlError) {
    Logger.log('Form rate-limit check skipped: ' + rlError);
  }

  const skipKeys = { action: 1, callback: 1, error: 1, redirect: 1, redirectUrl: 1 };
  const lines = [];
  for (var key in params) {
    if (skipKeys[key]) continue;
    var value = String(params[key]).trim();
    if (!value) continue;
    lines.push(key + ': ' + value.slice(0, 1500));
  }

  const subjects = {
    contact: '[Website] Contact Message',
    quote_request: '[Website] OEM Quote Request',
    schedule_meeting: '[Website] Meeting Request',
    newsletter: '[Website] Newsletter Subscribe'
  };

  const subject = subjects[action] || '[Website] Form Submission';
  const body = 'New website form submission\n\n' +
    'Form: ' + action + '\n' +
    'Received: ' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss') + ' ICT\n\n' +
    lines.join('\n');

  try {
    MailApp.sendEmail(FORM_RECIPIENT_EMAIL, subject, body);
    Logger.log('handleFormSubmit emailed a ' + action + ' submission to ' + FORM_RECIPIENT_EMAIL);
    return { success: true, message: 'OK' };
  } catch (error) {
    Logger.log('handleFormSubmit failed for ' + action + ': ' + error + ' Stack: ' + error.stack);
    return { success: false, message: 'Could not deliver your submission. Please email info@tpo-wellness.com directly.' };
  }
}

/**
 * Handles user login (Based on V85).
 */
function handleLogin(email, password) {
  if (!email || !password) {
    return { success: false, message: 'Missing required parameters (email, password)' };
  }

  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(LOGIN_SHEET_NAME);
    if (!sheet) {
      Logger.log(`Login sheet "${LOGIN_SHEET_NAME}" not found.`);
      return { success: false, message: 'Login system not configured (Sheet not found)' };
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      Logger.log(`Login sheet "${LOGIN_SHEET_NAME}" is empty or has no header.`);
      return { success: false, message: 'Login system not configured (Sheet empty)' };
    }
    const headers = data[0].map(h => String(h).trim().toLowerCase());

    // Column indices (0-based): A=Tokens(0), B=Email(1), C=Password(2), D=Linked Page(3)
    const tokensCol = 0;
    const emailCol = 1;
    const passwordCol = 2;
    const linkedPageCol = 3;

    if (data[0].length < 4) {
       Logger.log(`Login sheet "${LOGIN_SHEET_NAME}" is missing required columns (expected at least 4). Found: ${headers.join(', ')}`);
       return { success: false, message: 'Login system misconfigured (Missing columns)' };
    }

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowTokensString = tokensCol < row.length ? String(row[tokensCol]).trim() : '';
      const rowEmail = emailCol < row.length ? String(row[emailCol]).trim().toLowerCase() : '';
      const rowPassword = passwordCol < row.length ? String(row[passwordCol]) : ''; // Keep original case
      const rowLinkedPage = linkedPageCol < row.length ? String(row[linkedPageCol]).trim() : '';

      if (rowEmail === email.toLowerCase() && rowPassword === password) {

        if (!rowTokensString) {
           Logger.log(`Login successful for ${rowEmail} but 'Tokens' (Col A) is missing in sheet row ${i+1}.`);
           return { success: false, message: 'Login configuration error for user (missing tokens).' };
        }
         if (!rowLinkedPage) {
           Logger.log(`Login successful for ${rowEmail} but 'Linked Page' (Col D) is missing in sheet row ${i+1}.`);
           return { success: false, message: 'Login configuration error for user (missing redirect).' };
        }

        const grantedTokenNames = rowTokensString.split(',').map(t => t.trim()).filter(t => t);

        if (grantedTokenNames.length === 0) {
           Logger.log(`Login successful for ${rowEmail} but 'Tokens' (Col A) contains no valid tokens in sheet row ${i+1}. Value: "${rowTokensString}"`);
           return { success: false, message: 'Login configuration error for user (invalid tokens).' };
        }

        // FIX (V88): keep redirects working after the site rebrand renamed pages.
        const migratedLinkedPage = migrateLinkedPage(rowLinkedPage);
        if (migratedLinkedPage !== rowLinkedPage) {
          Logger.log(`Linked Page migrated for ${rowEmail}: "${rowLinkedPage}" -> "${migratedLinkedPage}"`);
        }

        const cache = CacheService.getScriptCache();
        const sessionToken = Utilities.getUuid();
        const sessionData = { email: rowEmail, tokens: grantedTokenNames };
        cache.put(sessionToken, JSON.stringify(sessionData), TOKEN_EXPIRATION_SECONDS);
        Logger.log(`Stored session token for ${rowEmail}. Token: ${sessionToken}, Expires in: ${TOKEN_EXPIRATION_SECONDS}s`);

        Logger.log(`Login successful for ${rowEmail}. Granted Tokens: ${grantedTokenNames.join(', ')}. Redirect: ${migratedLinkedPage}.`);
        const successResult = {
          success: true,
          sessionToken: sessionToken,
          grantedTokens: grantedTokenNames,
          linkedPage: migratedLinkedPage,
          email: rowEmail // Keep email in response
        };
        // Log the result just before returning
        try {
            logToSheet(`handleLogin success result (stringified): ${JSON.stringify(successResult)}`);
        } catch (e) {
            logToSheet(`handleLogin success result (could not stringify): ${successResult}`);
        }
        return successResult;
      }
    }

    Logger.log(`Login failed for ${email}: Invalid credentials.`);
    const failureResult1 = { success: false, message: 'Invalid credentials' };
    logToSheet(`handleLogin returning failure: ${JSON.stringify(failureResult1)}`);
    return failureResult1;

  } catch (error) {
    const errorMsg = `Error during handleLogin for ${email}: ${error} Stack: ${error.stack}`;
    Logger.log(errorMsg);
    logToSheet(errorMsg); // Log the error itself
    const failureResult2 = { success: false, message: `Login error: ${error.message}` };
    logToSheet(`handleLogin returning failure due to exception: ${JSON.stringify(failureResult2)}`);
    return failureResult2;
  }
}

/**
 * Checks access based on session token and required tokens (Based on V85).
 */
function checkAccess(sessionToken, requiredTokensString) {
  Logger.log(`checkAccess called. Token: ${sessionToken}, Required: ${requiredTokensString}`);

  const validationResult = validateSessionToken(sessionToken);

  if (!validationResult || !validationResult.valid) {
    Logger.log(`checkAccess: Session token validation failed.`);
    return { authorized: false, email: null, message: "Invalid or expired session." };
  }

  let requiredTokensArray = [];
  if (requiredTokensString) {
    try {
      requiredTokensArray = JSON.parse(requiredTokensString);
      if (!Array.isArray(requiredTokensArray)) {
        Logger.log(`checkAccess: requiredTokensString did not parse into an array.`);
        return { authorized: false, email: validationResult.email, message: "Internal error: Invalid required tokens format." };
      }
    } catch (e) {
      Logger.log(`checkAccess: Error parsing requiredTokensString JSON: ${e}`);
      return { authorized: false, email: validationResult.email, message: "Internal error: Could not parse required tokens." };
    }
  } else {
    Logger.log(`checkAccess: No required tokens specified.`);
    return { authorized: false, email: validationResult.email, message: "No required permissions specified for check." };
  }

  const grantedTokens = validationResult.tokens || [];
  const hasAllRequired = requiredTokensArray.every(reqToken => grantedTokens.includes(reqToken));

  if (hasAllRequired) {
    Logger.log(`checkAccess: Authorization successful for ${validationResult.email}.`);
    return { authorized: true, email: validationResult.email };
  } else {
    Logger.log(`checkAccess: Authorization failed for ${validationResult.email}. Missing required tokens.`);
    return { authorized: false, email: validationResult.email, message: "Insufficient permissions." };
  }
}

/**
 * Handles changing the user's password in the Google Sheet.
 * Accepts oldPassword (V87 backend name) or currentPassword (frontend name).
 * @param {string} email The user's email address.
 * @param {string} oldPassword The user's current password.
 * @param {string} newPassword The desired new password.
 * @return {object} An object { success: boolean, message: string }
 */
function handleChangePassword(email, oldPassword, newPassword) {
  if (!email || !oldPassword || !newPassword) {
    Logger.log(`handleChangePassword failed: Missing parameters. Email: ${email}, OldPwd Provided: ${!!oldPassword}, NewPwd Provided: ${!!newPassword}`);
    return { success: false, message: 'Missing required parameters (email, old password, new password).' };
  }

  if (oldPassword === newPassword) {
      Logger.log(`handleChangePassword failed for ${email}: New password cannot be the same as the old password.`);
      return { success: false, message: 'New password cannot be the same as the old password.' };
  }

  // Basic complexity check (example: at least 6 characters)
  if (newPassword.length < 6) {
      Logger.log(`handleChangePassword failed for ${email}: New password is too short.`);
      return { success: false, message: 'New password must be at least 6 characters long.' };
  }


  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(LOGIN_SHEET_NAME);
    if (!sheet) {
      Logger.log(`handleChangePassword: Login sheet "${LOGIN_SHEET_NAME}" not found.`);
      return { success: false, message: 'Password change system not configured (Sheet not found).' };
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      Logger.log(`handleChangePassword: Login sheet "${LOGIN_SHEET_NAME}" is empty.`);
      return { success: false, message: 'Password change system not configured (Sheet empty).' };
    }

    // Column indices (0-based): B=Email(1), C=Password(2)
    const emailCol = 1;
    const passwordCol = 2;

    // Find the user row
    let userRowIndex = -1;
    for (let i = 1; i < data.length; i++) { // Start from 1 to skip header
      const row = data[i];
      const rowEmail = emailCol < row.length ? String(row[emailCol]).trim().toLowerCase() : '';
      if (rowEmail === email.toLowerCase()) {
        userRowIndex = i; // Found the user (0-based index in the data array)
        break;
      }
    }

    if (userRowIndex === -1) {
      Logger.log(`handleChangePassword failed: User not found for email ${email}.`);
      return { success: false, message: 'User not found.' };
    }

    // Verify old password
    const currentRowPassword = passwordCol < data[userRowIndex].length ? String(data[userRowIndex][passwordCol]) : '';
    if (currentRowPassword !== oldPassword) {
      Logger.log(`handleChangePassword failed for ${email}: Incorrect old password provided.`);
      return { success: false, message: 'Incorrect old password.' };
    }

    // Update the password in the sheet
    // Sheet row numbers are 1-based, data array is 0-based. Header is row 1.
    // So, sheet row = userRowIndex + 1
    // Sheet column numbers are 1-based. Password is col C = 3.
    const passwordCell = sheet.getRange(userRowIndex + 1, passwordCol + 1);
    passwordCell.setValue(newPassword);
    SpreadsheetApp.flush(); // Ensure the change is written

    Logger.log(`Password successfully changed for ${email}.`);
    return { success: true, message: 'Password changed successfully.' };

  } catch (error) {
    Logger.log(`Error during handleChangePassword for ${email}: ${error} Stack: ${error.stack}`);
    return { success: false, message: `Password change error: ${error.message}` };
  }
}


// --- CORS Preflight Handler ---
// Keep this for potential future use or complex requests, although simple GET might not trigger it.
function doOptions(e) {
  return ContentService.createTextOutput()
    .withHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', // Keep POST just in case
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
}

// End of script
