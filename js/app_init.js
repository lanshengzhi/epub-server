// js/app_init.js - Initialization logic for PWA/Extension

// --- Utils ---
window.showToast = function(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = "show";
    setTimeout(function(){ toast.className = toast.className.replace("show", ""); }, 3000);
}

// --- Logger ---
window.log = function(msg) {
    console.log(msg);
    // Optionally show error logs in toast
    if (msg.toLowerCase().includes('error')) {
        showToast(msg);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // --- Theme Toggle ---
    const themeToggle = document.getElementById('theme-toggle');
    const body = document.body;
    
    // Load theme preference
    if (localStorage.getItem('theme') === 'dark') {
        body.classList.add('dark-mode');
        themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            body.classList.toggle('dark-mode');
            const isDark = body.classList.contains('dark-mode');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            themeToggle.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        });
    }

    // --- Service Worker (Only for PWA mode, ignored in Extension usually) ---
    // In Extension mode, this might fail or be ignored, which is fine.
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registered'))
            .catch(err => console.error('Service Worker registration failed', err));
    }
    
    // --- Trigger File Input ---
    const triggerBtn = document.getElementById('import-btn-trigger');
    const fileInput = document.getElementById('file-input');
    
    if (triggerBtn && fileInput) {
        triggerBtn.addEventListener('click', () => {
            fileInput.click();
        });
    }
});