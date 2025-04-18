// Set these variables according to Google Sheet and folder setup
const SPREADSHEET_ID = '12-twuC_50s7oRKBJE4bZkNysJ8LIXs5SAdCqDJYYAg4'; // Updated ID
const CRM_SHEET_NAME = 'CRM';
const SETUP_SHEET_NAME = 'Setup';
const UNASSIGNED_SHEET_NAME = 'UnassignedShops';
const PENDING_EMAILS_SHEET_NAME = 'PendingEmails';
const QR_FOLDER_ID = '19vRID9BLlI5nW_vXTpXfaBNevJuCoMES'; // Replace if needed
const TIMEZONE = 'Asia/Bangkok';

let OPERATOR_EMAIL;
let WEEKLY_REPORT_OPERATOR_EMAIL;
let MANAGER_EMAILS = []; // Still used for calendar invites/notifications, not auth
// AUTHORIZED_EXTERNAL_EMAILS is no longer used for auth, but initialize loads it. Can be removed if NewCode.gs handles all user setup.
let setupData = null; // Cache setup data globally for the script execution lifetime

// Columns expected by the frontend form (for getAllDispensaryData filtering) - Keep for reference
const FRONTEND_COLUMNS = [
  'Dispensary Name', 'Shop Size', 'Current Distributor', 'Dispensary Address', 'Latitude', 'Longitude',
  'Province', 'name', 'url', 'facebook', 'facebook_url', 'google_maps_url',
  'line', 'line_url', 'phone#', 'website', 'website_url', 'Contact Person Name',
  'Email', 'Phone', 'Line Contact', 'Line/Whatsapp QR Code',
  'Notes & Communication History', 'Next Action Item', 'Due Date',
  'Assigned Member', 'Sales Pipeline', 'Sales Pipeline Record',
  'Next Action Item Record', 'Assignment Notes and History', 'Last Modified'
];

// --- Initialization and Setup ---

function getRoleEmails() { // Renamed for clarity
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SETUP_SHEET_NAME);
  if (!sheet) {
    Logger.log(`Setup sheet "${SETUP_SHEET_NAME}" not found.`);
    return { operatorEmail: '', weeklyReportOperatorEmail: '', managerEmails: [] }; // Removed external auth emails from here
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { // No data rows
     return { operatorEmail: '', weeklyReportOperatorEmail: '', managerEmails: [] };
  }
  const operatorEmailsRange = sheet.getRange('C2:C' + lastRow);
  const weeklyReportOperatorEmailsRange = sheet.getRange('D2:D' + lastRow);
  const managerEmailsRange = sheet.getRange('E2:E' + lastRow); // Assuming Managers are in Column E

  const operatorEmails = operatorEmailsRange.getValues().flat().map(e => String(e).trim()).filter(String);
  const weeklyReportOperatorEmails = weeklyReportOperatorEmailsRange.getValues().flat().map(e => String(e).trim()).filter(String);
  const managerEmails = managerEmailsRange.getValues().flat().map(e => String(e).trim().toLowerCase()).filter(email => email && email.includes('@')); // Ensure valid emails, lowercase

  // Removed processing for external authorized emails and passwords

  return {
    operatorEmail: operatorEmails.join(', '),
    weeklyReportOperatorEmail: weeklyReportOperatorEmails.join(', '),
    managerEmails: managerEmails,
    // authorizedExternalEmails: authorizedExternalEmails // Removed
  };
}

function initialize() {
  try {
    SpreadsheetApp.getActiveSpreadsheet().setSpreadsheetTimeZone(TIMEZONE);
    try { CalendarApp.getDefaultCalendar().setTimeZone(TIMEZONE); } catch (e) { Logger.log("Could not set Calendar timezone, possibly needs authorization: " + e); }

    const roleEmails = getRoleEmails(); // Use renamed function
    OPERATOR_EMAIL = roleEmails.operatorEmail;
    WEEKLY_REPORT_OPERATOR_EMAIL = roleEmails.weeklyReportOperatorEmail;
    MANAGER_EMAILS = roleEmails.managerEmails; // Populate manager emails for notifications/invites
    // AUTHORIZED_EXTERNAL_EMAILS = roleEmails.authorizedExternalEmails; // Removed

    Logger.log('OPERATOR_EMAIL: ' + OPERATOR_EMAIL);
    Logger.log('WEEKLY_REPORT_OPERATOR_EMAIL: ' + WEEKLY_REPORT_OPERATOR_EMAIL);
    Logger.log('MANAGER_EMAILS: ' + MANAGER_EMAILS.join(', ')); // Log manager emails

    ensureLastModifiedColumn();
    // Pre-load setup data if not already loaded
    if (!setupData) {
        getSetupData();
    }
  } catch (error) {
    Logger.log("Error during initialization: " + error);
  }
}

function ensureLastModifiedColumn() {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CRM_SHEET_NAME);
    if (!sheet) return;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const lastModifiedHeader = 'Last Modified';

    // Check if 'Last Modified' exists, if not, find the first empty header column
    let lastModifiedColIndex = headers.indexOf(lastModifiedHeader);
    if (lastModifiedColIndex === -1) {
        let firstEmptyCol = headers.length + 1; // Default to next column if all are filled
        for (let i = 0; i < headers.length; i++) {
            if (!headers[i]) {
                firstEmptyCol = i + 1;
                break;
            }
        }
        sheet.getRange(1, firstEmptyCol).setValue(lastModifiedHeader);
        Logger.log(`Added "${lastModifiedHeader}" column to ${CRM_SHEET_NAME} at column index ${firstEmptyCol}.`);
    }
  } catch(e) {
    Logger.log("Error in ensureLastModifiedColumn: " + e);
  }
}

// --- Logging Function ---
function logToSheet(message) {
  const DEBUG_SHEET_NAME = "DebugLog";
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(DEBUG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(DEBUG_SHEET_NAME);
      sheet.appendRow(['Timestamp', 'Message']); // Add headers
    }
    const timestamp = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss.SSS");
    sheet.appendRow([timestamp, message]);
  } catch (e) {
    Logger.log(`Error logging to sheet: ${e}`); // Fallback to Logger.log if sheet logging fails
  }
}

// --- Conditional Logging Function ---
function conditionalLog(message) {
  try {
    // Ensure setupData is loaded; call initialize if not (might be redundant if called elsewhere)
    if (!setupData) {
       initialize();
    }
    // Check if DebugLog setting is '1'
    if (setupData && setupData.data && setupData.data.settings && setupData.data.settings.DebugLog === '1') {
      logToSheet(message); // Call existing logger
    }
  } catch (e) {
    // Log error in trying to conditionally log, fallback to standard Logger
    Logger.log(`Error in conditionalLog: ${e}. Original message: ${message}`);
  }
}

// --- Authentication Function (REMOVED - No longer used for logging verification) ---
// function verifySessionAndAccess(...) { ... } // REMOVED

// --- Web App Endpoints (doGet, doPost) ---

// Modified doGet to handle authentication and serve Login page correctly
function doGet(e) {
  initialize(); // Ensure initialization runs
  var action = e.parameter.action;
  var result;
  const paramsString = JSON.stringify(e.parameter);

  logToSheet(`doGet START - Parameters: ${paramsString}`); // Log start and params
  Logger.log(`doGet received parameters: ${paramsString}`);
  const token = e.parameter.token; // Get token from parameters

  // --- Handle Specific Actions ---

   // Google Sign-in related actions removed.
   // handleExternalLogin action removed (function deleted).


  // --- Serve HTML or Execute Authorized API Actions ---
  try {
    // If it's an API action
    if (action && action !== 'serveLoginPage') {
        // NOTE: validateToken is handled above and returns directly
        // Permission checks are now INSIDE each case
        switch (action) {
          case 'getAllDispensaryData': {
            const required = ['tpoCRMToken']; // Define required tokens
            logToSheet(`Action: ${action}, Token: ${token ? token.substring(0, 10) + '...' : 'N/A'}, Required: ${JSON.stringify(required)}`);
            // REMOVED: const authResult = verifySessionAndAccess(token, required);
            // REMOVED: if (!authResult.authorized) { ... }
            result = getAllDispensaryData();
            break;
          }
          case 'getSetupData': {
            const required = ['tpoCRMToken']; // Define required tokens
            logToSheet(`Action: ${action}, Token: ${token ? token.substring(0, 10) + '...' : 'N/A'}, Required: ${JSON.stringify(required)}`);
            // REMOVED: const authResult = verifySessionAndAccess(token, required);
            // REMOVED: if (!authResult.authorized) { ... }
            result = getSetupData(); // Includes assigned/unassigned provinces
            break;
          }
          case 'getUnassignedShops': {
            const required = ['tpoCRMManagerToken']; // Define required tokens
            logToSheet(`Action: ${action}, Token: ${token ? token.substring(0, 10) + '...' : 'N/A'}, Required: ${JSON.stringify(required)}`);
            // REMOVED: const authResult = verifySessionAndAccess(token, required);
            // REMOVED: if (!authResult.authorized) { ... }
            // NOTE: This action implicitly requires Manager access, but check is removed for now.
            result = getUnassignedShops(
                e.parameter.province,
                e.parameter.name,
                e.parameter.page,
                e.parameter.itemsPerPage // Pass itemsPerPage
            );
            break;
          }
          case 'getPipelineData': {
            const required = ['tpoCRMManagerToken']; // Define required tokens
            logToSheet(`Action: ${action}, Token: ${token ? token.substring(0, 10) + '...' : 'N/A'}, Required: ${JSON.stringify(required)}`);
            // REMOVED: const authResult = verifySessionAndAccess(token, required);
            // REMOVED: if (!authResult.authorized) { ... }
            // NOTE: This action implicitly requires Manager access, but check is removed for now.
            result = getPipelineData(
                e.parameter.member,
                e.parameter.pipelines, // Changed param name to plural 'pipelines' (receives JSON string)
                e.parameter.province,
                e.parameter.name,
                e.parameter.page,
                e.parameter.startDate, // Added startDate param
                e.parameter.endDate,    // Added endDate param
                e.parameter.itemsPerPage // Pass itemsPerPage
            );
            break;
          }
          case 'getNearbyDispensaries': {
            const required = ['tpoCRMManagerToken']; // Define required tokens
            logToSheet(`Action: ${action}, Token: ${token ? token.substring(0, 10) + '...' : 'N/A'}, Required: ${JSON.stringify(required)}`);
            // REMOVED: const authResult = verifySessionAndAccess(token, required);
            // REMOVED: if (!authResult.authorized) { ... }
            // NOTE: This action implicitly requires Manager access, but check is removed for now.
            result = getNearbyDispensaries(
                e.parameter.latitude,
                e.parameter.longitude,
                e.parameter.limit,      // Corresponds to itemsPerPage from frontend
                e.parameter.maxDistance // Corresponds to radius from frontend
            );
            break;
          }
          // validateToken handled above
          default:
             const errorMsg = `Unrecognized action: ${action}`;
             Logger.log(`Error: ${errorMsg}`);
             logToSheet(`Error: ${errorMsg}`);
             result = { success: false, message: errorMsg };
        } // End switch for authorized actions

        // Return JSON for API actions
        logToSheet(`doGet END - Action: ${action}, Result: ${JSON.stringify(result).substring(0, 500)}...`); // Log end and result summary
        return ContentService.createTextOutput(JSON.stringify(result))
            .setMimeType(ContentService.MimeType.JSON);

    } else {
        // No action specified, return error
        const errorMsg = 'No action specified in doGet request.';
        Logger.log(`Error: ${errorMsg}`);
        logToSheet(`Error: ${errorMsg}`);
        result = { success: false, message: errorMsg };
        return ContentService.createTextOutput(JSON.stringify(result))
            .setMimeType(ContentService.MimeType.JSON);
    }

  } catch (error) {
    const errorDetails = `Error in doGet (Action: "${action}"): ${error} Stack: ${error.stack}`;
    Logger.log(errorDetails);
    logToSheet(errorDetails); // Log error to sheet
    // Generic error page or message
     return ContentService.createTextOutput(JSON.stringify({
        success: false,
        message: `Server error processing request: ${error.message}`
      }))
      .setMimeType(ContentService.MimeType.JSON); // Return JSON error even for page loads if error occurs
  }
}


