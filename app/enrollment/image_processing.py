import cv2
import os

from app.enrollment.models import ODCHCScheme


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


def generate_crop_dimension_from_face(face_area, scale_factor, margin, h_img, w_img):
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
    y2 = min(h_img, y + h + int(pad_h * 1.2))
    return {"x1": x1, "x2": x2, "y1": y1, "y2": y2}


def process_form_orientation_and_crop(img_path_or_matrix, margin=0.27, logger=None, form_scheme: ODCHCScheme = None):
    img = read_image(img_path_or_matrix)
    original_image = img
    h_img, w_img = img.shape[:2]

    wrong_dimension = w_img > h_img

    img_approx = []  # guilty until proven innocent
    if wrong_dimension:
        img_approx.append(cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE))
        img_approx.append(cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE))
    else:
        img_approx.append(img)

    detector = cv2.FaceDetectorYN.create(
        model=YUNET_MODEL_PATH,
        config="",
        input_size=(0, 0),
        score_threshold=0.35,
        nms_threshold=0.20,
    )

    if form_scheme in (ODCHCScheme.SUNSHIS, ODCHCScheme.ORANGHIS, ODCHCScheme.ABIYAMO):
        MAX_FACES = 6
    else:
        MAX_FACES = 1

    POSITION_THRESHOLD = 0.60  # only applied for single-face schemes

    for img in img_approx:

        img_low_res, scale_factor = downscale_image(img)
        print("downscaled image")
        h_low, w_low = img_low_res.shape[:2]
        detector.setInputSize((w_low, h_low))
        h, w = img.shape[:2]

        try:
            _, faces = detector.detect(img_low_res)

            if faces is None or len(faces) == 0:
                continue

            faces_sorted = faces[faces[:, -1].argsort()[::-1]]
            top_faces = faces_sorted[:MAX_FACES]

            results = [
                generate_crop_dimension_from_face(face_area, scale_factor, margin, h, w)
                for face_area in top_faces
            ]

            # if logger:
            #     logger.info(f"YuNet detected {len(faces)} face(s), kept top {len(results)} by confidence")

            if MAX_FACES == 1:
                result = results[0]
                if (result["y2"] + result["y1"]) / 2 < h * POSITION_THRESHOLD:
                    return img, result
                if logger:
                    logger.info(
                        f"Rejected single face: center y={((result['y2']+result['y1'])/2):.0f} "
                        f">= threshold {h * POSITION_THRESHOLD:.0f}"
                    )
            else:
                # Multi-face schemes: no position filtering, since faces
                # may legitimately be spread across the form.
                if results:
                    return img, results

        except Exception as e:
            if logger:
                logger.info(f"Encounter error on image: {e}")
            continue

    if logger:
        logger.info(
            "Error extracting passport: returning a negative coordinate for error"
        )

    default_fail = {"x1": -1, "x2": -1, "y1": -1, "y2": -1}
    return original_image, default_fail if MAX_FACES == 1 else [default_fail]
