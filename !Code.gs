// New Google Apps Script for TPO Login System with Token Authentication
const SPREADSHEET_ID = '1kceGng_G15z6XL1nbEG4aLmnVKn_VbVJMNOvOeVXGEU'; // TPOlogin spreadsheet
const LOGIN_SHEET_NAME = 'Setups'; // Sheet for login credentials
const TIMEZONE = 'Asia/Bangkok';
const TOKEN_EXPIRATION_DAYS = 14; // Token validity period

// --- Helper Functions ---

/**
 * Generates a simple random token.
 * For production, consider a more robust method (e.g., UUID library or crypto).
 */
function generateToken() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Stores token information in Script Properties.
 * @param {string} token The token to store.
 * @param {string} email The user's email associated with the token.
 */
function storeToken(token, email) {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const expirationTime = new Date().getTime() + (TOKEN_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
    const tokenData = JSON.stringify({
      email: email,
      expires: expirationTime
    });
    scriptProperties.setProperty(token, tokenData);
    Logger.log(`Stored token for ${email}, expires: ${new Date(expirationTime).toLocaleString(TIMEZONE)}`);
    // Optional: Call cleanup function periodically
    // cleanupExpiredTokens();
  } catch (error) {
    Logger.log(`Error storing token for ${email}: ${error}`);
  }
}

/**
 * Validates a token against stored properties and checks expiration.
 * @param {string} token The token to validate.
 * @return {object} An object { valid: boolean, email: string|null }
 */
function validateToken(token) {
  if (!token) {
    return { valid: false, email: null };
  }
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const tokenDataString = scriptProperties.getProperty(token);

    if (!tokenDataString) {
      Logger.log(`Token validation failed: Token not found (${token})`);
      return { valid: false, email: null };
    }

    const tokenData = JSON.parse(tokenDataString);
    const now = new Date().getTime();

    if (now > tokenData.expires) {
      Logger.log(`Token validation failed: Token expired for ${tokenData.email} (${token})`);
      // Clean up expired token immediately
      scriptProperties.deleteProperty(token);
      return { valid: false, email: null };
    }

    Logger.log(`Token validation successful for ${tokenData.email} (${token})`);
    return { valid: true, email: tokenData.email };

  } catch (error) {
    Logger.log(`Error validating token (${token}): ${error}`);
    return { valid: false, email: null };
  }
}

/**
 * (Optional) Cleans up expired tokens from Script Properties.
 * Can be run periodically via a time-driven trigger.
 */
function cleanupExpiredTokens() {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const allKeys = scriptProperties.getKeys();
    const now = new Date().getTime();
    let deletedCount = 0;

    allKeys.forEach(key => {
      try {
        const tokenDataString = scriptProperties.getProperty(key);
        if (tokenDataString) {
          const tokenData = JSON.parse(tokenDataString);
          // Check if it looks like our token data (has 'expires')
          if (tokenData && tokenData.expires && now > tokenData.expires) {
            scriptProperties.deleteProperty(key);
            deletedCount++;
            Logger.log(`Deleted expired token for ${tokenData.email || 'unknown'} (Key: ${key})`);
          }
        }
      } catch (parseError) {
        // Ignore keys that aren't valid JSON or don't match our structure
      }
    });
    if (deletedCount > 0) {
      Logger.log(`Cleanup complete. Deleted ${deletedCount} expired tokens.`);
    }
  } catch (error) {
    Logger.log(`Error during token cleanup: ${error}`);
  }
}


// --- Main Request Handler ---

function doGet(e) {
  SpreadsheetApp.getActiveSpreadsheet().setSpreadsheetTimeZone(TIMEZONE);

  const action = e.parameter.action;
  let result;

  try {
    if (action === 'handleLogin') {
      const email = e.parameter.email;
      const password = e.parameter.password;
      const userType = e.parameter.type; // 'employee' or 'customer'
      result = handleLogin(email, password, userType);

    } else if (action === 'validateToken') {
      const token = e.parameter.token;
      result = validateToken(token); // Directly use the result object

    } else {
      result = { success: false, message: 'Invalid action' };
    }
  } catch (error) {
    Logger.log(`Error in doGet (Action: ${action}): ${error} Stack: ${error.stack}`);
    // Ensure result is always an object for JSON stringify
    result = { success: false, valid: false, message: `Server error: ${error.message}` };
  }

  // Always return JSON
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- Core Logic Functions ---

/**
 * Handles user login, validates credentials, generates and stores a token.
 * Returns an object with success status, token, and email.
 */
function handleLogin(email, password, userType) {
  if (!email || !password || !userType) {
    return { success: false, message: 'Missing required parameters (email, password, type)' };
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
    const headers = data[0].map(h => String(h).trim());

    const typeCol = headers.indexOf('Type');
    const emailCol = headers.indexOf('email');
    const passwordCol = headers.indexOf('password');
    // linkedPageCol is no longer needed for redirect decision here

    if (typeCol === -1 || emailCol === -1 || passwordCol === -1) {
      Logger.log(`Login sheet "${LOGIN_SHEET_NAME}" is missing required columns. Found: ${headers.join(', ')}`);
      return { success: false, message: 'Login system misconfigured (Missing columns)' };
    }

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowType = typeCol < row.length ? String(row[typeCol]).trim() : '';
      const rowEmail = emailCol < row.length ? String(row[emailCol]).trim().toLowerCase() : '';
      const rowPassword = passwordCol < row.length ? String(row[passwordCol]) : '';

      if (rowType === userType &&
          rowEmail === email.toLowerCase() &&
          rowPassword === password) {

        const userEmail = rowEmail; // Get the validated email
        const token = generateToken();
        storeToken(token, userEmail); // Store the token with email and expiration

        Logger.log(`Login successful for ${userEmail} (${userType}). Token generated.`);
        return {
          success: true,
          token: token, // Return the token
          email: userEmail // Return the email
        };
      }
    }

    Logger.log(`Login failed for ${email} (${userType}): Invalid credentials.`);
    return { success: false, message: 'Invalid credentials' };

  } catch (error) {
    Logger.log(`Error during handleLogin for ${email} (${userType}): ${error}`);
    return { success: false, message: `Login error: ${error.message}` };
  }
}

// getDefaultRedirect is no longer used by handleLogin but might be useful elsewhere
function getDefaultRedirect(userType) {
  return userType === 'employee'
    ? 'erp.html' // Use relative path now, client will handle full URL
    : 'customer_dashboard.html'; // Example for customer
}