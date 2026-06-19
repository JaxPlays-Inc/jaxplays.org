// This is the "Offline copy of pages" service worker

const CACHE = "pwabuilder-offline";

importScripts('https://storage.googleapis.com/workbox-cdn/releases/5.1.2/workbox-sw.js');

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

workbox.routing.registerRoute(
  new RegExp('/*'),
  new workbox.strategies.StaleWhileRevalidate({
    cacheName: CACHE
  })
);

async function shareLink(shareTitle, shareText, link) {
  const shareData = {
      title: shareTitle,
      text: shareText,
      url: link,
  };
  try {
      await navigator.share(shareData);
  } catch (e) {
      console.error(e);
  }
}

// forces a refresh every time the app gets re-opened without having to do it manually
// https://stackoverflow.com/questions/70968547/pwa-how-to-refresh-content-every-time-the-app-is-opened

window.addEventListener("visibilitychange", function () {
  console.log("Visibility changed");
  if (document.visibilityState === "visible") {
    console.log("APP resumed");
    window.location.reload();
  }
});