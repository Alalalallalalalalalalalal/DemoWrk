from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from postgres.analytics import router as analytics_router
from postgres.finance_backend import router as finance_router

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
#add finance router here
app.include_router(
    finance_router,
    prefix="/finance",
    tags=["Finance"]
)