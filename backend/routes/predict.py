from fastapi import APIRouter, UploadFile, File, HTTPException
from pathlib import Path

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
    
    #TODO call function to process multi-object detection

    # Return confirmation
    return {"message": f"File '{file.filename}' received for multi-object detection."}


