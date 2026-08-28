# 證件角點偵測（YOLO-pose）

用來取代 `image_utils/id_card.py` 目前的古典 CV 方法（Canny → 輪廓 →
凸包 → approxPolyDP）。那套方法今天（2026-08-27）踩了一整輪 bug：
輪廓面積算法、角點排序、邊緣斷裂、手指遮擋、光線太暗——每個都修得動，
但「手指蓋住卡片一角時要不要判定失敗」這種需要語意理解的判斷，
幾何規則沒辦法一次到位，調完一批真人照片，換一批新照片、新握法、
新光線大概率又要重調。

YOLO-pose 直接把 4 個角當 keypoint 學，理由：
1. **角點順序有固定語意**，不用像現在的 `_order_corners()` 那樣
   靠角度排序去猜哪個是左上角——模型直接輸出「這是左上角」。
2. **能處理遮擋**——手指蓋住角落時，Canny 完全沒有那個角落的邊界
   資訊可用；關鍵點模型是從整張卡片形狀學出來的，可以學會「這裡
   被擋住了，但根據其他三個角跟卡片比例，這裡大概是這個座標」。

## 目錄結構（Ultralytics YOLO-pose 標準格式）

```
id_card_detector/
├── dataset/
│   ├── images/
│   │   ├── train/          # 訓練圖片（.jpg/.png）
│   │   └── val/             # 驗證圖片
│   ├── labels/
│   │   ├── train/          # 對應的 .txt 標註（跟圖片同檔名）
│   │   └── val/
│   └── data.yaml            # Ultralytics 訓練設定檔
└── weights/                 # 訓練好的 .pt 權重（不進 git，同
                              # track1_synthetic/weights/ 的做法）
```

## 標註格式

每張圖片一個同檔名的 `.txt`，YOLO-pose 格式：

```
<class_id> <cx> <cy> <w> <h> <x1> <y1> <v1> <x2> <y2> <v2> <x3> <y3> <v3> <x4> <y4> <v4>
```

- `class_id`：固定 0（只有一個類別 `id_card`）
- `cx cy w h`：整張卡片的 bounding box 中心點跟寬高，**全部正規化到 0~1**
  （除以圖片寬高）
- `(x1,y1,v1)` ~ `(x4,y4,v4)`：**依序**左上、右上、右下、左下，座標
  同樣正規化到 0~1；`v` 是 visibility：
  - `0`：沒標註（不會用到，這個任務應該用不到）
  - `1`：標了，但這個角被遮擋看不見（例如手指蓋住）——**還是要標
    真正的角落座標**，不是隨便填一個點，模型才學得到「被遮住也要猜」
  - `2`：清楚可見

## 標註工具

推薦用 [Roboflow](https://roboflow.com/) 或 [CVAT](https://www.cvat.ai/)，
兩者都支援 keypoint 標註跟直接匯出 YOLO-pose 格式，不用手刻 txt。

## 訓練資料怎麼收集

不想用真的身分證（見專案裡的討論），兩個方向都不需要真證件：

1. **手動拍攝**：用手上的示範卡片（iPASS、學生證等）多角度、多光線、
   多握法（含刻意手指蓋角）實拍幾百張，手動標 4 個角。這個任務
   keypoint 數量少，標註速度很快。
2. **合成資料**（量能做更大時再考慮）：拿卡片模板圖，程式化隨機
   透視變形＋貼到各種背景照片上＋隨機疊加手指遮擋圖層，座標由程式
   算出來，不用手標。

兩種資料建議混用：合成資料量大但跟真實拍攝場景有 domain gap，
手動拍攝的少量真實樣本可以在合成資料訓練後再 fine-tune 一輪，
縮小這個差距。

## 訓練

```bash
pip install ultralytics
yolo pose train data=id_card_detector/dataset/data.yaml model=yolo11n-pose.pt epochs=100 imgsz=640
```

CPU 推論考量：這台機器 InsightFace/MediaPipe 已經在吃 CPU 資源，
選 `yolo11n-pose`（nano）量級，不要上更大的模型。

## 訓練完之後怎麼接回 `image_utils/id_card.py`

`rectify_id_card()` 目前的架構：

```
灰階 → 高斯模糊 → Canny → 膚色遮罩 → findContours 找輪廓
→ approxPolyDP 逼近四邊形 → 角點排序 → 信心分數 → 透視變換
```

只有「找四個角」這一段（從 Canny 到角點排序）要換成模型推論，
其餘（信心分數判斷、透視變換、API 回應格式）可以保留，甚至信心
分數可以直接拿模型自己輸出的 keypoint confidence，不用再靠長寬比
去猜。
