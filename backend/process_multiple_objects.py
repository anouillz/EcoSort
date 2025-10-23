# process_multiple_objects.py
from ultralytics import YOLO
import cv2
import numpy as np
from PIL import Image, ImageDraw
import os
import time


# yolo model, segmentation version
model = YOLO("yolo11m-seg.pt")


# helper function:
# function to compute IoU between two boxes
def box_iou(boxA, boxB):
    xA = max(boxA[0], boxB[0]); yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2]); yB = min(boxA[3], boxB[3])
    inter = max(0, xB - xA) * max(0, yB - yA)
    areaA = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1])
    areaB = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1])
    union = float(areaA + areaB - inter)
    return inter / union if union > 0 else 0.0


def crop_multiple_objects(
    file,
    output_dir="yolo_output",
    conf_thresh=0.15,        # confidence threshold for YOLO
    min_area_ratio=0.001,    # min box area relative to image
    max_area_ratio=0.95,     # drop boxes covering >95% of the image
    border_tol_ratio=0.005,  # tolerance to drop boxes touching all sides
    iou_dedupe=0.6,          # IoU threshold to deduplicate overlapping boxes    
    save_debug=False,        # saves images that are sent to prediction model
):
    """
    Detects and crops objects using YOLO segmentation or boxes.
    Returns list of ( [x1/w, y1/h, x2/w, y2/h], PIL.Image )
    """

    # file validation
    if file is None:
        raise ValueError("file is None")

    try:
        file.file.seek(0)
    except Exception:
        pass

    raw = file.file.read()
    np_arr = np.frombuffer(raw, np.uint8)
    img_bgr = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise ValueError("Could not decode image")
    H, W = img_bgr.shape[:2]
    border_tol = int(max(1, border_tol_ratio * min(W, H)))

    # create output foler for debug images
    ts = time.strftime("%Y%m%d-%H%M%S")
    dbg_dir = os.path.join(output_dir, "debug", ts)
    if save_debug:
        os.makedirs(dbg_dir, exist_ok=True)

    # Run yolo model
    res = model(img_bgr, conf=conf_thresh, iou=0.5)[0]
    # show results
    #res[0].show()
    boxes_abs = []

    # Extract bounding boxes 
    if res.masks is not None and len(res.masks.data) > 0:
        masks = res.masks.data.cpu().numpy()
        for m in masks:
            m8 = (m * 255).astype(np.uint8)
            m8 = cv2.resize(m8, (W, H), interpolation=cv2.INTER_NEAREST)
            ys, xs = np.where(m8 > 0)
            if xs.size == 0 or ys.size == 0:
                continue
            x1, y1, x2, y2 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
            bw, bh = x2 - x1, y2 - y1
            if bw <= 1 or bh <= 1:
                continue

            area_ratio = (bw * bh) / float(W * H)
            if area_ratio < min_area_ratio or area_ratio > max_area_ratio:
                continue

            # drop boxes that touch all borders (huge global detections)
            touches_left = x1 <= border_tol
            touches_top = y1 <= border_tol
            touches_right = (W - x2) <= border_tol
            touches_bottom = (H - y2) <= border_tol
            if touches_left and touches_top and touches_right and touches_bottom:
                continue

            boxes_abs.append([x1, y1, x2, y2])

    elif res.boxes is not None and len(res.boxes) > 0:
        for (x1, y1, x2, y2) in res.boxes.xyxy.cpu().numpy():
            bw, bh = (x2 - x1), (y2 - y1)
            area_ratio = (bw * bh) / float(W * H)
            if area_ratio < min_area_ratio or area_ratio > max_area_ratio:
                continue

            touches_left = x1 <= border_tol
            touches_top = y1 <= border_tol
            touches_right = (W - x2) <= border_tol
            touches_bottom = (H - y2) <= border_tol
            if touches_left and touches_top and touches_right and touches_bottom:
                continue

            boxes_abs.append([int(x1), int(y1), int(x2), int(y2)])

    # Deduplicate overlapping boxes
    filtered_abs = []
    for b in boxes_abs:
        keep = True
        for bb in filtered_abs:
            bn = [b[0]/W, b[1]/H, b[2]/W, b[3]/H]
            bbn = [bb[0]/W, bb[1]/H, bb[2]/W, bb[3]/H]
            if box_iou(bn, bbn) > iou_dedupe:
                keep = False
                break
        if keep:
            filtered_abs.append(b)

    # Crop plain boxes from the original image -> assures that prediction model recieves correct images
    crops = []
    for i, (x1, y1, x2, y2) in enumerate(filtered_abs):
        x1 = max(0, min(W - 1, int(x1)))
        y1 = max(0, min(H - 1, int(y1)))
        x2 = max(0, min(W, int(x2)))
        y2 = max(0, min(H, int(y2)))
        if x2 <= x1 or y2 <= y1:
            continue

        crop_bgr = img_bgr[y1:y2, x1:x2]
        if crop_bgr.size == 0:
            continue

        crop_rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        crop_pil = Image.fromarray(crop_rgb)
        box_norm = [x1 / W, y1 / H, x2 / W, y2 / H]
        crops.append((box_norm, crop_pil))

        if save_debug:
            cv2.imwrite(os.path.join(dbg_dir, f"crop_{i}.png"), crop_bgr)

    # save images
    if save_debug:
        base = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(base)
        for (x1, y1, x2, y2) in filtered_abs:
            draw.rectangle([x1, y1, x2, y2], outline=(0, 255, 0), width=3)
        base.save(os.path.join(dbg_dir, "overlay.png"))
        print(f"💾 Saved crops & overlay in {dbg_dir}")


    print(f"YOLO produced {len(boxes_abs)} boxes → kept {len(crops)} after dedupe")
    return crops
