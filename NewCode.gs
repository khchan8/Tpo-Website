// New Google Apps Script for TPO Login System with Token Authentication (Dynamic Token Names)
const SPREADSHEET_ID = '1kceGng_G15z6XL1nbEG4aLmnVKn_VbVJMNOvOeVXGEU'; // TPOlogin spreadsheet
const LOGIN_SHEET_NAME = 'Setups'; // Sheet for login credentials
const DEBUG_SHEET_NAME = 'DebugLog'; // <<< ADD THIS LINE - Sheet for debug logging
const TIMEZONE = 'Asia/Bangkok';
const TOKEN_EXPIRATION_SECONDS = 14 * 24 * 60 * 60; // Session Token validity period (14 days in seconds)
const CRM_TOKEN_EXPIRATION_SECONDS = 7 * 24 * 60 * 60; // CRM API Token validity period (7 days in seconds)

// --- Helper Functions ---

// generateToken, storeToken functions removed as per migration plan (using CacheService and Utilities.getUuid)

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

    // CacheService handles expiration automatically, so no need to check expires property.

    Logger.log(`Session token validation successful for ${cachedData.email} (Token: ${sessionToken})`);
    return { valid: true, email: cachedData.email, tokens: cachedData.tokens }; // Return email and tokens

  } catch (error) {
    Logger.log(`Error validating session token (${sessionToken}): ${error}`);
    return { valid: false, email: null, tokens: null };
  }
}

// cleanupExpiredTokens removed as per migration plan (CacheService handles expiration)


// --- Helper Function for Sheet Logging --- <<< ADD THIS FUNCTION
function logToSheet(message) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(DEBUG_SHEET_NAME);
    if (sheet) {
      const timestamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss.SSS');
      sheet.appendRow([timestamp, message]);
    } else {
      // Fallback if sheet doesn't exist (less likely to work if Logger fails)
      Logger.log('Debug sheet "' + DEBUG_SHEET_NAME + '" not found. Log attempt: ' + message); // Replaced template literal
    }
  } catch (err) {
     Logger.log('Error logging to sheet: ' + err + '. Original message: ' + message); // Replaced template literal
  }
}

// --- Main Request Handler ---

