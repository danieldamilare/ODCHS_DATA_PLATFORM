# Ondo State Contributory Health Data Platform (ODCHS M&E)

An internal web platform and asynchronous processing pipeline built for the Ondo State Contributory Health Commission (ODCHC). 

The platform handles real-world operational bottlenecks in state healthcare administration: digitizing messy physical enrollment forms, normalizing inconsistent monthly facility returns across 254 health facilities, and verifying citizen identity numbers against upstream government APIs without crashing third-party services.

---

## The Real Problems This Solves

### 1. The Spreadsheet Ingestion Mess (Encounter Analysis)
Primary healthcare facilities submit monthly returns in whatever format they have—`.csv`, `.xlsx`, `.ods`, often packed inside `.zip` archives.
- **Inconsistent layouts:** Some files start data on Row 1, others have 4 lines of agency headers before the actual table starts.
- **Unpredictable columns:** One facility labels a column `Client Name`, another writes `patient_name`, and another writes `Names`.
- **Spilled diagnoses:** Doctors frequently write notes across multiple physical lines in Excel, causing one patient's record to split across several database rows.
- **How it's handled:** We built a resumable state machine using Redis and Celery. The backend tries to guess the correct sheet and header row automatically. If it's ambiguous, it pauses, fires a real-time event (SSE) to the browser, and asks the reviewer to click the header row and map the 5 required fields. Once mapped, it cleans the data, de-spills multi-line rows using cumulative sums, imputes missing ages/genders, and generates standardized monthly utilization workbooks.

### 2. Physical Form Scanning & Extraction (Enrollment)
Physical BHCPF enrollment forms are scanned in batches. 
- The pipeline uses OpenCV with a YuNet ONNX model to detect face locations, correct document orientation, and extract passport photos automatically.
- Form fields are extracted using Gemini models bounded by strict Pydantic schemas.
- If a scan is blurry or an extraction needs human review, operators get a split-screen studio with live canvas controls (zoom, pan, 90° clockwise rotation) and an interactive snipping tool to re-crop passports directly in the browser.

### 3. Upstream API Throttling (NIN Verification)
Validating thousands of National Identification Numbers (NIN) against external government endpoints easily triggers rate limits or temporary IP blocks.
- We implemented an atomic token-bucket limiter in Redis using custom Lua scripts (`ACQUIRE_SCRIPT` and `RELEASE_SCRIPT`).
- Multiple parallel Celery workers lease slots safely without race conditions.
- If an upstream endpoint returns 429 or session expiry, a distributed circuit breaker pauses all active workers, refreshes credentials, and applies exponential backoff with jitter before resuming.

---

## Tech Stack

### Backend
- **Python 3.12 & Flask:** REST API, blueprints, Flask-SQLAlchemy, Flask-Migrate.
- **Celery & Redis:** Task queues split into `io_bound` (external HTTP calls, email) and `cpu_bound` (Pandas analysis, image processing, Playwright PDF rendering).
- **Pandas, Calamine & OpenPyXL:** Fast parsing of complex spreadsheets.
- **OpenCV & YuNet:** Local face detection and image pre-processing.
- **Playwright & Jinja2:** Headless Chromium rendering for audit reports and formatted printable ID cards.

### Frontend
- **React 18 & Vite:** Single-page application styled with Tailwind CSS.
- **Server-Sent Events (SSE):** Real-time progress updates for batch uploads, file validation, and ID generation without polling.
- **Custom Client Interceptor:** Handles silent token refreshes on 401s (including binary file downloads) and CSRF cookie validation.

---

## Project Structure

```text
├── app/
│   ├── admin/             # Staff management, activation emails, RBAC
│   ├── auth/              # JWT auth in HTTP-only cookies, token refresh
│   ├── core/              # Shared email tasks and file validation helpers
│   ├── encounter/         # Spreadsheet processing, fuzzy disease matching, state machine
│   ├── enrollment/        # Form OCR, face detection/cropping, HIS synchronization
│   ├── jobs/              # Central job tracking models
│   └── nin_validation/    # Atomic Lua limiter, batch verification, PDF reports
├── frontend/
│   ├── src/
│   │   ├── api/           # API client layer and SSE listeners
│   │   ├── components/    # Image viewer, crop modal, UI cards
│   │   ├── hooks/         # Custom SSE progress and debounce hooks
│   │   └── pages/         # Enrollment, Form Review, Encounter Studio, Admin
│   └── package.json
├── data_platform.py       # Main entry point
└── requirements.txt
```

---

## Local Setup

### 1. Prerequisites
- Python 3.11+
- Node.js 18+
- Redis running on `localhost:6379`
- PostgreSQL instance

### 2. Backend Setup
```bash
# Create and activate virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies and Playwright browser
pip install -r requirements.txt
playwright install chromium

# Copy environment variables and configure them
cp .env.example .env

# Run database migrations and seed diagnosis caches
flask db upgrade
flask encounter load-diagnosis
flask encounter warm-cache
```

### 3. Running Background Workers
Open two separate terminal windows for Celery:

```bash
# Worker 1: For network I/O, HIS queries, and email
celery -A app.celery_app worker -Q io_bound -c 4 --loglevel=info

# Worker 2: For heavy Pandas processing, PDF generation, and image crops
celery -A app.celery_app worker -Q cpu_bound -c 2 --loglevel=info
```

### 4. Running the Web Servers
```bash
# Terminal 3: Flask API
flask run --port=5000

# Terminal 4: Frontend Development Server
cd frontend
npm install
npm run dev
```
---
