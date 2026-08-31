# VLM 摘要模組

`summarize_verification()` 只在 verdict=review（人工複核）時被呼叫，把
造成 review 的那幾層（Track1/3/4，看哪幾層實際沒過，見 api/routes.py
`_collect_review_frames()`）標記出來的畫面轉成複核人員看得懂的文字說明。
VLM 不參與 pass/reject 判定，那個決策在呼叫這支函式之前就已經算完了。

理由與架構定位見 `summarizer.py` 檔頭註解。

## 安裝（地端 VLM，不是雲端 API）

1. 裝 [Ollama](https://ollama.com/download)
2. 拉模型：
   ```
   ollama pull qwen2.5vl:3b
   ```
3. 確認 Ollama 服務有在跑（安裝完通常會自動啟動，監聽 `http://localhost:11434`）：
   ```
   curl http://localhost:11434/api/tags
   ```

沒裝好、模型沒拉下來、或 Ollama 沒在跑的時候，`summarize_verification()`
會回傳 `available: False`，不會讓 `/verify` request 失敗——複核人員一樣
能看到其他各層的原始數據跟異常影格，只是少了這段文字摘要。

## 拿舊影片直接測試（不需要真的跑一次 /verify）

`summarize_verification()` 只吃「影格 + 秒數」，不管這些影格從哪來，所以
可以直接從任何一支既有的影片檔案（`data/recordings/` 下的舊測試片、
自己手機錄的都行）挖幾張圖出來測，不用真的觸發一次完整驗證流程：

```python
import cv2, sys, json
sys.path.insert(0, ".")
from vlm_summary.summarizer import summarize_verification

cap = cv2.VideoCapture("data/recordings/real_normal_001.mp4")  # 換成任何舊影片路徑
cap.set(cv2.CAP_PROP_POS_FRAMES, 100)  # 換成想測試的影格編號
ok, frame_bgr = cap.read()
cap.release()
frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

result = summarize_verification(
    {"decision": {}},
    [{"image": frame_rgb, "timestampSec": 3.3, "source": "occlusion"}],  # source 決定問 VLM 什麼問題，見 summarizer.py PROMPTS
)
print(json.dumps(result, ensure_ascii=False, indent=2))
```

任何裝了 Ollama + 拉過模型的電腦都能跑這段，不需要有 GPU、也不需要先
把整個 `/verify` 流程走一遍。

## 已知的效能狀況（沒有獨立顯卡的機器）

實測（2026-08-29，i5-13500H、無獨立顯卡、16GB RAM）：

- **原始解析度影格（例如手機直錄的 1920×1080）直接送進去會嚴重卡頓**，
  在系統記憶體吃緊時甚至會卡住十幾分鐘沒有回應——不是 bug，是 CPU
  版影像編碼器要處理的視覺 token 數量隨解析度暴增，記憶體不夠時整台
  機器忙著跟硬碟交換分頁，而不是真的在算。`summarizer.py` 已經固定
  把影格縮到長邊 512px 再送（見 `MAX_DIMENSION`），這個限制不要拿掉。
- **模型冷啟動（Ollama 剛把模型讀進記憶體）第一次請求約 70-90 秒**，
  之後只要模型還留在記憶體裡（Ollama 預設閒置 5 分鐘才會卸載），
  後續請求約 2-3 秒。這跟「只在人工複核時才觸發」的實際使用情境搭得
  起來，不需要額外做預熱機制。
- 如果同時開很多其他程式（多個 Claude Code 視窗、瀏覽器分頁、Docker
  Desktop 等）導致系統可用記憶體低於 1GB，速度會明顯劣化，測試前
  留意一下工作管理員的可用記憶體。

## 已知的限制：VLM「看不出異常」不代表系統判定有誤

2026-08-29 用真實 review 案例（id=166，Track4 標記出兩格身分穩定度異常
的畫面）實測，VLM 對這兩格的視覺判斷都是「未見明顯異常」。這不是壞掉，
是預期中會發生的事，而且值得寫進報告：

Track4 抓的是**身分嵌入向量在遮擋前後的統計距離**，這種異常是數學空間
裡的偏移，換臉演算法換得夠好時，單張畫面看起來可能完全正常——這正是
Track4 存在的意義：抓 VLM／人眼這種「看畫面判斷」的方法看不出來的東西
（跟這個專案「為什麼不能只靠 VLM 做防偽判定」的核心論點是同一件事，
見對話紀錄裡查過的文獻：GPT-4o 對深偽偵測準確率約 58%，接近隨機猜測）。

**曾經踩過的坑**：一開始判斷「VLM 有沒有講出東西」是用完全字串比對
（`observation != "未見明顯異常"`），但模型回覆常帶標點或些微措辭差異
（例如「未見明顯異常。」），比對永遠對不上，導致「沒異常」被誤判成
「有話要講」，摘要把「未見明顯異常」原句複誦出來、聽起來像是在說
「這格沒問題」——這會誤導複核人員以為系統標記錯了、可以放行,但這幾格
會被送來給 VLM 看，正是因為某一層已經判定它可疑。已改用
`observation.strip().startswith("未見明顯異常")`，而且不管有沒有找到
視覺瑕疵，`summary` 都會明講「這是 VLM 的視覺檢視結果，不是對系統判定
的背書或推翻，仍應以觸發複核的原始數據為準」——兩種情況都不該讓複核
人員誤會。

## 為什麼選 qwen2.5vl:3b

這台開發機沒有獨立顯卡（僅 Intel Iris Xe 內顯），硬碟可用空間也有限
（約 21GB），所以刻意選小模型：

- CPU 推論可接受速度，且複核本來就是非即時流程（`/verify` 已經是非
  同步背景處理，不需要即時回應）
- 模型檔案量化後約 3.2GB，不會把本來就緊繃的硬碟空間吃光
- Ollama 官方庫沒有 `qwen2-vl`（舊代）的 2B 版本，最小的官方 tag 是
  `qwen2.5vl:3b`——是比 Qwen2-VL 更新的世代，尺寸也還在預算內
- 3B 參數量對「描述這格畫面有沒有明顯異常」這種相對單純的任務夠用，
  不需要 7B 以上的模型

如果之後在有 GPU 的機器上部署，可以把 `summarizer.py` 裡的 `VLM_MODEL`
換成更大的模型（例如 `qwen2.5vl:7b`），其餘邏輯不用改。
