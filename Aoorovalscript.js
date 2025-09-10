// --- START: REQUIRED KEYS & URL ---
const GOOGLE_CLOUD_API_KEY = "AIzaSyBzpd32TmhuLyFjZ7t3J4__KuY7c3Gm-P0";
const GOOGLE_CLIENT_ID = '316419019852-4dum2avurto1fv23lm0mrehl6pa8k103.apps.googleusercontent.com';
const SPREADSHEET_ID = '1j359MdhUs9mScAnC7T0fB33LAZY2F_WISLxAbgGnHDM';

// --- ⚠️ ACTION REQUIRED: PASTE YOUR DEPLOYED GOOGLE APPS SCRIPT URL HERE ---
const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxGkiAts8CHjaFWF5gs6OxC9L70R3lA9NzJdkwhgyXt1qqqzivivXzyQ5Ab1da8TiIA6g/exec'; 
// ---

// --- Sheet Names ---
const MAIN_SHEET_NAME = 'Sheet1';
const HOD_SHEET_NAME = 'HOD';
const FINAL_APPROVAL_SHEET_NAME = 'Final Approval';
// ---

// --- Global State Variables ---
let tokenClient;
let gapiInited = false;
let gisInited = false;
let allSheetData = []; // Array of objects, each with a __rowNumber property
let visibleHeaders = [];
let currentApprovalView = 'none'; // 'none', 'hod', or 'final'
let hodEmailMap = new Map();
let finalApprovalEmailMap = new Map();

// --- DOM Element References ---
const loader = document.getElementById('loader');
const authView = document.getElementById('auth-view');
const headerSelectionView = document.getElementById('header-selection-view');
const dataApprovalView = document.getElementById('data-approval-view');
const authorizeBtn = document.getElementById('authorize_button');
const headerListDiv = document.getElementById('header-list');
const showDataBtn = document.getElementById('show-data-btn');
const backToHeadersBtn = document.getElementById('back-to-headers-btn');
const homeBtn = document.getElementById('home-btn');
const hodPendingBtn = document.getElementById('hod-pending-btn');
const finalPendingBtn = document.getElementById('final-pending-btn');
const dataTableContainer = document.getElementById('data-table-container');
const noDataMessage = document.getElementById('no-data-message');
const sendHodApprovalBtn = document.getElementById('send-hod-approval-btn');
const sendFinalApprovalBtn = document.getElementById('send-final-approval-btn');

// --- GOOGLE API INITIALIZATION ---
function gapiLoaded() { gapi.load('client', initializeGapiClient); }
async function initializeGapiClient() {
    await gapi.client.init({
        apiKey: GOOGLE_CLOUD_API_KEY,
        discoveryDocs: ["https://sheets.googleapis.com/$discovery/rest?version=v4"],
    });
    gapiInited = true;
    maybeEnableAuthButton();
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', // Read-only is enough for the client
        callback: handleAuthResponse,
    });
    gisInited = true;
    maybeEnableAuthButton();
}

function maybeEnableAuthButton() {
    if (gapiInited && gisInited) {
        authorizeBtn.disabled = false;
        authorizeBtn.textContent = 'Authorize Google Sheets';
    }
}

// --- AUTHENTICATION FLOW ---
function handleAuthClick() {
    if (GOOGLE_APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') {
        alert("Configuration Error: Please paste the Google Apps Script URL into script.js");
        return;
    }
    tokenClient.requestAccessToken({ prompt: '' });
}

async function handleAuthResponse(resp) {
    if (resp.error) {
        alert("Authorization failed. Please try again.");
        return;
    }
    await fetchAllSheetData();
}

