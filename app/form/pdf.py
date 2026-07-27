import io
import re
from urllib.parse import quote

from flask import Response
from pypdf import PdfReader, PdfWriter
from weasyprint import HTML

from app.paths import DATA_ROOT, MEDIA_URL_PREFIX, PROJECT_ROOT, STATIC_ROOT

try:
    from weasyprint.text.fonts import FontConfiguration
except Exception:  # pragma: no cover - compatible fallback for older WeasyPrint
    FontConfiguration = None


PDF_CJK_FONT_FAMILY = "XinyaPdfCJK"
PDF_CJK_FONT_PATH = STATIC_ROOT / "font" / "NotoSansCJKsc-Regular.otf"
PDF_CJK_FONT_FORMAT = "opentype"


def _normalize_pdf_filename(filename):
    raw_name = str(filename or "export").strip()
    base_name = re.sub(r"\.pdf$", "", raw_name, flags=re.IGNORECASE)
    base_name = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", base_name)
    base_name = re.sub(r"\s+", " ", base_name).strip(" .")
    base_name = base_name[:140] or "export"
    return f"{base_name}.pdf"


def _content_disposition_for_pdf(filename):
    pdf_filename = _normalize_pdf_filename(filename)
    ascii_base = re.sub(r"[^A-Za-z0-9._-]+", "_", pdf_filename[:-4]).strip("._") or "export"
    ascii_filename = f"{ascii_base}.pdf"
    return f"attachment; filename=\"{ascii_filename}\"; filename*=UTF-8''{quote(pdf_filename)}"


def _local_file_uri(url_path):
    """把 /static/... 或 /media_file/...（DATA_ROOT 上传文件）转成本地 file:// URI。"""
    cleaned = str(url_path or "").split("?", 1)[0].split("#", 1)[0]
    normalized = cleaned.lstrip("/")

    media_prefix = MEDIA_URL_PREFIX.strip("/") + "/"
    if normalized.startswith("static/"):
        file_path = PROJECT_ROOT / normalized
    elif normalized.startswith(media_prefix):
        file_path = DATA_ROOT / normalized.removeprefix(media_prefix)
    else:
        return None

    if ".." in file_path.parts or not file_path.exists():
        return None
    return file_path.resolve().as_uri()


def _rewrite_local_asset_urls(html):
    media_prefix = MEDIA_URL_PREFIX.strip("/")
    url_roots = f"(?:static|{re.escape(media_prefix)})"

    def replace_attr(match):
        uri = _local_file_uri(f"/{match.group('root')}/{match.group('path')}")
        if not uri:
            return match.group(0)
        return f'{match.group("prefix")}{uri}{match.group("suffix")}'

    def replace_css_url(match):
        uri = _local_file_uri(f"/{match.group('root')}/{match.group('path')}")
        if not uri:
            return match.group(0)
        return f'url("{uri}")'

    html = re.sub(
        rf'(?P<prefix>\b(?:src|href)=["\'])/(?P<root>{url_roots})/(?P<path>[^"\']+)(?P<suffix>["\'])',
        replace_attr,
        html,
        flags=re.IGNORECASE,
    )
    return re.sub(
        rf'url\(\s*["\']?/(?P<root>{url_roots})/(?P<path>[^)"\']+)["\']?\s*\)',
        replace_css_url,
        html,
        flags=re.IGNORECASE,
    )


def _pdf_font_css():
    if not PDF_CJK_FONT_PATH.exists():
        return ""

    font_uri = PDF_CJK_FONT_PATH.resolve().as_uri()
    return f"""
<style id="xinya-pdf-cjk-font">
  @font-face {{
    font-family: "{PDF_CJK_FONT_FAMILY}";
    src: url("{font_uri}") format("{PDF_CJK_FONT_FORMAT}");
    font-weight: 400;
    font-style: normal;
  }}
  @font-face {{
    font-family: "{PDF_CJK_FONT_FAMILY}";
    src: url("{font_uri}") format("{PDF_CJK_FONT_FORMAT}");
    font-weight: 700;
    font-style: normal;
  }}
  @font-face {{
    font-family: "{PDF_CJK_FONT_FAMILY}";
    src: url("{font_uri}") format("{PDF_CJK_FONT_FORMAT}");
    font-weight: 900;
    font-style: normal;
  }}
  html,
  body,
  body * {{
    font-family: "{PDF_CJK_FONT_FAMILY}", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans CJK TC", Arial, sans-serif !important;
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
    html_doc = HTML(
        string=_inject_pdf_font_css(_rewrite_local_asset_urls(html)),
        base_url=PROJECT_ROOT.as_uri(),
    )
    if FontConfiguration is None:
        return html_doc.write_pdf()

    return html_doc.write_pdf(font_config=FontConfiguration())


def merge_html_files_to_pdf(files, filename=None):
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
        headers={"Content-Disposition": _content_disposition_for_pdf(filename)},
    )
