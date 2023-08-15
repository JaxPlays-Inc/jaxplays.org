// Checking LocalStorage on page load
var darkModeEnabled = localStorage.getItem('darkMode') === 'enabled';

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
    localStorage.removeItem('darkMode'); // Removing from LocalStorage
  }
});
