from ultralytics import YOLO
import cv2
import os

# Load pretrained YOLOv8 model (COCO dataset) once
model = YOLO("yolov8n.pt")

def crop_multilple_objects(image, output_dir="yolo_output"):
    """
    Detects and crops all objects from the given image (numpy array, BGR).
    Returns a list of cropped images (numpy arrays).
    """
    if image is None:
        raise ValueError("image is None")

    os.makedirs(output_dir, exist_ok=True)
    results = model(image)
    cropped_images = []

    for result in results:
        boxes = result.boxes.xyxy  # x1, y1, x2, y2

        # if we want to give specific names or classes
        classes = result.boxes.cls  # class ids
        names = result.names        # class names

        for i, box in enumerate(boxes):
            x1, y1, x2, y2 = map(int, box)

            # Clip to image bounds
            h, w = image.shape[:2]
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(w, x2), min(h, y2)
            if x2 <= x1 or y2 <= y1:
                continue

            cropped = image[y1:y2, x1:x2]
            filename = os.path.join(output_dir, f"object_{i}.jpg")
            cv2.imwrite(filename, cropped)
            cropped_images.append(cropped)

    return cropped_images


# ------------------- testing

img_test = cv2.imread("yolo_input/test_1.jpg")
images = crop_multilple_objects(img_test)

""""
# display cropped images
for i, img in enumerate(images):
    cv2.imshow(f"Cropped Object {i}", img)
cv2.waitKey(0)
cv2.destroyAllWindows()
"""