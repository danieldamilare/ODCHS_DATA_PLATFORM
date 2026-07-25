import cv2
import pytesseract
import re
from deepface import DeepFace

def read_image(image_path_or_matrix):
    if isinstance(image_path_or_matrix, str):
        img = cv2.imread(image_path_or_matrix)
    else:
        img = image_path_or_matrix

    if img is None:
        raise ValueError("Image could not be loaded.")
    return img


def downscale_image(img, target_width=1000):
    h_img, w_img = img.shape[:2]
    scale_factor = target_width / w_img
    target_height = int(h_img * scale_factor)
    img_low_res = cv2.resize(
        img, (int(target_width), target_height), interpolation=cv2.INTER_AREA
    )
    return img_low_res, scale_factor


def is_image_too_blurry(image_path_or_matrix, threshold=200.0, logger=None):
    img = read_image(image_path_or_matrix)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    if logger:
        logger.info(
            f"Image Sharpness Score (Laplacian Variancce):  {laplacian_var:2f}"
        )
    if laplacian_var < threshold:
        return True

    return False


def correct_form_orentation(img_path_or_matrix, logger=None):
    img = read_image(img_path_or_matrix)
    try:
        img_low, _ = downscale_image(img)
        osd = pytesseract.image_to_osd(img_low, config="--psm 0")
        rotation = int(re.search(r"Rotate:\s*(\d+)", osd).group(1))
        print(rotation)
        if rotation == 90:
            img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
        elif rotation == 180:
            img = cv2.rotate(img, cv2.ROTATE_180)
        elif rotation == 270:
            img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
        return img
    except Exception as e:
        if logger:
            logger.info(f"Rotation failed for img: {e}")
        return img


def extract_full_passport_with_backend(img_path_or_matrix, margin=0.27, logger=None):
    img = read_image(img_path_or_matrix)
    h_img, w_img = img.shape[:2]
    img_low_res, scale_factor = downscale_image(img)

    try:
        face = DeepFace.extract_faces(img_low_res, detector_backend="retinaface")
    except Exception as e:
        if logger:
            logger.info(
                f"Error extracting passport with retinaface: {e}. Trying fallback..."
            )
        # let's user of the utility handles exception. No fall here
        try:
            face = DeepFace.extract_faces(img_low_res)
        except Exception as e:
            # if we reach here, then probably the form has no passport
            return {'x1': -1, 'x2': -1, 'y1': -1, 'y2': -1}

    face_area = face[0]["facial_area"]
    x, y, w, h = (
        int(face_area["x"] / scale_factor),
        int(face_area["y"] / scale_factor),
        int(face_area["w"] / scale_factor),
        int(face_area["h"] / scale_factor),
    )
    pad_w = int(w * margin)
    pad_h = int(h * margin)

    x1 = max(0, x - pad_w)
    y1 = max(0, y - int(pad_h * 1.2))
    x2 = min(w_img, x + w + pad_w)
    y2 = min(h_img, y + h + int(pad_h * 1.0))
    return {"x1": x1, "x2": x2, "y1": y1, "y2": y2}