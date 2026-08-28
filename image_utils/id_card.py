"""影像處理｜證件四角偵測與透視矯正。

契約見 CONVENTIONS.md §4.7。

流程：灰階 → 高斯模糊 → Canny 邊緣 → 膚色遮罩濾除 → findContours 找輪廓
→ 依面積排序 → approxPolyDP 逼近四邊形 → 角點排序 → 透視變換。全部是
古典 OpenCV 技術，不需要深度學習模型。矯正只搬動像素，輸出影像沿用
輸入的通道順序。

2026-08-27：新增膚色遮罩這一步之後，輸入影像的通道順序（BGR/RGB）
第一次真的會影響正確性——`_skin_mask()` 用 HSV 判斷膚色，HSV 轉換
依賴正確的通道順序。本模組收到的影像來自 `cv2.imdecode()`（BGR），
呼叫端（`api/routes.py`）也是這樣用，這裡假設輸入固定是 BGR。

找不到四邊形時的容錯很重要：使用者可能拍到桌面反光、證件被手指遮住、
背景太雜——這是實際使用時最常遇到的情況，回傳 success=False 加訊息，
不拋例外、不回傳任何影像（CONVENTIONS §10.3 明確禁止的行為之一）。

2026-08-28：新增 YOLO-pose 角點偵測（`_find_quad_ml()`）當作優先路徑，
見 `id_card_detector/README.md`。純幾何的 Canny 方法對「手指蓋住卡片
角落」這種情況天生做不到「猜出被遮住的角落在哪」，keypoint 模型從
354 張真人標註資料學出來，這項能力測試起來明顯比較好（見跟使用者的
討論紀錄）。**兩套邏輯都保留**，`config.ID_CARD_USE_ML_DETECTOR` 這個
開關可以隨時切回純古典方法：
    - ML 路徑找不到模型檔／信心不足／`ultralytics` 沒裝，都會自動退回
      古典方法，不會讓整支請求失敗——這樣其他沒有這份模型權重檔的
      開發環境（`id_card_detector/weights/` 沒進 git）也能正常運作
    - 古典方法（`_find_quad_contour()` 那一整套）完全沒被刪除或改動
"""

import cv2
import numpy as np

import config

_id_card_pose_model = None
_id_card_pose_model_load_failed = False


def _skin_mask(image_bgr):
    """粗略估計畫面裡哪些像素是膚色（手指、手掌），回傳二值遮罩。

    2026-08-27：真人測試回報「四角有抓到，但矯正出來的畫面還是歪的」
    ——追出根因是使用者拿卡片的方式：手指蓋住卡片其中一角，膚色跟卡片
    白色背景在那個區域的邊界對比夠清楚，Canny 邊緣會把「卡片邊界」跟
    「手指蓋住卡片的邊界」連成同一條線，`findContours` 因此把手指
    誤認成卡片的一部分，透視變換自然跟著扭曲。

    用 HSV 空間抓常見膚色範圍，在 Canny 之後把落在膚色遮罩內的邊緣
    直接清掉——與其讓演算法把手指誤判成卡片邊界、產生「有找到但答案
    是錯的」這種比較危險的結果，寧可讓遮罩把那段邊界弄出缺口，讓後續
    偵測誠實地回報找不到／信心不足，符合本模組開頭說的「找不到要老實
    回報，不要硬做」的原則。

    範圍是常見教學文獻用的粗略膚色 HSV 區間，沒有用大量真實樣本校準，
    刻意抓寬鬆一點（寧可多濾掉一點證件邊緣，也不要漏掉手指邊界）。

    參數:
        image_bgr: np.ndarray，BGR 影像
    回傳:
        np.ndarray，二值遮罩（255=膚色，0=不是），shape 跟輸入的
        高/寬相同
    """
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (0, 30, 60), (25, 180, 255))
    # 稍微膨脹，蓋住膚色邊界附近的抗鋸齒/漸層像素，避免遮罩邊緣本身
    # 又變成一條新的假邊界。
    #
    # 2026-08-27：原本用 7×7，真人測試發現太大——連「手只是拿著卡片
    # 邊緣、沒蓋住角」這種正常拿法都被波及（手部遮罩往卡片方向膨脹
    # 太多，把卡片真正的邊界也一起吃掉，變成完全找不到四邊形）。實測
    # 4 張真實照片（2 張手指真的蓋住角、2 張手只是拿著邊緣的正常照片）
    # 找出來：3×3 是同時滿足「擋得住蓋住角」跟「不誤傷正常拿法」的
    # 最小值，1×1 不夠、7×7 太多。
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
    return mask