function doGet(e) {
  logToSheet(`doGet triggered. Raw parameters: ${JSON.stringify(e.parameter)}`); // <<< ADD LOG
  try { // <<< ADD TRY AROUND TIMEZONE SETTING
    SpreadsheetApp.getActiveSpreadsheet().setSpreadsheetTimeZone(TIMEZONE);
  } catch (tzError) {
    logToSheet(`Error setting timezone: ${tzError}`);
    // Attempt to continue, but log the error
  }
  const action = e.parameter.action;
  let result;

  // --- Handle API Actions ---
  try {
    if (action === 'handleLogin') {
      logToSheet(`doGet: Action is handleLogin. Email: ${e.parameter.email}`); // <<< ADD LOG
      const email = e.parameter.email;
      const password = e.parameter.password;
      result = handleLogin(email, password); // Returns JS object
      logToSheet(`doGet: handleLogin returned: ${JSON.stringify(result)}`); // <<< ADD LOG

    } else if (action === 'validateSessionToken') {
      const sessionToken = e.parameter.sessionToken;
      result = validateSessionToken(sessionToken); // Returns JS object

    } else if (action === 'checkAccess') {
      const sessionToken = e.parameter.sessionToken;
      const requiredTokensString = e.parameter.requiredTokensString;
      result = checkAccess(sessionToken, requiredTokensString); // Returns JS object

    } else {
      result = { success: false, message: 'Invalid GET action' };
    }

    // *** JSONP Workaround Implementation (Success Path) ***
    const callback = e.parameter.callback; // Check for JSONP callback

    if (callback) {
      // JSONP Response
      logToSheet('doGet Success: Preparing JSONP response for callback: ' + callback);
      const jsonp = callback + '(' + JSON.stringify(result) + ');';
      return ContentService.createTextOutput(jsonp)
        .setMimeType(ContentService.MimeType.JAVASCRIPT); // Use JAVASCRIPT MimeType
    } else {
      // Standard JSON Response (Attempting original method, likely fails in V8)
      logToSheet('doGet Success: Preparing standard JSON response (callback not provided).');
      Logger.log('doGet Success: Preparing to return result for action \'' + action + '\'. Adding CORS header.'); // Replaced template literal
      const output = ContentService.createTextOutput(JSON.stringify(result)); // Store object
      output.setMimeType(ContentService.MimeType.JSON); // Restore MimeType
      let constructorName = 'N/A'; try { constructorName = output.constructor.name; } catch (err) {} // Rhino-compatible catch
      logToSheet('doGet Success: Output object created. Type: ' + (typeof output) + '. Constructor: ' + constructorName + '. Attempting setHeaders.'); // Replaced template literal
      try {
        output.setHeaders({'Access-Control-Allow-Origin': '*'}); // Call setHeaders separately
        logToSheet('doGet Success: setHeaders called successfully.'); // Replaced template literal
      } catch (headerError) {
        logToSheet('doGet Success Path CRITICAL HEADER ERROR: ' + headerError + '. Stack: ' + headerError.stack); // Replaced template literal
        // Fallback: Return without headers if setHeaders fails, but log it
      }
      return output; // Return the modified object
    }

  } catch (error) {
    logToSheet('doGet CRITICAL ERROR: ' + error + '. Stack: ' + error.stack + '. Action: ' + action + '.'); // Replaced template literal
    Logger.log('Error in doGet API action (Action: ' + action + '): ' + error + ' Stack: ' + error.stack); // Replaced template literal
    result = { success: false, message: 'Server error processing API action: ' + error.message }; // Replaced template literal

    // *** JSONP Workaround Implementation (Error Path) ***
    const callback = e.parameter.callback; // Check for JSONP callback again

    if (callback) {
       logToSheet('doGet Error Path: Preparing JSONP error response for callback: ' + callback);
       const jsonpError = callback + '(' + JSON.stringify(result) + ');';
       return ContentService.createTextOutput(jsonpError)
         .setMimeType(ContentService.MimeType.JAVASCRIPT);
    } else {
       // Standard JSON Error Response (Attempting original method, likely fails in V8)
       logToSheet('doGet Error Path: Preparing standard JSON error response.');
       Logger.log('doGet Error: Preparing to return error result for action \'' + action + '\'. Adding CORS header.'); // Replaced template literal
       const errorOutput = ContentService.createTextOutput(JSON.stringify(result)); // Store object
       errorOutput.setMimeType(ContentService.MimeType.JSON); // Restore MimeType
       let errorConstructorName = 'N/A'; try { errorConstructorName = errorOutput.constructor.name; } catch (err) {} // Rhino-compatible catch
       logToSheet('doGet Error Path: Output object created. Type: ' + (typeof errorOutput) + '. Constructor: ' + errorConstructorName + '. Attempting setHeaders.'); // Replaced template literal
       try {
         errorOutput.setHeaders({'Access-Control-Allow-Origin': '*'}); // Call setHeaders separately
         logToSheet('doGet Error Path: setHeaders called successfully.'); // Replaced template literal
       } catch (headerError) {
         logToSheet('doGet Error Path CRITICAL HEADER ERROR: ' + headerError + '. Stack: ' + headerError.stack); // Replaced template literal
         // Fallback: Return without headers if setHeaders fails, but log it
       }
       return errorOutput; // Correctly placed return
    } // Correctly placed brace for else
  } // Correctly placed brace for main catch
} // Correctly placed brace for doGet function