// --- DATA FETCHING & PROCESSING ---
async function fetchAllSheetData() {
    setLoading(true, "Fetching data from all sheets...");
    try {
        const response = await gapi.client.sheets.spreadsheets.values.batchGet({
            spreadsheetId: SPREADSHEET_ID,
            ranges: [MAIN_SHEET_NAME, HOD_SHEET_NAME, FINAL_APPROVAL_SHEET_NAME],
        });

        const sheetValues = response.result.valueRanges;
        const mainDataValues = sheetValues[0].values;
        const hodDataValues = sheetValues[1].values;
        const finalDataValues = sheetValues[2].values;

        if (!mainDataValues || mainDataValues.length < 2) {
            alert("Main sheet is empty or contains only headers.");
            setLoading(false);
            return;
        }

        // Process Main Sheet Data
        const headers = mainDataValues[0];
        allSheetData = mainDataValues.slice(1).map((row, index) => {
            const rowObject = { '__rowNumber': index + 2 }; // Store the actual sheet row number
            headers.forEach((header, i) => {
                rowObject[header] = row[i] || '';
            });
            return rowObject;
        });

        // Process HOD and Final Approval lookup sheets
        hodEmailMap = new Map(hodDataValues.slice(1).map(row => [row[0], row[1]]));
        finalApprovalEmailMap = new Map(finalDataValues.slice(1).map(row => [row[0], row[1]]));

        populateHeaderSelection(headers);
        switchView('header-selection-view');

    } catch (err) {
        console.error('Error fetching sheet data:', err);
        alert(`Error fetching data: ${err.result?.error?.message || 'Check console.'}`);
    } finally {
        setLoading(false);
    }
}


// --- EMAIL & BACKEND COMMUNICATION ---
async function sendApprovalEmails(approvalType) {
    setLoading(true, "Grouping items and preparing emails...");

    const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
    if (checkedBoxes.length === 0) {
        alert("Please select at least one item to send for approval.");
        setLoading(false);
        return;
    }

    const itemsToProcess = Array.from(checkedBoxes).map(cb => {
        return allSheetData.find(d => d.__rowNumber == cb.dataset.rowNumber);
    });

    const approverColumnName = approvalType === 'HOD' ? 'HOD Approval' : 'Final Approval';
    const emailMap = approvalType === 'HOD' ? hodEmailMap : finalApprovalEmailMap;
    
    // Group items by approver
    const groupedByApprover = itemsToProcess.reduce((acc, item) => {
        const approverName = item[approverColumnName];
        if (!acc[approverName]) acc[approverName] = [];
        acc[approverName].push(item);
        return acc;
    }, {});
    
    // Create payload for each approver and send to backend
    const requests = Object.entries(groupedByApprover).map(([approverName, items]) => {
        const approverEmail = emailMap.get(approverName);
        if (!approverEmail) {
            console.warn(`Could not find email for approver: ${approverName}. Skipping.`);
            return Promise.resolve(); // Skip this one
        }

        // We only need to send the data the email template will display, plus the row number
        const itemsForEmail = items.map(item => {
            let emailItem = { "Row Number": item.__rowNumber };
            visibleHeaders.forEach(h => emailItem[h] = item[h]);
            return emailItem;
        });

        const payload = {
            approverEmail,
            approvalType,
            items: itemsForEmail
        };

        return fetch(GOOGLE_APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' } // Required for Apps Script
        }).then(res => res.json());
    });
    
    setLoading(true, `Sending ${requests.length} email(s)...`);
    
    try {
        const results = await Promise.all(requests);
        let failures = results.filter(res => res && !res.success);
        if (failures.length > 0) {
            alert(`Some emails failed to send. Error: ${failures[0].message}`);
        } else {
            alert("Approval emails have been sent successfully!");
            homeBtn.click(); // Go back to home view to refresh the data state
        }
    } catch (error) {
        alert("An error occurred while sending emails. Check the console.");
        console.error("Email sending error:", error);
    } finally {
        setLoading(false);
    }
}


// --- UI RENDERING & VIEW MANAGEMENT ---
function populateHeaderSelection(headers) {
    headerListDiv.innerHTML = '';
    // Exclude our internal __rowNumber property from being a selectable column
    headers.forEach(header => {
        const itemHtml = `<div class="header-item"><input type="checkbox" id="header-${header}" value="${header}" checked><label for="header-${header}">${header}</label></div>`;
        headerListDiv.innerHTML += itemHtml;
    });
}

