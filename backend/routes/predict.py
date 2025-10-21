from fastapi import APIRouter, UploadFile, File, HTTPException
from pathlib import Path
from process_multiple_objects import crop_multilple_objects

router = APIRouter(prefix="/predict", tags=["predict"])

@router.post("/single")
async def predict_single(file: UploadFile = File(...)):
    """
    Placeholder for object prediction. For now, it just confirms receipt of the file.
    """
    # Check file type
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=415, detail="File must be an image")


    # Return confirmation
    return {
        "message": f"File '{file.filename}' received successfully.",
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