// --- POST Request Handler (Simplified for CORS Testing) ---
function doPost(e) {
  SpreadsheetApp.getActiveSpreadsheet().setSpreadsheetTimeZone(TIMEZONE);
  let result;
  let action = 'unknown';

  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("No POST data received.");
    }
    const requestData = JSON.parse(e.postData.contents);
    action = requestData.action || 'unknown';
    Logger.log('TEST doPost received action: ' + action); // Replaced template literal

    // For testing, just acknowledge the action
    result = { success: true, message: 'Test POST action \'' + action + '\' received successfully.' }; // Replaced template literal

  } catch (error) {
    Logger.log('Error in TEST doPost (Action: ' + action + '): ' + error + ' Stack: ' + error.stack); // Replaced template literal
    result = { success: false, message: 'Server error in TEST doPost: ' + error.message }; // Replaced template literal
  }

  // Return response WITH CORS headers (as per Plan v3 for cross-origin POST)
  const postOutput = ContentService.createTextOutput(JSON.stringify(result)); // Store object
  postOutput.setMimeType(ContentService.MimeType.JSON); // Restore MimeType
  // No sheet logging in doPost for simplicity, assume doGet is the main issue
  try {
    postOutput.setHeaders({'Access-Control-Allow-Origin': '*'}); // Call setHeaders separately
  } catch (headerError) {
     Logger.log('doPost CRITICAL HEADER ERROR: ' + headerError + '. Stack: ' + headerError.stack); // Replaced template literal
     // Fallback: Return without headers if setHeaders fails, but log it
  }
  return postOutput; // Return the modified object
}

// --- Core Logic Functions (Keep handleLogin, validateSessionToken, checkAccess, handleChangePassword) ---
// NOTE: handleChangePassword will not be called by the simplified doPost above, this is just for testing CORS preflight.

/**
 * Handles user login based on the migration plan.
 * Validates credentials against the 'Setups' sheet.
 * Generates a sessionToken and optionally a crmApiToken.
 * Stores token data in CacheService.
 * Returns sessionToken, grantedTokens, linkedPage, and crmApiToken.
 */
function handleLogin(email, password) {
  logToSheet('handleLogin started. Email: ' + email); // Replaced template literal
  if (!email || !password) {
    logToSheet('handleLogin returning error: Missing parameters.'); // Replaced template literal
    return { success: false, message: 'Missing required parameters (email, password)' };
  }

  try {
    logToSheet('handleLogin: Attempting to open sheet ID: ' + SPREADSHEET_ID + ', Name: ' + LOGIN_SHEET_NAME); // Replaced template literal
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(LOGIN_SHEET_NAME);
    if (!sheet) {
      Logger.log('Login sheet "' + LOGIN_SHEET_NAME + '" not found.'); // Replaced template literal
      return { success: false, message: 'Login system not configured (Sheet not found)' };
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) { // Check for header + at least one data row
      Logger.log('Login sheet "' + LOGIN_SHEET_NAME + '" is empty or has no header.'); // Replaced template literal
      return { success: false, message: 'Login system not configured (Sheet empty)' };
    }
    const headers = data[0].map(h => String(h).trim().toLowerCase()); // Normalize headers

    // Get column indices based on plan (A=Tokens, B=Email, C=Password, D=Linked Page)
    // Assuming 0-based index: A=0, B=1, C=2, D=3
    const tokensCol = 0; // Column A
    const emailCol = 1; // Column B
    const passwordCol = 2; // Column C
    const linkedPageCol = 3; // Column D

    // Basic validation if columns exist (adjust if headers are different)
    if (data[0].length < 4) {
       Logger.log('Login sheet "' + LOGIN_SHEET_NAME + '" is missing required columns (expected at least 4). Found: ' + headers.join(', ')); // Replaced template literal
       return { success: false, message: 'Login system misconfigured (Missing columns)' };
    }

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowTokensString = tokensCol < row.length ? String(row[tokensCol]).trim() : '';
      const rowEmail = emailCol < row.length ? String(row[emailCol]).trim().toLowerCase() : '';
      const rowPassword = passwordCol < row.length ? String(row[passwordCol]) : ''; // Keep original case for password
      const rowLinkedPage = linkedPageCol < row.length ? String(row[linkedPageCol]).trim() : '';

      // Validate email and password match
      if (rowEmail === email.toLowerCase() && rowPassword === password) {

        if (!rowTokensString) {
           Logger.log('Login successful for ' + rowEmail + ' but \'Tokens\' (Col A) is missing in sheet row ' + (i+1) + '.'); // Replaced template literal
           return { success: false, message: 'Login configuration error for user (missing tokens).' };
        }
         if (!rowLinkedPage) {
           Logger.log('Login successful for ' + rowEmail + ' but \'Linked Page\' (Col D) is missing in sheet row ' + (i+1) + '.'); // Replaced template literal
           return { success: false, message: 'Login configuration error for user (missing redirect).' };
        }

        // Parse comma-separated tokens, trim whitespace
        const grantedTokenNames = rowTokensString.split(',').map(t => t.trim()).filter(t => t); // Filter out empty strings

        if (grantedTokenNames.length === 0) {
           Logger.log('Login successful for ' + rowEmail + ' but \'Tokens\' (Col A) contains no valid tokens in sheet row ' + (i+1) + '. Value: "' + rowTokensString + '"'); // Replaced template literal
           return { success: false, message: 'Login configuration error for user (invalid tokens).' };
        }

        const cache = CacheService.getScriptCache();

        // Generate and store session token
        const sessionToken = Utilities.getUuid();
        const sessionData = { email: rowEmail, tokens: grantedTokenNames };
        cache.put(sessionToken, JSON.stringify(sessionData), TOKEN_EXPIRATION_SECONDS);
        Logger.log('Stored session token for ' + rowEmail + '. Token: ' + sessionToken + ', Expires in: ' + TOKEN_EXPIRATION_SECONDS + 's'); // Replaced template literal

        // crmApiToken generation and storage removed as per clean architecture plan

        Logger.log('Login successful for ' + rowEmail + '. Granted Tokens: ' + grantedTokenNames.join(', ') + '. Redirect: ' + rowLinkedPage + '.'); // Replaced template literal
        return {
          success: true,
          sessionToken: sessionToken,
          grantedTokens: grantedTokenNames, // Array of granted token names
          linkedPage: rowLinkedPage,
          // crmApiToken removed
          email: rowEmail // <--- ADD THIS LINE
        };
      }
    }

    Logger.log('Login failed for ' + email + ': Invalid credentials.'); // Replaced template literal
    return { success: false, message: 'Invalid credentials' };

  } catch (error) {
    Logger.log('Error during handleLogin for ' + email + ': ' + error + ' Stack: ' + error.stack); // Replaced template literal
    return { success: false, message: 'Login error: ' + error.message }; // Replaced template literal
  }
}

