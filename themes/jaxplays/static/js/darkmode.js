function applyDarkMode() {
  var darkModeEnabled = localStorage.getItem('darkMode') === 'enabled' || 
                        (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches && 
                         localStorage.getItem('darkMode') !== 'disabled');

  if (darkModeEnabled) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
}

// Call applyDarkMode on page load
applyDarkMode();

// Event listener for the dark mode toggle button
document.getElementById('dark-mode-toggle').addEventListener('click', function () {
  var darkModeEnabled = !document.body.classList.contains('dark-mode');
  
  if (darkModeEnabled) {
    document.body.classList.add('dark-mode');
    localStorage.setItem('darkMode', 'enabled');
  } else {
    document.body.classList.remove('dark-mode');
    localStorage.setItem('darkMode', 'disabled');
  }
});