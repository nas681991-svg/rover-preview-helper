var recorder_enabled = true;

var init = function () {
    // Load
    chrome.runtime.onInstalled.addListener(function (object) {
        chrome.notifications.create("T_" + Date.now(), {
            type: 'basic',
            iconUrl: 'images/recorder_icon.png',
            title: 'SeleniumBase Recorder ACTIVE',
            message: '[ESC]: Pause recording.\n[~`]: Resume recording.',
            priority: 2
        });
    });
    // User changes tab
    chrome.tabs.onActivated.addListener(function (activeInfo) {
    });
};
init();
