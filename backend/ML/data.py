import os
import shutil
import kagglehub

# ==========================================================
# CONFIG
# ==========================================================
DATA_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "data"))
DATASETS = {
    "asdasdasasdas/garbage-classification": "garbage-classification",
    "sumn2u/garbage-classification-v2": "garbage-classification-v2",
    "farzadnekouei/trash-type-image-dataset": "trash-type-image-dataset",
    "zlatan599/garbage-dataset-classification": "garbage-dataset-classification",
}
# ==========================================================

def safe_copy(src: str, dest: str):
    """Copy or move Kaggle dataset contents into target folder."""
    os.makedirs(dest, exist_ok=True)
    for root, _, files in os.walk(src):
        rel_root = os.path.relpath(root, src)
        target_dir = os.path.join(dest, rel_root)
        os.makedirs(target_dir, exist_ok=True)
        for file in files:
            src_file = os.path.join(root, file)
            dest_file = os.path.join(target_dir, file)
            if not os.path.exists(dest_file):
                shutil.move(src_file, dest_file)
            else:
                # if same name, keep the existing one
                continue


def download_all():
    """Download all Kaggle datasets and store them in ../data"""
    os.makedirs(DATA_PATH, exist_ok=True)

    print(f"\n📦 Target folder: {DATA_PATH}\n")
    for dataset, folder_name in DATASETS.items():
        print(f"⬇️  Downloading {dataset} ...")
        try:
            path = kagglehub.dataset_download(dataset)
            print(f"   ✅ Downloaded to: {path}")

            target_dir = os.path.join(DATA_PATH, folder_name)
            safe_copy(path, target_dir)
            print(f"   📁 Moved into: {target_dir}\n")

        except Exception as e:
            print(f"   ❌ Failed to download {dataset}: {e}\n")

    print("\n✅ All done! Datasets available under:", DATA_PATH)


if __name__ == "__main__":
    download_all()
