from ultralytics import YOLO
import cv2
import numpy as np
from PIL import Image
import os

# Load pretrained YOLOv8 model (COCO dataset) once
model = YOLO("yolov8n.pt")

def crop_multiple_objects(
    file,
    output_dir="yolo_output",
    conf_thresh=0.35,          # raise to reduce false positives
    min_area_ratio=0.002,      # drop tiny boxes (<0.2% of image)
    max_area_ratio=0.80,       # drop huge boxes (>80% of image)
    border_tol_ratio=0.005,    # drop boxes that touch all 4 borders
    allowed_classes=None       # optional set of class ids to keep
):
    if file is None:
        raise ValueError("file is None")

    try:
        file.file.seek(0)
    except Exception:
        pass
    file_bytes = file.file.read()
    np_arr = np.frombuffer(file_bytes, dtype=np.uint8)
    img_bgr = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise ValueError("Could not decode image")

    h, w = img_bgr.shape[:2]
    os.makedirs(output_dir, exist_ok=True)

    # Apply a higher confidence and standard IoU during prediction
    results = model(img_bgr, conf=conf_thresh, iou=0.5)

    crops = []
    border_tol = int(max(1, border_tol_ratio * min(w, h)))

    for res in results:
        boxes = res.boxes.xyxy
        confs = res.boxes.conf
        clses = res.boxes.cls

        if hasattr(boxes, "cpu"):
            boxes = boxes.cpu().numpy()
            confs = confs.cpu().numpy() if confs is not None else None
            clses = clses.cpu().numpy().astype(int) if clses is not None else None
        else:
            boxes = np.asarray(boxes)
            confs = np.asarray(confs) if confs is not None else None
            clses = np.asarray(clses).astype(int) if clses is not None else None

        for i, (x1, y1, x2, y2) in enumerate(boxes):
            # Confidence filter
            if confs is not None and confs[i] < conf_thresh:
                continue
            # Class filter (optional, pass COCO class ids to keep)
            if allowed_classes is not None and clses is not None and clses[i] not in allowed_classes:
                continue

            x1 = max(0, min(w, int(round(float(x1)))))
            y1 = max(0, min(h, int(round(float(y1)))))
            x2 = max(0, min(w, int(round(float(x2)))))
            y2 = max(0, min(h, int(round(float(y2)))))
            if x2 <= x1 or y2 <= y1:
                continue

            bw, bh = (x2 - x1), (y2 - y1)
            area_ratio = (bw * bh) / float(w * h)

            # Drop boxes that are too small or too large
            if area_ratio < min_area_ratio or area_ratio > max_area_ratio:
                continue

            # Drop boxes that basically cover the entire image (touch all borders)
            touches_left = x1 <= border_tol
            touches_top = y1 <= border_tol
            touches_right = (w - x2) <= border_tol
            touches_bottom = (h - y2) <= border_tol
            if touches_left and touches_top and touches_right and touches_bottom:
                continue

            # Crop and convert to PIL (RGB)
            crop_bgr = img_bgr[y1:y2, x1:x2]
            crop_rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
            crop_pil = Image.fromarray(crop_rgb)

            box_norm = [x1 / w, y1 / h, x2 / w, y2 / h]
            crops.append((box_norm, crop_pil))

    print(f"number of objects detected: {len(crops)}")
    return crops