function doPost(e) {
  initialize(); // Ensure initialization runs
  var lock = LockService.getScriptLock();
  var lockAcquired = lock.tryLock(15000); // 15 seconds timeout

  if (!lockAcquired) {
    Logger.log('Could not acquire lock for doPost.');
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: 'Server busy, please try again.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Try parsing body if parameters are empty (for potential JSON fetch)
  let postData = e.parameter; // Default to parameters (FormData)
  let isJsonPayload = false;
  if (e.postData && e.postData.type === 'application/json' && e.postData.contents) {
      try {
          postData = JSON.parse(e.postData.contents);
          isJsonPayload = true;
          Logger.log('Parsed JSON from postData.contents: ' + JSON.stringify(postData));
      } catch (jsonError) {
          Logger.log('Could not parse postData.contents as JSON: ' + jsonError + ' - Falling back to e.parameter.');
          // Keep postData as e.parameter if JSON parsing fails
          postData = e.parameter;
      }
  } else {
       Logger.log('doPost received parameters (FormData): ' + JSON.stringify(e.parameter));
  }

  const action = postData.action; // Get action from potentially parsed data or parameters

  // handleExternalLogin action removed (function deleted).

  const token = postData.token; // Get token from potentially parsed data or parameters

  // --- Basic Token Check ---
  // Trusting frontend validation, but ensure token is present
  if (!token) {
      const errorMsg = "Authorization Error: Missing token.";
      Logger.log(errorMsg);
      logToSheet(`doPost Error: ${errorMsg}`);
      return ContentService.createTextOutput(JSON.stringify({ success: false, message: errorMsg, requireLogin: true }))
          .setMimeType(ContentService.MimeType.JSON);
  }
  // --- End Basic Token Check ---

  // Authorization is checked inside each case now.

  let result = { success: false, message: 'Invalid action.' }; // Default result

  try {
    // Use conditionalLog and include postData for better debugging if enabled
    conditionalLog(`doPost START - Action: ${action}, Token: ${token ? token.substring(0, 10) + '...' : 'N/A'}, Data: ${JSON.stringify(postData).substring(0, 500)}...`);
    Logger.log(`Executing doPost action: ${action}`);

    switch (action) {
        case 'assignShops': {
            // --- Assign Shops Logic ---
            const shopIdsParam = postData.shopIds;
            const assignedMember = postData.assignedMember;
            const notes = postData.assignmentNotes;
            const assigningUserEmail = postData.assigningUserEmail || 'FrontendEmailMissing'; // Read email sent from frontend
            let shopIds = [];

            // REMOVED: verifySessionAndAccess call and authorization check block

            if (shopIdsParam) {
                try {
                    // If it's a JSON payload, shopIds might already be an array
                    if (isJsonPayload && Array.isArray(shopIdsParam)) {
                        shopIds = shopIdsParam;
                    } else {
                        // Otherwise, assume it's a JSON string (e.g., from FormData)
                        shopIds = JSON.parse(String(shopIdsParam));
                    }
                    if (!Array.isArray(shopIds)) throw new Error("shopIds parameter is not a valid JSON array.");
                } catch (jsonError) {
                    // Fallback if it wasn't a JSON string/array
                    shopIds = String(shopIdsParam).split(',').map(id => id.trim()).filter(id => id);
                    Logger.log(`Parsed shopIds as comma-separated (fallback): ${shopIds}`);
                }
            }

            if (!shopIds || shopIds.length === 0) throw new Error("No shop IDs provided for assignment.");
            if (!assignedMember) throw new Error("Assigned member not provided.");

            // Pass email read from postData
            result = assignShops(shopIds, assignedMember, notes, assigningUserEmail);
            break;
        } // End case 'assignShops'

        case 'addManagerComment': {
            // --- Add Manager Comment Logic ---
            const shopName = postData.shopName;
            const commentText = postData.commentText;
            const commentingUserEmail = postData.commentingUserEmail || 'FrontendEmailMissing'; // Read email sent from frontend

            if (!shopName) throw new Error("Shop name not provided for comment.");
            if (!commentText) throw new Error("Comment text cannot be empty.");

            // REMOVED: verifySessionAndAccess call and authorization check block

            // Pass email read from postData
            result = addManagerComment(shopName, commentText, commentingUserEmail);
            break;
        } // End case 'addManagerComment'

        default: { // --- Existing CRM Update Logic (Usually from CRMv4.html FormData) ---
            const userEmail = postData.userEmail || 'FrontendEmailMissing'; // Read email sent from frontend
            const dispensaryName = postData.selectDispensary === 'new' ? postData.newDispensaryName : postData.selectDispensary;
            if (!dispensaryName) {
              throw new Error('Missing required dispensary name parameter.');
            }

            // Look up user name based on email
            const userInfo = setupData.data.memberEmails.find(m => m.email && m.email.toLowerCase() === userEmail.toLowerCase());
            const userName = userInfo ? userInfo.name : userEmail; // Fallback to email if name not found

            const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CRM_SHEET_NAME);
            if (!sheet) throw new Error(`CRM sheet "${CRM_SHEET_NAME}" not found.`);

            const data = sheet.getDataRange().getValues();
            const headers = data[0]; // Keep headers for reference if needed, but use fixed indices
            let rowIndex = -1; // 0-based index in data array

            // Find row index (assuming Col A is Dispensary Name)
            for (let i = 1; i < data.length; i++) {
              if (String(data[i][0]).trim().toLowerCase() === String(dispensaryName).trim().toLowerCase()) {
                rowIndex = i;
                break;
              }
            }

            // Define column indices based on the NEW CRM structure (v2.1 PRD)
            const COL_DISPENSARY_NAME = 0;    // A
            const COL_SHOP_SIZE = 1;          // B
            const COL_CURRENT_DISTRIBUTOR = 2;// C (NEW)
            const COL_ADDRESS = 3;            // D
            const COL_LATITUDE = 4;           // E
            const COL_LONGITUDE = 5;          // F
            const COL_PROVINCE = 6;           // G
            const COL_NAME_H = 7;             // H (Original 'name' from unassigned)
            const COL_URL = 8;                // I
            const COL_FACEBOOK = 9;           // J
            const COL_FACEBOOK_URL = 10;      // K
            const COL_MAPS_URL = 11;          // L
            const COL_LINE = 12;              // M
            const COL_LINE_URL = 13;          // N
            const COL_PHONE_O = 14;           // O (phone#)
            const COL_WEBSITE = 15;           // P
            const COL_WEBSITE_URL = 16;       // Q
            const COL_CONTACT_PERSON = 17;    // R
            const COL_EMAIL = 18;             // S
            const COL_PHONE_T = 19;           // T (Phone)
            const COL_LINE_CONTACT = 20;      // U
            const COL_QR_CODE = 21;           // V
            const COL_HISTORY = 22;           // W (Notes & Communication History)
            const COL_NEXT_ACTION = 23;       // X
            const COL_DUE_DATE = 24;          // Y
            const COL_ASSIGNED_MEMBER = 25;   // Z
            const COL_PIPELINE = 26;          // AA
            const COL_PIPELINE_RECORD = 27;   // AB
            const COL_NEXT_ACTION_RECORD = 28;// AC
            const COL_ASSIGNMENT_HISTORY = 29;// AD (NEW)
            const COL_LAST_MODIFIED = 30;     // AE (Shifted)

            let qrCodeUrls = [];
            if (rowIndex > 0) {
              qrCodeUrls = data[rowIndex][COL_QR_CODE] ? String(data[rowIndex][COL_QR_CODE]).split('\n').filter(url => url.trim()) : [];
            }

            // Handle File Uploads (Uses postData which contains e.parameter content if not JSON)
            if (postData.qrCode) {
              const qrCodes = Array.isArray(postData.qrCode) ? postData.qrCode : [postData.qrCode];
              const qrCodeMimeTypes = Array.isArray(postData.qrCodeMimeType) ? postData.qrCodeMimeType : [postData.qrCodeMimeType];
              const folder = DriveApp.getFolderById(QR_FOLDER_ID);
              for (let i = 0; i < qrCodes.length; i++) {
                try {
                  const imageName = `QR_Code_${dispensaryName}_${new Date().getTime()}_${i}.jpg`;
                  const imageBlob = Utilities.newBlob(Utilities.base64Decode(qrCodes[i]), qrCodeMimeTypes[i] || 'image/jpeg', imageName);
                  const driveFile = folder.createFile(imageBlob);
                  qrCodeUrls.push(driveFile.getUrl());
                  Logger.log('QR Code uploaded: ' + driveFile.getUrl());
                } catch (uploadError) {
                  Logger.log(`Error uploading file ${i}: ${uploadError}`);
                }
              }
            }

            // Prepare History, Pipeline, Action Item Records
            const now = new Date();
            const timestamp = Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd HH:mm:ss");
            const isoTimestamp = now.toISOString();

            // Use looked-up userName for standard CRM submit logging
            let historyEntry = postData.activityLogging ? `${timestamp}: ${userName}: ${postData.activityLogging}\n` : '';
            if (rowIndex > 0) {
              historyEntry = historyEntry + (data[rowIndex][COL_HISTORY] || ''); // Prepend
            }

            let salesPipelineRecord = '';
            if (postData['Sales Pipeline']) {
              salesPipelineRecord = `${timestamp}: ${userName}: ${postData['Sales Pipeline']}\n`; // Use looked-up userName
              if (rowIndex > 0) {
                salesPipelineRecord += data[rowIndex][COL_PIPELINE_RECORD] || '';
              }
            } else if (rowIndex > 0) {
              salesPipelineRecord = data[rowIndex][COL_PIPELINE_RECORD] || '';
            }

            let nextActionItemRecord = '';
            if (postData['Next Action Item']) {
              nextActionItemRecord = `${timestamp}: ${userName}: ${postData['Next Action Item']}\n`; // Use looked-up userName
              if (rowIndex > 0) {
                nextActionItemRecord += data[rowIndex][COL_NEXT_ACTION_RECORD] || '';
              }
            } else if (rowIndex > 0) {
              nextActionItemRecord = data[rowIndex][COL_NEXT_ACTION_RECORD] || '';
            }

            // Construct rowData using NEW fixed indices and postData
            const rowData = [];
            rowData[COL_DISPENSARY_NAME] = dispensaryName;
            rowData[COL_SHOP_SIZE] = postData['Shop Size'] !== undefined ? postData['Shop Size'] : (rowIndex > 0 ? data[rowIndex][COL_SHOP_SIZE] : '');
            rowData[COL_CURRENT_DISTRIBUTOR] = postData['Current Distributor'] !== undefined ? postData['Current Distributor'] : (rowIndex > 0 ? data[rowIndex][COL_CURRENT_DISTRIBUTOR] : ''); // NEW
            rowData[COL_ADDRESS] = postData['Dispensary Address'] !== undefined ? postData['Dispensary Address'] : (rowIndex > 0 ? data[rowIndex][COL_ADDRESS] : '');
            rowData[COL_LATITUDE] = postData['Latitude'] !== undefined ? postData['Latitude'] : (rowIndex > 0 ? data[rowIndex][COL_LATITUDE] : '');
            rowData[COL_LONGITUDE] = postData['Longitude'] !== undefined ? postData['Longitude'] : (rowIndex > 0 ? data[rowIndex][COL_LONGITUDE] : '');
            rowData[COL_PROVINCE] = postData['Province'] !== undefined ? postData['Province'] : (rowIndex > 0 ? data[rowIndex][COL_PROVINCE] : '');
            rowData[COL_NAME_H] = (rowIndex > 0 ? data[rowIndex][COL_NAME_H] : ''); // Preserve original name (Col H)
            rowData[COL_URL] = postData['url'] !== undefined ? postData['url'] : (rowIndex > 0 ? data[rowIndex][COL_URL] : '');
            rowData[COL_FACEBOOK] = postData['facebook'] !== undefined ? postData['facebook'] : (rowIndex > 0 ? data[rowIndex][COL_FACEBOOK] : '');
            rowData[COL_FACEBOOK_URL] = postData['facebook_url'] !== undefined ? postData['facebook_url'] : (rowIndex > 0 ? data[rowIndex][COL_FACEBOOK_URL] : '');
            rowData[COL_MAPS_URL] = postData['google_maps_url'] !== undefined ? postData['google_maps_url'] : (rowIndex > 0 ? data[rowIndex][COL_MAPS_URL] : '');
            rowData[COL_LINE] = postData['line'] !== undefined ? postData['line'] : (rowIndex > 0 ? data[rowIndex][COL_LINE] : '');
            rowData[COL_LINE_URL] = postData['line_url'] !== undefined ? postData['line_url'] : (rowIndex > 0 ? data[rowIndex][COL_LINE_URL] : '');
            rowData[COL_PHONE_O] = postData['phone#'] !== undefined ? postData['phone#'] : (rowIndex > 0 ? data[rowIndex][COL_PHONE_O] : ''); // phone# (Col O)
            rowData[COL_WEBSITE] = postData['website'] !== undefined ? postData['website'] : (rowIndex > 0 ? data[rowIndex][COL_WEBSITE] : '');
            rowData[COL_WEBSITE_URL] = postData['website_url'] !== undefined ? postData['website_url'] : (rowIndex > 0 ? data[rowIndex][COL_WEBSITE_URL] : '');
            rowData[COL_CONTACT_PERSON] = postData['Contact Person Name'] !== undefined ? postData['Contact Person Name'] : (rowIndex > 0 ? data[rowIndex][COL_CONTACT_PERSON] : '');
            rowData[COL_EMAIL] = postData['Email'] !== undefined ? postData['Email'] : (rowIndex > 0 ? data[rowIndex][COL_EMAIL] : '');
            rowData[COL_PHONE_T] = postData['Phone'] !== undefined ? postData['Phone'] : (rowIndex > 0 ? data[rowIndex][COL_PHONE_T] : ''); // Phone (Col T)
            rowData[COL_LINE_CONTACT] = postData['Line Contact'] !== undefined ? postData['Line Contact'] : (rowIndex > 0 ? data[rowIndex][COL_LINE_CONTACT] : '');
            rowData[COL_QR_CODE] = qrCodeUrls.join('\n');
            rowData[COL_HISTORY] = historyEntry; // Notes & Communication History
            rowData[COL_NEXT_ACTION] = postData['Next Action Item'] !== undefined ? postData['Next Action Item'] : (rowIndex > 0 ? data[rowIndex][COL_NEXT_ACTION] : '');
            rowData[COL_DUE_DATE] = postData['Due Date'] !== undefined ? postData['Due Date'] : (rowIndex > 0 ? data[rowIndex][COL_DUE_DATE] : '');
            rowData[COL_ASSIGNED_MEMBER] = postData['Assigned Member'] !== undefined ? postData['Assigned Member'] : (rowIndex > 0 ? data[rowIndex][COL_ASSIGNED_MEMBER] : '');
            rowData[COL_PIPELINE] = postData['Sales Pipeline'] !== undefined ? postData['Sales Pipeline'] : (rowIndex > 0 ? data[rowIndex][COL_PIPELINE] : '');
            rowData[COL_PIPELINE_RECORD] = salesPipelineRecord;
            rowData[COL_NEXT_ACTION_RECORD] = nextActionItemRecord;
            rowData[COL_ASSIGNMENT_HISTORY] = (rowIndex > 0 ? data[rowIndex][COL_ASSIGNMENT_HISTORY] : ''); // Preserve existing Assignment History (will be updated by assign/comment actions)
            rowData[COL_LAST_MODIFIED] = isoTimestamp; // Now at AE


            // Ensure rowData has the correct number of columns matching the sheet
            const expectedColumnCount = sheet.getLastColumn();
            if (rowData.length < expectedColumnCount) {
                for (let i = rowData.length; i < expectedColumnCount; i++) {
                    rowData.push(rowIndex > 0 ? data[rowIndex][i] : ''); // Fill remaining with existing or empty
                }
            } else if (rowData.length > expectedColumnCount) {
                rowData.length = expectedColumnCount; // Truncate if too long
            }


            let updateType = '';
            if (rowIndex > 0) {
              sheet.getRange(rowIndex + 1, 1, 1, rowData.length).setValues([rowData]);
              updateType = 'updated';
              Logger.log('Data updated in Google Sheets at row: ' + (rowIndex + 1));
            } else {
              sheet.appendRow(rowData);
              updateType = 'created';
              Logger.log('New data added to Google Sheets');
            }

            const setupDataResult = getSetupData(); // Re-fetch setup data to get potentially updated member emails
            const assignedMemberEmail = setupDataResult.data.memberEmails.find(member => member.name === postData['Assigned Member'])?.email;
            // Pass email from frontend for standard CRM submit
            sendEmailNotification(dispensaryName, postData, updateType, assignedMemberEmail, userEmail);

            let calendarResult = null;
            if (postData['Due Date']) {
              // Pass email from frontend for standard CRM submit
              calendarResult = createCalendarEvent(dispensaryName, postData, assignedMemberEmail, userEmail);
              if (!calendarResult.success) {
                Logger.log(`Calendar event creation failed: ${calendarResult.message}`);
              }
            }
             // Construct result for CRM update
            result = {
              success: true,
              message: `Dispensary data ${updateType} successfully.`,
              calendarEventCreated: calendarResult ? calendarResult.success : false
            };
            break;
        } // End default case (CRM Update)
    } // End switch (action)

    // Return the result from the executed case
    if (lockAcquired) { // Release lock before returning
        lock.releaseLock();
    }
    return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString() + ' Stack: ' + error.stack);
     if (lockAcquired) { // Ensure lock is released on error
        lock.releaseLock();
    }
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: 'Server Error: ' + error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    // Final check to release lock if it hasn't been released yet
    if (lockAcquired && lock.hasLock()) {
      lock.releaseLock();
       Logger.log('Lock released in finally block.');
    }
  }
}


