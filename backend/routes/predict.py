from fastapi import APIRouter, UploadFile, File, HTTPException
from pathlib import Path
from process_multiple_objects import crop_multilple_objects
from fastapi import APIRouter, UploadFile, File, HTTPException
from io import BytesIO
from PIL import Image, ImageOps


# Import model utilities
from ML.single_garbage_detection import load_model, predict_one
from process_multiple_objects import crop_multilple_objects


router = APIRouter(prefix="/predict", tags=["predict"])

# ---- Load model once when this router is imported ----
MODEL_PATH = Path("ML/model/garbage_classification_model.pth")

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
        "label": class_name,   # e.g. "plastic"
        "proba": confidence,   # 0..1
    }



@router.post("/many")
async def predict_many(file: UploadFile = File(...)):
    """
    Placeholder for future YOLO multiple-object predictions.
    For now, it just confirms receipt of the file.
    """
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=415, detail="File must be an image")
    
    print("File received for multi-object detection: ", type(file))
    images = crop_multilple_objects(file)
    for i, img in enumerate(images):
        print(f"Cropped Object {i} shape: {img.shape}")
        #TODO call model and process images here

    # Return confirmation
    return {"message": f"File '{file.filename}' received for multi-object detection."}


