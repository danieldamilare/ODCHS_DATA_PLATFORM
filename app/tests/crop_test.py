import os
import sys
import cv2

from app.enrollment.image_processing import process_form_orientation_and_crop
from app.enrollment.normalization import order_faces_reading_order
from app.enrollment.models import ODCHCScheme

# Usage:
# python -m app.tests.crop_test <path_to_image> [optional_scheme_name: bhcpfp|oranghis|abiyamo|sunshis]
IMAGE_PATH = sys.argv[1] if len(sys.argv) > 1 else "/home/limfakson/Downloads/333789be-d3a3-40c4-bfac-1951495573a3.jpeg"
SCHEME_ARG = sys.argv[2] if len(sys.argv) > 2 else "sunshis"


def resolve_scheme(scheme_str: str):
    scheme_lower = scheme_str.lower()
    for member in ODCHCScheme:
        if member.value == scheme_lower or member.name.lower() == scheme_lower:
            return member
    return None


def run_test(image_path: str, scheme_str: str = "sunshis"):
    if not os.path.exists(image_path):
        print(f"[ERROR] Image file not found: {image_path}")
        print("Usage:")
        print("  python -m app.tests.crop_test <path_to_image> [scheme]")
        return

    scheme = resolve_scheme(scheme_str)
    print(f"[*] Testing process_form_orientation_and_crop on: {image_path}")
    print(f"[*] Form Scheme: {scheme}")

    try:
        print(f"    [*] selected & resolved scheme: {scheme}")
        oriented_img, crop_result = process_form_orientation_and_crop(
            image_path,
            form_scheme=scheme
        )

        h, w = oriented_img.shape[:2]
        print("\n" + "=" * 50)
        print("ORIENTATION & CROP RESULT")
        print("=" * 50)
        print(f"Oriented Image Size : {w}x{h} (width x height)")
        print(f"Crop Coordinates    : {crop_result}")

        # Check if coordinates are valid
        output_dir = os.path.join(os.path.dirname(__file__), "output")
        os.makedirs(output_dir, exist_ok=True)

        base_name = os.path.splitext(os.path.basename(image_path))[0]
        oriented_output_path = os.path.join(output_dir, f"{base_name}_oriented.jpg")
        cv2.imwrite(oriented_output_path, oriented_img)
        print(f"Saved oriented image -> {oriented_output_path}")

        # Extract and save cropped face/passport(s)
        crops = order_faces_reading_order(crop_result) if isinstance(crop_result, list) else order_faces_reading_order([crop_result])
        for idx, crop in enumerate(crops):
            x1, y1, x2, y2 = crop.get("x1", -1), crop.get("y1", -1), crop.get("x2", -1), crop.get("y2", -1)
            if x1 == -1 or y1 == -1 or x2 == -1 or y2 == -1:
                print(f"[!] Crop #{idx + 1}: Face/passport not detected (negative coordinates returned)")
                continue

            face_crop = oriented_img[y1:y2, x1:x2]
            crop_output_path = os.path.join(output_dir, f"{base_name}_crop_{idx + 1}.jpg")
            cv2.imwrite(crop_output_path, face_crop)
            print(f"Saved crop #{idx + 1} ({x2-x1}x{y2-y1}px) -> {crop_output_path}")

        print("=" * 50)

    except Exception as e:
        print(f"\n[ERROR] Crop processing failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    run_test(IMAGE_PATH, SCHEME_ARG)
