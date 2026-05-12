import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

engine = create_engine(DATABASE_URL)

def test_db():
    with engine.connect() as conn:
        return conn.execute(text("SELECT 'PostgreSQL connected'")).scalar()