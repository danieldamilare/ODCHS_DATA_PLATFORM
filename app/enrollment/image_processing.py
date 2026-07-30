import cv2
import pytesseract
import os


YUNET_MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "face_detection_yunet_2026may.onnx"
)

if not os.path.exists(YUNET_MODEL_PATH):
    raise FileNotFoundError(
        f"YuNet ONNX architecture file missing at expected location: {YUNET_MODEL_PATH}. "
        "Ensure the model file is committed to Git and pulled into this directory."
    )


def read_image(image_path_or_matrix):
    if isinstance(image_path_or_matrix, str):
        img = cv2.imread(image_path_or_matrix)
    else:
        img = image_path_or_matrix

    if img is None:
        raise ValueError("Image could not be loaded.")
    return img


def rotate_image(img_path, angle: int):
    img = read_image(img_path)
    if angle == 90:
        img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    elif angle == 180:
        img = cv2.rotate(img, cv2.ROTATE_180)
    elif angle == 270:
        img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    cv2.imwrite(img_path, img)


def downscale_image(img, target_width=1200):
    h_img, w_img = img.shape[:2]
    if w_img <= target_width:
        return img, 1.0
    scale_factor = target_width / w_img
    target_height = int(h_img * scale_factor)
    img_low_res = cv2.resize(
        img, (int(target_width), target_height), interpolation=cv2.INTER_AREA
    )
    return img_low_res, scale_factor


def is_image_too_blurry(image_path_or_matrix, threshold=200.0, logger=None):
    img = read_image(image_path_or_matrix)
    img, _ = downscale_image(img)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    if logger:
        logger.info(f"Image Sharpness Score (Laplacian Variance):  {laplacian_var:2f}")
    if laplacian_var < threshold:
        return True

    return False


def correct_form_orentation(img_path_or_matrix, logger=None):
    img = read_image(img_path_or_matrix)
    try:
        osd_data = pytesseract.image_to_osd(
            img, config="--psm 0", output_type=pytesseract.Output.DICT
        )

        rotation = int(osd_data.get("rotate", 0))
        confidence = float(osd_data.get("orientation_conf", 0.0))

        if logger:
            logger.info(
                f"OSD Results -> Rotation: {rotation}°, Confidence: {confidence}"
            )

        if confidence < 2.0:
            if logger:
                logger.info(
                    "OSD confidence too low. Skipping rotation to avoid false positives."
                )
            return img

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
    print("About to start reading image")
    img = read_image(img_path_or_matrix)
    h_img, w_img = img.shape[:2]
    img_low_res, scale_factor = downscale_image(img)
    print("downscaled image")
    h_low, w_low = img_low_res.shape[:2]

    try:
        detector = cv2.FaceDetectorYN.create(
            model=YUNET_MODEL_PATH,
            config="",
            input_size=(w_low, h_low),
            score_threshold=0.40,
            nms_threshold=0.20,
        )
        retval, faces = detector.detect(img_low_res)

        if faces is None or len(faces) == 0:
            raise ValueError("No faces detected by YuNet.")
        face_area = faces[0]

        x, y, w, h = (
            int(face_area[0] / scale_factor),
            int(face_area[1] / scale_factor),
            int(face_area[2] / scale_factor),
            int(face_area[3] / scale_factor),
        )
        pad_w = int(w * margin)
        pad_h = int(h * margin)

        x1 = max(0, x - pad_w)
        y1 = max(0, y - int(pad_h * 1.2))
        x2 = min(w_img, x + w + pad_w)
        y2 = min(h_img, y + h + int(pad_h * 1.0))
        return {"x1": x1, "x2": x2, "y1": y1, "y2": y2}

    except Exception as e:
        print(e)
        print("caught an exception", e)
        if logger:
            logger.info(
                f"Error extracting passport with retinaface: {e}. Trying fallback..."
            )
        return {"x1": -1, "x2": -1, "y1": -1, "y2": -1}
