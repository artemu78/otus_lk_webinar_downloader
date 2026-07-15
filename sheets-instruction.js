import(chrome.runtime.getURL("constants.js")).then(({ EXTENSION_MESSAGES }) => {
  chrome.runtime
    .sendMessage({ type: EXTENSION_MESSAGES.GOOGLE_SHEET_READY })
    .then((response) => {
      if (!response?.showInstruction) return;

      const notice = document.createElement("aside");
      notice.setAttribute("role", "status");
      notice.style.cssText = [
    "position:fixed",
    "top:16px",
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:2147483647",
    "max-width:560px",
    "padding:14px 44px 14px 18px",
    "border-radius:10px",
    "box-shadow:0 4px 18px rgba(0,0,0,.28)",
    "color:#202124",
    "background:#fff",
    "font:14px/1.45 Arial,sans-serif",
      ].join(";");

      const message = document.createElement("span");
      message.textContent =
        "Данные уже скопированы. Нажмите ⌘V или Ctrl+V. Если A1 не выделена, нажмите на неё и вставьте данные.";

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.setAttribute("aria-label", "Закрыть подсказку");
      closeButton.textContent = "×";
      closeButton.style.cssText = [
    "position:absolute",
    "top:7px",
    "right:10px",
    "border:0",
    "color:#5f6368",
    "background:transparent",
    "font:24px/1 Arial,sans-serif",
    "cursor:pointer",
      ].join(";");
      closeButton.addEventListener("click", () => notice.remove());

      notice.append(message, closeButton);
      document.body.append(notice);
    });
});
