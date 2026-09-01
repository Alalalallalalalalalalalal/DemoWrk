from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from postgres.analytics import router as analytics_router
from postgres.finance_backend import router as finance_router
from postgres.overview_analytics import router as overview_router #For overview analytics

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://interntproductsite.netlify.app"],
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


#For overview analytics
app.include_router(                                                  
    overview_router,                                              
    prefix="/overview",                                               
    tags=["Overview"]                                         
)

#For Historical Villa Fees Analytics
from postgres.analytics_villa_fees import router as villa_fees_router  # Villa Fees test tab

app.include_router(
    villa_fees_router,
    prefix="/analytics",   # same prefix as the other analytics routers
)

#For New vs Repeat Guest Revenue (Marketing tab)
from postgres.analytics_guest_revenue import router as guest_revenue_router  # New vs Repeat guest revenue

app.include_router(
    guest_revenue_router,
    prefix="/analytics",   # same prefix as the other analytics routers
    tags=["Guest Revenue"],
)