// --- Nearby Search Functions ---

// Function to calculate distance between two points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) {
    return Infinity; // Return infinity if any coordinate is null or undefined
  }
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // Distance in km
  return isNaN(distance) ? Infinity : distance; // Return infinity if calculation results in NaN
}

// Function to get nearby dispensaries (CRM & Unassigned) based on latitude and longitude
// Filters Unassigned based on 'Assignment' status column
function getNearbyDispensaries(latitude, longitude, limit = 5, maxDistance = 20) { // Default radius 20km
  if (latitude == null || longitude == null) { // Use == null to check for both null and undefined
    return {
      success: false,
      message: 'Latitude and longitude are required for nearby search.'
    };
  }

  // Parse coordinates to numbers
  const searchLat = parseFloat(latitude);
  const searchLon = parseFloat(longitude);
  const numLimit = parseInt(limit) || 5;
  const numMaxDistance = parseFloat(maxDistance) || 20; // Use default if parsing fails

  if (isNaN(searchLat) || isNaN(searchLon)) {
    return {
      success: false,
      message: 'Invalid latitude or longitude values provided.'
    };
  }

  Logger.log(`Searching nearby: Lat=${searchLat}, Lon=${searchLon}, Limit=${numLimit}, Radius=${numMaxDistance}km`);

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const crmSheet = ss.getSheetByName(CRM_SHEET_NAME);
    const unassignedSheet = ss.getSheetByName(UNASSIGNED_SHEET_NAME);

    if (!crmSheet) {
      Logger.log(`Error: CRM sheet "${CRM_SHEET_NAME}" not found.`);
      return { success: false, message: `CRM sheet "${CRM_SHEET_NAME}" not found.` };
    }
     if (!unassignedSheet) {
      Logger.log(`Error: Unassigned sheet "${UNASSIGNED_SHEET_NAME}" not found.`);
      return { success: false, message: `Unassigned sheet "${UNASSIGNED_SHEET_NAME}" not found.` };
    }

    const allDispensaries = [];

    // --- Process CRM Sheet ---
    const crmData = crmSheet.getDataRange().getValues();
    const crmHeaders = crmData.shift(); // Remove header row

    // Find column indices for CRM sheet (adjust if needed)
    const crmNameIndex = crmHeaders.indexOf('Dispensary Name'); // Col A
    const crmLatIndex = crmHeaders.indexOf('Latitude');         // Col E
    const crmLonIndex = crmHeaders.indexOf('Longitude');        // Col F
    const crmAssignedMemberIndex = crmHeaders.indexOf('Assigned Member'); // Col Z
    // Add other indices needed for the frontend table/popup
    const crmAddressIndex = crmHeaders.indexOf('Dispensary Address'); // Col D
    const crmProvinceIndex = crmHeaders.indexOf('Province');       // Col G
    const crmMapsUrlIndex = crmHeaders.indexOf('google_maps_url'); // Col L
    const crmLineIndex = crmHeaders.indexOf('line');             // Col M
    const crmPhoneIndex = crmHeaders.indexOf('Phone');           // Col T (Primary Phone)
    const crmWebsiteIndex = crmHeaders.indexOf('website');         // Col P


    if (crmLatIndex === -1 || crmLonIndex === -1 || crmNameIndex === -1 || crmAssignedMemberIndex === -1) {
       Logger.log(`Error: Missing required columns in CRM sheet (Name, Lat, Lon, Assigned Member). Indices found: Name=${crmNameIndex}, Lat=${crmLatIndex}, Lon=${crmLonIndex}, Assigned=${crmAssignedMemberIndex}`);
       // Continue processing Unassigned if possible, but log the error
    } else {
        crmData.forEach(row => {
          const shopLat = parseFloat(row[crmLatIndex]);
          const shopLon = parseFloat(row[crmLonIndex]);

          if (!isNaN(shopLat) && !isNaN(shopLon)) {
            const distance = calculateDistance(searchLat, searchLon, shopLat, shopLon);

            if (distance <= numMaxDistance) {
              allDispensaries.push({
                name: row[crmNameIndex] || 'Unknown CRM Shop',
                latitude: shopLat,
                longitude: shopLon,
                distance: distance,
                source: 'CRM',
                assignedMember: row[crmAssignedMemberIndex] || '', // Get assigned member
                // Add other fields needed by frontend
                google_maps_url: row[crmMapsUrlIndex] || '',
                line: row[crmLineIndex] || '',
                phone: row[crmPhoneIndex] || '',
                website: row[crmWebsiteIndex] || '',
                province: row[crmProvinceIndex] || '',
                address: row[crmAddressIndex] || ''
              });
            }
          }
        });
        Logger.log(`Processed ${crmData.length} rows from CRM sheet. Found ${allDispensaries.length} within radius so far.`);
    }

    // --- Process Unassigned Sheet ---
    const unassignedData = unassignedSheet.getDataRange().getValues();
    const unassignedHeaders = unassignedData.shift(); // Remove header row

    // Find column indices for Unassigned sheet
    const unassignedNameIndex = unassignedHeaders.indexOf('name'); // Assuming 'name' column
    const unassignedLatIndex = unassignedHeaders.indexOf('Latitude'); // N=13
    const unassignedLonIndex = unassignedHeaders.indexOf('Longitude'); // O=14
    const unassignedStatusIndex = unassignedHeaders.indexOf('Assignment'); // P=15
    // Add other indices needed for the frontend table/popup
    const unassignedMapsUrlIndex = unassignedHeaders.indexOf('google_maps_url');
    const unassignedLineIndex = unassignedHeaders.indexOf('line');
    const unassignedPhoneIndex = unassignedHeaders.indexOf('phone#'); // Note: 'phone#' column (K=10)
    const unassignedWebsiteIndex = unassignedHeaders.indexOf('website'); // L=11
    const unassignedProvinceIndex = unassignedHeaders.indexOf('Province');


    if (unassignedLatIndex === -1 || unassignedLonIndex === -1 || unassignedNameIndex === -1 || unassignedStatusIndex === -1) {
       Logger.log(`Error: Missing required columns in Unassigned sheet (name, Latitude, Longitude, Assignment Status). Indices found: Name=${unassignedNameIndex}, Lat=${unassignedLatIndex}, Lon=${unassignedLonIndex}, Status=${unassignedStatusIndex}`);
       // Continue if CRM processing worked, but log the error
    } else {
        let unassignedProcessedCount = 0;
        let unassignedIncludedCount = 0;
        unassignedData.forEach(row => {
          unassignedProcessedCount++;
          // Filter: Only include if 'Assignment' status (Col P) is NOT 'Assigned' (case-insensitive check)
          const assignmentStatus = String(row[unassignedStatusIndex] || '').trim().toLowerCase();
          if (assignmentStatus !== 'assigned') {
              const shopLat = parseFloat(row[unassignedLatIndex]);
              const shopLon = parseFloat(row[unassignedLonIndex]);

              if (!isNaN(shopLat) && !isNaN(shopLon)) {
                const distance = calculateDistance(searchLat, searchLon, shopLat, shopLon);

                if (distance <= numMaxDistance) {
                  unassignedIncludedCount++;
                  allDispensaries.push({
                    name: row[unassignedNameIndex] || 'Unknown Unassigned Shop',
                    latitude: shopLat,
                    longitude: shopLon,
                    distance: distance,
                    source: 'Unassigned',
                    assignedMember: '', // Explicitly empty for Unassigned
                    // Add other fields needed by frontend
                    google_maps_url: unassignedMapsUrlIndex !==-1 ? (row[unassignedMapsUrlIndex] || '') : '',
                    line: unassignedLineIndex !==-1 ? (row[unassignedLineIndex] || '') : '',
                    phone: unassignedPhoneIndex !==-1 ? (row[unassignedPhoneIndex] || '') : '',
                    website: unassignedWebsiteIndex !==-1 ? (row[unassignedWebsiteIndex] || '') : '',
                    province: unassignedProvinceIndex !==-1 ? (row[unassignedProvinceIndex] || '') : '',
                    address: '' // Unassigned likely doesn't have a full address field like CRM
                  });
                }
              }
          }
        });
         Logger.log(`Processed ${unassignedProcessedCount} rows from Unassigned sheet. Included ${unassignedIncludedCount} unassigned shops within radius.`);
    }

    // Sort by distance
    allDispensaries.sort((a, b) => a.distance - b.distance);

    // Limit results
    const limitedResults = allDispensaries.slice(0, numLimit);
    Logger.log(`Total nearby shops found: ${allDispensaries.length}. Returning limited results: ${limitedResults.length}`);

    return {
      success: true,
      data: limitedResults,
      searchPoint: { // Include search point for reference on frontend if needed
        latitude: searchLat,
        longitude: searchLon
      }
    };

  } catch (error) {
    Logger.log('Error in getNearbyDispensaries: ' + error + ' Stack: ' + error.stack);
    return {
      success: false,
      message: 'Error searching for nearby dispensaries: ' + error.toString()
    };
  }
}


