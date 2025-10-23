from fastapi import APIRouter, UploadFile, File, HTTPException
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException
from io import BytesIO
from PIL import Image, ImageOps
import time
from collections import Counter

# Import model utilities
from ML.single_garbage_detection import load_model, predict_one
from process_multiple_objects import crop_multiple_objects

CONF_TRESHHOLD = 0.5

router = APIRouter(prefix="/predict", tags=["predict"])

# load our prediction model 
MODEL_PATH = Path("ML/model/garbage_classification_model_12k.pth")

try:
    model = load_model(MODEL_PATH)
except Exception as e:
    print(f"⚠️ Failed to load model: {e}")
    model = None



router = APIRouter(prefix="/predict", tags=["predict"])

@router.post("/single")
async def predict_single(file: UploadFile = File(...)):
    """
    Placeholder for object prediction. For now, it just confirms receipt of the file.
    """
    # Check file type
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=415, detail="File must be an image")
    
    # check model loaded
    if model is None:
        raise HTTPException(status_code=500, detail="Model not loaded on server.")
    
    # Read -> PIL.Image
    raw = await file.read()
    img = Image.open(BytesIO(raw)).convert("RGB")
    img = ImageOps.exif_transpose(img)

    class_name, class_idx, confidence = predict_one(model, img)


    return {
        "label": class_name,   
        "proba": confidence,   
    }



@router.post("/many")
async def predict_many(file: UploadFile = File(...)):
    """
    Placeholder for future YOLO multiple-object predictions.
    For now, it just confirms receipt of the file.
    """
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=415, detail="File must be an image")
    
    # check model loaded
    if model is None:
        raise HTTPException(status_code=500, detail="Model not loaded on server.")
    
    t0 = time.perf_counter()

    # crop multiple objects
    try:
        crops = crop_multiple_objects(file)  
    except Exception as e:
        import traceback
        traceback.print_exc()  
        raise HTTPException(status_code=500, detail=f"Cropping failed: {e}")

    # Run predictions on cropped images
    items = []
    for i, (box, img) in enumerate(crops):
        class_name, class_idx, confidence = predict_one(model, img)
        # filter by confidence
        if confidence > CONF_TRESHHOLD:
            items.append({
                "box": box,
                "material": class_name,
                "score": confidence,
                "recyclable": class_name in ["glass", "metal", "paper", "cardboard", "plastic"],
            })

    counts = Counter(it["material"] for it in items)
    latency = round((time.perf_counter() - t0) * 1000, 1)

    return {"items": items, "counts": counts, "latency_ms": latency}