from ultralytics import YOLO
import cv2
import numpy as np
from PIL import Image
import os

# Load pretrained YOLOv8 model (COCO dataset) once
model = YOLO("yolov8n.pt")

def crop_multilple_objects(file, output_dir="yolo_output"):
    """
    Detects and crops all objects from the given image.
    Returns a list of tuples: (box_norm, cropped_image_PIL)
      - box_norm = [x1/w, y1/h, x2/w, y2/h]  (normalized to [0..1] in original image space)
      - cropped_image_PIL = PIL.Image in RGB
    """
    if file is None:
        raise ValueError("file is None")

    # Read bytes from UploadFile
    try:
        file.file.seek(0)  # ensure start
    except Exception:
        pass
    file_bytes = file.file.read()
    np_arr = np.frombuffer(file_bytes, dtype=np.uint8)
    img_bgr = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)  # BGR

    if img_bgr is None:
        raise ValueError("Could not decode image")

    h, w = img_bgr.shape[:2]
    os.makedirs(output_dir, exist_ok=True)

    # Run YOLO
    results = model(img_bgr)

    crops = []
    for res in results:
        # xyxy may be a torch tensor; convert to numpy
        boxes = res.boxes.xyxy
        if hasattr(boxes, "cpu"):
            boxes = boxes.cpu().numpy()
        else:
            boxes = np.asarray(boxes)

        for (x1, y1, x2, y2) in boxes:
            # Clip and int-cast
            x1 = max(0, min(w, int(round(float(x1)))))
            y1 = max(0, min(h, int(round(float(y1)))))
            x2 = max(0, min(w, int(round(float(x2)))))
            y2 = max(0, min(h, int(round(float(y2)))))
            if x2 <= x1 or y2 <= y1:
                continue

            # Crop and convert to PIL (RGB)
            crop_bgr = img_bgr[y1:y2, x1:x2]
            crop_rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
            crop_pil = Image.fromarray(crop_rgb)

            # Normalize box for frontend overlay
            box_norm = [x1 / w, y1 / h, x2 / w, y2 / h]

            crops.append((box_norm, crop_pil))

    print(f"number of objects detected: {len(crops)}")
    return crops