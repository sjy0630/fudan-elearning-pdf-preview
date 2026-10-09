#!/usr/bin/env python3
"""Generate deterministic, synthetic PDF reader fixtures (ReportLab 4.4.9).

SPDX-License-Identifier: MIT
No input documents or font files are read. Built-in PDF font names are used.
"""

from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

import reportlab
from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen.canvas import Canvas

ROOT = Path(__file__).resolve().parent
PASSWORD = "reader-test-2026"
OWNER_PASSWORD = "fixture-owner-2026"


def canvas(stream, **kwargs):
    result = Canvas(stream, pagesize=(612, 792), invariant=1,
                    pageCompression=0, **kwargs)
    result.setTitle("Synthetic PDF reader test fixture")
    result.setAuthor("Synthetic fixture generator")
    result.setSubject("Harmless local reader regression test")
    return result


def chinese_pdf():
    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    stream = BytesIO()
    c = canvas(stream)
    c.setFont("Helvetica", 17)
    c.drawString(54, 730, "Chinese CMap and standard-font fixture")
    c.setFont("STSong-Light", 24)
    c.drawString(54, 672, "中文字体测试：你好，世界。")
    c.setFont("STSong-Light", 18)
    c.drawString(54, 625, "课程预览、搜索与复制。")
    c.setFont("Helvetica", 12)
    c.drawString(54, 573, "Latin search marker: CMAP-FONT-FIXTURE")
    c.drawString(54, 546, "Non-embedded STSong-Light / UniGB-UCS2-H")
    c.drawString(54, 519, "ZapfDingbats: check mark, star, circle")
    c.setFont("ZapfDingbats", 30)
    c.drawString(54, 464, "✓ ★ ●")
    c.setFont("Helvetica", 11)
    c.drawString(54, 68, "Synthetic content. Page 1 / 2.")
    c.showPage()
    c.setFont("STSong-Light", 24)
    c.drawString(54, 704, "第二页：课程预览测试。")
    c.setFont("Helvetica", 15)
    c.drawString(54, 650, "PAGE-TWO-MARKER / 2026 / 0123456789")
    c.setFont("Helvetica", 11)
    c.drawString(54, 68, "Synthetic content. Page 2 / 2.")
    c.showPage()
    c.save()
    return stream.getvalue()


def encrypted_pdf():
    stream = BytesIO()
    encryption = StandardEncryption(PASSWORD, OWNER_PASSWORD, strength=128)
    c = canvas(stream, encrypt=encryption)
    c.setFont("Helvetica", 24)
    c.drawString(54, 706, "Encrypted reader fixture")
    c.setFont("Helvetica", 15)
    c.drawString(54, 660, "PASSWORD OK - reader-test-2026")
    c.setFont("Helvetica", 11)
    c.drawString(54, 68, "Synthetic content. Page 1 / 1.")
    c.showPage()
    c.save()
    return stream.getvalue()


def main():
    chinese = chinese_pdf()
    files = {
        "chinese-cmap-fonts.pdf": chinese,
        "encrypted-known-password.pdf": encrypted_pdf(),
        # Preserve the header and truncate before any page/catalog can survive.
        "damaged-valid-header.pdf": chinese[:96],
    }
    manifest = {
        "generator": "generate_fixtures.py",
        "generator_license": "MIT",
        "generated_content_license": "CC0-1.0",
        "reportlab_version": reportlab.Version,
        "input_provenance": "Original synthetic text; no documents or font files copied",
        "user_password": PASSWORD,
        "owner_password": OWNER_PASSWORD,
        "files": {},
    }
    for name, data in files.items():
        (ROOT / name).write_bytes(data)
        manifest["files"][name] = {
            "bytes": len(data), "sha256": sha256(data).hexdigest()
        }
    (ROOT / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
