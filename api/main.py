"""FastAPI｜應用進入點。

契約見 CONVENTIONS.md §5.5。啟動方式：
    uvicorn api.main:app --reload
"""

from fastapi import FastAPI

from api.routes import router

app = FastAPI(title="GuardFrame 驗證引擎")
app.include_router(router)
