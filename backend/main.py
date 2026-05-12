from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from postgres.database import test_db


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# @app.on_event("startup")
# def startup():
#     start_scheduler()

@app.get("/")
def root():
    return {"message": "FastAPI backend is running"}

@app.get("/db-test")
def db_test():
    return {"result": test_db()}