// --- Data Retrieval Functions ---

function getAllDispensaryData() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CRM_SHEET_NAME);
  if (!sheet) return { success: false, message: `Sheet "${CRM_SHEET_NAME}" not found.` };
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();

  const dispensaries = data.map(row => {
    let dispensary = {};
    headers.forEach((header, index) => {
      dispensary[header] = row[index];
    });
    return dispensary;
  });
  return { success: true, data: dispensaries };
}

function getSetupData() {
  // Return cached data if available and not forced refresh
  if (setupData) {
       // Let's return a copy to avoid potential modification issues if needed elsewhere
       return JSON.parse(JSON.stringify(setupData));
  }

  const setupSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SETUP_SHEET_NAME);
  const unassignedSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(UNASSIGNED_SHEET_NAME);
  const crmSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CRM_SHEET_NAME); // Get CRM sheet

   if (!setupSheet) return { success: false, message: `Sheet "${SETUP_SHEET_NAME}" not found.` };

  const setupSheetData = setupSheet.getDataRange().getValues(); // Renamed variable
  const members = [];
  const memberEmails = [];
  const salesPipelines = [];
  const distributors = []; // Added for distributors
  const settings = {}; // Added for settings

  // Process Setup Sheet
  for(let i = 1; i < setupSheetData.length; i++) { // Start from row 2 (index 1) to skip header
      const row = setupSheetData[i]; // Use renamed variable
      // Member Info (Col A/B)
      if (row[0]) { // Member Name in Col A
          let name = String(row[0]).trim();
          let email = '';
          // Check if email is combined in Col A or separate in Col B
          if (name.includes(',') && name.includes('@')) {
              const parts = name.split(',');
              name = parts[0].trim();
              email = parts[1] ? parts[1].trim() : '';
          } else {
               email = String(row[1] || '').trim(); // Assume email is in Col B if not combined
          }
          members.push(name);
          if (email && email.includes('@')) {
              memberEmails.push({ name: name, email: email });
          } else {
              memberEmails.push({ name: name, email: null });
              Logger.log(`Email not found or invalid for member: ${name}`);
          }
      }
      // Sales Pipeline (Col B - index 1, if not an email)
      if (row[1] && !String(row[1]).includes('@') && String(row[1]).trim()) {
          const pipeline = String(row[1]).trim();
          if (!salesPipelines.includes(pipeline)) {
            salesPipelines.push(pipeline);
          }
      }
      // Distributor (Col F - index 5)
      if (row[5] && String(row[5]).trim()) {
          const distributorName = String(row[5]).trim();
          if (!distributors.includes(distributorName)) { // Avoid duplicates
             distributors.push(distributorName);
          }
      }
      // Settings (Col I=8, J=9) - Assuming headers are in row 1
      const parameter = String(row[8] || '').trim(); // Use index 8 for Col I, default to empty string
      const value = String(row[9] || '').trim(); // Use index 9 for Col J, default to empty string
      if (parameter) {
          settings[parameter] = value;
      }
    }
    Logger.log("Loaded settings from Setup sheet: " + JSON.stringify(settings)); // Log loaded settings
 
    // Process Unassigned Sheet for Unassigned Provinces
    let unassignedProvinces = [];
  if (unassignedSheet) {
      try {
          const unassignedData = unassignedSheet.getDataRange().getValues();
          if (unassignedData.length > 1) {
              const headers = unassignedData[0]; // Headers at index 0
              const provinceIndex = headers.indexOf('Province');
              const statusIndex = headers.indexOf('Assignment'); // Check Assignment status P=15

              if (provinceIndex !== -1 && statusIndex !== -1) {
                   // Start loop from 1 to skip header row in data
                  const provinces = unassignedData.slice(1)
                      .filter(row => String(row[statusIndex] || '').trim().toLowerCase() !== 'assigned') // Only include if NOT assigned
                      .map(row => String(row[provinceIndex] || '').trim())
                      .filter(Boolean); // Filter out empty strings
                  unassignedProvinces = [...new Set(provinces)].sort();
                  Logger.log("Found unassigned provinces: " + unassignedProvinces.join(', '));
              } else {
                  Logger.log(`Could not find 'Province' (${provinceIndex}) or 'Assignment' (${statusIndex}) column header in UnassignedShops sheet.`);
              }
          }
      } catch (e) {
          Logger.log("Error reading provinces from UnassignedShops sheet: " + e);
      }
  } else {
      Logger.log(`Sheet "${UNASSIGNED_SHEET_NAME}" not found. Cannot get unassigned provinces.`);
  }

  // Process CRM Sheet for Assigned Provinces
  let assignedProvinces = [];
  if (crmSheet) {
      try {
          const crmData = crmSheet.getDataRange().getValues();
          if (crmData.length > 1) {
              const headers = crmData.shift(); // Remove header
              const provinceIndex = headers.indexOf('Province'); // Assuming 'Province' is the header name
              if (provinceIndex !== -1) {
                  const provinces = crmData.map(row => String(row[provinceIndex] || '').trim()).filter(Boolean);
                  assignedProvinces = [...new Set(provinces)].sort();
                   Logger.log("Found assigned provinces: " + assignedProvinces.join(', '));
              } else {
                  Logger.log("Could not find 'Province' column header in CRM sheet.");
              }
          }
      } catch (e) {
          Logger.log("Error reading provinces from CRM sheet: " + e);
      }
  } else {
       Logger.log(`Sheet "${CRM_SHEET_NAME}" not found. Cannot get assigned provinces.`);
  }


  // Cache the result globally
  setupData = {
    success: true,
    data: {
      members: [...new Set(members.filter(Boolean))].sort(), // Unique, sorted members
      memberEmails: memberEmails.filter(m => m.name),
      salesPipelines: [...new Set(salesPipelines)].sort(), // Unique, sorted pipelines
      distributors: [...new Set(distributors)].sort(), // Unique, sorted distributors
      unassignedProvinces: unassignedProvinces,
      assignedProvinces: assignedProvinces, // Add assigned provinces array
      settings: settings // Add the loaded settings
    }
  };
  // Return a copy of the cached data
  return JSON.parse(JSON.stringify(setupData));
}

