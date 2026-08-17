"""FastAPI｜資料庫連線設定。

契約見 CONVENTIONS.md §5.7。DATABASE_URL 從 .env 讀取，不寫死
（CONVENTIONS §10.2 規則 5）。
"""

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """FastAPI dependency：每個請求開一個 session，處理完自動關閉。"""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
