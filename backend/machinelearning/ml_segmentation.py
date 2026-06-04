import os
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans


# ---------------------------
# LOAD ENV
# ---------------------------
BASE_DIR = Path(__file__).resolve().parents[1]  # backend/
load_dotenv(BASE_DIR / ".env")


# ---------------------------
# DB CONNECTION
# ---------------------------
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_NAME = os.getenv("DB_NAME")

missing = [
    key for key, value in {
        "DB_USER": DB_USER,
        "DB_PASSWORD": DB_PASSWORD,
        "DB_HOST": DB_HOST,
        "DB_PORT": DB_PORT,
        "DB_NAME": DB_NAME,
    }.items()
    if not value
]

if missing:
    raise ValueError(f"Missing environment variables: {missing}")

DATABASE_URL = (
    f"postgresql+psycopg2://{DB_USER}:{DB_PASSWORD}"
    f"@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)

engine = create_engine(DATABASE_URL)


def query(sql):
    return pd.read_sql(sql, engine)


# ---------------------------
# LOAD FOLIO DATA
# ---------------------------
print("Loading folio data...")

folios = query("""
    SELECT
        COALESCE(member_number, main_member_number) AS member_id,
        transaction_date,
        description,
        amount,
        check_in_date,
        check_out_date
    FROM folios
    WHERE description IS NOT NULL
      AND COALESCE(member_number, main_member_number) IS NOT NULL
""")

print(f"Loaded {len(folios)} folio rows")

if folios.empty:
    raise ValueError("No folio rows found. Check the folios table.")


# ---------------------------
# AMENITY CLASSIFICATION
# ---------------------------
def classify_amenity(description):
    if pd.isna(description):
        return "Other"

    desc = str(description).lower()

    if "spa" in desc or "massage" in desc or "facial" in desc:
        return "Spa"

    if "golf" in desc or "pro shop" in desc or "cart" in desc:
        return "Golf"

    if "grill" in desc:
        return "Grill"

    if "bar" in desc:
        return "Bar"

    if (
        "restaurant" in desc
        or "dinner" in desc
        or "lunch" in desc
        or "breakfast" in desc
    ):
        return "Restaurant"

    if "tennis" in desc:
        return "Tennis"

    if "boutique" in desc or "commissary" in desc or "shop" in desc:
        return "Retail"

    if "villa" in desc or "rental" in desc:
        return "Villa Rental"

    if "airport" in desc or "transfer" in desc or "transport" in desc:
        return "Transportation"

    if "membership" in desc or "dues" in desc or "fee" in desc:
        return "Membership"

    return "Other"


folios["amenity"] = folios["description"].apply(classify_amenity)
folios["amount"] = pd.to_numeric(folios["amount"], errors="coerce").fillna(0)


# ---------------------------
# MEMBER AMENITY USAGE
# ---------------------------
usage = (
    folios
    .groupby(["member_id", "amenity"])
    .agg(
        visits=("description", "count"),
        total_spend=("amount", "sum"),
    )
    .reset_index()
)

print("\nAmenity usage sample:")
print(usage.head())


# ---------------------------
# ONE ROW PER MEMBER
# ---------------------------
member_matrix = usage.pivot_table(
    index="member_id",
    columns="amenity",
    values="visits",
    fill_value=0,
).reset_index()

member_matrix.columns.name = None

amenity_cols = [col for col in member_matrix.columns if col != "member_id"]

if not amenity_cols:
    raise ValueError("No amenity columns created. Check description data.")


# ---------------------------
# FAVORITE AMENITY
# ---------------------------
member_matrix["favorite_amenity"] = member_matrix[amenity_cols].idxmax(axis=1)
member_matrix["total_amenity_visits"] = member_matrix[amenity_cols].sum(axis=1)

member_matrix["favorite_amenity_visits"] = member_matrix.apply(
    lambda row: row[row["favorite_amenity"]],
    axis=1,
)


# ---------------------------
# RULE-BASED SEGMENTS
# ---------------------------
def assign_segment(row):
    fav = row["favorite_amenity"]

    if fav in ["Grill", "Bar", "Restaurant"]:
        return "Food & Beverage Guest"

    if fav == "Spa":
        return "Spa / Wellness Guest"

    if fav == "Golf":
        return "Golf Guest"

    if fav == "Tennis":
        return "Tennis Guest"

    if fav == "Villa Rental":
        return "Villa / Luxury Guest"

    if fav == "Transportation":
        return "Travel Service Guest"

    if fav == "Retail":
        return "Retail Shopper"

    if fav == "Membership":
        return "Membership / Admin"

    return "Other / Low Signal"


member_matrix["segment"] = member_matrix.apply(assign_segment, axis=1)


# ---------------------------
# ML CLUSTERING
# ---------------------------
features = member_matrix[amenity_cols]

if len(member_matrix) >= 5:
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(features)

    kmeans = KMeans(n_clusters=5, random_state=42, n_init=10)
    member_matrix["ml_cluster"] = kmeans.fit_predict(X_scaled)
else:
    member_matrix["ml_cluster"] = 0


# ---------------------------
# SAVE TO POSTGRESQL
# ---------------------------
member_matrix.to_sql(
    "member_amenity_segments",
    engine,
    if_exists="replace",
    index=False,
)

print("\nSaved table: member_amenity_segments")

print("\nPreview:")
print(
    member_matrix[
        [
            "member_id",
            "favorite_amenity",
            "favorite_amenity_visits",
            "total_amenity_visits",
            "segment",
            "ml_cluster",
        ]
    ].head()
)