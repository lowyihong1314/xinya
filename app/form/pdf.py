import io

from flask import Response
from pypdf import PdfReader, PdfWriter
from weasyprint import HTML


def merge_html_files_to_pdf(files):
    if not files:
        return {"error": "no html files uploaded"}, 400

    writer = PdfWriter()
    for file in files:
        html = file.read().decode("utf-8", errors="ignore")
        pdf_bytes = HTML(string=html).write_pdf()
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
