from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.postgres.analytics import router as analytics_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://intern-test-site.netlify.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "FastAPI backend is running"}

app.include_router(
    analytics_router,
    prefix="/analytics",
    tags=["Analytics"]
)