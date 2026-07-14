async function refreshFiles() {
  const files = await window.api.listRecords();
  const fileListEl = document.getElementById('fileList');
  const skillsListEl = document.getElementById('skillsList');
  
  if (fileListEl) fileListEl.textContent = '';
  if (skillsListEl) skillsListEl.textContent = '';
  
  if (files.length === 0) {
    if (fileListEl) {
      const placeholder = document.createElement('div');
      placeholder.style.cssText = 'padding: 15px; color: #666; font-size: 12px;';
      placeholder.textContent = 'No records found. Click Launch Browser and save a recording.';
      fileListEl.appendChild(placeholder);
    }
    return;
  }
  
  files.forEach(file => {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.textContent = file.name;
    div.addEventListener('click', async () => {
      document.getElementById('editorTitle').textContent = file.name;
      document.getElementById('editorContent').textContent = 'Loading...';
      const content = await window.api.readRecord(file.path);
      document.getElementById('editorContent').textContent = content;
    });
    
    if (file.name.endsWith('.skill.json')) {
      if (skillsListEl) skillsListEl.appendChild(div);
    } else {
      if (fileListEl) fileListEl.appendChild(div);
    }
  });
}

document.getElementById('launchBtn').addEventListener('click', async () => {
  const btn = document.getElementById('launchBtn');
  const statusEl = document.getElementById('status');
  const modeSelect = document.getElementById('modeSelect');
  const mode = modeSelect ? modeSelect.value : 'playwright-trace';
  
  btn.disabled = true;
  statusEl.textContent = 'Checking for updates and launching... (This may take a minute on first run)';
  try {
    const result = await window.api.launchRecorder(mode);
    if (result === 'success') {
      statusEl.textContent = 'Browser closed. Telemetry saved.';
      refreshFiles();
    } else {
      statusEl.textContent = 'Error: ' + result;
    }
  } finally {
    btn.disabled = false;
  }
});

refreshFiles();
setInterval(() => {
  if (!document.hidden) refreshFiles();
}, 5000);

const modeSelect = document.getElementById('modeSelect');
const extensionsList = document.getElementById('extensionsList');
if (modeSelect && extensionsList) {
  function updateExtensionsList() {
    const mode = modeSelect.value;
    let listHTML = '';
    if (mode === 'all') {
      listHTML = '• Rover Preview Helper<br>• BugBug Automation Testing<br>• SeleniumBase Recorder';
    } else if (mode === 'rover' || mode === 'form-recorder') {
      listHTML = '• Rover Preview Helper';
    } else if (mode === 'bugbug') {
      listHTML = '• BugBug Automation Testing';
    } else if (mode === 'seleniumbase') {
      listHTML = '• SeleniumBase Recorder';
    } else if (mode === 'form-recorder') {
      listHTML = '• Form Recorder';
    } else {
      listHTML = '<i>No extensions loaded</i>';
    }
    extensionsList.innerHTML = listHTML;
  }
  modeSelect.addEventListener('change', updateExtensionsList);
  updateExtensionsList();
}

const pdfUploadInput = document.getElementById('pdfUploadInput');
if (pdfUploadInput) {
  pdfUploadInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const statusEl = document.getElementById('pdfUploadStatus');
    statusEl.style.display = 'block';
    statusEl.textContent = 'Parsing PDF...';
    
    try {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
      
      const result = await window.api.extractPdf(base64, file.name);
      if (result && result.ok) {
        statusEl.textContent = 'Success! Added to Skills Library.';
        refreshFiles();
      } else {
        statusEl.textContent = 'Error: ' + (result?.error || 'Unknown error');
      }
    } catch (err) {
      statusEl.textContent = 'Error: ' + err.message;
    }
  });
}
