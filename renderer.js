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
      const titleEl = document.getElementById('editorTitle');
      if (titleEl) titleEl.textContent = file.name;
      const contentEl = document.getElementById('editorContent');
      if (contentEl) contentEl.textContent = 'Loading...';
      const content = await window.api.readRecord(file.path);
      if (contentEl) contentEl.textContent = content;
    });
    
    if (file.name.endsWith('.skill.json')) {
      if (skillsListEl) skillsListEl.appendChild(div);
    } else {
      if (fileListEl) fileListEl.appendChild(div);
    }
  });
}

const launchBtn = document.getElementById('launchBtn');
if (launchBtn) {
  launchBtn.addEventListener('click', async () => {
    const statusEl = document.getElementById('status');
    const modeSelect = document.getElementById('modeSelect');
    const mode = modeSelect ? modeSelect.value : 'playwright-trace';
    
    launchBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Checking for updates and launching... (This may take a minute on first run)';
    try {
      const result = await window.api.launchRecorder(mode);
      if (result === 'success') {
        if (statusEl) statusEl.textContent = 'Browser closed. Telemetry saved.';
        refreshFiles();
      } else {
        if (statusEl) statusEl.textContent = 'Error: ' + result;
      }
    } finally {
      launchBtn.disabled = false;
    }
  });
}

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
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.textContent = 'Parsing PDF...';
    }
    
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
      });
      
      const result = await window.api.extractPdf(base64, file.name);
      if (result && result.ok) {
        if (statusEl) statusEl.textContent = 'Success! Added to Skills Library.';
        refreshFiles();
      } else {
        if (statusEl) statusEl.textContent = 'Error: ' + (result?.error || 'Unknown error');
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Error: ' + err.message;
    }
  });
}
