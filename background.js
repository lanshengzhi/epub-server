chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({
    url: 'pwa/index.html'
  });
});