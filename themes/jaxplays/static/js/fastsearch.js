var fuse; // holds our search engine
var searchVisible = false; 
var firstRun = true; // allow us to delay loading json data unless search activated
var list = document.getElementById('searchResults'); // targets the <ul>
var first = list.firstChild; // first child of search list
var last = list.lastChild; // last child of search list
var maininput = document.getElementById('searchInput'); // input box for search
var resultsAvailable = false; // Did we get any search results?

document.addEventListener('keydown', function(event) {
  if (event.metaKey && event.key === '/') {
    if (firstRun) {
      loadSearch();
      firstRun = false;
    }
    const searchBox = document.getElementById("fastSearch");
    searchBox.style.display = searchBox.style.display === "flex" ? "none" : "flex";
    document.getElementById("searchInput").focus();
    searchVisible = !searchVisible;
  }

  if (event.key == 'Escape' && searchVisible) {
    document.getElementById("fastSearch").style.display = "none";
    searchVisible = false;
  }

  if (event.key == 'ArrowDown' && searchVisible && resultsAvailable) {
    event.preventDefault();
    var active = document.activeElement;
    if (active == maininput) { first.focus(); }
    else if (active == last) { last.focus(); }
    else { active.parentElement.nextSibling.firstElementChild.focus(); }
  }

  if (event.key == 'ArrowUp' && searchVisible && resultsAvailable) {
    event.preventDefault();
    var active = document.activeElement;
    if (active == maininput) { maininput.focus(); }
    else if (active == first) { maininput.focus(); }
    else { active.parentElement.previousSibling.firstElementChild.focus(); }
  }
});

document.getElementById("searchInput").onkeyup = function(e) { 
  executeSearch(this.value);
};

function fetchJSONFile(path, callback) {
  var httpRequest = new XMLHttpRequest();
  httpRequest.onreadystatechange = function() {
    if (httpRequest.readyState === 4 && httpRequest.status === 200) {
      var data = JSON.parse(httpRequest.responseText);
      if (callback) callback(data);
    }
  };
  httpRequest.open('GET', path);
  httpRequest.send(); 
}

function loadSearch() { 
  fetchJSONFile('/index.json', function(data){
    var options = {
      shouldSort: true,
      location: 0,
      distance: 100,
      threshold: 0.4,
      minMatchCharLength: 2,
      keys: ['title', 'permalink', 'summary']
    };
    fuse = new Fuse(data, options); 
  });
}

function executeSearch(term) {
  let results = fuse.search(term);
  console.log(results); // Debug line to print the results
  let searchitems = '';
  if (results.length === 0) {
    resultsAvailable = false;
    searchitems = '';
  } else {
    results.slice(0, 5).forEach(result => {
      let date = result.item.date;
      let section = result.item.section;
      if (section === 'Productions' && result.item.opening_date) {
        date = new Date(result.item.opening_date).getFullYear();
        if (result.item.theatre_name) {
          date += ' — ' + result.item.theatre_name; // Append theatre name if available
        }
      } else if (section === 'News' || section === 'Reviews') {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        date = new Date(date).toLocaleDateString(undefined, options);
      } else {
        date = ''; // No date for other sections
      }
      searchitems += `<li><a href="${result.item.permalink}" tabindex="0">` +
                     `<span class="title">${result.item.title}</span><br />` +
                     `<span class="sc">${section}</span> ${date ? '— ' + date : ''}</a></li>`;
    });
    resultsAvailable = true;
  }
  document.getElementById("searchResults").innerHTML = searchitems;
  first = list.firstChild ? list.firstChild.firstElementChild : null;
  last = list.lastChild ? list.lastChild.firstElementChild : null;
}

document.addEventListener("DOMContentLoaded", function() {
  const searchIcon = document.getElementById("search-icon");
  const mobileSearchIcon = document.getElementById("mobile-search-icon");
  const pwaSearchIcon = document.getElementById("pwa-search-icon");
  searchIcon.addEventListener("click", toggleSearch);
  mobileSearchIcon.addEventListener("click", toggleSearch);
  pwaSearchIcon.addEventListener("click", toggleSearch);
  function toggleSearch(event) {
    event.preventDefault();
    if (firstRun) {
      loadSearch();
      firstRun = false;
    }
    const searchBox = document.getElementById("fastSearch");
    searchBox.style.display = searchBox.style.display === "flex" ? "none" : "flex";
    searchVisible = !searchVisible;
  }
});