def _order_corners(pts):
    """把四個角排成左上、右上、右下、左下。

    approxPolyDP 回傳的四個點順序不固定，做透視變換前必須排好，
    否則影像會被扭曲成奇怪的樣子。

    參數:
        pts: np.ndarray，可為 (4, 2) 或 (4, 1, 2)
    回傳:
        np.ndarray，shape (4, 2)，float32，順序為 [左上, 右上, 右下, 左下]

    2026-08-25：原本用「x+y 最小/最大」「y-x 最小/最大」各自獨立找
    左上/右下、右上/左下——這個技巧只在證件幾乎沒有旋轉（接近正躺）
    時才成立。真人測試發現：手機拍攝時證件常常有明顯旋轉角度（15~30
    度），這時候可能有同一個點同時是「x+y 最大」又是「y-x 最小」，
    導致四個角裡有兩個位置被指派到同一個點、變成退化的三角形——
    warpPerspective 對這種輸入做出來的結果自然是扭曲變形的（這正是
    使用者回報「拍出來的畫面是歪的」的根因，不是新的問題，是這個角點
    排序邏輯本來就有的限制，只是先前的版本連四邊形都找不到、沒機會
    暴露出來）。改成先算四點的形心，用每個點相對形心的角度
    （atan2）排出繞行順序——這個方法對任意旋轉角度都成立，四個點
    一定各自對應到相異的位置。角度排序只保證「相鄰」順序正確，還要
    再挑一個當作左上角的起點（用 x+y 最小當起點，跟原本的直覺一致），
    把序列轉到從那裡開始。
    """
    pts = pts.reshape(4, 2).astype("float32")
    center = pts.mean(axis=0)
    angles = np.arctan2(pts[:, 1] - center[1], pts[:, 0] - center[0])
    ordered = pts[np.argsort(angles)]

    start = int(np.argmin(ordered.sum(axis=1)))
    return np.roll(ordered, -start, axis=0)