/**
 * Checks if a session token is valid and grants access to specific required tokens.
 * To be called server-side by other scripts (e.g., Code.gs) via UrlFetchApp.
 * @param {string} sessionToken The session token to validate.
 * @param {string} requiredTokensString A JSON string representing an array of required token names (e.g., '["tpoCRMToken"]').
 * @return {object} An object { authorized: boolean, email: string|null, message?: string }
 */
function checkAccess(sessionToken, requiredTokensString) {
  Logger.log('checkAccess called. Token: ' + sessionToken + ', Required: ' + requiredTokensString); // Replaced template literal

  // 1. Validate the session token itself
  const validationResult = validateSessionToken(sessionToken); // Uses CacheService

  if (!validationResult || !validationResult.valid) {
    Logger.log('checkAccess: Session token validation failed.'); // Replaced template literal
    return { authorized: false, email: null, message: "Invalid or expired session." };
  }

  // 2. Parse required tokens
  let requiredTokensArray = [];
  if (requiredTokensString) {
    try {
      requiredTokensArray = JSON.parse(requiredTokensString);
      if (!Array.isArray(requiredTokensArray)) {
        Logger.log('checkAccess: requiredTokensString did not parse into an array.'); // Replaced template literal
        return { authorized: false, email: validationResult.email, message: "Internal error: Invalid required tokens format." };
      }
    } catch (e) {
      Logger.log('checkAccess: Error parsing requiredTokensString JSON: ' + e); // Replaced template literal
      return { authorized: false, email: validationResult.email, message: "Internal error: Could not parse required tokens." };
    }
  } else {
    // If no required tokens are specified, deny access for safety.
    Logger.log('checkAccess: No required tokens specified.'); // Replaced template literal
    return { authorized: false, email: validationResult.email, message: "No required permissions specified for check." };
  }

  // 3. Check if granted tokens include all required tokens
  const grantedTokens = validationResult.tokens || []; // Ensure it's an array
  const hasAllRequired = requiredTokensArray.every(reqToken => grantedTokens.includes(reqToken));

  if (hasAllRequired) {
    Logger.log('checkAccess: Authorization successful for ' + validationResult.email + '.'); // Replaced template literal
    return { authorized: true, email: validationResult.email };
  } else {
    Logger.log('checkAccess: Authorization failed for ' + validationResult.email + '. Missing required tokens.'); // Replaced template literal
    return { authorized: false, email: validationResult.email, message: "Insufficient permissions." };
  }
}


