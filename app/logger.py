import os
import logging
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path

# logs directory exists and log file formatting
log_dir = Path("logs")
os.makedirs(log_dir, exist_ok=True)
timestamp = datetime.now().strftime("%Y%m")
LOG_FILE = os.path.join(log_dir, f"odchs_{timestamp}.log")

# Create a rotating handler that rotates every month (when=midnight + interval=30 days)
file_handler = RotatingFileHandler(filename=LOG_FILE, maxBytes=1024 * 1024 * 1024)

# add month to filename (e.g. robot.log.2025-09)
file_handler.suffix = "%Y-%m"


# === Formatter, includes thread name ===
formatter = logging.Formatter(
    "%(asctime)s [%(levelname)s] %(threadName)s %(name)s: %(message)s",
    "%Y-%m-%d %H:%M:%S",
)
file_handler.setFormatter(formatter)

# Optional console output
console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)

# === Configure root logger globally ===
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
root_logger.handlers.clear()  # prevent duplicate handlers if re-imported
root_logger.addHandler(file_handler)
root_logger.addHandler(console_handler)

# === Silence noisy libraries ===
logging.getLogger("celery").setLevel(logging.ERROR)
logging.getLogger("uvicorn").setLevel(logging.WARNING)

# === App logger ===
logger = logging.getLogger("odchs")
logger.info("ODCHS data system started.")
