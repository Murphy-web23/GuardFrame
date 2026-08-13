"""pytest 設定檔。

tests/ 底下的測試需要 import config 與各 track 套件，
這裡把專案根目錄放進 sys.path，讓 `pytest` 在任何位置執行都能找到。
"""

import sys
from pathlib import Path

ROOT = Path(__file__).parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
