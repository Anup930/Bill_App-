// --- START: REQUIRED KEYS (REPLACE THESE) ---
// AIzaSyD20V3kl-bSkyBL8XZWKORc7d4fImHYjNM
// Old-AIzaSyCDEGN1ZXXVda9yhp2bHhpzT5yncr66CKY
const GEMINI_API_KEY = ""; // <--- ⚠️ PASTE YOUR GEMINI API KEY HERE //AIzaSyCDEGN1ZXXVda9yhp2bHhpzT5yncr66CKY
const GOOGLE_CLOUD_API_KEY = "AIzaSyCtGleETIdBzb62E_uS1-xKJq2rtJf7IbI"; // <--- ⚠️ PASTE YOUR GOOGLE CLOUD API KEY HERE
const GOOGLE_CLIENT_ID = '11695437694-vdhi7mtrobv6nhpsv2171g883adu3o6l.apps.googleusercontent.com'; // <--- ⚠️ PASTE YOUR NEW CLIENT ID HERE
const SPREADSHEET_ID = '1j359MdhUs9mScAnC7T0fB33LAZY2F_WISLxAbgGnHDM';
const DRIVE_FOLDER_ID = '1m1UqRMWNX5c7BBUg5_j5NF5JAm1HQuQO'; // <--- ⚠️ PASTE YOUR GOOGLE DRIVE FOLDER ID HERE

// Comment: Global variables for Google API clients
let tokenClient;
let gapiInited = false;
let gisInited = false;

// Comment: Global variables for app state
let pdfFile = null;
let pdfBlobUrl = null;
let verificationPopup = null;
let billData = [];
let sheetHeaders = [];

// Comment: Get references to DOM elements
const pdfUpload = document.getElementById('pdf-upload');
const getDataBtn = document.getElementById('get-data-btn');
const extractedTextOutput = document.getElementById('extracted-text-output');
const extractedTextSection = document.getElementById('extracted-text-section');
const statusArea = document.getElementById('status-area');
const loader = document.getElementById('loader');
const resultsDiv = document.getElementById('results');
const downloadSection = document.getElementById('download-section');
const authorizeBtn = document.getElementById('authorize_button');
const signoutBtn = document.getElementById('signout_button');
const processNewBtn = document.getElementById('process-new-btn');

// --- GOOGLE API INITIALIZATION ---
function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}
async function initializeGapiClient() {
    try {
        await gapi.client.init({
            apiKey: GOOGLE_CLOUD_API_KEY,
            discoveryDocs: [
                "https://sheets.googleapis.com/$discovery/rest?version=v4",
                "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"
            ],
        });
        gapiInited = true;
        maybeEnableAuthButtons();
    } catch (error) {
        console.error("Error initializing GAPI client:", error);
        showStatus('error', 'Could not initialize Google API. Check your Google Cloud API Key.');
    }
}
function gisLoaded() {
    try {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
            callback: '',
        });
        gisInited = true;
        maybeEnableAuthButtons();
    } catch (error) {
        console.error("Error initializing GIS client:", error);
        showStatus('error', 'Could not initialize Google Sign-In. Check your Google Client ID.');
    }
}
function maybeEnableAuthButtons() {
    if (gapiInited && gisInited) {
        authorizeBtn.style.visibility = 'visible';
    }
}

// --- AUTHENTICATION HANDLERS ---
function handleAuthClick() {
    if (!tokenClient) { console.error("Token client not initialized."); return; }
    tokenClient.callback = (resp) => {
        if (resp.error !== undefined) { console.error("Auth Error:", resp); throw (resp); }
        signoutBtn.style.visibility = 'visible';
        authorizeBtn.innerText = 'Refresh Token';
        showStatus('success', 'Authorization successful! You can now process the bill.');
        maybeEnableGetDataButton();
    };
    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        tokenClient.requestAccessToken({ prompt: '' });
    }
}
function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
        signoutBtn.style.visibility = 'hidden';
        authorizeBtn.innerText = 'Authorize Google Sheets';
        getDataBtn.disabled = true;
        showStatus('info', 'You have been signed out.');
    }
}