def _find_quad_contour(edges):
    """在邊緣圖裡找面積最大的四邊形輪廓。

    參數:
        edges: np.ndarray，Canny 輸出的二值邊緣圖
    回傳:
        np.ndarray | None，approxPolyDP 的輸出，找不到四頂點輪廓時回傳 None

    2026-08-24：原本沒有下限，背景裡的小碎紋理（磁磚、織物花紋）如果
    剛好排進面積前 N 名，會被誤判成證件邊界。現在要求候選四邊形面積
    至少佔畫面 ID_CARD_MIN_AREA_RATIO，太小的直接跳過不考慮。

    2026-08-25：真人測試發現幾乎每一張證件照都偵測失敗，連光線充足、
    證件佔畫面很大、背景乾淨的情況也一樣——用真的失敗截圖（存在
    data/_debug_id_card_failures/ 的診斷圖）實測追出根因：Canny 畫出來
    的證件圓角矩形輪廓只有 1 像素寬，`cv2.findContours` 沿著這條細線
    來回描邊時，`cv2.contourArea()`（Green's theorem／shoelace 公式）
    算出來的「封閉面積」會因為路徑來回折返而互相抵銷、逼近 0——即使
    這個輪廓明明是一個清楚的封閉矩形（實測：外接框 386×247 像素、
    272 個點的輪廓，contourArea 卻只有 78）。這不是門檻設太嚴，是
    「用原始輪廓面積排序」這個做法本身，對這種細線輪廓天生就會失準。
    改成先取每個候選輪廓的**凸包（convex hull）**，用凸包面積排序、
    對凸包做 approxPolyDP——凸包會把來回折返的路徑收斂成真正的外部
    邊界，面積才會正確反映實際大小。同時不再只試第一個達到面積門檻
    的候選就放棄，改成依序嘗試多個候選＋多個 epsilon，直到找到一個
    「四邊形＋長寬比也合理（見 _compute_confidence）」的為止——背景
    雜亂時，面積最大的凸包不一定是證件本身，要有機會往後面的候選找。
    """
    # 2026-08-25：光有凸包還不夠——背景雜亂（例如木紋桌面）時，證件
    # 邊界的 Canny 線條常常在跟背景對比較低的局部位置出現小缺口，
    # `findContours` 會把邊界斷成好幾段各自獨立的小輪廓，而不是一整條
    # 圍住證件的封閉線。用真的失敗截圖實測驗證：對 Canny 結果做一次
    # 輕度膨脹（dilate），把幾像素內的缺口接起來，就能讓原本斷開的
    # 邊界重新連成一條封閉輪廓——5 張真人測試失敗截圖裡，4 張因此從
    # 「完全找不到候選」變成能正確找到證件邊界。膨脹核不能太大，太大
    # 會把證件邊界跟背景紋理黏成一片，反而找不到正確形狀（也實測驗證
    # 過）。
    dilated = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=1)

    frame_area = dilated.shape[0] * dilated.shape[1]
    min_area = frame_area * config.ID_CARD_MIN_AREA_RATIO

    contours, _ = cv2.findContours(dilated, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    hulls = [cv2.convexHull(c) for c in contours]
    hulls = sorted(hulls, key=cv2.contourArea, reverse=True)[
        : config.ID_CARD_CONTOUR_TOP_N
    ]

    candidates = []
    for hull in hulls:
        if cv2.contourArea(hull) < min_area:
            continue
        peri = cv2.arcLength(hull, True)
        for eps_ratio in config.ID_CARD_APPROX_EPSILON_RATIOS:
            approx = cv2.approxPolyDP(hull, eps_ratio * peri, True)
            if len(approx) == 4 and _is_well_formed_quad(approx):
                candidates.append(approx)
                break

    if not candidates:
        return None

    # 面積最大的候選優先，但如果它的長寬比明顯不像證件（見
    # _compute_confidence），換下一個候選試試看，不要一次就放棄。
    candidates.sort(key=cv2.contourArea, reverse=True)
    best = candidates[0]
    for approx in candidates:
        if _compute_confidence(_order_corners(approx)) >= config.ID_CARD_MIN_CONFIDENCE:
            return approx
    return best


def _is_well_formed_quad(approx):
    """四個頂點裡有沒有兩個根本是（幾乎）同一個點。

    2026-08-25：真人測試發現輸出影像常常扭曲變形（使用者回報「拍出來
    的畫面是歪的」），追出根因在 `_order_corners()`——證件明顯旋轉時
    （手機拍攝很常見），原本的排序邏輯可能把兩個角都指派到同一個點，
    退化成三角形，warpPerspective 對這種輸入做出來的結果自然扭曲
    （`_order_corners` 本身已經改用角度排序修正了指派邏輯，這裡另外
    加一層防禦：如果 approxPolyDP 給出來的四個點裡，本來就已經有兩個
    彼此距離小於最大點對距離的 15%，代表這根本不是一個像樣的四邊形
    ——不管後面怎麼排序都不該採用，直接跳過換下一個候選。）
    """
    pts = approx.reshape(4, 2).astype("float64")
    dists = [
        np.linalg.norm(pts[i] - pts[j])
        for i in range(4)
        for j in range(i + 1, 4)
    ]
    return min(dists) > max(dists) * 0.15


def _count_text_regions(image, ordered_corners):
    """粗略估計矯正前的原圖裡，四邊形內部有多少個「候選文字」小區域。

    2026-08-27：光靠長寬比沒辦法擋掉「隨便拍一個長寬比湊巧接近證件的
    矩形」這種誤判（書封面、桌墊、螢幕邊框都可能符合）。真證件（或
    有文字欄位的示範證件）內部會有姓名、證號等密集印刷文字/圖案，這裡
    用自適應二值化＋連通元件分析抓小尺寸候選區域——文字筆畫或圖案元素
    會形成大量小尺寸、長寬比適中的獨立連通元件；大面積單一材質的背景
    （桌面、牆面）幾乎不會有這種東西。

    原本想用 MSER（cv2.MSER_create().detectRegions()），但實測發現這個
    環境的 OpenCV 版本（5.0.0）MSER 對任何輸入（合成圖、真實照片）都
    回傳 0 個區域，懷疑是這個 build 的已知問題，改用不依賴 MSER 的
    自適應二值化＋`connectedComponentsWithStats` 方案。

    刻意不用邊緣密度：木紋桌面、磁磚這類雜亂紋理背景邊緣密度反而很
    高，本模組另一處（`_find_quad_contour`）就是為了處理這種背景造成
    的斷邊問題，用邊緣密度來擋反而會被同一種背景騙過。

    參數:
        image: np.ndarray，原始（未矯正）影像
        ordered_corners: np.ndarray，shape (4, 2)，_order_corners 的輸出，
            座標對應到 image 的像素座標系
    回傳:
        int，符合文字/圖案筆畫特徵（小尺寸、長寬比不誇張）的候選連通
        元件數量
    """
    x, y, w, h = cv2.boundingRect(ordered_corners.astype("float32"))
    x, y = max(x, 0), max(y, 0)
    w = min(w, image.shape[1] - x)
    h = min(h, image.shape[0] - y)
    if w <= 0 or h <= 0:
        return 0

    roi = image[y : y + h, x : x + w]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if roi.ndim == 3 else roi

    block_size = max(15, (min(w, h) // 20) | 1)  # 一定要是奇數
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, block_size, 5
    )
    n_labels, _, stats, _ = cv2.connectedComponentsWithStats(binary)

    roi_area = w * h
    count = 0
    for i in range(1, n_labels):  # label 0 是背景，跳過
        rw, rh, area = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT], stats[i, cv2.CC_STAT_AREA]
        area_ratio = area / roi_area
        aspect = rw / rh if rh > 0 else 0
        # 文字/圖案筆畫：面積佔整個證件區域一個小比例、長寬比不會太
        # 誇張（排除掉整條邊界線、大色塊這種明顯不是單一筆畫的區域）。
        if 0.00005 < area_ratio < 0.02 and 0.1 < aspect < 6.0:
            count += 1

    return count


def _compute_confidence(ordered_corners):
    """依偵測到的四邊形長寬比跟 ISO/IEC 7810 ID-1 規格（856:540）的接近
    程度，估計偵測結果的可信度。

    比對長寬比而不是絕對面積或角度：使用者跟證件的距離、拍攝角度都會
    讓面積跟角的量測值變動很大，但正常拍攝下卡片本身的長寬比不會變。
    偏離標準比例越多，越可能是誤抓到別的矩形（桌面、書本封面等），
    不是真的證件邊界。

    參數:
        ordered_corners: np.ndarray，shape (4, 2)，_order_corners 的輸出
    回傳:
        float，0.0-1.0
    """
    tl, tr, br, bl = ordered_corners
    width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2.0
    height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2.0
    if height < 1e-6 or width < 1e-6:
        return 0.0

    aspect_ratio = max(width, height) / min(width, height)
    deviation = abs(aspect_ratio - config.ID_CARD_ASPECT_RATIO) / config.ID_CARD_ASPECT_RATIO
    return float(max(0.0, 1.0 - deviation))


def _get_id_card_pose_model():
    """延遲載入 YOLO-pose 角點偵測模型，載過一次就快取（同
    `image_utils/quality.py` `_get_face_app()` 的模式）。

    載不起來（`ultralytics` 沒裝、權重檔不存在——後者是常態，這份
    權重檔是訓練出來的大型二進位檔，`.gitignore` 排除掉了，其他開發
    環境本來就不會有）時記下來不再重試，回傳 None 讓呼叫端自動退回
    古典方法，不拋例外。
    """
    global _id_card_pose_model, _id_card_pose_model_load_failed
    if _id_card_pose_model is not None:
        return _id_card_pose_model
    if _id_card_pose_model_load_failed:
        return None

    if not config.ID_CARD_ML_WEIGHTS_PATH.exists():
        print(
            f"[身分證偵測] 找不到 YOLO-pose 權重檔 {config.ID_CARD_ML_WEIGHTS_PATH}，"
            "退回古典 CV 方法",
            flush=True,
        )
        _id_card_pose_model_load_failed = True
        return None

    try:
        from ultralytics import YOLO
    except ImportError:
        print("[身分證偵測] 沒有安裝 ultralytics，退回古典 CV 方法", flush=True)
        _id_card_pose_model_load_failed = True
        return None

    try:
        _id_card_pose_model = YOLO(str(config.ID_CARD_ML_WEIGHTS_PATH))
    except Exception as exc:  # noqa: BLE001 - 模型載入失敗的原因五花八門，都當作「這條路走不通」
        print(f"[身分證偵測] YOLO-pose 模型載入失敗（{exc}），退回古典 CV 方法", flush=True)
        _id_card_pose_model_load_failed = True
        return None

    return _id_card_pose_model


def _find_quad_ml(image_bgr):
    """用 YOLO-pose 模型偵測證件四角。

    參數:
        image_bgr: np.ndarray，BGR 原圖（不是縮小後的 small，YOLO 自己
            會處理縮放，直接餵原圖解析度較高、角點座標較精確）
    回傳:
        (ordered_corners, confidence) | None
        ordered_corners 已經是 [左上, 右上, 右下, 左下]（訓練標註時就是
        照這個固定順序標的，不用像古典方法那樣另外排序），座標對應到
        image_bgr 原圖尺寸；confidence 是模型自己輸出的偵測信心分數。
        沒有模型可用、或偵測不到、或信心低於 config.ID_CARD_ML_MIN_CONFIDENCE
        都回傳 None，呼叫端會自動退回古典方法。
    """
    model = _get_id_card_pose_model()
    if model is None:
        return None

    results = model.predict(image_bgr, verbose=False)
    r = results[0]
    if r.boxes is None or len(r.boxes) == 0 or r.keypoints is None:
        return None

    # 可能同時偵測到好幾個候選（例如背景誤判成第二張卡片），取信心分數
    # 最高的那個，同 _find_quad_contour() 「面積最大的優先」的精神。
    best_idx = int(r.boxes.conf.argmax())
    confidence = float(r.boxes.conf[best_idx])
    if confidence < config.ID_CARD_ML_MIN_CONFIDENCE:
        return None

    ordered_corners = r.keypoints.xy[best_idx].cpu().numpy().astype("float32")
    if ordered_corners.shape != (4, 2):
        return None

    return ordered_corners, confidence


def _warp_to_output(orig, ordered_corners, confidence):
    """已經有排好序的四個角座標之後，共用的透視變換＋組裝回傳值這段——
    ML 路徑跟古典路徑找角點的方法不同，但矯正這一步完全一樣，抽出來
    避免兩邊各寫一份。
    """
    output_w, output_h = config.ID_CARD_OUTPUT_WIDTH, config.ID_CARD_OUTPUT_HEIGHT
    dst = np.array(
        [[0, 0], [output_w - 1, 0], [output_w - 1, output_h - 1], [0, output_h - 1]],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(ordered_corners.astype("float32"), dst)
    rectified = cv2.warpPerspective(orig, matrix, (output_w, output_h))

    return {
        "success": True,
        "rectified": rectified,
        "corners": ordered_corners.tolist(),
        "confidence": confidence,
        "message": "",
    }


def rectify_id_card(image: np.ndarray) -> dict:
    """偵測證件四角並做透視變換矯正。

    參數:
        image: np.ndarray，原始影像，shape (H, W, 3)

    回傳:
        {
            "success": bool,                # 是否成功偵測到四邊形
            "rectified": np.ndarray | None, # 矯正後影像，856×540
                                             # success 為 False 時為 None
            "corners": list | None,         # 四個角座標 [[x,y]×4]，原圖座標，失敗為 None
            "confidence": float,            # 0.0-1.0
            "message": str                  # 供前端顯示的失敗訊息
        }

    實作要點:
        - 灰階 → 高斯模糊 → Canny → findContours → 依面積排序
        - approxPolyDP 逼近四邊形，須確認頂點數為 4
        - 角點依左上/右上/右下/左下排序後才能做透視變換
        - 找不到四邊形時，rectified 與 corners 皆回傳 None，success=False，
          並附上清楚的 message，前端僅顯示此訊息，不顯示任何影像。不拋例外
    """
    if image is None or image.size == 0:
        return {
            "success": False,
            "rectified": None,
            "corners": None,
            "confidence": 0.0,
            "message": "未收到有效影像，請重新拍攝",
        }

    orig = image
    h, w = orig.shape[:2]
    ratio = min(1.0, config.ID_CARD_RESIZE_WIDTH / w)
    small = cv2.resize(orig, None, fx=ratio, fy=ratio) if ratio < 1.0 else orig.copy()

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY) if small.ndim == 3 else small

    # 2026-08-27：真人測試發現昏暗環境（灰階平均亮度 47~64）加上背景
    # 有反光雜物時，Canny 邊緣品質太差，幾何演算法容易選錯輪廓（見
    # config.ID_CARD_MIN_BRIGHTNESS 的說明）——在這種輸入上跑完整套
    # 幾何偵測不會比直接擋掉更可靠，先在這裡快速失敗。
    brightness = float(gray.mean())
    if brightness < config.ID_CARD_MIN_BRIGHTNESS:
        return {
            "success": False,
            "rectified": None,
            "corners": None,
            "confidence": 0.0,
            "message": "畫面過暗，請在光線充足處重新拍攝證件",
        }

    # 2026-08-28：優先試 YOLO-pose 模型，找不到／信心不足／模型不可用
    # 都會自動退回下面的古典 CV 流程，見 config.ID_CARD_USE_ML_DETECTOR
    # 跟 _find_quad_ml() 的說明。
    if config.ID_CARD_USE_ML_DETECTOR:
        ml_result = _find_quad_ml(orig)
        if ml_result is not None:
            ordered_corners, confidence = ml_result
            print(
                f"[身分證偵測] YOLO-pose 偵測成功，confidence={confidence:.3f}",
                flush=True,
            )
            return _warp_to_output(orig, ordered_corners, confidence)
        print("[身分證偵測] YOLO-pose 沒有偵測到，退回古典 CV 方法", flush=True)

    blurred = cv2.GaussianBlur(gray, config.ID_CARD_BLUR_KERNEL, 0)
    edges = cv2.Canny(blurred, config.ID_CARD_CANNY_LOW, config.ID_CARD_CANNY_HIGH)

    # 2026-08-27：真人測試發現手指蓋住卡片一角時，Canny 會把手指邊界跟
    # 卡片邊界連成同一條線，見 _skin_mask() 的說明。這裡把落在膚色遮罩
    # 內的邊緣清掉，寧可讓邊界出現缺口、找不到／信心不足，也不要把手指
    # 誤判成卡片的一部分。small 一定是 3 通道（BGR），因為只有 3 通道
    # 輸入才需要走膚色判斷這條路。
    if small.ndim == 3:
        skin = _skin_mask(small)
        edges[skin > 0] = 0

    quad = _find_quad_contour(edges)
    if quad is None:
        # 2026-08-24：暫時的診斷 log，門檻（面積比例、信心分數）都還沒有
        # 真實資料驗證過，先印出原始畫面尺寸，才知道是不是鏡頭解析度/
        # 畫面比例對不起來導致證件在原始畫面裡佔比太小。
        print(
            f"[身分證偵測失敗診斷] 原始畫面尺寸={w}x{h}（長寬比={w/h:.2f}），"
            f"完全沒找到四邊形輪廓",
            flush=True,
        )
        return {
            "success": False,
            "rectified": None,
            "corners": None,
            "confidence": 0.0,
            "message": "未偵測到證件邊界，請確認證件完整入鏡、背景單純後重新拍攝",
        }

    ordered_small = _order_corners(quad)
    ordered_orig = ordered_small / ratio  # 換算回原圖尺寸

    confidence = _compute_confidence(ordered_orig)
    quad_area_ratio = cv2.contourArea(quad) / (small.shape[0] * small.shape[1])
    print(
        f"[身分證偵測診斷] 原始畫面尺寸={w}x{h}，找到四邊形，"
        f"面積佔比={quad_area_ratio:.3f}（門檻 {config.ID_CARD_MIN_AREA_RATIO}），"
        f"confidence={confidence:.3f}（門檻 {config.ID_CARD_MIN_CONFIDENCE}）",
        flush=True,
    )

    # 2026-08-24：confidence 原本算完全沒被用來判斷，等於「不管信心分數
    # 多低，只要找到一個四邊形就算成功」。加這道檢查，長寬比偏離身分證
    # 標準規格太多（例如背景裡的方形紋理，長寬比接近 1:1 而不是 1.585）
    # 就當作失敗，不要硬做透視變換。
    if confidence < config.ID_CARD_MIN_CONFIDENCE:
        return {
            "success": False,
            "rectified": None,
            "corners": None,
            "confidence": confidence,
            "message": "偵測到的邊界形狀與證件規格差異過大，請確認證件完整入鏡、背景單純後重新拍攝",
        }

    # 2026-08-27：長寬比合格不代表裡面真的是證件——桌面、書本封面、
    # 螢幕邊框都可能湊巧符合 1.585:1。加一道文字密度檢查，見
    # _count_text_regions() 的說明。
    text_regions = _count_text_regions(orig, ordered_orig)
    print(
        f"[身分證偵測診斷] 文字候選區域數={text_regions}"
        f"（門檻 {config.ID_CARD_MIN_TEXT_REGIONS}）",
        flush=True,
    )
    if text_regions < config.ID_CARD_MIN_TEXT_REGIONS:
        return {
            "success": False,
            "rectified": None,
            "corners": None,
            "confidence": confidence,
            "message": "偵測到的區域內文字內容過少，請確認拍攝的是證件本身、背景單純後重新拍攝",
        }

    return _warp_to_output(orig, ordered_orig, confidence)
