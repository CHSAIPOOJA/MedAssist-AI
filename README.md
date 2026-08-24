# MedAssist AI

A basic local application for uploading a medical report PDF and extracting its text.

## Backend

From the project root, activate the existing virtual environment (or create one), then install the dependencies:

```powershell
cd backend
python -m pip install -r requirements.txt
uvicorn main:app --reload
```

For scanned or image-only PDFs, install the Tesseract OCR application on Windows and ensure `tesseract.exe` is on your PATH. Regular text PDFs work with PyMuPDF alone.

The API runs at `http://localhost:8000`.

## Frontend

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Use any non-empty email/username and password to enter the dashboard. Select a PDF and choose **Upload & Extract** to view its extracted text.

This initial version uses local dummy login state only. It does not include RAG, an LLM, database storage, diagnosis, or predictions.