function renderDataTable(dataToRender, headersToRender, options = {}) {
    const { withCheckboxes = false } = options;
    dataTableContainer.innerHTML = '';
    noDataMessage.style.display = 'none';

    if (!dataToRender || dataToRender.length === 0) {
        noDataMessage.style.display = 'block';
        return;
    }

    let tableHtml = '<table><thead><tr>';
    if (withCheckboxes) tableHtml += '<th>Select</th>';
    headersToRender.forEach(header => tableHtml += `<th>${header}</th>`);
    tableHtml += '</tr></thead><tbody>';

    dataToRender.forEach(row => {
        tableHtml += '<tr>';
        if (withCheckboxes) {
            tableHtml += `<td><input type="checkbox" class="row-checkbox" data-row-number="${row.__rowNumber}" checked></td>`;
        }
        headersToRender.forEach(header => {
            tableHtml += `<td>${row[header] || ''}</td>`;
        });
        tableHtml += '</tr>';
    });
    tableHtml += '</tbody></table>';

    dataTableContainer.innerHTML = tableHtml;

    if (withCheckboxes) {
        document.querySelectorAll('.row-checkbox').forEach(cb => cb.addEventListener('change', updateApprovalButtonVisibility));
    }
}

function updateApprovalButtonVisibility() {
    sendHodApprovalBtn.style.display = 'none';
    sendFinalApprovalBtn.style.display = 'none';
    const allChecked = document.querySelectorAll('.row-checkbox:checked').length > 0;
    if (!allChecked) return;
    if (currentApprovalView === 'hod') sendHodApprovalBtn.style.display = 'block';
    else if (currentApprovalView === 'final') sendFinalApprovalBtn.style.display = 'block';
}

function manageButtonVisibility(state) {
    homeBtn.style.display = 'none';
    hodPendingBtn.style.display = 'inline-block';
    finalPendingBtn.style.display = 'inline-block';
    if (state === 'hod_view' || state === 'final_view') {
        homeBtn.style.display = 'inline-block';
        hodPendingBtn.style.display = 'none';
        finalPendingBtn.style.display = 'none';
    }
}

function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.getElementById(viewId).style.display = 'block';
}

function setLoading(isLoading, message = "Processing...") {
    loader.style.display = isLoading ? 'block' : 'none';
    loader.querySelector('p').innerText = message;
}

// --- EVENT LISTENERS ---
authorizeBtn.addEventListener('click', handleAuthClick);

showDataBtn.addEventListener('click', () => {
    visibleHeaders = Array.from(headerListDiv.querySelectorAll('input:checked')).map(cb => cb.value);
    if (visibleHeaders.length === 0) {
        alert("Please select at least one column.");
        return;
    }
    switchView('data-approval-view');
    homeBtn.click(); // Use homeBtn click to set the default view
});

homeBtn.addEventListener('click', () => {
    currentApprovalView = 'none';
    manageButtonVisibility('initial');
    renderDataTable(allSheetData, visibleHeaders);
    sendHodApprovalBtn.style.display = 'none';
    sendFinalApprovalBtn.style.display = 'none';
});

hodPendingBtn.addEventListener('click', () => {
    currentApprovalView = 'hod';
    manageButtonVisibility('hod_view');
    const pendingData = allSheetData.filter(row => row['HOD Approval Status'] === 'Pending');
    renderDataTable(pendingData, visibleHeaders, { withCheckboxes: true });
    updateApprovalButtonVisibility();
});

finalPendingBtn.addEventListener('click', () => {
    currentApprovalView = 'final';
    manageButtonVisibility('final_view');
    const pendingData = allSheetData.filter(
        row => row['HOD Approval Status'] === 'Approved' && row['Final Approval Status'] === 'Pending'
    );
    renderDataTable(pendingData, visibleHeaders, { withCheckboxes: true });
    updateApprovalButtonVisibility();
});

backToHeadersBtn.addEventListener('click', () => switchView('header-selection-view'));

sendHodApprovalBtn.addEventListener('click', () => sendApprovalEmails('HOD'));
sendFinalApprovalBtn.addEventListener('click', () => sendApprovalEmails('Final'));