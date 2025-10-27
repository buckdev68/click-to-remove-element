/**
 * content.js (v1.5.0 - Simplified Selection, Final)
 * - Removed Q/W key functionality and Shift+Click.
 * - Selection always targets the directly hovered element.
 * - Always requires Ctrl/Cmd key for selection and removal.
 * - Fixes SecurityError in cross-origin iframes.
 * - Removes console warnings for cleaner output.
 */
class ElementRemover {
  constructor() {
    this.isActive = false;
    this.isModKeyDown = false;
    this.hoveredElement = null; // Element currently under the mouse (now equals selected)
    this.currentElement = null; // Kept for consistency, will mirror hoveredElement
    // this.selectionLevel = 0; // REMOVED
    this.removedSelectors = []; // Array of {selector, description}
    this.isRemember = false; // State of the "Remember" checkbox
    this.panel = null; // Reference to the main panel DOM element
    this.observer = null; // Reference to the MutationObserver
    this.isTopFrame = window.top === window.self; // Is this the main page or an iframe?

    // Storage key (domain name)
    this.urlKey = null;
    try {
      // Use the top-level domain as the key
      this.urlKey = window.top.location.hostname;
    } catch (e) {
      // Fallback for cross-origin iframes: use the iframe's own domain
      this.urlKey = window.location.hostname;
      // console.warn removed for cleaner console
    }

    // Bind 'this' for event handlers
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleUndo = this.handleUndo.bind(this);
    this.handleToggleRemember = this.handleToggleRemember.bind(this);
    this.handleEyeHover = this.handleEyeHover.bind(this);
    this.handleEyeOut = this.handleEyeOut.bind(this);
    this.toggleSettingsView = this.toggleSettingsView.bind(this);
    this.handleExport = this.handleExport.bind(this);
    this.handleImport = this.handleImport.bind(this);
    this.applyRulesToMutations = this.applyRulesToMutations.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.updateHighlight = this.updateHighlight.bind(this); // Renamed from updateSelectionAndHighlight
  }

  /**
   * Initialize the script: Load rules, set up listeners.
   */
  initialize() {
    if (!this.urlKey) return; // Stop if we couldn't determine a domain

    // Load saved rules for this domain and apply them immediately
    this.loadAndApplySavedRules();

    // Only the top-level frame listens for the 'toggle' message from background
    if (this.isTopFrame) {
      console.log("Element Remover Loaded on page."); // Log for debugging
      chrome.runtime.onMessage.addListener(this.handleMessage);
    }

    // All frames set up the MutationObserver to catch dynamic content
    this.setupObserver();
  }

  /**
   * Handles messages from the background script or other frames.
   */
  handleMessage(request, sender, sendResponse) {
    if (request.action === "toggle") {
      this.toggle();
      sendResponse({ success: true }); // Acknowledge
    } else if (request.action === "queryState") {
      // Background script asks for the current state (only top frame matters)
      sendResponse({ isActive: this.isActive });
    }
    // Indicate potential async response
    return true;
  }

