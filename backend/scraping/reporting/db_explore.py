"""
db_explore.py — Read-only diagnostic queries to understand data shape.
No data is written or changed. Safe to run at any time.

Usage:
    cd backend && python -m scraping.reporting.db_explore
"""

import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

conn = psycopg2.connect(
    host=os.getenv("DB_HOST"),
    port=os.getenv("DB_PORT"),
    database=os.getenv("DB_NAME"),
    user=os.getenv("DB_USER"),
    password=os.getenv("DB_PASSWORD"),
)
cur = conn.cursor()

def run(label, query):
    print(f"\n{'=' * 60}")
    print(f"  {label}")
    print('=' * 60)
    try:
        cur.execute(query)
        rows = cur.fetchall()
        if rows:
            for row in rows:
                print(" ", row)
        else:
            print("  (no results)")
    except Exception as e:
        print(f"  ERROR: {e}")
        conn.rollback()

# 1. Row counts
run("Row counts across all tables", """
    SELECT 'members'         AS table_name, COUNT(*) FROM members
    UNION ALL SELECT 'dependents',          COUNT(*) FROM dependents
    UNION ALL SELECT 'recent_activity',     COUNT(*) FROM recent_activity
    UNION ALL SELECT 'statements',          COUNT(*) FROM statements
    UNION ALL SELECT 'services',            COUNT(*) FROM services
    UNION ALL SELECT 'interests',           COUNT(*) FROM interests
    UNION ALL SELECT 'rooms',               COUNT(*) FROM rooms
    UNION ALL SELECT 'member_addresses',    COUNT(*) FROM member_addresses
    UNION ALL SELECT 'member_phones',       COUNT(*) FROM member_phones;
""")

# 2. Member status breakdown
run("Member status breakdown", """
    SELECT status, COUNT(*)
    FROM members
    GROUP BY status
    ORDER BY COUNT(*) DESC;
""")

# 3. Member type breakdown
run("Member type breakdown", """
    SELECT member_type, COUNT(*)
    FROM members
    GROUP BY member_type
    ORDER BY COUNT(*) DESC;
""")

# 4. Sample interests
run("Sample interest names and values (first 20)", """
    SELECT DISTINCT interest_name, interest_value
    FROM interests
    LIMIT 20;
""")

# 5. Sample recent activity descriptions
run("Sample activity descriptions (first 20)", """
    SELECT DISTINCT description
    FROM recent_activity
    LIMIT 20;
""")

# 6. Activity date range
run("Recent activity date range", """
    SELECT MIN(activity_date), MAX(activity_date)
    FROM recent_activity;
""")

# 7. Spending summary
run("Spending summary (min, max, avg amount per member)", """
    SELECT
        MIN(amount)  AS min_amount,
        MAX(amount)  AS max_amount,
        ROUND(AVG(amount)::numeric, 2) AS avg_amount,
        COUNT(*)     AS total_transactions
    FROM recent_activity
    WHERE amount IS NOT NULL;
""")

# 8. Members with most activity
run("Top 10 most active members (by transaction count)", """
    SELECT member_number, COUNT(*) AS tx_count
    FROM recent_activity
    GROUP BY member_number
    ORDER BY tx_count DESC
    LIMIT 10;
""")

# 9. Services breakdown
run("Most common services", """
    SELECT service_name, COUNT(*) AS member_count
    FROM services
    GROUP BY service_name
    ORDER BY member_count DESC
    LIMIT 20;
""")

# 10. Dependent count distribution
run("Dependent count per member", """
    SELECT dep_count, COUNT(*) AS members
    FROM (
        SELECT member_number, COUNT(*) AS dep_count
        FROM dependents
        GROUP BY member_number
    ) sub
    GROUP BY dep_count
    ORDER BY dep_count;
""")

cur.close()
conn.close()

print(f"\n{'=' * 60}")
print("  Done — no data was modified.")
print('=' * 60)