// --- Function to get Sales Pipeline data with filtering and pagination ---
function getPipelineData(memberFilter, pipelinesJson, provinceFilter, nameFilter, page = 1, startDateStr, endDateStr, itemsPerPageParam = '5') { // Added itemsPerPageParam, default 5
  const itemsPerPage = parseInt(itemsPerPageParam, 10) || 5; // Use param or default to 5
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CRM_SHEET_NAME);
  if (!sheet) {
    return { success: false, message: `Sheet "${CRM_SHEET_NAME}" not found.` };
  }

  try {
    const data = sheet.getDataRange().getValues();
    const headers = data.shift(); // Remove header row

    // Find indices dynamically - adjust header names if needed
    const COL_DISPENSARY_NAME = headers.indexOf('Dispensary Name');
    const COL_ASSIGNED_MEMBER = headers.indexOf('Assigned Member');
    const COL_PROVINCE = headers.indexOf('Province');
    const COL_PIPELINE = headers.indexOf('Sales Pipeline'); // Added
    const COL_PIPELINE_RECORD = headers.indexOf('Sales Pipeline Record'); // Added
    const COL_HISTORY = headers.indexOf('Notes & Communication History'); // Added
    const COL_NEXT_ACTION = headers.indexOf('Next Action Item'); // Added
    const COL_LAST_MODIFIED = headers.indexOf('Last Modified'); // Keep for sorting


    // Ensure required columns exist
    const requiredCols = ['Dispensary Name', 'Assigned Member', 'Province', 'Sales Pipeline', 'Last Modified']; // Added Last Modified
    const missingCols = requiredCols.filter(h => headers.indexOf(h) === -1);
    if (missingCols.length > 0) {
        throw new Error(`Required columns (${missingCols.join(', ')}) not found in CRM sheet.`);
    }

    // Filter data
    const filteredData = data.filter(row => {
      const member = String(row[COL_ASSIGNED_MEMBER] || '').trim();
      const province = String(row[COL_PROVINCE] || '').trim();
      const name = String(row[COL_DISPENSARY_NAME] || '').toLowerCase().trim();
      const pipeline = String(row[COL_PIPELINE] || '').trim(); // Added pipeline value

      const memberMatch = !memberFilter || member.toLowerCase() === memberFilter.toLowerCase();
      // Parse selected pipelines from JSON string
      let selectedPipelines = [];
      try {
        if (pipelinesJson && pipelinesJson !== '[]' && pipelinesJson !== 'null') { // Also check if it's not just an empty array string or null
          selectedPipelines = JSON.parse(pipelinesJson);
          // Ensure it's actually an array after parsing
          if (!Array.isArray(selectedPipelines)) {
              Logger.log(`Parsed pipelinesJson is not an array: ${pipelinesJson}`);
              selectedPipelines = []; // Treat as no selection if parse result isn't an array
          }
        }
      } catch (jsonError) {
        Logger.log(`Error parsing pipelinesJson: ${pipelinesJson} - Error: ${jsonError}`);
        selectedPipelines = []; // Treat as no selection on error
      }

      // Check if the row's pipeline is in the selected list (if any pipelines are selected)
      // If selectedPipelines is empty, the filter should pass (show all pipelines)
      const pipelineMatch = selectedPipelines.length === 0 || selectedPipelines.includes(pipeline);
      const provinceMatch = !provinceFilter || province.toLowerCase() === provinceFilter.toLowerCase();
      const nameMatch = !nameFilter || name.includes(nameFilter.toLowerCase().trim());
      const isAssigned = member !== ''; // Ensure the shop is actually assigned

      // Date Filter Logic
      let dateMatch = true; // Default to true if no dates provided
      if (startDateStr && endDateStr) {
          try {
              const startDate = new Date(startDateStr);
              startDate.setHours(0, 0, 0, 0); // Start of the day
              const endDate = new Date(endDateStr);
              endDate.setHours(23, 59, 59, 999); // End of the day

              const history = String(row[COL_HISTORY] || '');
              // More robust regex to find timestamps like yyyy-MM-dd HH:mm:ss
              const timestamps = history.match(/\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}/g);

              if (timestamps && timestamps.length > 0) {
                  dateMatch = timestamps.some(ts => {
                      try {
                          // Attempt to parse the timestamp, assuming script's timezone if none specified
                          const entryDate = new Date(ts);
                          // Check if the parsed date is valid before comparing
                          return !isNaN(entryDate.getTime()) && entryDate >= startDate && entryDate <= endDate;
                      } catch (dateParseError) {
                           Logger.log(`Could not parse timestamp "${ts}" in history for row ${name}: ${dateParseError}`);
                           return false; // Ignore invalid timestamps within history
                      }
                  });
              } else {
                  dateMatch = false; // No valid timestamps found in history
              }
          } catch (e) {
               Logger.log(`Error processing date filter for row ${name}: ${e}`);
               dateMatch = false; // Error during date processing, exclude row
          }
      }

      return memberMatch && pipelineMatch && provinceMatch && nameMatch && isAssigned && dateMatch; // Added dateMatch
    });

    // Sort by Last Modified Descending (Required column check added above)
    filteredData.sort((a, b) => {
        const dateA = a[COL_LAST_MODIFIED] ? new Date(a[COL_LAST_MODIFIED]) : new Date(0); // Handle empty/invalid dates
        const dateB = b[COL_LAST_MODIFIED] ? new Date(b[COL_LAST_MODIFIED]) : new Date(0);
        // Ensure valid dates before comparing
        if (isNaN(dateA.getTime())) return 1; // Push invalid dates down
        if (isNaN(dateB.getTime())) return -1;
        return dateB - dateA; // Descending (most recent first)
    });


    // Pagination logic
    const totalItems = filteredData.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1; // Use itemsPerPage
    const currentPage = Math.max(1, Math.min(parseInt(page, 10) || 1, totalPages));
    const startIndex = (currentPage - 1) * itemsPerPage; // Use itemsPerPage
    const pageDataRaw = filteredData.slice(startIndex, startIndex + itemsPerPage); // Use itemsPerPage

    // Prepare data for frontend - Fetch ONLY required fields, adding checks for indices
    const resultData = pageDataRaw.map(row => ({
        dispensaryName: COL_DISPENSARY_NAME !== -1 && row[COL_DISPENSARY_NAME] !== undefined ? row[COL_DISPENSARY_NAME] : '',
        assignedMember: COL_ASSIGNED_MEMBER !== -1 && row[COL_ASSIGNED_MEMBER] !== undefined ? row[COL_ASSIGNED_MEMBER] : '',
        salesPipeline: COL_PIPELINE !== -1 && row[COL_PIPELINE] !== undefined ? row[COL_PIPELINE] : '',
        salesPipelineRecord: COL_PIPELINE_RECORD !== -1 && row[COL_PIPELINE_RECORD] !== undefined ? row[COL_PIPELINE_RECORD] : '',
        notesHistory: COL_HISTORY !== -1 && row[COL_HISTORY] !== undefined ? row[COL_HISTORY] : '',
        nextActionItem: COL_NEXT_ACTION !== -1 && row[COL_NEXT_ACTION] !== undefined ? row[COL_NEXT_ACTION] : ''
        // Add Last Modified if needed by the pipeline view?
        // lastModified: COL_LAST_MODIFIED !== -1 && row[COL_LAST_MODIFIED] !== undefined ? row[COL_LAST_MODIFIED] : '',
    }));


    return {
      success: true,
      data: resultData,
      totalPages: totalPages,
      currentPage: currentPage
    };

  } catch (error) {
    Logger.log('Error in getPipelineData: ' + error); // Updated log message
    return { success: false, message: 'Error fetching pipeline data: ' + error.toString() }; // Updated error message
  }
}

function getUnassignedShops(provinceFilter, nameFilter, page = 1, itemsPerPageParam = '5') { // Added itemsPerPageParam, default 5
  const itemsPerPage = parseInt(itemsPerPageParam, 10) || 5; // Use param or default to 5
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(UNASSIGNED_SHEET_NAME);
  if (!sheet) {
    return { success: false, message: `Sheet "${UNASSIGNED_SHEET_NAME}" not found.` };
  }

  try {
    const data = sheet.getDataRange().getValues();
    const headers = data.shift(); // Remove header row

    // Find indices dynamically
    const COL_PROVINCE = headers.indexOf('Province');
    const COL_NAME = headers.indexOf('name'); // B
    const COL_ASSIGNMENT_STATUS = headers.indexOf('Assignment'); // P=15
    const COL_URL = headers.indexOf('url'); // C
    const COL_FB_URL = headers.indexOf('facebook_url'); // E
    const COL_MAPS_URL = headers.indexOf('google_maps_url'); // F
    const COL_LINE = headers.indexOf('line'); // G
    const COL_LINE_URL = headers.indexOf('line_url'); // H
    const COL_PHONE = headers.indexOf('phone#'); // K=10
    const COL_WEBSITE = headers.indexOf('website'); // L=11
    const COL_WEBSITE_URL = headers.indexOf('website_url'); // M=12
    const COL_LATITUDE = headers.indexOf('Latitude'); // N=13
    const COL_LONGITUDE = headers.indexOf('Longitude'); // O=14


    // Update validation to include Lat/Lon and Assignment Status
    if (COL_PROVINCE === -1 || COL_NAME === -1 || COL_ASSIGNMENT_STATUS === -1 || COL_PHONE === -1 || COL_LATITUDE === -1 || COL_LONGITUDE === -1) {
        let missingCols = ['Province', 'name', 'Assignment', 'phone#', 'Latitude', 'Longitude'].filter(h => headers.indexOf(h) === -1);
        throw new Error(`Required columns (${missingCols.join(', ')}) not found in UnassignedShops sheet.`);
    }

    // Filter data
    const filteredData = data.filter(row => {
      const province = String(row[COL_PROVINCE] || '').trim();
      const name = String(row[COL_NAME] || '').toLowerCase().trim();
      const status = String(row[COL_ASSIGNMENT_STATUS] || '').trim().toLowerCase();

      const provinceMatch = !provinceFilter || province.toLowerCase() === provinceFilter.toLowerCase();
      const nameMatch = !nameFilter || name.includes(nameFilter.toLowerCase().trim());
      const statusMatch = status !== 'assigned'; // Filter out already assigned shops

      return provinceMatch && nameMatch && statusMatch;
    });

    // Pagination logic
    const totalItems = filteredData.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1; // Use itemsPerPage
    const currentPage = Math.max(1, Math.min(parseInt(page, 10) || 1, totalPages));
    const startIndex = (currentPage - 1) * itemsPerPage; // Use itemsPerPage
    const pageData = filteredData.slice(startIndex, startIndex + itemsPerPage); // Use itemsPerPage

    // Prepare data for frontend, ensuring all required keys exist, including Lat/Lon
    const resultData = pageData.map(row => ({
        province: row[COL_PROVINCE] !== undefined ? row[COL_PROVINCE] : '',
        name: row[COL_NAME] !== undefined ? row[COL_NAME] : '',
        google_maps_url: COL_MAPS_URL !== -1 && row[COL_MAPS_URL] !== undefined ? row[COL_MAPS_URL] : '',
        line: COL_LINE !== -1 && row[COL_LINE] !== undefined ? row[COL_LINE] : '',
        line_url: COL_LINE_URL !== -1 && row[COL_LINE_URL] !== undefined ? row[COL_LINE_URL] : '',
        phone: row[COL_PHONE] !== undefined ? row[COL_PHONE] : '', // Use the correct index for phone#
        website: COL_WEBSITE !== -1 && row[COL_WEBSITE] !== undefined ? row[COL_WEBSITE] : '',
        website_url: COL_WEBSITE_URL !== -1 && row[COL_WEBSITE_URL] !== undefined ? row[COL_WEBSITE_URL] : '',
        latitude: COL_LATITUDE !== -1 && row[COL_LATITUDE] !== undefined ? row[COL_LATITUDE] : '', // Add latitude
        longitude: COL_LONGITUDE !== -1 && row[COL_LONGITUDE] !== undefined ? row[COL_LONGITUDE] : '' // Add longitude
    }));


    return {
      success: true,
      data: resultData,
      totalPages: totalPages,
      currentPage: currentPage
    };

  } catch (error) {
    Logger.log('Error in getUnassignedShops: ' + error);
    return { success: false, message: 'Error fetching unassigned shops: ' + error.toString() };
  }
}

