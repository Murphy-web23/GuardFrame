"""FastAPI｜應用進入點。

契約見 CONVENTIONS.md §5.5。啟動方式：
    uvicorn api.main:app --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router

app = FastAPI(title="GuardFrame 驗證引擎")

# 開發階段先開放所有來源，讓前端（不同 origin）能連上這個 API——
# 沒有這段設定，瀏覽器會直接擋下跨網域請求，前端連測試都測不了。
# allow_credentials 保持預設 False：目前沒有任何端點用 cookie/session
# 認證（後台登入還沒做），不需要帶憑證的跨站請求；allow_origins=["*"]
# 只有在 allow_credentials=False 時才合法（CORS 規範不允許萬用字元
# 來源搭配憑證）。**正式部署前要把 allow_origins 改成前端實際網域**，
# 不要繼續開放所有來源。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
