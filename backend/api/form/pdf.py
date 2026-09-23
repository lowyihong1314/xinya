"""HTML → PDF：把前端传来的若干张 HTML 各自排版成 PDF 再合成一份下载（原 backend/app/form/pdf.py）。

只有 ``/form/html_to_pdf`` 一条路由用它（报名名单 / 点名表的打印导出）。

── 搬迁只改了两行 ────────────────────────────────────────────────────
  · ``flask.Response(bytes, mimetype=…, headers=…)``
    → ``starlette.responses.Response(content=bytes, media_type=…, headers=…)``。
    参数名换了（mimetype → media_type），值和 headers 一个字没动。
  · ``return {"error": …}, 400`` → ``json_response({"error": …}, 400)``。
    Flask 会把「裸 dict + 状态码」自动 jsonify，FastAPI 不会 —— 不改的话
    调用方拿到的是一个 ``[{...}, 400]`` 形状的 JSON 数组。响应体一字不差。

★ ``_content_disposition_for_pdf`` 是**自己拼**的 Content-Disposition
  （ASCII 回退名 + RFC 5987 的 ``filename*``），不是让框架生成 ——
  文件名里有中文时两边的转义方式不同，自己拼才能保证下载下来的名字不变。
  这段逐字保留，别换成 ``FileResponse(filename=…)``。

★ 这里的 PDF 在内存里（BytesIO），磁盘上没有这个文件，所以用 ``Response(bytes)``
  而不是 FileResponse —— starlette 会按 content 长度自动补 Content-Length，与 Flask 一致。

★ ``files`` 里每个元素要支持同步 ``.read()``。router 那边给的是
  ``uploads.UploadedFile``（包了 starlette UploadFile 的同步读），见 uploads.py。
"""

import io
import re
from urllib.parse import quote

from pypdf import PdfReader, PdfWriter
from starlette.responses import Response
from weasyprint import HTML

from backend.core.paths import DATA_ROOT, MEDIA_URL_PREFIX, PROJECT_ROOT, STATIC_ROOT
from backend.core.responses import json_response

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
        # Flask 会把「裸 dict + 状态码」自动 jsonify，FastAPI 不会（见模块头）。
        return json_response({"error": "no html files uploaded"}, 400)

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
        media_type="application/pdf",
        headers={"Content-Disposition": _content_disposition_for_pdf(filename)},
    )