  /**
   * Sets up the MutationObserver to watch for dynamically added elements.
   */
  setupObserver() {
    // Only run if 'Remember' is active and observer doesn't exist yet
    if (!this.isRemember || this.observer) return;

    this.observer = new MutationObserver(this.applyRulesToMutations);
    // Observe the entire body for added child nodes in the whole subtree
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Callback for the MutationObserver. Applies saved rules to newly added nodes.
   */
  applyRulesToMutations(mutations) {
    if (this.removedSelectors.length === 0) return;

    for (const mutation of mutations) {
      // Check if nodes were added
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          // Process only element nodes
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check each saved rule against the new node and its children
            this.removedSelectors.forEach((item) => {
              const selector = item.selector;
              try {
                // Check if the node itself matches
                if (node.matches && node.matches(selector)) {
                  node.style.setProperty("display", "none", "important");
                }
                // Check if any children within the new node match
                const children = node.querySelectorAll(selector);
                children.forEach((child) => {
                  child.style.setProperty("display", "none", "important");
                });
              } catch (e) {
                // Ignore errors from potentially invalid selectors
              }
            });
          }
        }
      }
    }
  }

  /**
   * Activates the element remover mode (shows panel, adds listeners).
   * Only runs in the top-level frame.
   */
  activate() {
    // Only run if not already active and is the top frame
    if (this.isActive || !this.isTopFrame) return;

    this.isActive = true;
    console.log("Element Remover Activated.");
    // Notify background script to change the icon to 'active'
    chrome.runtime.sendMessage({ action: "stateChange", active: true });

    // Create the panel if it doesn't exist
    if (!this.panel) {
      this.createPanel();
    }
    // Show the panel
    this.panel.style.display = "flex";

    // Update UI elements based on current state
    this.panel.querySelector("#remover-remember").checked = this.isRemember;
    this.updatePanelList(); // Refresh the list of removed items

    // Add event listeners for interaction (using CAPTURE phase)
    document.addEventListener("mousemove", this.handleMouseMove, {
      capture: true,
    });
    document.addEventListener("click", this.handleClick, { capture: true });
    document.addEventListener("keydown", this.handleKeyDown, { capture: true });
    document.addEventListener("keyup", this.handleKeyUp, { capture: true });

    // Set initial placeholder text
    this.panel.querySelector("#remover-selector-display").value =
      "Hold [Ctrl]/[Cmd] to select";
  }

  /**
   * Deactivates the element remover mode (hides panel, removes listeners).
   * Only runs in the top-level frame.
   */
  deactivate() {
    // Only run if active and is the top frame
    if (!this.isActive || !this.isTopFrame) return;

    this.isActive = false;
    this.isModKeyDown = false; // Reset modifier key state
    console.log("Element Remover Deactivated");
    // Notify background script to change the icon to 'inactive'
    chrome.runtime.sendMessage({ action: "stateChange", active: false });

    this.removeHighlight(); // Clear any active highlight and reset state
    // Hide the panel
    if (this.panel) {
      this.panel.style.display = "none";
      // Ensure settings view is closed
      this.panel.classList.remove("remover-is-flipped");
    }
    // Remove event listeners (using CAPTURE phase)
    document.removeEventListener("mousemove", this.handleMouseMove, {
      capture: true,
    });
    document.removeEventListener("click", this.handleClick, { capture: true });
    document.removeEventListener("keydown", this.handleKeyDown, {
      capture: true,
    });
    document.removeEventListener("keyup", this.handleKeyUp, { capture: true });
  }

  /**
   * Toggles the activation state.
   */
  toggle() {
    if (this.isActive) {
      this.deactivate();
    } else {
      this.activate();
    }
  }

  /**
   * Creates the main panel and settings panel HTML and appends them to the body.
   * Only called by the top-level frame.
   */
  createPanel() {
    this.panel = document.createElement("div");
    this.panel.id = "remover-panel";
    this.panel.style.display = "none"; // Initially hidden

    // --- Main View HTML ---
    const mainView = document.createElement("div");
    mainView.id = "remover-main-view";
    mainView.className = "remover-view";
    // Removed the .remover-key-hint div
    mainView.innerHTML = `
      <div id="remover-panel-header">
        <h3 class="remover-header-title">Remove Element</h3>
        <div class="remover-setting">
          <button id="remover-settings-btn" class="remover-icon-btn" title="Settings">⚙️</button>
          <button id="remover-close-btn" class="remover-icon-btn" title="Close (Esc)">❌</button>
        </div>
      </div>
      <div id="remover-tools">
        <input type="text" id="remover-selector-display" value="Hold [Ctrl]/[Cmd] to select" readonly>
        </div>
      <div id="remover-list-container">
        <h4>Removed on this domain</h4>
        <ul id="remover-list"></ul>
      </div>
      <div id="remover-remember-footer">
        <label>
          <input type="checkbox" id="remover-remember"> Remember for this domain
        </label>
      </div>
      <div id="remover-author-footer">
        <hr class="remover-divider">
        Made by <a href="https://github.com/buckdev68" target="_blank" rel="noopener noreferrer">buckdev68</a>.
        Love <a href="[YOUR-CHROME-STORE-LINK]" target="_blank" rel="noopener noreferrer">CRE</a>?
        Consider <a href="https://www.buymeacoffee.com/[YOUR-BMA-USERNAME]" target="_blank" rel="noopener noreferrer">donating</a>.
      </div>
    `;

    // --- Settings View HTML ---
    const settingsView = document.createElement("div");
    settingsView.id = "remover-settings-view";
    settingsView.className = "remover-view";
    settingsView.innerHTML = `
      <div id="remover-panel-header">
        <div class="remover-header-title">
          <button id="remover-back-btn" class="remover-icon-btn" title="Back">⬅️</button>
          <h3>Settings</h3>
        </div>
      </div>
      <div class="remover-setting-item">
        <button id="remover-export">Export All Rules</button>
      </div>
      <div class="remover-setting-item">
        <label for="remover-import-file">Import Rules</label>
        <input type="file" id="remover-import-file" accept=".json">
      </div>
      <div style="flex-grow: 1;"></div> <div class="remover-setting-version">
        Click to Remove Element v1.5.0 </div>
    `;

    // Append views to the main panel
    this.panel.appendChild(mainView);
    this.panel.appendChild(settingsView);
    // Append panel to the body
    document.body.appendChild(this.panel);

    // Add Event Listeners for panel controls
    this.panel
      .querySelector("#remover-close-btn")
      .addEventListener("click", () => this.deactivate());
    this.panel
      .querySelector("#remover-settings-btn")
      .addEventListener("click", this.toggleSettingsView);
    this.panel
      .querySelector("#remover-back-btn")
      .addEventListener("click", this.toggleSettingsView);
    this.panel
      .querySelector("#remover-remember")
      .addEventListener("change", this.handleToggleRemember);
    this.panel
      .querySelector("#remover-list")
      .addEventListener("click", this.handleUndo);
    // Use list-container for hover effects to cover empty area too
    this.panel
      .querySelector("#remover-list-container")
      .addEventListener("mouseover", this.handleEyeHover);
    this.panel
      .querySelector("#remover-list-container")
      .addEventListener("mouseout", this.handleEyeOut);
    // Settings controls
    this.panel
      .querySelector("#remover-export")
      .addEventListener("click", this.handleExport);
    this.panel
      .querySelector("#remover-import-file")
      .addEventListener("change", this.handleImport);
  }

  /** Flips between the main view and the settings view. */
  toggleSettingsView() {
    this.panel.classList.toggle("remover-is-flipped");
  }

  /**
   * Handles mouse movement to update the hovered element and highlight.
   */
  handleMouseMove(e) {
    // Only proceed if active and modifier key is held
    if (!this.isActive || !this.isModKeyDown) {
      this.removeHighlight(); // Ensure highlight is off
      return;
    }

    // Ignore moves over the panel itself (only relevant in top frame)
    if (this.isTopFrame && this.panel && this.panel.contains(e.target)) {
      this.removeHighlight();
      return;
    }

    // If the element under the mouse changed
    if (this.hoveredElement !== e.target) {
      this.hoveredElement = e.target; // Update hovered
      // this.selectionLevel = 0; // REMOVED
      this.updateHighlight(); // Update highlight & UI
    }
  }

  /**
   * Updates the highlight/UI based on the directly hovered element.
   * Renamed from updateSelectionAndHighlight.
   */
  updateHighlight() {
    // Remove previous highlight
    if (this.currentElement) {
      this.currentElement.classList.remove("remover-highlight");
    }

    // Set current element to the hovered one
    this.currentElement = this.hoveredElement;

    // Add new highlight
    if (this.currentElement) {
      this.currentElement.classList.add("remover-highlight");

      // Update selector display (only in top frame with panel)
      if (this.isTopFrame && this.panel) {
        const selector = this.getUniqueSelector(this.currentElement);
        this.panel.querySelector("#remover-selector-display").value = selector;
      }
    } else {
      // Fallback: If no element selected, reset display
      this.removeHighlight();
    }
  }

  /**
   * Removes the highlight and resets hover state.
   */
  removeHighlight() {
    // Remove class from the currently highlighted element
    if (this.currentElement) {
      this.currentElement.classList.remove("remover-highlight");
    }
    // Reset state variables
    this.currentElement = null; // Clear selected
    this.hoveredElement = null; // Clear hovered
    // this.selectionLevel = 0; // REMOVED

    // Reset UI display (only in top frame if panel exists and is active)
    if (this.isTopFrame && this.panel && this.isActive) {
      this.panel.querySelector("#remover-selector-display").value =
        "Hold [Ctrl]/[Cmd] to select";
    }
  }

  /**
   * Handles clicks to remove the currently selected element.
   * Removed Shift+Click logic.
   */
  handleClick(e) {
    // Only act if active, modifier key is held, and an element is selected
    if (!this.isActive || !this.isModKeyDown || !this.currentElement) {
      return;
    }

    // Prevent default click actions AND stop event propagation
    e.preventDefault();
    e.stopPropagation();

    // Always remove the currently highlighted element
    this.removeElement(this.currentElement);
  }

  /**
   * Handles keydown events (Modifier keys, Space, Esc).
   * Removed Q/W key handling.
   */
  handleKeyDown(e) {
    // Key handling only happens in the top frame where the panel is
    if (!this.isActive || !this.isTopFrame) return;

    // Prevent default browser actions and stop propagation for our control keys
    const isControlKey = ["Control", "Meta", "Escape", " "].includes(e.key); // Removed Q, W
    if (isControlKey) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Detect modifier key press
    if (e.key === "Control" || e.key === "Meta") {
      this.isModKeyDown = true;
      // Update placeholder text
      if (this.panel) {
        this.panel.querySelector("#remover-selector-display").value =
          "Hover an element...";
      }
      return; // Modifier key press itself doesn't do anything else
    }

    // Escape always deactivates
    if (e.key === "Escape") {
      this.deactivate();
      return;
    }

    // Actions below require the modifier key to be held
    if (!this.isModKeyDown) return;

    switch (e.key) {
      case " ": // Space to remove
        if (this.currentElement) {
          this.removeElement(this.currentElement);
        }
        break;
      // Q & W cases removed
    }
  }

  /**
   * Handles keyup events (Modifier keys).
   */
  handleKeyUp(e) {
    if (!this.isActive || !this.isTopFrame) return;

    // Stop propagation for modifier keys on keyup as well
    if (["Control", "Meta"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Detect modifier key release
    if (e.key === "Control" || e.key === "Meta") {
      this.isModKeyDown = false;
      // Clear highlight when modifier is released
      this.removeHighlight();
    }
  }

  /**
   * Generates a user-friendly description (text & icon) for an element.
   */
  generateElementDescription(el) {
    let desc = "";
    let icon = "📄"; // Default: document icon
    try {
      if (el.tagName === "IMG") {
        icon = "🖼️"; // Image icon
        desc = el.alt
          ? el.alt.trim()
          : el.src
          ? `Image: ${el.src.split("/").pop().split("?")[0]}`
          : "An image";
      } else if (el.innerText && el.innerText.trim()) {
        desc = el.innerText.trim().replace(/\s+/g, " ").substring(0, 50);
        if (desc.length === 50) desc += "...";
      } else {
        // Fallback
        icon = "📦"; // Box icon
        if (el.tagName === "A") {
          icon = "🔗"; // Link icon
          desc = el.href ? `Link: ${el.href.substring(0, 40)}...` : "A link";
        } else if (el.tagName === "VIDEO" || el.tagName === "IFRAME") {
          icon = "📹"; // Video/Iframe icon
          desc = `A <${el.tagName.toLowerCase()}> element`;
        } else {
          desc = `An empty <${el.tagName.toLowerCase()}> element`;
        }
      }
    } catch (e) {
      desc = "A complex element";
      icon = "🔧"; // Wrench icon
    }
    return { text: desc || "Unnamed element", icon: icon };
  }

  /**
   * Removes the element, adds its selector to the list, and updates state.
   */
  removeElement(element) {
    if (!element) return;
    const selector = this.getUniqueSelector(element);
    if (this.removedSelectors.some((item) => item.selector === selector))
      return;
    const description = this.generateElementDescription(element);
    element.style.setProperty("display", "none", "important");
    this.removedSelectors.push({
      selector: selector,
      description: description,
    });
    if (this.isActive && this.isTopFrame) {
      this.updatePanelList();
    }
    this.removeHighlight(); // Clear highlight AFTER removing
    if (this.isRemember) {
      this.saveRules();
    }
  }

  /**
   * Handles clicking the 'Undo' button in the removed list.
   */
  handleUndo(e) {
    let target = e.target;
    while (
      target &&
      !target.classList.contains("remover-undo") &&
      target !== this.panel
    ) {
      target = target.parentElement;
    }
    if (target && target.classList.contains("remover-undo")) {
      const selector = target.dataset.selector;
      this.restoreElement(selector);
      this.removedSelectors = this.removedSelectors.filter(
        (item) => item.selector !== selector
      );
      this.updatePanelList();
      if (this.isRemember) {
        this.saveRules();
      }
    }
  }

  /**
   * Restores elements matching a selector by removing the 'display: none'.
   */
  restoreElement(selector) {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => {
        el.style.removeProperty("display");
      });
    } catch (e) {
      console.warn(
        `Element Remover: Invalid selector to restore: ${selector}`,
        e.message
      );
    }
  }

  /**
   * Updates the list of removed elements displayed in the panel.
   */
  updatePanelList() {
    if (!this.panel || !this.isActive || !this.isTopFrame) return;
    const list = this.panel.querySelector("#remover-list");
    list.innerHTML = "";
    if (this.removedSelectors.length === 0) {
      const li = document.createElement("li");
      li.style.color = "#888";
      li.style.fontStyle = "italic";
      li.style.padding = "16px 0";
      li.style.textAlign = "center";
      li.textContent = "No elements removed yet.";
      list.appendChild(li);
      return;
    }
    this.removedSelectors.forEach((item) => {
      const li = document.createElement("li");
      li.className = "remover-item-card";
      li.title = `Selector: ${item.selector}`;
      const undoButton = document.createElement("button");
      undoButton.className = "remover-undo";
      undoButton.dataset.selector = item.selector;
      undoButton.title = "Undo";
      undoButton.textContent = "X";
      li.innerHTML = `
        <span class="remover-item-icon">${item.description.icon}</span>
        <div class="remover-item-info">
          <span class="remover-item-desc">${this.escapeHTML(
            item.description.text
          )}</span>
          <span class="remover-item-selector">${this.escapeHTML(
            item.selector.length > 35
              ? item.selector.substring(0, 35) + "..."
              : item.selector
          )}</span>
        </div>
      `;
      li.appendChild(undoButton);
      list.appendChild(li);
    });
  }

  /** Basic HTML escaping */
  escapeHTML(str) {
    return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /** Handles changes to the "Remember" checkbox. */
  handleToggleRemember(e) {
    if (!this.isTopFrame) return;
    this.isRemember = e.target.checked;
    if (this.isRemember) {
      this.saveRules();
      this.setupObserver();
    } else {
      chrome.storage.local.remove(this.urlKey);
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
    }
  }

  /** Saves the current list of removed selectors to chrome.storage. */
  saveRules() {
    if (!this.urlKey) return;
    const data = {};
    data[this.urlKey] = this.removedSelectors;
    chrome.storage.local.set(data);
  }

  /** Loads rules from chrome.storage and applies them. Handles old data format. */
  loadAndApplySavedRules() {
    if (!this.urlKey) return;
    chrome.storage.local.get(this.urlKey, (result) => {
      const rules = result[this.urlKey];
      if (rules && rules.length > 0) {
        if (typeof rules[0] === "string") {
          // Upgrade check
          console.log("Element Remover: Upgrading old data format...");
          this.removedSelectors = rules.map((selector) => ({
            selector: selector,
            description: { text: selector, icon: "🔧" },
          }));
          if (this.isTopFrame) this.saveRules(); // Save upgraded format
        } else {
          this.removedSelectors = rules;
        }
        this.isRemember = true;
        this.applyRules();
        setTimeout(() => this.setupObserver(), 500); // Start observer if rules loaded
      } else {
        this.removedSelectors = [];
        this.isRemember = false;
      }
      // Update checkbox in panel if panel exists (only top frame)
      if (this.isTopFrame && this.panel) {
        this.panel.querySelector("#remover-remember").checked = this.isRemember;
      }
    });
  }

  /** Applies all currently stored rules to hide elements. */
  applyRules() {
    if (this.removedSelectors.length === 0) return;
    this.removedSelectors.forEach((item) => {
      try {
        const elements = document.querySelectorAll(item.selector);
        elements.forEach((el) => {
          el.style.setProperty("display", "none", "important");
        });
      } catch (e) {
        // console.warn removed
      }
    });
  }

  /** Temporarily restores removed elements on hover (Eye icon simulation). */
  handleEyeHover(e) {
    if (this.isTopFrame && e.target.closest("#remover-list-container")) {
      this.removedSelectors.forEach((item) =>
        this.restoreElement(item.selector)
      );
    }
  }

  /** Re-applies rules when hover ends (Eye icon simulation). */
  handleEyeOut() {
    if (this.isTopFrame) {
      this.applyRules();
    }
  }

  /** Exports all saved rules to a JSON file. */
  handleExport() {
    chrome.storage.local.get(null, (allRules) => {
      const dataStr = JSON.stringify(allRules, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "remover_settings.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  /** Imports rules from a JSON file. */
  handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedRules = JSON.parse(event.target.result);
        chrome.storage.local.clear(() => {
          chrome.storage.local.set(importedRules, () => {
            alert(
              "Settings imported successfully! Please reload affected pages."
            );
            this.toggleSettingsView();
            this.deactivate();
            this.loadAndApplySavedRules(); // Reload rules internally
          });
        });
      } catch (err) {
        alert("Error: Invalid JSON file.");
      }
    };
    reader.readAsText(file);
    e.target.value = null; // Reset input
  }

  /**
   * Generates a unique CSS selector for a given element.
   * Prefers ID, falls back to tag name + :nth-of-type path.
   */
  getUniqueSelector(el) {
    if (!el || !el.tagName) return "";
    // Prefer ID if unique and valid
    if (el.id) {
      const idSelector = `#${CSS.escape(el.id)}`;
      try {
        if (document.querySelectorAll(idSelector).length === 1)
          return idSelector;
      } catch (e) {}
    }
    // Fallback to path
    let path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      if (el === document.body) {
        path.unshift("body");
        break;
      }
      let index = 1;
      let sibling = el.previousElementSibling;
      while (sibling) {
        if (sibling.nodeName.toLowerCase() === selector) index++;
        sibling = sibling.previousElementSibling;
      }
      let needsNthOfType = index > 1;
      if (!needsNthOfType) {
        sibling = el.nextElementSibling;
        while (sibling) {
          if (sibling.nodeName.toLowerCase() === selector) {
            needsNthOfType = true;
            break;
          }
          sibling = sibling.nextElementSibling;
        }
      }
      if (needsNthOfType) selector += `:nth-of-type(${index})`;
      path.unshift(selector);
      el = el.parentNode;
    }
    return path.join(" > ");
  }
} // End of ElementRemover class

// --- Script entry point ---
// Create and initialize the remover instance if it doesn't exist
if (!window.elementRemoverInstance) {
  window.elementRemoverInstance = new ElementRemover();
  window.elementRemoverInstance.initialize();
}