// --- CORE APPLICATION LOGIC ---
const DEFAULT_PROMPT = `Kindly Read carefuly and tell me the following details in JSON format:
1. Name of the Vendor
2. Name of the company on which this bill has been raise
3. What is the Invoice Number?
4. Is this is a capital or revenue expense?
5. ⁠What is the expense name in which the bill should be booked if it is a revenue expenditure? If it is a capital expenditure, under which asset group should it be capitalised?
6. Is TDS Applicable on this bill?
7. If tds is applicable what is the rate?
8. what is the amount of tds if applicable?
9. Under which TDS Section this deduction is applicable?
10. Is GST under RCM applicable?
11. Is GST Input included in the bill?
12. Is the nature of IGST or CGST and SGST as per Place of Supply in GST correct?
13. what is the amount of cgst, sgst or igst input included in the bill?
14. What is the final amount payable to the vendor?
15. Are there any remarks mentioned in the bill?
Note: 
A. always Give CGSTAmount, SGSTAmount, IGSTAmount, Don't Inclode in Once
B. Always Keep Col name Vendor, always keep Col name Company, always keep col name CapitalOrRevenueExpense
C. Add a Col Part Payment and in val add 0 Every Time,
D. Memo No, Doc No both are same as invoice No, always Keep In InvoiceNumber
E.Also We need to show Few Col (CapitalOrRevenueExpense,ExpenseName, Taxable Value, TDSApplicable,TDSRate, TDSAmount, TDSSection, RCMApplicable, GSTInputIncluded, GSTCorrect, CGSTAmount, SGSTAmount, IGSTAmount, FinalAmountPayable, PartPayment, Remarks)
F. Add 2 Column (Accountant Approval, CFO Approval) always add val Pending
Return ONLY valid JSON without any extra text, explanation, or markdown formatting.`;

pdfUpload.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    resetUIForNewBill();

    pdfFile = file;
    if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); }
    pdfBlobUrl = URL.createObjectURL(file);
    
    extractedTextSection.style.display = 'block';
    showStatus('info', 'Step 1: Reading PDF file...');
    const fileReader = new FileReader();
    fileReader.onload = async function() {
        const typedarray = new Uint8Array(this.result);
        try {
            const extractedText = await extractTextFromPdf(typedarray);
            if (extractedText) {
                extractedTextOutput.value = extractedText;
                showStatus('success', 'Text extracted! Please fill manual details and authorize Google Sheets.');
                maybeEnableGetDataButton();
            } else {
                showStatus('error', 'Could not extract any text from the PDF.');
            }
        } catch (error) {
            console.error("Processing Error:", error);
            showStatus('error', 'An error occurred while processing the PDF.');
        }
    };
    fileReader.readAsArrayBuffer(file);
});

async function extractTextFromPdf(pdfData) {
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    let combinedText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        if (textContent.items.length > 0) {
            combinedText += textContent.items.map(s => s.str).join(' ') + '\n';
        }
    }
    if (!combinedText.trim()) {
        showStatus('info', 'No direct text found. Starting OCR...');
        const worker = await Tesseract.createWorker('eng');
        for (let i = 1; i <= pdf.numPages; i++) {
            showStatus('info', `Processing Page ${i}/${pdf.numPages} with OCR...`);
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
            const { data: { text } } = await worker.recognize(canvas);
            combinedText += text + '\n';
        }
        await worker.terminate();
    }
    return combinedText.trim();
}

