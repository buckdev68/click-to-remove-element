// background.js (v7.1 - Fix executeScript & alert errors)

const ICONS = {
  ACTIVE: {
    16: "icons/active-16.png",
    32: "icons/active-32.png",
  },
  INACTIVE: {
    16: "icons/inactive-16.png",
    32: "icons/inactive-32.png",
  },
  UNAVAILABLE: {
    16: "icons/unavailable-16.png",
    32: "icons/unavailable-32.png",
  },
};

/**
 * Checks if a URL is restricted for extensions.
 */
function isRestrictedUrl(url) {
  return (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("https://chrome.google.com")
  );
}

/**
 * Updates the action icon and enabled state for a given tab.
 */
async function updateActionState(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) return; // Tab might have been closed

    if (isRestrictedUrl(tab.url)) {
      await chrome.action.setIcon({ path: ICONS.UNAVAILABLE, tabId: tabId });
      await chrome.action.disable(tabId);
      await chrome.action.setTitle({
        title: "Click to Remove Element (Unavailable on this page)",
        tabId: tabId,
      });
    } else {
      // Check current state from content script to set active/inactive
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          action: "queryState",
        });
        if (response && response.isActive) {
          await chrome.action.setIcon({ path: ICONS.ACTIVE, tabId: tabId });
          await chrome.action.setTitle({
            title: "Click to Remove Element (Active - Press ESC to exit)",
            tabId: tabId,
          });
        } else {
          await chrome.action.setIcon({ path: ICONS.INACTIVE, tabId: tabId });
          await chrome.action.setTitle({
            title: "Click to Remove Element (Ctrl+Shift+X)",
            tabId: tabId,
          });
        }
      } catch (e) {
        // Content script might not be injected yet or failed, assume inactive
        await chrome.action.setIcon({ path: ICONS.INACTIVE, tabId: tabId });
        await chrome.action.setTitle({
          title: "Click to Remove Element (Ctrl+Shift+X)",
          tabId: tabId,
        });
      }
      await chrome.action.enable(tabId);
    }
  } catch (error) {
    // This can happen if the tab is closed while we're checking
    console.warn(
      `Error updating action state for tab ${tabId}: ${error.message}`
    );
  }
}

// --- Listen for messages from content scripts ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "stateChange") {
    const tabId = sender.tab?.id;
    if (!tabId) return;

    if (request.active) {
      chrome.action.setIcon({ path: ICONS.ACTIVE, tabId: tabId });
      chrome.action.setTitle({
        title: "Click to Remove Element (Active - Press ESC to exit)",
        tabId: tabId,
      });
    } else {
      chrome.action.setIcon({ path: ICONS.INACTIVE, tabId: tabId });
      chrome.action.setTitle({
        title: "Click to Remove Element (Ctrl+Shift+X)",
        tabId: tabId,
      });
    }
  }
  // Respond true to indicate async response (optional but good practice)
  return true;
});

// --- Update icon state on tab changes ---
chrome.tabs.onActivated.addListener((activeInfo) => {
  updateActionState(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Update as soon as loading starts and also when complete for accuracy
  if (changeInfo.status === "loading" || changeInfo.status === "complete") {
    updateActionState(tabId);
  }
});

// --- Handle Action Click / Command ---
async function handleActionTrigger(tab) {
  if (!tab?.id || isRestrictedUrl(tab.url)) {
    console.log("Action ignored on restricted URL or invalid tab.");
    return; // Ignore clicks on unavailable pages or invalid tabs
  }

  try {
    // Try sending the 'toggle' message
    await chrome.tabs.sendMessage(tab.id, { action: "toggle" });
    // State update will be handled by the 'stateChange' message listener
  } catch (error) {
    // If sending fails, the content script likely isn't injected
    console.warn(
      `Initial message send failed to tab ${tab.id}: ${error.message}. Checking if reload needed.`
    );

    // Check if it's a typical "no receiving end" error
    if (
      error.message.includes("Could not establish connection") ||
      error.message.includes("Receiving end does not exist")
    ) {
      try {
        // Inject a simple script to prompt the user
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            if (
              confirm(
                "Click to Remove Element was updated or installed after this page loaded.\n\nReload the page to enable it?"
              )
            ) {
              location.reload();
            }
          },
        });
      } catch (injectionError) {
        console.error(
          `Failed to inject reload prompt script into tab ${tab.id}: ${injectionError.message}`
        );
        // alert() removed here
      }
    } else {
      // Log other unexpected errors
      console.error(
        `Unexpected error sending toggle message to tab ${tab.id}: ${error.message}`
      );
    }
  }
}

// Listen for clicks on the extension action icon
chrome.action.onClicked.addListener(handleActionTrigger);

// Listen for the keyboard shortcut command
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "_execute_action") {
    await handleActionTrigger(tab);
  }
});

// Set initial state for all tabs on startup/install
chrome.runtime.onStartup.addListener(() => {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => updateActionState(tab.id));
  });
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => updateActionState(tab.id));
  });
});
