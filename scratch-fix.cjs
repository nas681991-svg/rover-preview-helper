const fs = require('fs');
let c = fs.readFileSync('src/popup.html', 'utf8');

c = c.replace(/class="([^"]+)" style="display:none;"/g, 'class="$1 d-none"');
c = c.replace(/style="display:none;"/g, 'class="d-none"');
c = c.replace(/style="display:flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;"/g, 'class="actions-flex"');
c = c.replace(/style="display:flex; gap: 8px; flex-wrap: wrap;"/g, 'class="actions-flex-no-mb"');
c = c.replace(/style="display:none; align-items:center; gap:6px; margin-top:8px; font-size:13px; cursor:pointer;"/g, 'class="fast-mode-label d-none"');
c = c.replace(/class="([^"]+)" class="d-none"/g, 'class="$1 d-none"');

fs.writeFileSync('src/popup.html', c);