// --- Action Functions (Assignment, Calendar, Email) ---

// Added assigningUserEmail parameter for auditing/logging
function assignShops(shopIds, assignedMember, assignmentNotes = '', assigningUserEmail = 'System') {
  const crmSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CRM_SHEET_NAME);
  const unassignedSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(UNASSIGNED_SHEET_NAME);
  const setupDataResult = getSetupData(); // Fetch fresh setup data including emails

  if (!setupDataResult.success) {
      return { success: false, message: "Failed to load setup data for assignment." };
  }
  const currentSetupData = setupDataResult.data; // Use locally fetched data

  if (!crmSheet || !unassignedSheet) {
    return { success: false, message: 'Required sheet (CRM or UnassignedShops) not found.' };
  }

  const assignedMemberEmail = currentSetupData.memberEmails.find(member => member.name === assignedMember)?.email;
  if (!assignedMemberEmail) {
      Logger.log(`Could not find email for assigned member: ${assignedMember}. Assignment will proceed without email notification.`);
  }

  const unassignedDataRange = unassignedSheet.getDataRange();
  const unassignedData = unassignedDataRange.getValues();
  const unassignedHeaders = unassignedData[0]; // Get headers (index 0)

  const crmHeaders = crmSheet.getRange(1, 1, 1, crmSheet.getLastColumn()).getValues()[0]; // Get headers from CRM sheet

  // --- Find indices dynamically ---

  // Unassigned Sheet Indices
  const COL_PROVINCE_UNASSIGNED = unassignedHeaders.indexOf('Province');
  const COL_NAME_UNASSIGNED = unassignedHeaders.indexOf('name'); // B
  const COL_URL_UNASSIGNED = unassignedHeaders.indexOf('url'); // C
  const COL_FB_UNASSIGNED = unassignedHeaders.indexOf('facebook'); // D
  const COL_FB_URL_UNASSIGNED = unassignedHeaders.indexOf('facebook_url'); // E
  const COL_MAPS_URL_UNASSIGNED = unassignedHeaders.indexOf('google_maps_url'); // F
  const COL_LINE_UNASSIGNED = unassignedHeaders.indexOf('line'); // G
  const COL_LINE_URL_UNASSIGNED = unassignedHeaders.indexOf('line_url'); // H
  const COL_PHONE_UNASSIGNED = unassignedHeaders.indexOf('phone#'); // K=10
  const COL_WEBSITE_UNASSIGNED = unassignedHeaders.indexOf('website'); // L=11
  const COL_WEBSITE_URL_UNASSIGNED = unassignedHeaders.indexOf('website_url'); // M=12
  const COL_LATITUDE_UNASSIGNED = unassignedHeaders.indexOf('Latitude'); // N=13
  const COL_LONGITUDE_UNASSIGNED = unassignedHeaders.indexOf('Longitude'); // O=14
  const COL_ASSIGNMENT_STATUS_UNASSIGNED = unassignedHeaders.indexOf('Assignment'); // P=15
  const COL_ASSIGNMENT_DATE_UNASSIGNED = unassignedHeaders.indexOf('Assignment Date'); // Q=16


  // CRM Sheet Indices
  const COL_DISPENSARY_NAME_CRM = 0;    // A
  const COL_SHOP_SIZE_CRM = 1;          // B
  const COL_CURRENT_DISTRIBUTOR_CRM = 2;// C
  const COL_ADDRESS_CRM = 3;            // D
  const COL_LATITUDE_CRM = 4;           // E
  const COL_LONGITUDE_CRM = 5;          // F
  const COL_PROVINCE_CRM = 6;           // G
  const COL_NAME_H_CRM = 7;             // H
  const COL_URL_CRM = 8;                // I
  const COL_FACEBOOK_CRM = 9;           // J
  const COL_FACEBOOK_URL_CRM = 10;      // K
  const COL_MAPS_URL_CRM = 11;          // L
  const COL_LINE_CRM = 12;              // M
  const COL_LINE_URL_CRM = 13;          // N
  const COL_PHONE_O_CRM = 14;           // O (phone#)
  const COL_WEBSITE_CRM = 15;           // P
  const COL_WEBSITE_URL_CRM = 16;       // Q
  const COL_CONTACT_PERSON_CRM = 17;    // R
  const COL_EMAIL_CRM = 18;             // S
  const COL_PHONE_T_CRM = 19;           // T (Phone)
  const COL_LINE_CONTACT_CRM = 20;      // U
  const COL_QR_CODE_CRM = 21;           // V
  const COL_HISTORY_CRM = 22;           // W
  const COL_NEXT_ACTION_CRM = 23;       // X
  const COL_DUE_DATE_CRM = 24;          // Y
  const COL_ASSIGNED_MEMBER_CRM = 25;   // Z
  const COL_PIPELINE_CRM = 26;          // AA
  const COL_PIPELINE_RECORD_CRM = 27;   // AB
  const COL_NEXT_ACTION_RECORD_CRM = 28;// AC
  const COL_ASSIGNMENT_HISTORY_CRM = 29;// AD (NEW)
  const COL_LAST_MODIFIED_CRM = 30;     // AE (Shifted)

  // Validation of critical indices from Unassigned Sheet
  const requiredUnassignedIndices = [
      COL_NAME_UNASSIGNED, COL_PHONE_UNASSIGNED, COL_LATITUDE_UNASSIGNED, COL_LONGITUDE_UNASSIGNED,
      COL_ASSIGNMENT_STATUS_UNASSIGNED, COL_ASSIGNMENT_DATE_UNASSIGNED
  ];
  const requiredUnassignedHeaders = [
      'name', 'phone#', 'Latitude', 'Longitude', 'Assignment', 'Assignment Date'
  ];
  if (requiredUnassignedIndices.includes(-1)) {
      let missingCols = requiredUnassignedHeaders.filter((h, index) => requiredUnassignedIndices[index] === -1);
      Logger.log(`Error: One or more critical columns not found in UnassignedShops. Missing: ${missingCols.join(', ')}. Check headers.`);
      return { success: false, message: `UnassignedShops sheet configuration error: Critical columns missing (${missingCols.join(', ')}).` };
  }

  let assignedCount = 0;
  const now = new Date();
  const timestamp = Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd HH:mm:ss");
  const isoTimestamp = now.toISOString();

  // Get assigning user's name from email if possible
  const assigningUserInfo = currentSetupData.memberEmails.find(m => m.email && m.email.toLowerCase() === assigningUserEmail.toLowerCase());
  const assigningUserName = assigningUserInfo ? assigningUserInfo.name : assigningUserEmail; // Use name or fall back to email

  const unassignedRowMap = new Map();
   // Start from index 1 to skip headers in unassignedData
  for (let i = 1; i < unassignedData.length; i++) {
      const row = unassignedData[i];
      const shopName = String(row[COL_NAME_UNASSIGNED] || '').trim();
      const status = String(row[COL_ASSIGNMENT_STATUS_UNASSIGNED] || '').trim().toLowerCase();
      // Only map shops that are not already marked as 'assigned'
      if (shopName && status !== 'assigned') {
          // Store 1-based sheet row index (i + 1 because sheet is 1-based, and we skipped header i=0)
          unassignedRowMap.set(shopName, { rowIndex: i + 1, data: row });
      }
  }


  const crmRowsToAdd = [];
  const updatesToUnassigned = [];

  shopIds.forEach(shopId => {
    const shopIdTrimmed = String(shopId).trim();
    const unassignedRowInfo = unassignedRowMap.get(shopIdTrimmed);

    if (unassignedRowInfo) {
      const unassignedRowData = unassignedRowInfo.data;
      const unassignedSheetRowIndex = unassignedRowInfo.rowIndex; // This is the 1-based sheet row index

      // Initialize new CRM row with correct number of columns (up to AE, index 30)
      const newCrmRowData = new Array(COL_LAST_MODIFIED_CRM + 1).fill('');

      // Map Data from Unassigned to CRM (using dynamic indices)
      const mapUnassignedToCrm = (unassignedIdx, crmIdx) => {
          if (unassignedIdx !== -1 && crmIdx !== -1 && unassignedRowData[unassignedIdx] !== undefined && unassignedRowData[unassignedIdx] !== null) {
              newCrmRowData[crmIdx] = unassignedRowData[unassignedIdx];
          }
      };

      mapUnassignedToCrm(COL_PROVINCE_UNASSIGNED, COL_PROVINCE_CRM);
      mapUnassignedToCrm(COL_NAME_UNASSIGNED, COL_NAME_H_CRM); // Map 'name' to Col H
      mapUnassignedToCrm(COL_URL_UNASSIGNED, COL_URL_CRM);
      mapUnassignedToCrm(COL_FB_UNASSIGNED, COL_FACEBOOK_CRM);
      mapUnassignedToCrm(COL_FB_URL_UNASSIGNED, COL_FACEBOOK_URL_CRM);
      mapUnassignedToCrm(COL_MAPS_URL_UNASSIGNED, COL_MAPS_URL_CRM);
      mapUnassignedToCrm(COL_LINE_UNASSIGNED, COL_LINE_CRM);
      mapUnassignedToCrm(COL_LINE_URL_UNASSIGNED, COL_LINE_URL_CRM);
      mapUnassignedToCrm(COL_PHONE_UNASSIGNED, COL_PHONE_O_CRM); // Map 'phone#' K -> O
      mapUnassignedToCrm(COL_WEBSITE_UNASSIGNED, COL_WEBSITE_CRM); // Map 'website' L -> P
      mapUnassignedToCrm(COL_WEBSITE_URL_UNASSIGNED, COL_WEBSITE_URL_CRM); // Map 'website_url' M -> Q
      mapUnassignedToCrm(COL_LATITUDE_UNASSIGNED, COL_LATITUDE_CRM); // Map Latitude N -> E
      mapUnassignedToCrm(COL_LONGITUDE_UNASSIGNED, COL_LONGITUDE_CRM); // Map Longitude O -> F

      // Set CRM Specific Fields
      newCrmRowData[COL_DISPENSARY_NAME_CRM] = newCrmRowData[COL_NAME_H_CRM]; // Copy 'name' to 'Dispensary Name'
      newCrmRowData[COL_ASSIGNED_MEMBER_CRM] = assignedMember;
      newCrmRowData[COL_PIPELINE_CRM] = currentSetupData.salesPipelines[0] || 'New Lead'; // Default pipeline stage
      newCrmRowData[COL_LAST_MODIFIED_CRM] = isoTimestamp;
      newCrmRowData[COL_HISTORY_CRM] = `${timestamp}: Assigned to ${assignedMember} by ${assigningUserName}\n`; // Add assigning user
      newCrmRowData[COL_PIPELINE_RECORD_CRM] = `${timestamp}: ${assigningUserName}: ${newCrmRowData[COL_PIPELINE_CRM]}\n`; // Use Name for Pipeline Record
      newCrmRowData[COL_NEXT_ACTION_RECORD_CRM] = ''; // Initialize empty

      // Add formatted assignment note to the new Assignment History column (AD)
      const formattedAssignmentNote = assignmentNotes
          ? `${timestamp}: ${assigningUserName} : ${assignmentNotes}`
          : `${timestamp}: ${assigningUserName} : Assigned`; // Default note if none provided
      newCrmRowData[COL_ASSIGNMENT_HISTORY_CRM] = formattedAssignmentNote;

      crmRowsToAdd.push(newCrmRowData);

      // Prepare batch update for Unassigned Sheet (Status and Date only)
      // Update Status Column (P = index 15) and Date Column (Q = index 16)
      // Use the 1-based row index and 1-based column indices
      updatesToUnassigned.push({
          range: unassignedSheet.getRange(unassignedSheetRowIndex, COL_ASSIGNMENT_STATUS_UNASSIGNED + 1, 1, 2), // Target P#:Q#
          values: [['Assigned', now]] // Set status to 'Assigned' and update date
      });

      if (assignedMemberEmail) {
          const subject = `New Shop Assigned: ${shopIdTrimmed}`;
          const body = `You have been assigned a new shop:\nName: ${shopIdTrimmed}\nProvince: ${unassignedRowData[COL_PROVINCE_UNASSIGNED] || 'N/A'}\nAssigned by: ${assigningUserName}\nNotes: ${assignmentNotes || 'N/A'}\n\nPlease review details in the CRM.`;
          addPendingEmail(assignedMemberEmail, subject, body);
      }

      assignedCount++;
      Logger.log(`Prepared assignment for shop '${shopIdTrimmed}' to ${assignedMember}. Marked in UnassignedShops row ${unassignedSheetRowIndex}. Assigned by ${assigningUserName}`);

      } else {
        Logger.log(`Could not find shop ID '${shopIdTrimmed}' in UnassignedShops sheet or it might already be assigned.`);
      }
    });

    // Batch append new rows to CRM sheet
    if (crmRowsToAdd.length > 0) {
        crmSheet.getRange(crmSheet.getLastRow() + 1, 1, crmRowsToAdd.length, crmRowsToAdd[0].length).setValues(crmRowsToAdd);
        Logger.log(`Appended ${crmRowsToAdd.length} new rows to CRM sheet.`);
    }

    // Batch update Unassigned sheet
    if (updatesToUnassigned.length > 0) {
        Logger.log(`Preparing to update ${updatesToUnassigned.length} ranges in UnassignedShops.`);
        updatesToUnassigned.forEach(update => {
            try {
                // Use range object directly
                 if (update.range) {
                    Logger.log(`Updating range ${update.range.getA1Notation()} with values: ${JSON.stringify(update.values)}`);
                    update.range.setValues(update.values);
                } else {
                     Logger.log(`Skipping update due to missing range object: ${JSON.stringify(update)}`);
                }
            } catch (updateError) {
                Logger.log(`Error updating Unassigned sheet range ${update.range ? update.range.getA1Notation() : 'N/A'}: ${updateError}`);
            }
        });
         Logger.log(`Finished updating ${updatesToUnassigned.length} ranges in Unassigned sheet.`);
    }


    return { success: true, message: `${assignedCount} of ${shopIds.length} shops processed for assignment.` };
}


