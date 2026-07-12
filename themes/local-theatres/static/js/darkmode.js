function isDarkModeEnabled() {
  return localStorage.getItem('darkMode') === 'enabled' ||
         (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches &&
          localStorage.getItem('darkMode') !== 'disabled');
}

function setDarkMode(enabled) {
  document.documentElement.classList.toggle('dark-mode', enabled);

  if (document.body) {
    document.body.classList.toggle('dark-mode', enabled);
  }
}

function applyDarkMode() {
  setDarkMode(isDarkModeEnabled());
}

// Call applyDarkMode on page load
applyDarkMode();

// Event listener for dark mode toggle buttons
document.querySelectorAll('.dark-mode-toggle').forEach(function (button) {
  button.addEventListener('click', function () {
    var darkModeEnabled = !document.documentElement.classList.contains('dark-mode');

    setDarkMode(darkModeEnabled);
    localStorage.setItem('darkMode', darkModeEnabled ? 'enabled' : 'disabled');
  });
});
