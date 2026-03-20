import { open_parental_form } from "./modal.js";

function renderSuccessScreen() {
  document.body.innerHTML = "";
  document.body.style.margin = "0";
  document.body.style.minHeight = "100vh";
  document.body.style.display = "grid";
  document.body.style.placeItems = "center";
  document.body.style.background = "linear-gradient(180deg, #f8fafc, #eef2ff)";
  document.body.style.fontFamily =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  const card = document.createElement("div");
  Object.assign(card.style, {
    width: "min(520px, calc(100vw - 32px))",
    padding: "28px",
    borderRadius: "24px",
    background: "rgba(255,255,255,.96)",
    boxShadow: "0 24px 60px rgba(15,23,42,0.12)",
    border: "1px solid rgba(99,102,241,0.12)",
    textAlign: "center",
  });

  const title = document.createElement("h2");
  title.textContent = "签名已同步";
  Object.assign(title.style, {
    margin: "0 0 12px",
    color: "#312e81",
    fontSize: "28px",
  });

  const text = document.createElement("p");
  text.textContent = "家长签名已经同步到孩子那边，现在可以回到孩子的页面继续提交。";
  Object.assign(text.style, {
    margin: 0,
    color: "#475569",
    lineHeight: "1.7",
  });

  card.append(title, text);
  document.body.appendChild(card);
}

async function bootstrapParentalSharePage() {
  const context = window.parental_sign_context;
  if (!context?.form || !context?.payload) {
    console.error("parental_sign_context not found");
    return;
  }

  await open_parental_form(
    context.form,
    context.payload,
    context.parent || {},
    false,
    false,
    {
      shareOnly: true,
      syncRoom: context.room || "",
    },
  );

  renderSuccessScreen();
}

document.addEventListener("DOMContentLoaded", () => {
  void bootstrapParentalSharePage();
});