getDataBtn.addEventListener('click', async () => {
    const billSource = document.getElementById('bill-source').value;
    const billGivenBy = document.getElementById('bill-given-by').value;
    const addedBy = document.getElementById('added-by').value;
    const hodApproval = document.getElementById('hod-approval').value;
    const finalApproval = document.getElementById('final-approval').value;
    if (extractedTextOutput.value.trim() === "") { showStatus('error', 'Please upload a PDF first.'); return; }
    if (!billGivenBy || !addedBy) { showStatus('error', 'Please fill "Bill Given By" and "Added By" fields.'); return; }

    setLoading(true, "Getting latest columns from Google Sheet...");
    try {
        await fetchSheetHeaders();
    } catch (error) {
        showStatus('error', `Could not fetch headers from Google Sheet: ${error.message}`, true);
        setLoading(false);
        return;
    }

    setLoading(true, "Processing with Gemini...");
    // const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    // const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    const payload = { contents: [{ parts: [{ text: `${DEFAULT_PROMPT}\n\nBill Text:\n${extractedTextOutput.value}` }] }] };
    try {
        const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error ? errorData.error.message : `API request failed with status ${response.status}`);
        }
        const data = await response.json();
        const geminiText = data.candidates[0].content.parts[0].text;
        const jsonMatch = geminiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsedData = JSON.parse(jsonMatch[0]);
            const uniqueId = `BID-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
            const finalDataObject = {
                "Unique ID": uniqueId,
                ...parsedData,
                "Bill Source": billSource,
                "Bill Given By": billGivenBy,
                "Added By": addedBy,
                "HOD Approval": hodApproval,
                "Final Approval": finalApproval,
                'HOD Approval Status': 'Pending',
                'Final Approval Status': 'Pending',
                "PDF Link": "Pending Upload"
            };
            showStatus('info', 'Opening verification tab...', true);
            openVerificationPopup(finalDataObject, sheetHeaders);
        } else {
            showStatus('error', 'No valid JSON found in the AI response.', true);
            resultsDiv.innerHTML = `<pre>${geminiText}</pre>`;
        }
    } catch (error) {
        console.error('Gemini API/Processing Error:', error);
        showStatus('error', `Error: ${error.message}`, true);
    } finally {
        setLoading(false);
    }
});

function openVerificationPopup(data, headers) {
    if (verificationPopup && !verificationPopup.closed) {
        verificationPopup.focus();
        return;
    }

    verificationPopup = window.open('', '_blank');

    if (!verificationPopup || verificationPopup.closed || typeof verificationPopup.closed == 'undefined') {
        showStatus('error', 'Popup was blocked by your browser. Please allow popups for this site and try again.', true);
        setLoading(false);
        return;
    }

    verificationPopup.document.write(`
        <!DOCTYPE html><html lang="en"><head><title>Verify Bill Data</title><style>
        body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;height:100vh;margin:0;background-color:#f4f7fb}
        .panel{height:100%;box-sizing:border-box}#pdf-viewer{flex:1 1 55%;border-right:2px solid #d1d9e6}
        #form-container{flex:1 1 45%;padding:25px;overflow-y:auto;background-color:#fff}
        h2{color:#1a73e8;border-bottom:1px solid #eee;padding-bottom:10px;margin-top:0}
        .form-row{display:flex;align-items:flex-end;gap:15px;margin-bottom:12px;}
        .main-field{flex-grow:1;}
        .form-row label{font-weight:600;display:block;margin-bottom:4px;font-size:14px;color:#333;}
        textarea,input{width:100%;box-sizing:border-box;padding:10px;font-size:14px;border:1px solid #d1d9e6;border-radius:6px;background-color:#fafbfc}
        input[readonly]{background-color:#f0f0f0;cursor:not-allowed;color:#555}
        .column-switcher{cursor:pointer;padding-bottom:8px;min-width:120px;text-align:right;}
        .column-switcher .column-name{font-size:13px;color:#1a73e8;font-weight:500;border-bottom:1px dashed #1a73e8;}
        .column-switcher select{font-size:13px;border-radius:6px;border-color:#d1d9e6;}
        .column-switcher select{display:none;}
        button{background:linear-gradient(90deg,#34a853,#2a7b3b);color:#fff;width:100%;padding:14px;border:none;border-radius:8px;cursor:pointer;font-size:16px;font-weight:700;margin-top:15px}
        button:hover{box-shadow:0 4px 12px rgba(52,168,83,.3)}
        </style></head><body><div id="pdf-viewer" class="panel"><embed src="${pdfBlobUrl}" type="application/pdf" width="100%" height="100%"></div>
        <div id="form-container" class="panel"><h2>📝 Verify & Edit Data</h2><div id="editable-form"></div><button id="add-to-sheet-btn">Confirm and Add Data to Sheet</button></div>
        <script>
            document.addEventListener('DOMContentLoaded',()=>{
                const data=${JSON.stringify(data)};
                const headers=${JSON.stringify(headers)};
                const formDiv=document.getElementById('editable-form');
                let formHtml='';

                for(const key in data){
                    // --- THIS LINE IS NOW CORRECTED ---
                    const inputId='edit-'+key.replace(/[^a-zA-Z0-9]/g,'-');
                    const value=String(data[key]||'').replace(/"/g,'&quot;');
                    const isReadOnly=(key==="Unique ID"||key.includes("Status")||key==="PDF Link");
                    
                    formHtml+='<div class="form-row">';
                    formHtml+='<div class="main-field">';
                    formHtml+=\`<label for="\${inputId}">\${key}</label>\`;
                    if(isReadOnly){
                        formHtml+=\`<input type="text" id="\${inputId}" value="\${value}" readonly>\`;
                    } else {
                        formHtml+=\`<textarea id="\${inputId}" rows="1">\${value}</textarea>\`;
                    }
                    formHtml+='</div>';

                    if (!isReadOnly) {
                        let dropdownHtml = '<select class="column-selector">';
                        let keyExistsInHeaders = false;
                        headers.forEach(header => {
                            const isSelected = header === key ? 'selected' : '';
                            if (isSelected) keyExistsInHeaders = true;
                            dropdownHtml += \`<option value="\${header}" \${isSelected}>\${header}</option>\`;
                        });
                        if (!keyExistsInHeaders) {
                             dropdownHtml += \`<option value="\${key}" selected>\${key} (New)</option>\`;
                        }
                        dropdownHtml += '<option value="__addNew__">-- Add New Column --</option>';
                        dropdownHtml += '</select>';

                        formHtml += \`<div class="column-switcher" data-original-key="\${key}">
                            <span class="column-name">\${key}</span>
                            \${dropdownHtml}
                        </div>\`;
                    }
                    formHtml+='</div>';
                }
                formDiv.innerHTML=formHtml;

                formDiv.addEventListener('click', function(e) {
                    const switcher = e.target.closest('.column-switcher');
                    if (!switcher) return;
                    const colNameSpan = switcher.querySelector('.column-name');
                    const colSelect = switcher.querySelector('.column-selector');
                    colNameSpan.style.display = 'none';
                    colSelect.style.display = 'inline-block';
                    colSelect.focus();
                });

                document.getElementById('add-to-sheet-btn').addEventListener('click',()=>{
                    const finalData={};
                    formDiv.querySelectorAll('.form-row').forEach(row => {
                        const input = row.querySelector('textarea, input');
                        const switcher = row.querySelector('.column-switcher');
                        let key;
                        const value = input.value;

                        if (switcher) {
                            const selector = switcher.querySelector('.column-selector');
                            key = selector.value;
                            if (key === '__addNew__') {
                                const newKey = prompt("Please enter the new column name:");
                                key = (newKey && newKey.trim() !== "") ? newKey.trim() : switcher.dataset.originalKey;
                            }
                        } else {
                            key = row.querySelector('label').innerText;
                        }
                        
                        if(key) { finalData[key] = value; }
                    });
                    window.opener.submitDataToSheet(finalData);
                    window.close();
                });
            });
        <\/script></body></html>`);
    verificationPopup.document.close();
}

async function submitDataToSheet(data) {
    setLoading(true, "Uploading PDF to Google Drive...");
    try {
        const fileLink = await uploadPdfToDrive(pdfFile);
        data["PDF Link"] = fileLink;
        
        setLoading(true, "Sending data to Google Sheets...");
        billData.push(data);
        createDownloadButton();
        await appendToSheet(data);
    } catch (error) {
        console.error('Error during submission process:', error);
        showStatus('error', `Submission failed: ${error.message}`, true);
    } finally {
        setLoading(false);
    }
}

async function fetchSheetHeaders() {
    try {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!1:1'
        });
        sheetHeaders = response.result.values ? response.result.values[0] : [];
    } catch (err) {
        console.error('Error fetching sheet headers:', err);
        const errorMessage = err.result?.error?.message || 'Could not fetch column headers from the sheet.';
        throw new Error(errorMessage);
    }
}

async function uploadPdfToDrive(fileObject) {
    if (!fileObject) throw new Error("No PDF file found to upload.");
    if (!DRIVE_FOLDER_ID || DRIVE_FOLDER_ID === 'YOUR_GOOGLE_DRIVE_FOLDER_ID') {
        throw new Error("Google Drive Folder ID is not set. Please update it in script.js.");
    }
    const metadata = { name: fileObject.name, parents: [DRIVE_FOLDER_ID], mimeType: 'application/pdf' };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', fileObject);
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST',
        headers: new Headers({ 'Authorization': 'Bearer ' + gapi.client.getToken().access_token }),
        body: form,
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to upload file to Google Drive.');
    }
    const fileData = await response.json();
    return fileData.webViewLink;
}

async function appendToSheet(data) {
    const sheetName = 'Sheet1';
    try {
        const headerResponse = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!1:1`
        });
        const existingHeaders = headerResponse.result.values ? headerResponse.result.values[0] : [];
        let finalHeaders = [...existingHeaders];
        const dataKeys = Object.keys(data);
        const newHeaders = dataKeys.filter(key => !existingHeaders.includes(key));
        if (newHeaders.length > 0) {
            finalHeaders = [...existingHeaders, ...newHeaders];
            await gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!1:1`,
                valueInputOption: 'RAW',
                resource: { values: [finalHeaders] }
            });
            sheetHeaders = finalHeaders;
        }
        const orderedRow = finalHeaders.map(header => data[header] !== undefined ? data[header] : '');
        await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: sheetName,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: [orderedRow] }
        });
        showStatus('success', `Data successfully added! View it <a href="https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/" target="_blank">here</a>.`, true);
        processNewBtn.style.display = 'block';
    } catch (err) {
        console.error('Error appending data to sheet:', err);
        const errorMessage = err.result?.error?.message || 'Could not add data. Check console.';
        showStatus('error', errorMessage, true);
    }
}

function maybeEnableGetDataButton() {
    if (gapi && gapi.client && gapi.client.getToken()) {
        const hasText = extractedTextOutput.value.trim() !== "";
        getDataBtn.disabled = !hasText;
    }
}

function setLoading(isLoading, message = "Processing...") {
    loader.style.display = isLoading ? 'block' : 'none';
    loader.querySelector('p').innerText = message;
}

function showStatus(type, message, isResult = false) {
    const targetDiv = isResult ? resultsDiv : statusArea;
    const messageHtml = `<div class="${type}">${message}</div>`;
    if (isResult) {
        targetDiv.insertAdjacentHTML('afterbegin', messageHtml);
    } else {
        targetDiv.innerHTML = messageHtml;
    }
}

function createDownloadButton() {
    if (downloadSection.querySelector('button')) return;
    const button = document.createElement('button');
    button.innerText = 'Download All Extracted Data (Excel)';
    button.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
    button.onclick = () => {
        if (billData.length === 0) { alert("No data to download."); return; }
        const worksheet = XLSX.utils.json_to_sheet(billData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Bills");
        XLSX.writeFile(workbook, "bill_data_extract.xlsx");
    };
    downloadSection.appendChild(button);
}

function resetUIForNewBill() {
    extractedTextOutput.value = "";
    document.getElementById('bill-given-by').value = "";
    document.getElementById('added-by').value = "";
    resultsDiv.innerHTML = "";
    statusArea.innerHTML = "";
    extractedTextSection.style.display = 'none';
    getDataBtn.disabled = true;
    processNewBtn.style.display = 'none';
}

function fullReset() {
    resetUIForNewBill();
    pdfUpload.value = "";
    if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); pdfBlobUrl = null; }
    pdfFile = null;
    showStatus('info', 'Ready for the next bill. Upload a PDF to begin.');
}

authorizeBtn.onclick = handleAuthClick;
signoutBtn.onclick = handleSignoutClick;
processNewBtn.addEventListener('click', fullReset);










