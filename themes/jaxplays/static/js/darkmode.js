// Checking LocalStorage and user's preference on page load
var darkModeEnabled = localStorage.getItem('darkMode') === 'enabled' || 
                      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches && 
                       localStorage.getItem('darkMode') !== 'disabled');

if (darkModeEnabled) {
  document.body.classList.add('dark-mode');
}

document.getElementById('dark-mode-toggle').addEventListener('click', function () {
  darkModeEnabled = !darkModeEnabled;
  if (darkModeEnabled) {
    document.body.classList.add('dark-mode');
    localStorage.setItem('darkMode', 'enabled'); // Saving to LocalStorage
  } else {
    document.body.classList.remove('dark-mode');
    localStorage.setItem('darkMode', 'disabled'); // Setting to disabled in LocalStorage
  }
});
