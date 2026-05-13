import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "port": os.getenv("DB_PORT"),
    "database": os.getenv("DB_NAME"),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
}

# Build PostgreSQL URL manually
DATABASE_URL = (
    f"postgresql+psycopg2://"
    f"{DB_CONFIG['user']}:{DB_CONFIG['password']}@"
    f"{DB_CONFIG['host']}:{DB_CONFIG['port']}/"
    f"{DB_CONFIG['database']}"
)

# Create SQLAlchemy engine
engine = create_engine(DATABASE_URL)

def test_db():
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("SELECT 'PostgreSQL connected'")
            ).scalar()

            print(result)
            return result

    except Exception as e:
        print("Database connection failed:")
        print(e)