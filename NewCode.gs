// New Google Apps Script for TPO Login System with Token Authentication (Dynamic Token Names)
const SPREADSHEET_ID = '1kceGng_G15z6XL1nbEG4aLmnVKn_VbVJMNOvOeVXGEU'; // TPOlogin spreadsheet
const LOGIN_SHEET_NAME = 'Setups'; // Sheet for login credentials
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


// --- Main Request Handler ---

function doGet(e) {
  SpreadsheetApp.getActiveSpreadsheet().setSpreadsheetTimeZone(TIMEZONE);

  const action = e.parameter.action;
  let result;

  try {
    if (action === 'handleLogin') {
      const email = e.parameter.email;
      const password = e.parameter.password;
      result = handleLogin(email, password);

    } else if (action === 'validateSessionToken') { // Renamed action
      const sessionToken = e.parameter.sessionToken; // Renamed parameter
      result = validateSessionToken(sessionToken); // Call renamed function
} else if (action === 'checkAccess') { // Add handler for server-to-server check
  const sessionToken = e.parameter.sessionToken;
  const requiredTokensString = e.parameter.requiredTokensString;
  result = checkAccess(sessionToken, requiredTokensString);

} else {
  result = { success: false, message: 'Invalid action' };
}
    // Extra closing brace removed
  } catch (error) {
    Logger.log(`Error in doGet (Action: ${action}): ${error} Stack: ${error.stack}`);
    result = { success: false, valid: false, message: `Server error: ${error.message}` };
    // Return error with CORS headers
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON)
      .withHeaders({'Access-Control-Allow-Origin': '*'}); // Add CORS header to error response
  }

  // Return success result with CORS headers
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON)
    .withHeaders({'Access-Control-Allow-Origin': '*'}); // Add CORS header to success response
}

// --- Core Logic Functions ---

/**
 * Handles user login based on the migration plan.
 * Validates credentials against the 'Setups' sheet.
 * Generates a sessionToken and optionally a crmApiToken.
 * Stores token data in CacheService.
 * Returns sessionToken, grantedTokens, linkedPage, and crmApiToken.
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
    if (data.length < 2) { // Check for header + at least one data row
      Logger.log(`Login sheet "${LOGIN_SHEET_NAME}" is empty or has no header.`);
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
       Logger.log(`Login sheet "${LOGIN_SHEET_NAME}" is missing required columns (expected at least 4). Found: ${headers.join(', ')}`);
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
           Logger.log(`Login successful for ${rowEmail} but 'Tokens' (Col A) is missing in sheet row ${i+1}.`);
           return { success: false, message: 'Login configuration error for user (missing tokens).' };
        }
         if (!rowLinkedPage) {
           Logger.log(`Login successful for ${rowEmail} but 'Linked Page' (Col D) is missing in sheet row ${i+1}.`);
           return { success: false, message: 'Login configuration error for user (missing redirect).' };
        }

        // Parse comma-separated tokens, trim whitespace
        const grantedTokenNames = rowTokensString.split(',').map(t => t.trim()).filter(t => t); // Filter out empty strings

        if (grantedTokenNames.length === 0) {
           Logger.log(`Login successful for ${rowEmail} but 'Tokens' (Col A) contains no valid tokens in sheet row ${i+1}. Value: "${rowTokensString}"`);
           return { success: false, message: 'Login configuration error for user (invalid tokens).' };
        }

        const cache = CacheService.getScriptCache();

        // Generate and store session token
        const sessionToken = Utilities.getUuid();
        const sessionData = { email: rowEmail, tokens: grantedTokenNames };
        cache.put(sessionToken, JSON.stringify(sessionData), TOKEN_EXPIRATION_SECONDS);
        Logger.log(`Stored session token for ${rowEmail}. Token: ${sessionToken}, Expires in: ${TOKEN_EXPIRATION_SECONDS}s`);

        // crmApiToken generation and storage removed as per clean architecture plan

        Logger.log(`Login successful for ${rowEmail}. Granted Tokens: ${grantedTokenNames.join(', ')}. Redirect: ${rowLinkedPage}.`);
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

    Logger.log(`Login failed for ${email}: Invalid credentials.`);
    return { success: false, message: 'Invalid credentials' };

  } catch (error) {
    Logger.log(`Error during handleLogin for ${email}: ${error} Stack: ${error.stack}`);
    return { success: false, message: `Login error: ${error.message}` };
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
  Logger.log(`checkAccess called. Token: ${sessionToken}, Required: ${requiredTokensString}`);

  // 1. Validate the session token itself
  const validationResult = validateSessionToken(sessionToken); // Uses CacheService

  if (!validationResult || !validationResult.valid) {
    Logger.log(`checkAccess: Session token validation failed.`);
    return { authorized: false, email: null, message: "Invalid or expired session." };
  }

  // 2. Parse required tokens
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
    // If no required tokens are specified, deny access for safety.
    Logger.log(`checkAccess: No required tokens specified.`);
    return { authorized: false, email: validationResult.email, message: "No required permissions specified for check." };
  }

  // 3. Check if granted tokens include all required tokens
  const grantedTokens = validationResult.tokens || []; // Ensure it's an array
  const hasAllRequired = requiredTokensArray.every(reqToken => grantedTokens.includes(reqToken));

  if (hasAllRequired) {
    Logger.log(`checkAccess: Authorization successful for ${validationResult.email}.`);
    return { authorized: true, email: validationResult.email };
  } else {
    Logger.log(`checkAccess: Authorization failed for ${validationResult.email}. Missing required tokens.`);
    return { authorized: false, email: validationResult.email, message: "Insufficient permissions." };
  }
}

function doOptions(e) {
  // Standard CORS preflight response
  return ContentService.createTextOutput()
    .withHeaders({
      'Access-Control-Allow-Origin': '*', // Allow all origins
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', // Allowed methods
      'Access-Control-Allow-Headers': 'Content-Type, Authorization', // Allowed headers (adjust if needed)
      'Access-Control-Max-Age': '86400' // Cache preflight response for 1 day
    });
}

// End of script