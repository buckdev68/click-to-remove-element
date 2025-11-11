/**
 * CTRE
 * buckdev68@gmail.com
 */
class ElementRemover {
  constructor() {
    this.isActive = false;
    this.isModKeyDown = false;
    this.currentElement = null;
    this.removedSelectors = [];
    this.isRemember = false;
    this.panel = null;
    this.observer = null;
    this.isTopFrame = window.top === window.self;

    this.urlKey = null;
    try {
      this.urlKey = window.top.location.hostname;
    } catch (e) {
      this.urlKey = window.location.hostname;
    }

    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleUndo = this.handleUndo.bind(this);
    this.restoreAllElements = this.restoreAllElements.bind(this);
    this.reApplyAllRules = this.reApplyAllRules.bind(this);
    this.toggleSettingsView = this.toggleSettingsView.bind(this);
    this.handleExport = this.handleExport.bind(this);
    this.handleImport = this.handleImport.bind(this);
    this.applyRulesToMutations = this.applyRulesToMutations.bind(this);
    this.handleMessage = this.handleMessage.bind(this);
    this.updateHighlight = this.updateHighlight.bind(this);
    this.handleResetDomain = this.handleResetDomain.bind(this);
  }

  initialize() {
    if (!this.urlKey) return;
    this.loadAndApplySavedRules();
    if (this.isTopFrame) {
      console.log("Element Remover Loaded on page.");
      chrome.runtime.onMessage.addListener(this.handleMessage);
    }
    this.setupObserver();
  }

  handleMessage(request, sender, sendResponse) {
    if (request.action === "toggle") {
      this.toggle();
      sendResponse({ success: true });
    } else if (request.action === "queryState") {
      sendResponse({ isActive: this.isActive });
    }
    return true;
  }

