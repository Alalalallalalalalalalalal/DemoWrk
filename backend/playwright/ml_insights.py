import os
import psycopg2
import pandas as pd
import numpy as np

from dotenv import load_dotenv
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from sklearn.ensemble import IsolationForest

load_dotenv()

# ---------------------------
# DB CONNECTION
# ---------------------------
conn = psycopg2.connect(
    host=os.getenv("DB_HOST"),
    port=os.getenv("DB_PORT"),
    database=os.getenv("DB_NAME"),
    user=os.getenv("DB_USER"),
    password=os.getenv("DB_PASSWORD"),
)

def query(sql):
    return pd.read_sql(sql, conn)

print("\nLoading data... yes, this is the boring but important part.\n")

# ---------------------------
# LOAD CORE DATA
# ---------------------------
members = query("SELECT member_number, status, member_type FROM members")
activity = query("SELECT member_number, amount FROM recent_activity WHERE amount IS NOT NULL")
dependents = query("SELECT member_number FROM dependents")

# ---------------------------
# FEATURE ENGINEERING
# ---------------------------

# Activity per member
activity_agg = activity.groupby("member_number").agg(
    tx_count=("amount", "count"),
    total_spend=("amount", "sum"),
    avg_spend=("amount", "mean"),
).reset_index()

# Dependent count per member
dep_agg = dependents.groupby("member_number").size().reset_index(name="dep_count")

# Merge everything
df = members.merge(activity_agg, on="member_number", how="left")
df = df.merge(dep_agg, on="member_number", how="left")

# Fill missing values
df["tx_count"] = df["tx_count"].fillna(0)
df["total_spend"] = df["total_spend"].fillna(0)
df["avg_spend"] = df["avg_spend"].fillna(0)
df["dep_count"] = df["dep_count"].fillna(0)

print("\nBasic dataset built. Now we squeeze meaning out of it.\n")

# ---------------------------
# OUTLIER DETECTION (DEPENDENTS + SPENDING)
# ---------------------------
outlier_features = df[["tx_count", "total_spend", "dep_count"]]

iso = IsolationForest(contamination=0.02, random_state=42)
df["anomaly"] = iso.fit_predict(outlier_features)

anomalies = df[df["anomaly"] == -1]

print("\n--- ANOMALIES DETECTED ---")
print(anomalies[["member_number", "tx_count", "total_spend", "dep_count"]].head(10))

# ---------------------------
# CLUSTERING (MEMBER SEGMENTS)
# ---------------------------
features = df[["tx_count", "total_spend", "dep_count"]]

scaler = StandardScaler()
X_scaled = scaler.fit_transform(features)

kmeans = KMeans(n_clusters=3, random_state=42, n_init=10)
df["segment"] = kmeans.fit_predict(X_scaled)

print("\n--- SEGMENT DISTRIBUTION ---")
print(df["segment"].value_counts())

# ---------------------------
# SEGMENT INTERPRETATION
# ---------------------------
summary = df.groupby("segment").agg({
    "tx_count": "mean",
    "total_spend": "mean",
    "dep_count": "mean",
    "member_number": "count"
}).rename(columns={"member_number": "member_count"})

print("\n--- SEGMENT PROFILES ---")
print(summary)

# ---------------------------
# BASIC BUSINESS INSIGHTS
# ---------------------------
print("\n--- QUICK INSIGHTS ---")

inactive_rate = (df["status"].value_counts(normalize=True).get("Inactive", 0)) * 100
print(f"Inactive rate: {inactive_rate:.2f}%")

top_dependents = df.sort_values("dep_count", ascending=False).head(5)
print("\nTop dependent-heavy members:")
print(top_dependents[["member_number", "dep_count"]])

top_spenders = df.sort_values("total_spend", ascending=False).head(5)
print("\nTop spenders:")
print(top_spenders[["member_number", "total_spend"]])

print("\nDone. If this still looks messy, it’s not the code’s fault anymore.")