/**
 * Handles password change requests.
 * Finds user by email, verifies current password, updates to new password in the sheet.
 * @param {object} requestData Parsed JSON object containing { email, currentPassword, newPassword }.
 * @return {object} An object { success: boolean, message: string }.
 */
function handleChangePassword(requestData) {
  const { email, currentPassword, newPassword } = requestData;
  Logger.log('handleChangePassword called for email: ' + email); // Replaced template literal

  // Basic validation (already done in doPost, but good practice)
  if (!email || !currentPassword || !newPassword) {
    return { success: false, message: 'Missing required parameters.' };
  }

  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(LOGIN_SHEET_NAME);
    if (!sheet) {
      Logger.log('Password change failed: Login sheet "' + LOGIN_SHEET_NAME + '" not found.'); // Replaced template literal
      return { success: false, message: 'System configuration error (Sheet not found).' };
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      Logger.log('Password change failed: Login sheet "' + LOGIN_SHEET_NAME + '" is empty.'); // Replaced template literal
      return { success: false, message: 'System configuration error (Sheet empty).' };
    }

    // Assuming columns: A=Tokens(0), B=Email(1), C=Password(2), D=Linked Page(3)
    const emailCol = 1;
    const passwordCol = 2;
    let userFound = false;
    let rowIndex = -1; // 0-based index in the data array

    // Find the user row (start from 1 to skip header)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowEmail = emailCol < row.length ? String(row[emailCol]).trim().toLowerCase() : '';

      if (rowEmail === email.toLowerCase()) {
        userFound = true;
        rowIndex = i; // Store the 0-based index
        break;
      }
    }

    if (!userFound) {
      Logger.log('Password change failed: Email "' + email + '" not found.'); // Replaced template literal
      return { success: false, message: 'Email address not found.' };
    }

    // User found, check current password (Column C, index 2)
    const storedPassword = passwordCol < data[rowIndex].length ? String(data[rowIndex][passwordCol]) : '';

    if (storedPassword !== currentPassword) {
      Logger.log('Password change failed for ' + email + ': Incorrect current password provided.'); // Replaced template literal
      return { success: false, message: 'Incorrect current password.' };
    }

    // Current password matches, update the password
    // Get the cell range (rowIndex is 0-based, sheet range is 1-based; passwordCol is 0-based, sheet col is 1-based)
    const passwordCell = sheet.getRange(rowIndex + 1, passwordCol + 1);
    passwordCell.setValue(newPassword);
    SpreadsheetApp.flush(); // Ensure the change is written

    Logger.log('Password successfully updated for ' + email + '.'); // Replaced template literal
    return { success: true, message: 'Password updated successfully.' };

  } catch (error) {
    Logger.log('Error during handleChangePassword for ' + email + ': ' + error + ' Stack: ' + error.stack); // Replaced template literal
    return { success: false, message: 'Password update error: ' + error.message }; // Replaced template literal
  }
}


// --- doOptions (Ensure this is correct for Preflight Testing) ---
function doOptions(e) {
  // --- Simplified for Debugging ---
  // Just try to log that this function was entered at all.
  try {
     logToSheet('--- MINIMAL doOptions EXECUTED ---');
     Logger.log('--- MINIMAL doOptions EXECUTED ---');
  } catch (logErr) {
     // If even logging fails, something is very wrong early on.
     // We can't easily log this failure itself.
  }
  // Return a minimal response, though it won't have correct headers if ContentService fails.
  return ContentService.createTextOutput('');
}