import io
import re

from flask import Response
from pypdf import PdfReader, PdfWriter
from weasyprint import HTML

from app.paths import PROJECT_ROOT, STATIC_ROOT

try:
    from weasyprint.text.fonts import FontConfiguration
except Exception:  # pragma: no cover - compatible fallback for older WeasyPrint
    FontConfiguration = None


PDF_CJK_FONT_FAMILY = "XinyaPdfCJK"
PDF_CJK_FONT_PATH = STATIC_ROOT / "font" / "NotoSerifTC-Medium.otf"


def _pdf_font_css():
    if not PDF_CJK_FONT_PATH.exists():
        return ""

    font_uri = PDF_CJK_FONT_PATH.resolve().as_uri()
    return f"""
<style id="xinya-pdf-cjk-font">
  @font-face {{
    font-family: "{PDF_CJK_FONT_FAMILY}";
    src: url("{font_uri}") format("opentype");
    font-weight: 400;
    font-style: normal;
  }}
  @font-face {{
    font-family: "{PDF_CJK_FONT_FAMILY}";
    src: url("{font_uri}") format("opentype");
    font-weight: 700;
    font-style: normal;
  }}
  @font-face {{
    font-family: "{PDF_CJK_FONT_FAMILY}";
    src: url("{font_uri}") format("opentype");
    font-weight: 900;
    font-style: normal;
  }}
  html,
  body,
  body * {{
    font-family: "{PDF_CJK_FONT_FAMILY}", "Noto Serif CJK TC", "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif !important;
  }}
</style>
"""


def _inject_pdf_font_css(html):
    font_css = _pdf_font_css()
    if not font_css or "xinya-pdf-cjk-font" in html:
        return html

    if re.search(r"</head\s*>", html, flags=re.IGNORECASE):
        return re.sub(r"</head\s*>", f"{font_css}\\g<0>", html, count=1, flags=re.IGNORECASE)

    return f"{font_css}{html}"


def _write_pdf(html):
    html_doc = HTML(string=_inject_pdf_font_css(html), base_url=PROJECT_ROOT.as_uri())
    if FontConfiguration is None:
        return html_doc.write_pdf()

    return html_doc.write_pdf(font_config=FontConfiguration())


def merge_html_files_to_pdf(files):
    if not files:
        return {"error": "no html files uploaded"}, 400

    writer = PdfWriter()
    for file in files:
        html = file.read().decode("utf-8", errors="ignore")
        pdf_bytes = _write_pdf(html)
        reader = PdfReader(io.BytesIO(pdf_bytes))
        for page in reader.pages:
            writer.add_page(page)

    output = io.BytesIO()
    writer.write(output)
    output.seek(0)
    return Response(
        output.read(),
        mimetype="application/pdf",
        headers={"Content-Disposition": "attachment; filename=export.pdf"},
    )
