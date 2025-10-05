import { registerDriftServiceWorker, replayFailedRequests } from '@negretenico/sw';

// Stats
let stats = {
  total: 0,
  successful: 0,
  failed: 0,
  retried: 0,
};

// DOM elements
const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');
const swStatus = document.getElementById('swStatus');
const logContainer = document.getElementById('logContainer');
const makeRequestBtn = document.getElementById('makeRequest');
const retryRequestsBtn = document.getElementById('retryRequests');
const clearLogsBtn = document.getElementById('clearLogs');

// Update stats display
function updateStats() {
  document.getElementById('totalRequests').textContent = stats.total;
  document.getElementById('successfulRequests').textContent = stats.successful;
  document.getElementById('failedRequests').textContent = stats.failed;
  document.getElementById('retriedRequests').textContent = stats.retried;
}

// Add log entry
function addLog(message, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.innerHTML = `<span class="log-time">[${time}]</span>${message}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Clear logs
clearLogsBtn.addEventListener('click', () => {
  logContainer.innerHTML = '<div class="log-entry log-info"><span class="log-time">[--:--:--]</span>Logs cleared</div>';
});

// Update online/offline status
function updateOnlineStatus() {
  const isOnline = navigator.onLine;
  statusBar.className = `status-bar ${isOnline ? 'online' : 'offline'}`;
  statusText.textContent = isOnline ? 'Online' : 'Offline';
  addLog(`Status changed: ${isOnline ? '🟢 Online' : '🔴 Offline'}`, 'warning');
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

// Initialize service worker
async function initServiceWorker() {
  try {
    addLog('Registering Drift service worker...', 'info');
    const registration = await registerDriftServiceWorker();
    
    if (registration) {
      swStatus.textContent = 'Service Worker: Active ✓';
      addLog('✅ Service worker registered successfully', 'success');
      
      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'REPLAY_COMPLETE') {
          addLog('🔄 Background sync completed', 'success');
          stats.retried++;
          updateStats();
        }
      });
    } else {
      swStatus.textContent = 'Service Worker: Not supported';
      addLog('⚠️ Service workers not supported in this browser', 'warning');
    }
  } catch (error) {
    swStatus.textContent = 'Service Worker: Failed';
    addLog(`❌ Service worker registration failed: ${error.message}`, 'error');
  }
}

// Make API request
makeRequestBtn.addEventListener('click', async () => {
  makeRequestBtn.disabled = true;
  stats.total++;
  updateStats();
  
  addLog('📤 Making request to JSONPlaceholder API...', 'info');
  
  try {
    // Use JSONPlaceholder as a test API
    const response = await fetch('https://jsonplaceholder.typicode.com/posts/1');
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    stats.successful++;
    updateStats();
    addLog(`✅ Request successful! Got post: "${data.title}"`, 'success');
  } catch (error) {
    stats.failed++;
    updateStats();
    addLog(`❌ Request failed: ${error.message}`, 'error');
    addLog('💾 Request captured by service worker for retry', 'warning');
  } finally {
    makeRequestBtn.disabled = false;
  }
});

// Manual retry
retryRequestsBtn.addEventListener('click', async () => {
  retryRequestsBtn.disabled = true;
  addLog('🔄 Manually triggering retry of failed requests...', 'info');
  
  try {
    await replayFailedRequests(50);
    stats.retried++;
    updateStats();
    addLog('✅ Retry command sent to service worker', 'success');
  } catch (error) {
    addLog(`❌ Retry failed: ${error.message}`, 'error');
  } finally {
    retryRequestsBtn.disabled = false;
  }
});

// Initialize
updateOnlineStatus();
initServiceWorker();
addLog('🚀 Application initialized', 'success');