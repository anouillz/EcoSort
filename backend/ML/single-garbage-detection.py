from pathlib import Path
import sys
import torch
import torch.nn as nn
from PIL import Image, ImageOps
from torchvision import transforms
from torchvision.transforms import InterpolationMode as IM

IMG_SIZE = 224
CLASS_NAMES = ['cardboard', 'glass', 'metal', 'paper', 'plastic', 'trash']
MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]

def load_model(weights_path: str, device: str | None = None) -> nn.Module:
    import torchvision.models
    torch.serialization.add_safe_globals([torchvision.models.efficientnet.EfficientNet])

    dev = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    obj = torch.load(weights_path, map_location=dev, weights_only=False)
    if not isinstance(obj, nn.Module):
        raise ValueError("The provided .pth is not a full model. Save with torch.save(model, path).")
    return obj.to(dev).eval()

def load_image(image_path: str) -> Image.Image:
    img = Image.open(image_path).convert("RGB")
    return ImageOps.exif_transpose(img)

def make_transform() -> transforms.Compose:
    return transforms.Compose([
        transforms.Resize(256, interpolation=IM.BICUBIC),
        transforms.CenterCrop(IMG_SIZE),
        transforms.ToTensor(),
        transforms.Normalize(mean=MEAN, std=STD),
    ])

@torch.inference_mode()
def predict_one(model: nn.Module, image_path: str) -> tuple[str, int, float]:
    dev = next(model.parameters()).device
    img = load_image(image_path)
    x = make_transform()(img).unsqueeze(0).to(dev)
    logits = model(x)
    probs = torch.softmax(logits, dim=1).squeeze(0)
    idx = int(torch.argmax(probs).item())
    conf = float(probs[idx].item())
    name = CLASS_NAMES[idx] if 0 <= idx < len(CLASS_NAMES) else str(idx)
    return name, idx, conf

def main():
    if len(sys.argv) < 3:
        print("Usage: python predict_simple.py <weights.pth> <image_path> [cpu|cuda]")
        sys.exit(1)

    weights, image = sys.argv[1], sys.argv[2]
    device = sys.argv[3] if len(sys.argv) > 3 else None

    if not Path(weights).exists():
        sys.exit(f"Model file not found: {weights}")
    if not Path(image).exists():
        sys.exit(f"Image file not found: {image}")

    model = load_model(weights, device=device)
    name, idx, conf = predict_one(model, image)
    print(f"\n   {Path(image).resolve()}")
    print(f"➡️  Predicted: {name} (class {idx}) | confidence {conf:.3f}")

if __name__ == "__main__":
    main()