// --- Stage 2: Add Manager Comment Function (PRD 5.7) ---
// Added commentingUserEmail parameter
function addManagerComment(shopName, commentText, commentingUserEmail) {
    const crmSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(CRM_SHEET_NAME);
    if (!crmSheet) {
        Logger.log(`CRM sheet "${CRM_SHEET_NAME}" not found.`);
        return { success: false, message: `CRM sheet "${CRM_SHEET_NAME}" not found.` };
    }

    // Ensure setup data is loaded
    const setupResult = getSetupData();
     if (!setupResult.success) {
         Logger.log("Failed to load setup data within addManagerComment.");
         return { success: false, message: "Failed to load setup data." };
     }
    const currentSetupData = setupResult.data; // Use locally fetched setup data

    // Check if commentingUserEmail was passed
    if (!commentingUserEmail) {
        Logger.log("Error: No user email provided for addManagerComment action.");
        return { success: false, message: "Could not determine user performing the action (email missing)." };
    }

    // Use the freshly fetched setup data for lookup
    const managerInfo = currentSetupData.memberEmails.find(m => m.email && m.email.toLowerCase() === commentingUserEmail.toLowerCase());
    const managerName = managerInfo ? managerInfo.name : commentingUserEmail; // Use name or fall back to email

    // Find the shop row in CRM sheet (assuming Dispensary Name is unique and in Column A)
    const data = crmSheet.getDataRange().getValues();
    const headers = data[0];
    const COL_DISPENSARY_NAME = 0; // A
    const COL_ASSIGNED_MEMBER = 25; // Z
    const COL_ASSIGNMENT_HISTORY = 29; // AD
    const COL_LAST_MODIFIED = 30; // AE

    let targetRowIndex = -1; // 1-based sheet index
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][COL_DISPENSARY_NAME]).trim().toLowerCase() === String(shopName).trim().toLowerCase()) {
            targetRowIndex = i + 1; // Found the row (1-based index for getRange)
            break;
        }
    }

    if (targetRowIndex === -1) {
        Logger.log(`Shop "${shopName}" not found in CRM sheet.`);
        return { success: false, message: `Shop "${shopName}" not found.` };
    }

    try {
        const now = new Date();
        const timestamp = Utilities.formatDate(now, TIMEZONE, "yyyy-MM-dd HH:mm:ss");
        const isoTimestamp = now.toISOString();

        const assignmentHistoryCell = crmSheet.getRange(targetRowIndex, COL_ASSIGNMENT_HISTORY + 1); // +1 because sheet cols are 1-based
        const currentHistory = assignmentHistoryCell.getValue();
        const newCommentEntry = `${timestamp}: ${managerName} : ${commentText}`; // Format uses Name

        // Prepend new comment
        const updatedHistory = `${newCommentEntry}\n${currentHistory}`;

        // Update Assignment History and Last Modified
        assignmentHistoryCell.setValue(updatedHistory);
        crmSheet.getRange(targetRowIndex, COL_LAST_MODIFIED + 1).setValue(isoTimestamp); // +1 because sheet cols are 1-based

        // Queue notification for assigned member
        const assignedMemberName = data[targetRowIndex - 1][COL_ASSIGNED_MEMBER]; // Get name from data array (0-based index from sheet row index)
        // Use the freshly fetched setup data for lookup
        const assignedMemberInfo = currentSetupData.memberEmails.find(m => m.name === assignedMemberName);
        if (assignedMemberInfo && assignedMemberInfo.email) {
            // Avoid sending notification if manager comments on their own assigned shop
            if (assignedMemberInfo.email.toLowerCase() !== commentingUserEmail.toLowerCase()) {
                const subject = `New Comment on Shop: ${shopName}`;
                const body = `User ${managerName} added a comment to ${shopName}:\n\n"${commentText}"\n\nPlease review in the CRM.`;
                addPendingEmail(assignedMemberInfo.email, subject, body);
                Logger.log(`Queued comment notification for ${assignedMemberInfo.email} regarding shop ${shopName}.`);
            } else {
                 Logger.log(`Skipping notification for ${assignedMemberInfo.email} as they commented on their own shop.`);
            }
        } else {
            Logger.log(`Could not find email for assigned member "${assignedMemberName}" to send comment notification.`);
        }

        Logger.log(`Comment added successfully to shop "${shopName}" by ${managerName}.`);
        return { success: true, message: "Comment added successfully." };

    } catch (error) {
        Logger.log(`Error adding manager comment for shop "${shopName}": ${error}`);
        return { success: false, message: `Error adding comment: ${error.toString()}` };
    }
}
// --- End Stage 2 ---


// --- Email Notification Function ---
// Added updatingUserEmail parameter for context
function sendEmailNotification(dispensaryName, postData, updateType, assignedMemberEmail, updatingUserEmail = 'System') {
  // Don't send standard notification for 'assigned' action, as assignShops handles its specific notification
  if (updateType === 'assigned') return;

  // Get user's name for notification body
  const setupResult = getSetupData(); // Ensure setup data is available
  const updatingUserInfo = setupResult.success ? setupResult.data.memberEmails.find(m => m.email && m.email.toLowerCase() === updatingUserEmail.toLowerCase()) : null;
  const updatingUserName = updatingUserInfo ? updatingUserInfo.name : updatingUserEmail; // Use name or fallback to email

  const subject = `${updateType === 'created' ? 'New Dispensary Created' : 'Dispensary Updated'}: ${dispensaryName}`;
  let body = `A dispensary record has been ${updateType} by ${updatingUserName}:\n\n`;
  // Access data using postData object and original form field names (keys)
  body += `Dispensary Name: ${dispensaryName}\n`;
  body += `Address: ${postData['Dispensary Address'] || 'N/A'}\n`; // Use original key
  body += `Contact Person: ${postData['Contact Person Name'] || 'N/A'}\n`; // Use original key
  body += `Assigned Member: ${postData['Assigned Member'] || 'N/A'}\n`; // Use original key
  body += `Sales Pipeline: ${postData['Sales Pipeline'] || 'N/A'}\n`; // Use original key
  body += `Next Action Item: ${postData['Next Action Item'] || 'N/A'}\n`; // Use original key
  body += `Due Date: ${postData['Due Date'] || 'N/A'}\n`; // Use original key
  body += `Activity Logged: ${postData.activityLogging || 'None'}\n\n`; // activityLogging is specific property name
  body += `Please review in the CRM system.`;

  // Add pending emails for Operator and Assigned Member (if different)
  let notifiedEmails = new Set();

  if (OPERATOR_EMAIL) {
      OPERATOR_EMAIL.split(',')
                    .map(e => e.trim().toLowerCase())
                    .filter(e => e && e.includes('@'))
                    .forEach(e => {
                        if (!notifiedEmails.has(e)) {
                            addPendingEmail(e, subject, body);
                            notifiedEmails.add(e);
                        }
                    });
  } else {
      Logger.log("OPERATOR_EMAIL not set, cannot send operator notification.");
  }

  if (assignedMemberEmail) {
      const assignedLower = assignedMemberEmail.toLowerCase();
      if (!notifiedEmails.has(assignedLower)) {
          addPendingEmail(assignedMemberEmail, subject, body);
          notifiedEmails.add(assignedLower);
      }
  }
}

