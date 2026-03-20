import { renderPaymentPage } from "./page.js";
import { applyPageShell } from "./ui.js";

function bootstrapPaymentPage() {
  if (!window.form_data) {
    console.error("form_data not found");
    return;
  }

  const container = document.querySelector(".container");
  if (!container) {
    return;
  }

  const bgUrl =
    document.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
    "";
  const content = applyPageShell(container, bgUrl);
  content.appendChild(renderPaymentPage(window.form_data));
}

document.addEventListener("DOMContentLoaded", bootstrapPaymentPage);
