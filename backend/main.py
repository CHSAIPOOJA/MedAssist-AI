from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from io import BytesIO
from pathlib import Path
import shutil

from PIL import Image
import pytesseract

tesseract_path = shutil.which("tesseract")
if not tesseract_path:
    standard_path = Path("C:/Program Files/Tesseract-OCR/tesseract.exe")
    if standard_path.exists():
        tesseract_path = str(standard_path)
if tesseract_path:
    pytesseract.pytesseract.tesseract_cmd = tesseract_path

try:
    import fitz
except ImportError:
    import pymupdf as fitz

app = FastAPI(title="MedAssist AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return {
        "message": "Welcome to MedAssist AI"
    }


@app.post("/upload")
async def upload_report(file: UploadFile = File(...)):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    try:
        file_bytes = await file.read()
        document = fitz.open(stream=file_bytes, filetype="pdf")
        extracted_text = "\n\n".join(page.get_text() for page in document).strip()

        if not extracted_text:
            ocr_pages = []
            for page in document:
                pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                page_image = Image.open(BytesIO(pixmap.tobytes("png")))
                ocr_pages.append(pytesseract.image_to_string(page_image))
            extracted_text = "\n\n".join(ocr_pages).strip()
        document.close()
    except pytesseract.pytesseract.TesseractNotFoundError as error:
        raise HTTPException(
            status_code=503,
            detail="This scanned PDF needs OCR. Install Tesseract and try again.",
        ) from error
    except Exception as error:
        raise HTTPException(status_code=400, detail="The PDF could not be processed.") from error

    return {"filename": file.filename, "text": extracted_text}