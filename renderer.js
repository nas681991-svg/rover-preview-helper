async function refreshFiles() {
  const files = await window.api.listRecords();
  const listEl = document.getElementById('fileList');
  listEl.textContent = '';
  
  if (files.length === 0) {
    const placeholder = document.createElement('div');
    placeholder.style.cssText = 'padding: 15px; color: #666; font-size: 12px;';
    placeholder.textContent = 'No records found. Click Launch Browser and save a recording.';
    listEl.appendChild(placeholder);
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
    listEl.appendChild(div);
  });
}

document.getElementById('launchBtn').addEventListener('click', async () => {
  const btn = document.getElementById('launchBtn');
  const statusEl = document.getElementById('status');
  btn.disabled = true;
  statusEl.textContent = 'Checking for updates and launching... (This may take a minute on first run)';
  try {
    const result = await window.api.launchRecorder();
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