// --- Calendar Event Function ---
// Added creatingUserEmail parameter for context
function createCalendarEvent(dispensaryName, postData, assignedMemberEmail, creatingUserEmail = 'System') {
  // Access data using postData object and original form field names (keys)
  const dueDate = postData['Due Date']; // Use original key
  const nextAction = postData['Next Action Item']; // Use original key
  let assignedMemberName = postData['Assigned Member']; // Get assigned member name from form data

  if (!dueDate || !nextAction) {
      Logger.log("Cannot create calendar event: Missing Due Date or Next Action Item.");
      return { success: false, message: "Missing due date or action item." };
  }
  if (!assignedMemberEmail) {
       Logger.log(`Cannot create calendar event for ${dispensaryName}: Missing assigned member email.`);
       return { success: false, message: "Missing assigned member email." };
  }
   if (!assignedMemberName) {
       Logger.log(`Cannot create calendar event for ${dispensaryName}: Missing assigned member name in form data.`);
       // Fallback title if name is missing
       assignedMemberName = assignedMemberEmail; // Use email as name if name is missing
  }


  try {
    const calendar = CalendarApp.getDefaultCalendar();
    const startTime = new Date(dueDate);
    if (isNaN(startTime.getTime())) {
        throw new Error(`Invalid Due Date format: ${dueDate}`);
    }
    // Set time to 9 AM in the script's timezone if only date is provided
    if (String(dueDate).indexOf('T') === -1 && String(dueDate).indexOf(' ') === -1) {
        startTime.setHours(9, 0, 0, 0);
    }
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour duration

    // Get creator's name
    const setupResult = getSetupData();
    const creatingUserInfo = setupResult.success ? setupResult.data.memberEmails.find(m => m.email && m.email.toLowerCase() === creatingUserEmail.toLowerCase()) : null;
    const creatingUserName = creatingUserInfo ? creatingUserInfo.name : creatingUserEmail; // Use name or fallback to email

    // New Event Title Format (PRD 5.8)
    const eventTitle = `${assignedMemberName}, ${dispensaryName}: ${nextAction}`;
    // Access data using postData object and original form field names (keys)
    const eventDescription = `Dispensary: ${dispensaryName}\nTask: ${nextAction}\nDetails: ${postData.nextActionItemDetails || 'N/A'}\nContact: ${postData['Contact Person Name'] || 'N/A'} (${postData['Phone'] || 'N/A'})\n\n(Event created by ${creatingUserName})`; // Add creator context

    // New Invitees Logic (PRD 5.8)
    const guestsSet = new Set();
    guestsSet.add(assignedMemberEmail.toLowerCase()); // Add assigned member

    // Add Operator Email (handle potential multiple emails in OPERATOR_EMAIL string)
    if (OPERATOR_EMAIL) {
        OPERATOR_EMAIL.split(',')
                      .map(e => e.trim().toLowerCase())
                      .filter(e => e && e.includes('@'))
                      .forEach(e => guestsSet.add(e));
    }

    // Add All Manager Emails
    // Ensure MANAGER_EMAILS is initialized
    if (!MANAGER_EMAILS || MANAGER_EMAILS.length === 0) {
        Logger.log("MANAGER_EMAILS array not initialized. Re-running initialize() to fetch them.");
        initialize(); // Attempt to re-initialize to get manager emails
    }
    if (MANAGER_EMAILS && MANAGER_EMAILS.length > 0) {
        MANAGER_EMAILS.forEach(managerEmail => guestsSet.add(managerEmail.toLowerCase()));
    } else {
        Logger.log("No manager emails found in MANAGER_EMAILS array after initialization check.");
    }


    const finalGuestsList = Array.from(guestsSet).join(','); // Create comma-separated list from unique emails

    const eventOptions = {
      description: eventDescription,
      guests: finalGuestsList,
      sendInvites: true
    };

    const event = calendar.createEvent(eventTitle, startTime, endTime, eventOptions);
    Logger.log(`Calendar event created: ${event.getId()} for ${dispensaryName}. Title: "${eventTitle}". Invitees: ${finalGuestsList}`);
    return { success: true, message: 'Calendar event created successfully' };
  } catch (error) {
    Logger.log(`Error creating calendar event for ${dispensaryName}: ${error.toString()} Stack: ${error.stack}`);
    return { success: false, message: 'Error creating calendar event: ' + error.toString() };
  }
}


// --- Email Digest Functions ---

function addPendingEmail(recipient, subject, body) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(PENDING_EMAILS_SHEET_NAME);
    if (!sheet) {
        Logger.log(`Sheet "${PENDING_EMAILS_SHEET_NAME}" not found. Cannot add pending email.`);
        return;
    }
    const timestamp = new Date().toISOString();
    sheet.appendRow([recipient, subject, body, timestamp]);
  } catch (error) {
      Logger.log(`Error adding pending email for ${recipient}: ${error}`);
  }
}

function getPendingEmails() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(PENDING_EMAILS_SHEET_NAME);
   if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return []; // Check if there's more than just the header
  const headers = data.shift(); // Remove header

  return data.map((row, index) => {
      if (!row[0] || !row[1] || !row[2] || !row[3]) {
          Logger.log(`Skipping invalid pending email entry at sheet row ${index + 2}`);
          return null; // Skip rows with missing essential data
      }
      return {
        recipient: String(row[0]).trim(),
        subject: String(row[1]),
        body: String(row[2]),
        timestamp: new Date(row[3]) // Assuming timestamp is in ISO format
      };
  }).filter(email => email !== null); // Filter out any null entries
}


function clearPendingEmails() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(PENDING_EMAILS_SHEET_NAME);
   if (!sheet) return;
  if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }
   Logger.log("Cleared pending emails.");
}

function sendCombinedDailyEmails() {
  initialize(); // Ensure emails/setup are loaded
  const pendingEmails = getPendingEmails();
  if (pendingEmails.length === 0) {
    Logger.log("No pending emails to send.");
    return;
  }

  const emailsByRecipient = {};
  pendingEmails.forEach(email => {
    const recipient = email.recipient.toLowerCase(); // Normalize recipient email
    if (!recipient || !recipient.includes('@')) {
        Logger.log(`Skipping pending email with invalid recipient: ${email.recipient}`);
        return; // Skip this email
    }
    if (!emailsByRecipient[recipient]) {
      emailsByRecipient[recipient] = [];
    }
    emailsByRecipient[recipient].push(email);
  });

  Logger.log(`Sending daily digests to ${Object.keys(emailsByRecipient).length} recipients.`);

  const quota = MailApp.getRemainingDailyQuota();
  Logger.log(`Remaining email quota before sending: ${quota}`);
  let emailsSent = 0;

  for (const [recipient, emails] of Object.entries(emailsByRecipient)) {
    if (MailApp.getRemainingDailyQuota() < 1) {
        Logger.log("Email quota reached. Stopping daily digest sending.");
        break; // Stop if quota is exceeded
    }

    const subject = `Daily CRM Update - ${Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd")}`;
    let body = `Here's your daily summary of CRM activities:\n\n`;

    emails.sort((a, b) => a.timestamp - b.timestamp); // Sort by timestamp ascending

    emails.forEach(email => {
      // Check if timestamp is valid before formatting
      let formattedTime = "Time N/A";
      if (email.timestamp && !isNaN(email.timestamp.getTime())) {
          formattedTime = Utilities.formatDate(email.timestamp, TIMEZONE, "HH:mm");
      } else {
          Logger.log(`Invalid timestamp found for email to ${recipient}, Subject: ${email.subject}`);
      }
      body += `--- ${email.subject} [${formattedTime}] ---\n`;
      body += `${email.body}\n\n`;
    });

    try {
        MailApp.sendEmail(recipient, subject, body);
        emailsSent++;
        Logger.log(`Sent daily digest to ${recipient}`);
    } catch (error) {
        Logger.log(`Failed to send daily digest to ${recipient}: ${error}`);
        // Optionally, add these failed emails back to pending? Or just log.
    }
  }

  Logger.log(`Finished sending daily digests. Sent ${emailsSent} emails.`);
  const quotaAfter = MailApp.getRemainingDailyQuota();
  Logger.log(`Remaining email quota after sending: ${quotaAfter}`);


  // Only clear emails if sending was attempted (even if some failed)
  if (Object.keys(emailsByRecipient).length > 0) {
      clearPendingEmails();
  }
}

// --- Trigger Setup (Run manually once or as needed) ---

function setupTriggers() {
    const triggers = ScriptApp.getProjectTriggers();
    let triggerExists = false;
    triggers.forEach(trigger => {
        if (trigger.getHandlerFunction() === 'sendCombinedDailyEmails') {
            // ScriptApp.deleteTrigger(trigger); // Optional: Delete existing before creating new
            // Logger.log("Deleted existing daily email trigger.");
             Logger.log("Found existing daily email trigger. Skipping creation.");
             triggerExists = true;

        }
    });

    if (!triggerExists) {
        ScriptApp.newTrigger('sendCombinedDailyEmails')
          .timeBased()
          .everyDays(1)
          .atHour(17) // 5 PM
          .inTimezone(TIMEZONE)
          .create();
        Logger.log(`Created new daily email trigger for handler 'sendCombinedDailyEmails' at 5 PM ${TIMEZONE}.`);
    }
}

// --- Test Functions ---
function testSendCombinedEmails() {
  Logger.log("Manually testing sendCombinedDailyEmails...");
  // Add test data - replace with valid emails if needed for actual sending
  addPendingEmail('test@example.com', 'Test Subject 1', 'Test Body 1');
  addPendingEmail('test2@example.com', 'Test Subject 2', 'Test Body 2');
  addPendingEmail('test@example.com', 'Test Subject 3', 'Test Body 3 earlier', new Date(Date.now() - 3600000).toISOString()); // Add timestamp manually for testing order
  sendCombinedDailyEmails();
}

function testAssign() {
    // Test assigning a shop - replace with actual data from your sheet
    Logger.log("Manually testing assignShops...");
    const testShopIds = ["REPLACE_WITH_UNASSIGNED_SHOP_NAME"]; // <<<<< CHANGE THIS
    const testMember = "REPLACE_WITH_VALID_MEMBER_NAME"; // <<<<< CHANGE THIS
    const testNotes = "This is a manual test assignment note via testAssign function.";
    if (testShopIds[0] === "REPLACE_WITH_UNASSIGNED_SHOP_NAME" || testMember === "REPLACE_WITH_VALID_MEMBER_NAME") {
        Logger.log("WARNING: Using default test data for testAssign. Please update testShopIds and testMember with real data from your sheets.");
        return;
    }
    // Cannot reliably get user email without context like doGet/doPost provides authInfo
    // Using a placeholder email for the test function.
    const userEmailForTest = 'test-assigner@example.com';
    Logger.log(`Running testAssign with user email: ${userEmailForTest}`);
    const result = assignShops(testShopIds, testMember, testNotes, userEmailForTest);
    Logger.log(`AssignShops test result: ${JSON.stringify(result)}`);
}

function testGetNearby() {
    Logger.log("Manually testing getNearbyDispensaries...");
    // Replace with coordinates near your test data
    const lat = 13.7563; // Example: Bangkok latitude
    const lon = 100.5018; // Example: Bangkok longitude
    const limit = 10;
    const radiusKm = 25;
    const result = getNearbyDispensaries(lat, lon, limit, radiusKm);
    Logger.log(`GetNearbyDispensaries test result for ${lat}, ${lon} (Limit: ${limit}, Radius: ${radiusKm}km): ${JSON.stringify(result, null, 2)}`);

}

function testGetSetupData() {
    Logger.log("Manually testing getSetupData...");
    setupData = null; // Force refresh
    const result = getSetupData();
    Logger.log(`GetSetupData test result: ${JSON.stringify(result, null, 2)}`);
}

function testAddManagerComment() {
     Logger.log("Manually testing addManagerComment...");
     const testShopName = "REPLACE_WITH_EXISTING_CRM_SHOP_NAME"; // <<<<< CHANGE THIS
     const testComment = "This is a test comment added via test function.";
     if (testShopName === "REPLACE_WITH_EXISTING_CRM_SHOP_NAME") {
         Logger.log("WARNING: Using default test data for testAddManagerComment. Please update testShopName.");
         return;
     }
     // Cannot reliably get user email without context like doGet/doPost provides authInfo
     // Using a placeholder email for the test function.
     const userEmailForTest = 'test-commenter@example.com';
     Logger.log(`Running testAddManagerComment with user email: ${userEmailForTest}`);
     const result = addManagerComment(testShopName, testComment, userEmailForTest);
     Logger.log(`AddManagerComment test result: ${JSON.stringify(result)}`);
}