document.addEventListener('DOMContentLoaded', () => {
  const loginModal = document.getElementById('login-modal');
  const appContainer = document.getElementById('app-container');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  
  const canvas = document.getElementById('editor-canvas');
  const syncDot = document.getElementById('sync-dot');
  const syncText = document.getElementById('sync-text');
  
  const tabGroup = document.getElementById('tab-group');
  const addTabBtn = document.getElementById('add-tab-btn');
  const manualSaveBtn = document.getElementById('manual-save-btn');
  
  const newTabModal = document.getElementById('new-tab-modal');
  const newTabForm = document.getElementById('new-tab-form');
  const cancelTabBtn = document.getElementById('cancel-tab-btn');
  const justCreateTabBtn = document.getElementById('just-create-tab-btn');

  const deleteModal = document.getElementById('delete-modal');
  const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
  const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
  const deleteTabNameLabel = document.getElementById('delete-tab-name-label');
  let tabIdToDelete = null; 

  const themeToggle = document.getElementById('theme-toggle');
  const logoutBtn = document.getElementById('logout-btn');
  const htmlEl = document.documentElement;
  const themeIcon = document.getElementById('theme-icon');
  
  const userAvatar = document.getElementById('user-initial');
  const profileModal = document.getElementById('profile-modal');
  const closeProfileBtn = document.getElementById('close-profile-btn');
  const profilePreview = document.getElementById('profile-preview');
  const uploadImageBtn = document.getElementById('upload-image-btn');
  const profileFileInput = document.getElementById('profile-file-input');
  const clearImageBtn = document.getElementById('clear-image-btn');
  
  let currentUser = localStorage.getItem('uni-note_username') || null;
  let currentContentHash = localStorage.getItem('uni-note_hash') || "";
  let currentProfilePhoto = localStorage.getItem('uni-note_profilePhoto') || null;
  let saveTimeout = null;
  const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

  // Tab State Management
  let tabsData = {};
  let activeTabId = null;

  // Initialize Theme
  const savedTheme = localStorage.getItem('uni-note_theme') || 'dark';
  setTheme(savedTheme);

  themeToggle.addEventListener('click', () => {
    const isDark = htmlEl.getAttribute('data-theme') === 'dark';
    setTheme(isDark ? 'light' : 'dark');
  });

  function setTheme(theme) {
    htmlEl.setAttribute('data-theme', theme);
    localStorage.setItem('uni-note_theme', theme);
    if (theme === 'dark') {
      themeIcon.innerHTML = `<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>`;
    } else {
      themeIcon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
    }
  }

  // Cryptography
  async function generateHash(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Auth Flow
  if (currentUser) {
    loadApp(currentUser);
  } else {
    loginModal.classList.remove('hidden');
    appContainer.classList.add('hidden');
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = "";
    
    const userval = document.getElementById('username').value.trim();
    const passval = document.getElementById('password').value;
    
    if (!userval || !passval) return;
    loginForm.querySelector('button').textContent = "Authenticating...";

    try {
      const passwordHash = await generateHash(passval);
      const res = await smartFetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: userval, passwordHash })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || "Login Failed");
      
      localStorage.setItem('uni-note_username', userval);
      if (data.content) {
        localStorage.setItem('uni-note_content', data.content);
        currentContentHash = data.hash || "";
        localStorage.setItem('uni-note_hash', currentContentHash);
      }
      if (data.activeTab) {
        localStorage.setItem('uni-note_activeTab', data.activeTab);
      }
      if (data.profilePhoto) {
        currentProfilePhoto = data.profilePhoto;
        localStorage.setItem('uni-note_profilePhoto', currentProfilePhoto);
      }
      
      loginForm.querySelector('button').textContent = "Enter Workspace";
      loadApp(userval);
    } catch (err) {
      loginError.textContent = err.message;
      loginForm.querySelector('button').textContent = "Enter Workspace";
    }
  });

  // Logout Flow
  logoutBtn.addEventListener('click', () => {
    clearTimeout(saveTimeout);
    
    localStorage.removeItem('uni-note_username');
    localStorage.removeItem('uni-note_content');
    localStorage.removeItem('uni-note_hash');
    localStorage.removeItem('uni-note_activeTab');
    
    currentUser = null;
    tabsData = {};
    activeTabId = null;
    currentContentHash = "";
    
    canvas.innerHTML = "";
    tabGroup.innerHTML = "";
    document.getElementById('username').value = "";
    document.getElementById('password').value = "";
    
    appContainer.classList.add('hidden');
    loginModal.classList.remove('hidden');
  });

  // Load App Setup
  function loadApp(username) {
    currentUser = username;
    document.getElementById('nav-username').textContent = username;
    document.getElementById('user-initial').textContent = username.charAt(0).toUpperCase();
    
    loginModal.classList.add('hidden');
    appContainer.classList.remove('hidden');
    
    // Parse cached data
    const rawContent = localStorage.getItem('uni-note_content') || "";
    currentContentHash = localStorage.getItem('uni-note_hash') || "";
    const cachedActiveTab = localStorage.getItem('uni-note_activeTab') || null;
    initTabsData(rawContent, cachedActiveTab);
    
    checkRemoteSync(username);
    
    // Show cached version immediately
    updateProfileUI(currentProfilePhoto);
    
    // Then refresh from server
    fetchProfile(username);
  }

  async function fetchProfile(username) {
    try {
      const res = await smartFetch(`${API_BASE}/api/profile/${username}`);
      if (res.ok) {
        const data = await res.json();
        updateProfileUI(data.profilePhoto);
      }
    } catch (err) {
      console.error("Failed to fetch fresh profile", err);
    }
  }


  function updateProfileUI(base64) {
    if (base64 === undefined) return; // Don't clear if data is missing from sync
    
    currentProfilePhoto = base64;
    const initial = currentUser ? currentUser.charAt(0).toUpperCase() : 'U';
    
    if (base64) {
      userAvatar.innerHTML = `<img src="${base64}" alt="Avatar">`;
      profilePreview.innerHTML = `<img src="${base64}" alt="Avatar">`;
      localStorage.setItem('uni-note_profilePhoto', base64);
    } else {
      userAvatar.textContent = initial;
      profilePreview.textContent = initial;
      localStorage.removeItem('uni-note_profilePhoto');
    }
  }

  // Profile Modal Logic
  userAvatar.addEventListener('click', () => {
    profileModal.classList.remove('hidden');
  });

  closeProfileBtn.addEventListener('click', () => {
    profileModal.classList.add('hidden');
  });

  profileModal.addEventListener('click', (e) => {
    if (e.target === profileModal) profileModal.classList.add('hidden');
  });

  uploadImageBtn.addEventListener('click', () => {
    profileFileInput.click();
  });

  profileFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target.result;
      
      // Optimize image before saving (Resize to max 300x300)
      const compressedBase64 = await resizeImage(base64, 300, 300);
      updateProfileUI(compressedBase64);
      
      // Save to server immediately for profile images
      saveProfileImageToServer(compressedBase64);
    };
    reader.readAsDataURL(file);
  });

  function resizeImage(base64, maxWidth, maxHeight) {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8)); // 80% quality JPEG
      };
    });
  }

  clearImageBtn.addEventListener('click', () => {
    updateProfileUI(null);
    saveProfileImageToServer(null);
  });

  async function saveProfileImageToServer(base64) {
    if (!currentUser) return;
    try {
      await smartFetch(`${API_BASE}/api/profile/${currentUser}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profilePhoto: base64 }) // Only send the photo
      });
    } catch (err) {
      console.error("Failed to save profile image", err);
    }
  }

  // Process loaded content into Tabs
  function initTabsData(rawContentString, targetedTabId = null) {
    try {
      if (!rawContentString) throw new Error("Empty String");
      
      // Try to parse as the new JSON format
      const parsed = JSON.parse(rawContentString);
      if (typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        tabsData = parsed;
      } else {
        throw new Error("Invalid object format");
      }
    } catch (e) {
      // It's likely an old raw HTML string, gently migrate it
      tabsData = { 
        "tab1": { "name": "tab1", "data": rawContentString || "" }
      };
    }
    
    // Assign active tab matching target or fallback to first
    activeTabId = (targetedTabId && tabsData[targetedTabId]) 
                    ? targetedTabId 
                    : (Object.keys(tabsData)[0] || "tab1");
                    
    if (!tabsData[activeTabId]) {
      tabsData[activeTabId] = { name: 'tab1', data: '' };
    }

    renderTabs();
    canvas.innerHTML = tabsData[activeTabId].data;
  }

  // Draw the DOM tabs
  function renderTabs() {
    tabGroup.innerHTML = '';
    const keys = Object.keys(tabsData);
    
    keys.forEach(tabId => {
      const tabObj = tabsData[tabId];
      const tabEl = document.createElement('div');
      tabEl.className = `tab-item ${tabId === activeTabId ? 'active' : ''}`;
      
      // Build inner layout
      const span = document.createElement('span');
      span.textContent = tabObj.name;
      tabEl.appendChild(span);

      // Add close button ONLY to active tab
      if (tabId === activeTabId) {
        const closeBtn = document.createElement('div');
        closeBtn.className = 'close-tab';
        closeBtn.innerHTML = '×';
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeTab(tabId);
        });
        tabEl.appendChild(closeBtn);
      }
      
      tabEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('close-tab')) return;
        switchTab(tabId);
      });
      
      tabGroup.appendChild(tabEl);
    });
  }

  // Delete an existing tab - Show Modal
  function closeTab(tabId) {
    const tabObj = tabsData[tabId];
    if (!tabObj) return;

    tabIdToDelete = tabId;
    deleteTabNameLabel.textContent = tabObj.name;
    deleteModal.classList.remove('hidden');
  }

  // Confirm delete in Modal
  confirmDeleteBtn.addEventListener('click', () => {
    if (!tabIdToDelete) return;

    // Delete data object
    delete tabsData[tabIdToDelete];

    const remainingKeys = Object.keys(tabsData);
    if (remainingKeys.length === 0) {
      // Create a fresh tab if no more left
      const newId = "tab1";
      tabsData[newId] = { name: "tab1", data: "" };
      activeTabId = newId;
    } else {
      // Pick another tab as active
      if (activeTabId === tabIdToDelete) {
        activeTabId = remainingKeys[0];
      }
    }

    deleteModal.classList.add('hidden');
    tabIdToDelete = null;

    renderTabs();
    canvas.innerHTML = tabsData[activeTabId].data;
    triggerAutoSave();
  });

  cancelDeleteBtn.addEventListener('click', () => {
    deleteModal.classList.add('hidden');
    tabIdToDelete = null;
  });

  // Switch Active Tab
  function switchTab(newTabId) {
    if (newTabId === activeTabId) return;
    
    // Save current canvas to active tab before switching
    if (activeTabId && tabsData[activeTabId]) {
      tabsData[activeTabId].data = canvas.innerHTML;
    }
    
    activeTabId = newTabId;
    renderTabs();
    
    // Load new canvas
    canvas.innerHTML = tabsData[newTabId].data;
  }

  // Add new tab dynamically via modal
  addTabBtn.addEventListener('click', () => {
    newTabModal.classList.remove('hidden');
    const nameInput = document.getElementById('new-tab-name');
    nameInput.value = '';
    setTimeout(() => nameInput.focus(), 100);
  });

  cancelTabBtn.addEventListener('click', () => {
    newTabModal.classList.add('hidden');
  });

  newTabForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const desiredName = document.getElementById('new-tab-name').value.trim();
    if (!desiredName) return;

    // Current save backup
    if (activeTabId && tabsData[activeTabId]) {
      tabsData[activeTabId].data = canvas.innerHTML;
    }
    
    const existingIds = Object.keys(tabsData);
    let counter = existingIds.length + 1;
    let newId = `tab${counter}`;
    
    // Prevent overriding existing ID inherently
    while(tabsData[newId]) {
      counter++;
      newId = `tab${counter}`;
    }
    
    tabsData[newId] = { name: desiredName, data: '' };
    newTabModal.classList.add('hidden');
    switchTab(newId);
    triggerAutoSave();
  });

  justCreateTabBtn.addEventListener('click', () => {
    // Current save backup
    if (activeTabId && tabsData[activeTabId]) {
      tabsData[activeTabId].data = canvas.innerHTML;
    }
    
    const existingIds = Object.keys(tabsData);
    let counter = existingIds.length + 1;
    let newId = `tab${counter}`;
    let newName = `tab ${counter}`;
    
    // Prevent overriding existing ID inherently
    while(tabsData[newId]) {
      counter++;
      newId = `tab${counter}`;
      newName = `tab ${counter}`;
    }
    
    tabsData[newId] = { name: newName, data: '' };
    newTabModal.classList.add('hidden');
    switchTab(newId);
    triggerAutoSave();
  });

  // Background Cloud Sync
  async function checkRemoteSync(username) {
    try {
      appContainer.classList.add('blur-screen');
      setSyncStatus('Checking cloud...', '#3b82f6');
      
      const hashRes = await smartFetch(`${API_BASE}/api/hash/${username}`);
      if (!hashRes.ok) throw new Error("Network response wasn't OK");
      
      const { hash: remoteHash } = await hashRes.json();
      
      if (remoteHash && remoteHash !== currentContentHash) {
        setSyncStatus('Downloading...', '#eab308');
        
        const dataRes = await smartFetch(`${API_BASE}/api/data/${username}`);
        if (!dataRes.ok) throw new Error("Failed to fetch data");
        const remoteData = await dataRes.json();
        
        // Fully load object logic and DOM
        initTabsData(remoteData.content, remoteData.activeTab);
        currentContentHash = remoteData.hash || "";
        localStorage.setItem('uni-note_content', remoteData.content || "");
        localStorage.setItem('uni-note_hash', remoteData.hash || "");
        if (remoteData.activeTab) localStorage.setItem('uni-note_activeTab', remoteData.activeTab);
        
        if (remoteData.profilePhoto) {
          updateProfileUI(remoteData.profilePhoto);
        }
      }
      
      setSyncStatus('Up to date', '#10b981');
    } catch (err) {
      console.error('Remote sync check failed', err);
      setSyncStatus('Offline Mode', '#94a3b8');
    } finally {
      setTimeout(() => { appContainer.classList.remove('blur-screen'); }, 200);
    }
  }

  // --- Auto-Save Flow ---
  canvas.addEventListener('input', triggerAutoSave);

  function triggerAutoSave() {
    // Commit current DOM typed state gently to the current active tab
    if (activeTabId) {
      tabsData[activeTabId].data = canvas.innerHTML;
      localStorage.setItem('uni-note_activeTab', activeTabId);
    }
    
    // Serialize entire architecture
    const JSONPayload = JSON.stringify(tabsData);
    localStorage.setItem('uni-note_content', JSONPayload);
    
    setSyncStatus('Pending...', '#eab308'); 

    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      await saveToServer(JSONPayload);
    }, 5000);
  }

  async function saveToServer(contentJSONString) {
    if (!currentUser) return;
    setSyncStatus('Syncing...', '#3b82f6'); 
    manualSaveBtn.classList.add('hidden'); // Hide the button immediately when we move out of pending status
    
    try {
      const newHash = await generateHash(contentJSONString);
      if (newHash === currentContentHash) {
        setSyncStatus('Ready', '#10b981');
        return; 
      }
      
      const res = await smartFetch(`${API_BASE}/api/data/${currentUser}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          content: contentJSONString, 
          hash: newHash, 
          activeTab: activeTabId
        })
      });
      
      if (!res.ok) throw new Error("Sync failed");
      
      currentContentHash = newHash;
      localStorage.setItem('uni-note_hash', newHash);
      setSyncStatus('Cloud Synced', '#10b981');
    } catch (err) {
      console.error(err);
      setSyncStatus('Server Down', '#ef4444');
      syncDot.classList.add('danger-pulse');
    }
  }

  // --- Smart Watchdog Logic ---
  async function smartFetch(url, options = {}) {
    const timeout = 2500; // 2.5 seconds to detect cold start
    let coldStartTimer = setTimeout(() => {
      setSyncStatus('Waking up server...', '#eab308');
      syncDot.classList.add('warning-pulse');
    }, timeout);

    try {
      const response = await fetch(url, options);
      clearTimeout(coldStartTimer);
      return response;
    } catch (err) {
      clearTimeout(coldStartTimer);
      throw err;
    }
  }

  function setSyncStatus(text, color) {
    syncText.textContent = text;
    syncDot.style.backgroundColor = color;
    
    // Clear any previous special pulses
    syncDot.classList.remove('sync-pulse', 'warning-pulse', 'danger-pulse');
    
    if (text === 'Syncing...' || text === 'Checking cloud...') {
      syncDot.classList.add('sync-pulse');
    }
    
    // Show 'Save Now' button ONLY when pending sync
    if (text === 'Pending...') {
      manualSaveBtn.classList.remove('hidden');
    } else {
      manualSaveBtn.classList.add('hidden');
    }
  }

  // Handle immediate manual save
  if (manualSaveBtn) {
    manualSaveBtn.addEventListener('click', async (e) => {
      e.stopPropagation(); // Avoid triggering any container clicks
      
      clearTimeout(saveTimeout);
      
      // Serialize architecture for immediate save
      const JSONPayload = localStorage.getItem('uni-note_content');
      if (JSONPayload) {
        manualSaveBtn.textContent = "Saving...";
        manualSaveBtn.disabled = true;
        await saveToServer(JSONPayload);
        manualSaveBtn.textContent = "Save Now";
        manualSaveBtn.disabled = false;
      }
    });
  }

  // --- Reliability: Save on Unload (Bacon Approach) ---
  window.addEventListener('beforeunload', () => {
    if (!currentUser || !activeTabId) return;

    // Commit final typed content
    tabsData[activeTabId].data = canvas.innerHTML;
    const JSONPayload = JSON.stringify(tabsData);

    // Using sendBeacon for best-effort delivery on unload
    // It must be a BloB with JSON content type for standard Express bodyParser to pick it up cleanly
    const blob = new Blob([JSON.stringify({ 
      content: JSONPayload, 
      hash: "UNLOAD_FINAL_SYNC", // Skip hash check on server for final beacon
      activeTab: activeTabId 
    })], { type: 'application/json' });

    navigator.sendBeacon(`${API_BASE}/api/data/${currentUser}`, blob);
  });

  // --- Clipboard Customization ---
  document.addEventListener('copy', (e) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    let selectedText = selection.toString();
    let selectedHTML = "";

    const range = selection.getRangeAt(0);
    const container = document.createElement("div");
    container.appendChild(range.cloneContents());
    selectedHTML = container.innerHTML;

    if (!selectedText && !selectedHTML) return;

    // Wrap selection with <br> in front and a space at the end
    const textPrefix = "\n";
    const textSuffix = " "; 
    const htmlPrefix = "<br>";
    const htmlSuffix = "&nbsp;";

    const newText = textPrefix + selectedText + textSuffix;
    const newHTML = htmlPrefix + selectedHTML + htmlSuffix;

    e.clipboardData.setData('text/plain', newText);
    e.clipboardData.setData('text/html', newHTML);
    e.preventDefault(); // Required to override
  });
  // --- Image Alignment Tooltip Logic ---
  const imageTooltip = document.getElementById('image-align-tooltip');
  let currentTargetImage = null;
  let tooltipHideTimeout = null;

  function showTooltip(target, rect) {
    clearTimeout(tooltipHideTimeout);
    currentTargetImage = target;
    imageTooltip.style.top = `${window.scrollY + rect.top - 45}px`;
    imageTooltip.style.left = `${window.scrollX + rect.left + (rect.width / 2) - 50}px`;
    imageTooltip.classList.remove('hidden');
  }

  function startHideTimer() {
    clearTimeout(tooltipHideTimeout);
    tooltipHideTimeout = setTimeout(() => {
      imageTooltip.classList.add('hidden');
    }, 2500); // 2.5 seconds delay
  }

  canvas.addEventListener('mouseover', (e) => {
    if (e.target.tagName === 'IMG') {
      showTooltip(e.target, e.target.getBoundingClientRect());
    }
  });

  canvas.addEventListener('mouseout', (e) => {
    if (e.target.tagName === 'IMG') {
      startHideTimer();
    }
  });

  imageTooltip.addEventListener('mouseenter', () => {
    clearTimeout(tooltipHideTimeout);
  });

  imageTooltip.addEventListener('mouseleave', () => {
    startHideTimer();
  });

  imageTooltip.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!currentTargetImage) return;
      const align = btn.dataset.align;
      currentTargetImage.style.display = 'block';
      if (align === 'left') {
        currentTargetImage.style.display = 'block';
        currentTargetImage.style.float = 'none';
        currentTargetImage.style.marginLeft = '0';
        currentTargetImage.style.marginRight = 'auto';
      } else if (align === 'center') {
        currentTargetImage.style.display = 'block';
        currentTargetImage.style.float = 'none';
        currentTargetImage.style.marginLeft = 'auto';
        currentTargetImage.style.marginRight = 'auto';
      } else if (align === 'right') {
        currentTargetImage.style.display = 'block';
        currentTargetImage.style.float = 'none';
        currentTargetImage.style.marginLeft = 'auto';
        currentTargetImage.style.marginRight = '0';
      } else if (align === 'wrap-left') {
        currentTargetImage.style.display = 'inline-block';
        currentTargetImage.style.float = 'left';
        currentTargetImage.style.margin = '10px 15px 10px 0';
      } else if (align === 'wrap-right') {
        currentTargetImage.style.display = 'inline-block';
        currentTargetImage.style.float = 'right';
        currentTargetImage.style.margin = '10px 0 10px 15px';
      } else if (align === 'delete') {
        currentTargetImage.remove();
        currentTargetImage = null;
      }
      imageTooltip.classList.add('hidden');
      triggerAutoSave();
    });
  });;
});