  setupObserver() {
    if (!this.isRemember || this.observer) return;
    this.observer = new MutationObserver(this.applyRulesToMutations);
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  applyRulesToMutations(mutations) {
    if (this.removedSelectors.length === 0) return;
    for (const mutation of mutations) {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.removedSelectors.forEach((item) => {
              const selector = item.selector;
              try {
                if (selector === "body" || selector === "html") return;
                if (node.matches && node.matches(selector)) {
                  node.style.setProperty("display", "none", "important");
                }
                const children = node.querySelectorAll(selector);
                children.forEach((child) => {
                  child.style.setProperty("display", "none", "important");
                });
              } catch (e) {}
            });
          }
        }
      }
    }
  }

  activate() {
    if (this.isActive || !this.isTopFrame) return;
    this.isActive = true;
    console.log("Element Remover Activated.");
    chrome.runtime.sendMessage({ action: "stateChange", active: true });
    if (!this.panel) {
      this.createPanel();
    }
    this.panel.style.display = "flex";
    this.updatePanelList();
    document.addEventListener("mousemove", this.handleMouseMove, {
      capture: true,
    });
    document.addEventListener("click", this.handleClick, { capture: true });
    document.addEventListener("keydown", this.handleKeyDown, { capture: true });
    document.addEventListener("keyup", this.handleKeyUp, { capture: true });
    this.panel.querySelector("#remover-selector-display").value =
      "Hold [Ctrl]/[Cmd] to select";
  }

  deactivate() {
    if (!this.isActive || !this.isTopFrame) return;
    this.isActive = false;
    this.isModKeyDown = false;
    console.log("Element Remover Deactivated");
    chrome.runtime.sendMessage({ action: "stateChange", active: false });
    this.removeHighlight();
    if (this.panel) {
      this.panel.style.setProperty("display", "none", "important");
      this.panel.classList.remove("remover-is-flipped");
    }
    document.removeEventListener("mousemove", this.handleMouseMove, {
      capture: true,
    });
    document.removeEventListener("click", this.handleClick, { capture: true });
    document.removeEventListener("keydown", this.handleKeyDown, {
      capture: true,
    });
    document.removeEventListener("keyup", this.handleKeyUp, { capture: true });
  }

  toggle() {
    if (this.isActive) {
      this.deactivate();
    } else {
      this.activate();
    }
  }

  createPanel() {
    this.panel = document.createElement("div");
    this.panel.id = "remover-panel";
    this.panel.style.display = "none";
    const mainView = document.createElement("div");
    mainView.id = "remover-main-view";
    mainView.className = "remover-view";
    mainView.innerHTML = `
      <div id="remover-panel-header">
        <h3 class="remover-header-title"> Click to Remove Element v1.0.1</h3>
        <div class="remover-setting"> <button id="remover-reset-btn" class="remover-icon-btn" title="Reset rules for this domain">🔄</button>
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
      <div id="remover-author-footer">
        <hr class="remover-divider">
        Made by <a href="https://github.com/buckdev68/click-to-remove-element" target="_blank" rel="noopener noreferrer">buckdev68</a>.
      </div>
    `;
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
      <div style="flex-grow: 1;"></div>
      <div class="remover-setting-version">
        Click to Remove Element</div>
    `;
    this.panel.appendChild(mainView);
    this.panel.appendChild(settingsView);
    document.body.appendChild(this.panel);

    // Add Event Listeners
    // Các listener này (Close, Reset, v.v.) sẽ chạy ở giai đoạn "bubble", SAU khi hàm handleClick (capture) chạy
    this.panel
      .querySelector("#remover-close-btn")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        this.deactivate();
      });
    this.panel
      .querySelector("#remover-reset-btn")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleResetDomain();
      });
    this.panel
      .querySelector("#remover-settings-btn")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleSettingsView();
      });
    this.panel
      .querySelector("#remover-back-btn")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleSettingsView();
      });
    this.panel
      .querySelector("#remover-list")
      .addEventListener("click", this.handleUndo); // handleUndo đã có stopPropagation
    this.panel
      .querySelector("#remover-list-container")
      .addEventListener("mouseover", this.restoreAllElements);
    this.panel
      .querySelector("#remover-list-container")
      .addEventListener("mouseout", this.reApplyAllRules);
    this.panel
      .querySelector("#remover-export")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleExport();
      });
    this.panel
      .querySelector("#remover-import-file")
      .addEventListener("change", this.handleImport);
  }

  toggleSettingsView() {
    this.panel.classList.toggle("remover-is-flipped");
  }

  handleMouseMove(e) {
    if (!this.isActive || !this.isModKeyDown) {
      this.removeHighlight();
      return;
    }
    if (this.currentElement !== e.target) {
      this.updateHighlight(e.target);
    }
  }

  updateHighlight(newTarget) {
    if (
      !newTarget ||
      newTarget === document.body ||
      newTarget === document.documentElement ||
      (this.isTopFrame && this.panel && this.panel.contains(newTarget))
    ) {
      this.removeHighlight();
      return;
    }
    if (this.currentElement) {
      this.currentElement.classList.remove("remover-highlight");
    }
    this.currentElement = newTarget;
    if (this.currentElement) {
      this.currentElement.classList.add("remover-highlight");
      if (this.isTopFrame && this.panel) {
        const selector = this.getUniqueSelector(this.currentElement);
        this.panel.querySelector("#remover-selector-display").value = selector;
      }
    } else {
      this.removeHighlight();
    }
  }

  removeHighlight() {
    if (this.currentElement) {
      this.currentElement.classList.remove("remover-highlight");
    }
    this.currentElement = null;
    if (this.isTopFrame && this.panel && this.isActive) {
      this.panel.querySelector("#remover-selector-display").value =
        "Hold [Ctrl]/[Cmd] to select";
    }
  }

  /**
   * Logic handleClick
   */
  handleClick(e) {
    // Nếu click bắt nguồn TỪ BÊN TRONG panel,
    if (this.isTopFrame && this.panel && this.panel.contains(e.target)) {
      return;
    }

    // Kiểm tra các điều kiện để XÓA.
    // Nếu không active, hoặc không nhấn mod key, hoặc không có mục tiêu
    if (!this.isActive || !this.isModKeyDown || !this.currentElement) {
      return;
    }

    // Không cho phép xóa các phần tử quan trọng (body/html).
    if (
      this.currentElement === document.body ||
      this.currentElement === document.documentElement
    ) {
      console.warn("Element Remover: Blocked attempt to remove body/html.");
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Đây là một click XÓA hợp lệ.
    e.preventDefault();
    e.stopPropagation();
    this.removeElement(this.currentElement);
  }

  handleKeyDown(e) {
    if (!this.isActive || !this.isTopFrame) return;
    const isControlKey = ["Control", "Meta", "Escape", " "].includes(e.key);
    if (isControlKey) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (e.key === "Control" || e.key === "Meta") {
      this.isModKeyDown = true;
      if (this.panel)
        this.panel.querySelector("#remover-selector-display").value =
          "Hover an element...";
      return;
    }
    if (e.key === "Escape") {
      this.deactivate();
      return;
    }
    if (!this.isModKeyDown) return;
    switch (e.key) {
      case " ":
        if (this.currentElement) {
          this.removeElement(this.currentElement);
        }
        break;
    }
  }

  handleKeyUp(e) {
    if (!this.isActive || !this.isTopFrame) return;
    if (["Control", "Meta"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (e.key === "Control" || e.key === "Meta") {
      this.isModKeyDown = false;
      this.removeHighlight();
    }
  }

  generateElementDescription(el) {
    let desc = "";
    let icon = "📄";
    try {
      if (el.tagName === "IMG") {
        icon = "🖼️";
        desc = el.alt
          ? el.alt.trim()
          : el.src
          ? `Image: ${el.src.split("/").pop().split("?")[0]}`
          : "An image";
      } else if (el.innerText && el.innerText.trim()) {
        desc = el.innerText.trim().replace(/\s+/g, " ").substring(0, 50);
        if (desc.length === 50) desc += "...";
      } else {
        icon = "📦";
        if (el.tagName === "A") {
          icon = "🔗";
          desc = el.href ? `Link: ${el.href.substring(0, 40)}...` : "A link";
        } else if (el.tagName === "VIDEO" || el.tagName === "IFRAME") {
          icon = "📹";
          desc = `A <${el.tagName.toLowerCase()}> element`;
        } else {
          desc = `An empty <${el.tagName.toLowerCase()}> element`;
        }
      }
    } catch (e) {
      desc = "A complex element";
      icon = "🔧";
    }
    return { text: desc || "Unnamed element", icon: icon };
  }

  removeElement(element) {
    if (!element) return;
    if (
      element === document.body ||
      element === document.documentElement ||
      (this.isTopFrame && this.panel && this.panel.contains(element))
    ) {
      console.warn(
        "Element Remover: Blocked attempt to remove critical element."
      );
      return;
    }
    const selector = this.getUniqueSelector(element);
    if (selector === "body" || selector === "html") {
      console.warn(
        `Element Remover: Blocked attempt to save selector: ${selector}`
      );
      return;
    }
    if (this.removedSelectors.some((item) => item.selector === selector))
      return;
    const description = this.generateElementDescription(element);
    element.style.setProperty("display", "none", "important");
    this.removedSelectors.push({
      selector: selector,
      description: description,
    });
    this.isRemember = true;
    if (this.isActive && this.isTopFrame) {
      this.updatePanelList();
    }
    this.removeHighlight();
    this.saveRules();
    this.setupObserver();
  }

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
      e.stopPropagation(); // Thêm stopPropagation ở đây
      const selector = target.dataset.selector;
      this.restoreElement(selector);
      this.removedSelectors = this.removedSelectors.filter(
        (item) => item.selector !== selector
      );
      this.updatePanelList();
      this.saveRules();
      if (this.removedSelectors.length === 0) {
        this.isRemember = false;
        if (this.observer) {
          this.observer.disconnect();
          this.observer = null;
        }
      }
    }
  }

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

  escapeHTML(str) {
    return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  saveRules() {
    if (!this.urlKey) return;
    const data = {};
    data[this.urlKey] = this.removedSelectors;
    chrome.storage.local.set(data);
  }

  loadAndApplySavedRules() {
    if (!this.urlKey) return;
    chrome.storage.local.get(this.urlKey, (result) => {
      const rules = result[this.urlKey];
      if (rules && rules.length > 0) {
        const safeRules = rules.filter(
          (item) =>
            item &&
            item.selector &&
            item.selector !== "body" &&
            item.selector !== "html"
        );
        if (safeRules.length !== rules.length && this.isTopFrame) {
          console.warn(
            "Element Remover: Filtered dangerous 'body' or 'html' rules from storage."
          );
          this.removedSelectors = safeRules;
          this.saveRules();
        }
        if (typeof safeRules[0] === "string") {
          console.log("Element Remover: Upgrading old data format...");
          this.removedSelectors = safeRules.map((selector) => ({
            selector: selector,
            description: { text: selector, icon: "🔧" },
          }));
          if (this.isTopFrame) this.saveRules();
        } else {
          this.removedSelectors = safeRules;
        }
        if (this.removedSelectors.length > 0) {
          this.isRemember = true;
          this.applyRules();
          setTimeout(() => this.setupObserver(), 500);
        } else {
          this.isRemember = false;
        }
      } else {
        this.removedSelectors = [];
        this.isRemember = false;
      }
    });
  }

  applyRules() {
    if (this.removedSelectors.length === 0) return;
    this.removedSelectors.forEach((item) => {
      try {
        if (item.selector === "body" || item.selector === "html") {
          console.warn(
            `Element Remover: Skipped applying dangerous rule: ${item.selector}`
          );
          return;
        }
        const elements = document.querySelectorAll(item.selector);
        elements.forEach((el) => {
          el.style.setProperty("display", "none", "important");
        });
      } catch (e) {
        /* console.warn removed */
      }
    });
  }

  restoreAllElements(e) {
    if (this.isTopFrame && e.target.closest("#remover-list-container")) {
      this.removedSelectors.forEach((item) =>
        this.restoreElement(item.selector)
      );
    }
  }

  reApplyAllRules() {
    if (this.isTopFrame) {
      this.applyRules();
    }
  }

  handleResetDomain(e) {
    if (!this.isTopFrame) return;
    if (
      confirm(
        "Are you sure you want to restore all hidden elements for this domain? This action cannot be undone."
      )
    ) {
      this.removedSelectors.forEach((item) =>
        this.restoreElement(item.selector)
      );
      this.removedSelectors = [];
      this.isRemember = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      this.updatePanelList();
      this.saveRules();
    }
  }

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
            this.loadAndApplySavedRules();
          });
        });
      } catch (err) {
        alert("Error: Invalid JSON file.");
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  }

  getUniqueSelector(el) {
    if (!el || !el.tagName) return "";
    if (el === document.body) return "body";
    if (el === document.documentElement) return "html";
    if (el.id) {
      const idSelector = `#${CSS.escape(el.id)}`;
      try {
        if (document.querySelectorAll(idSelector).length === 1)
          return idSelector;
      } catch (e) {}
    }
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
if (!window.elementRemoverInstance) {
  window.elementRemoverInstance = new ElementRemover();
  window.elementRemoverInstance.initialize();
}
