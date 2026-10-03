import sys
import os
import json
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

from app import create_app
from app.enrollment.llm.clients import gemini_client

# Define default image path or pass it via CLI argument
# Example: python -m app.tests.path_test /path/to/image.png
IMAGE_PATH = sys.argv[1] if len(sys.argv) > 1 else "/home/limfakson/Downloads/333789be-d3a3-40c4-bfac-1951495573a3.jpeg"

def run_test(image_path: str):
    if not os.path.exists(image_path):
        print(f"[ERROR] Image file not found: {image_path}")
        print("Please provide a valid file path either in the script or via CLI:")
        print("  python -m app.tests.path_test <path_to_image>")
        return

    print(f"[*] Initializing Flask application context...")
    app = create_app()

    with app.app_context():
        print(f"[*] Processing image with Gemini: {image_path}")
        try:
            result = gemini_client(image_path)
            print("\n" + "=" * 50)
            print("GEMINI OCR EXTRACTION RESPONSE:")
            print("=" * 50)
            print(json.dumps(result.model_dump(), indent=2))
            print("=" * 50)
        except Exception as e:
            print(f"\n[ERROR] Gemini extraction failed: {e}")


if __name__ == "__main__":
    run_test(IMAGE_PATH)

