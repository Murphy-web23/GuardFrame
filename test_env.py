"""環境驗證。

裝完套件後跑一次 `python test_env.py`，確認每個套件都能 import
且版本符合預期。任何一項失敗會印出完整錯誤並以非 0 結束。

PLAN.md 特別提醒：Python 3.12 對 MediaPipe 的相容性要實測，不能用猜的。
這支腳本就是那個實測。
"""

import platform
import sys
import traceback

# (import 名稱, 顯示名稱, 版本屬性)
PACKAGES = [
    ("cv2", "OpenCV", "__version__"),
    ("mediapipe", "MediaPipe", "__version__"),
    ("numpy", "NumPy", "__version__"),
    ("scipy", "SciPy", "__version__"),
    ("matplotlib", "Matplotlib", "__version__"),
    ("insightface", "InsightFace", "__version__"),
    ("onnxruntime", "ONNX Runtime", "__version__"),
    ("fastapi", "FastAPI", "__version__"),
    ("uvicorn", "Uvicorn", "__version__"),
    ("multipart", "python-multipart", "__version__"),
    ("sqlalchemy", "SQLAlchemy", "__version__"),
    ("psycopg2", "psycopg2", "__version__"),
    ("pydantic", "Pydantic", "__version__"),
    ("dotenv", "python-dotenv", None),
    ("jupyter", "Jupyter", None),
    ("tqdm", "tqdm", "__version__"),
    ("pytest", "pytest", "__version__"),
]


def main():
    print(f"Python : {platform.python_version()}  ({sys.executable})")
    print(f"平台   : {platform.system()} {platform.release()}")
    print("-" * 60)

    failures = []
    for module_name, display_name, version_attr in PACKAGES:
        try:
            module = __import__(module_name)
            version = getattr(module, version_attr, "—") if version_attr else "—"
            print(f"  OK   {display_name:<18} {version}")
        except Exception:
            print(f"  FAIL {display_name:<18}")
            failures.append((display_name, traceback.format_exc()))

    print("-" * 60)

    # 只有 import 成功不代表能用，實際跑一次運算才算數。
    # 這對應 PLAN.md 對 A 的提醒：不要只測 is_available()。
    try:
        import cv2
        import numpy as np
        from scipy.signal import butter, filtfilt

        img = np.zeros((64, 64, 3), dtype=np.uint8)
        cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)

        b, a = butter(3, [0.7 / 15.0, 4.0 / 15.0], btype="band")
        filtfilt(b, a, np.random.default_rng(0).normal(size=300))
        print("  OK   實際運算測試（OpenCV 色彩轉換 + SciPy 帶通濾波）")
    except Exception:
        print("  FAIL 實際運算測試")
        failures.append(("實際運算測試", traceback.format_exc()))

    print("-" * 60)

    if failures:
        print(f"\n有 {len(failures)} 項失敗：\n")
        for name, tb in failures:
            print(f"===== {name} =====")
            print(tb)
        return 1

    print("全部 OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
