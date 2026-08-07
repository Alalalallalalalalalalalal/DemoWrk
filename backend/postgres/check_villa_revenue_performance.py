from sqlalchemy import text
from database import engine

sql = """
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT
    f.conf_code::text AS conf_code,
    MAX(f.villa_name) AS villa_name,
    COALESCE(
        NULLIF(TRIM(MAX(f.source)), ''),
        CASE
            WHEN BOOL_OR(f.folio_source = 'synthetic_villa_income')
            THEN 'Rental Programme'
            ELSE 'Unknown'
        END
    ) AS source,
    MAX(f.bedroom_count) AS bedroom_count,
    MAX(f.member_number) AS member_number,
    MIN(f.check_in_date) AS check_in_date,
    MAX(f.check_out_date) AS check_out_date
FROM folios_unified_display f
WHERE f.conf_code IS NOT NULL
  AND f.villa_name IS NOT NULL
  AND f.check_in_date IS NOT NULL
  AND f.check_out_date IS NOT NULL
  AND COALESCE(
        LOWER(TRIM(f.reservation_status)),
        ''
      ) NOT IN (
        'cancelled',
        'canceled',
        'no-show',
        'no show'
      )
GROUP BY f.conf_code
HAVING MIN(f.check_in_date) <= DATE '2026-12-31'
   AND MAX(f.check_out_date) >= DATE '2026-01-01';
"""


def main():
    print("\nRunning EXPLAIN ANALYZE...\n")

    with engine.connect() as connection:
        result = connection.execute(text(sql))

        for row in result:
            print(row[0])


if __name__ == "__main__":
    main()