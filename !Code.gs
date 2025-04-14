// New Google Apps Script for TPO Login System
const SPREADSHEET_ID = '1kceGng_G15z6XL1nbEG4aLmnVKn_VbVJMNOvOeVXGEU'; // Change to TPOlogin spreadsheet
const LOGIN_SHEET_NAME = 'Setups'; // New sheet for login credentials
const TIMEZONE = 'Asia/Bangkok';

function doGet(e) {
  SpreadsheetApp.getActiveSpreadsheet().setSpreadsheetTimeZone(TIMEZONE);
  
  const action = e.parameter.action;
  let result;

  try {
    if (action === 'handleLogin') {
      const email = e.parameter.email;
      const password = e.parameter.password;
      const userType = e.parameter.type; // 'employee' or 'customer'
      
      result = handleLogin(email, password, userType); // handleLogin will now return the JSON object directly
    } else {
      result = {success: false, message: 'Invalid action'};
    }
  } catch (error) {
      Logger.log(`Error in doGet (Action: ${action}): ${error} Stack: ${error.stack}`);
      result = {success: false, message: `Server error: ${error.message}`};
  }
  
  // Always return JSON
  return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
}

// This function now returns a plain JavaScript object, not a ContentService output
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
    if (data.length < 2) { // No header or no data rows
        Logger.log(`Login sheet "${LOGIN_SHEET_NAME}" is empty or has no header.`);
        return { success: false, message: 'Login system not configured (Sheet empty)' };
    }
    const headers = data[0].map(h => String(h).trim()); // Trim headers
    
    // Find column indexes
    const typeCol = headers.indexOf('Type');
    const emailCol = headers.indexOf('email');
    const passwordCol = headers.indexOf('password');
    const linkedPageCol = headers.indexOf('linked page');
    
    if (typeCol === -1 || emailCol === -1 || passwordCol === -1 || linkedPageCol === -1) {
      Logger.log(`Login sheet "${LOGIN_SHEET_NAME}" is missing required columns. Found: ${headers.join(', ')}`);
      return { success: false, message: 'Login system misconfigured (Missing columns)' };
    }
    
    // Search for matching user (start from row 1, skipping header)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // Ensure columns exist before accessing and convert to string/lowercase
      const rowType = typeCol < row.length ? String(row[typeCol]).trim() : '';
      const rowEmail = emailCol < row.length ? String(row[emailCol]).trim().toLowerCase() : '';
      const rowPassword = passwordCol < row.length ? String(row[passwordCol]) : ''; // Password is case-sensitive
      const rowLinkedPage = linkedPageCol < row.length ? String(row[linkedPageCol]).trim() : '';

      if (rowType === userType &&
          rowEmail === email.toLowerCase() &&
          rowPassword === password) {
        
        Logger.log(`Login successful for ${email} (${userType}). Redirecting to: ${rowLinkedPage || getDefaultRedirect(userType)}`);
        return {
            success: true,
            linkedPage: rowLinkedPage || getDefaultRedirect(userType) // Return the redirect URL
        };
      }
    }
    
    // If loop completes without finding a match
    Logger.log(`Login failed for ${email} (${userType}): Invalid credentials.`);
    return { success: false, message: 'Invalid credentials' };
    
  } catch (error) {
    Logger.log(`Error during handleLogin for ${email} (${userType}): ${error}`);
    return { success: false, message: `Login error: ${error.message}` };
  }
}

function getDefaultRedirect(userType) {
  return userType === 'employee' 
    ? 'https://tpowellness.com/erp.html' 
    : 'https://tpowellness.com/customer_dashboard.html';
}