from sqlalchemy import text
from database import engine


indexes = [
    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_details_stay
    ON rate_details (check_in_date, check_out_date)
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_details_conf_recency
    ON rate_details (
        (TRIM(conf_code)),
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        rate_detail_key DESC
    )
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_details_villa_checkin
    ON rate_details (villa_name, check_in_date DESC)
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_details_bedroom_checkin
    ON rate_details (bedroom_count, check_in_date DESC)
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reservation_guests_conf
    ON reservation_guests ((TRIM(conf_code)))
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rooms_conf
    ON rooms ((TRIM(confirmation_code)))
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_statement_details_villa_income
    ON statement_details (transaction_date, member_number)
    WHERE description ILIKE '%Villa Income%'
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_addresses_member
    ON member_addresses (member_number)
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_phones_member
    ON member_phones (member_number, phone_type)
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folios_conf_code
    ON folios (conf_code)
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folios_conf_stay
    ON folios (conf_code, check_in_date, check_out_date)
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folios_villa_conf
    ON folios (villa_name, conf_code)
    WHERE villa_name IS NOT NULL
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folios_villa_category_conf
    ON folios (transaction_category, conf_code)
    WHERE transaction_category = 'Villa'
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folios_paid_villa_conf
    ON folios (conf_code, villa_payment_type)
    WHERE transaction_category = 'Villa'
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_details_conf_rate_recency
    ON rate_details (
        conf_code,
        rate_date,
        updated_at DESC NULLS LAST
    )
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rate_details_room_villa
    ON rate_details (room_number, villa_name)
    WHERE room_number IS NOT NULL
    AND villa_name IS NOT NULL
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rooms_room_type
    ON rooms (room_number, room_type)
    WHERE room_number IS NOT NULL
    AND room_type IS NOT NULL
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_statement_villa_income_member_date
    ON statement_details (
        member_number,
        transaction_date,
        ref_transaction_id
    )
    WHERE description ILIKE '%Villa Income%'
    """,

    """
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_statement_details_nonzero_cover
    ON statement_details (
        statement_detail_key
    )
    INCLUDE (
        member_number,
        transaction_date,
        description,
        amount
    )
    WHERE amount <> 0
    """,
]


tables_to_analyze = [
    "rate_details",
    "reservation_guests",
    "rooms",
    "statement_details",
    "member_addresses",
    "member_phones",
]


def main():
    print("\nCreating performance indexes...\n")

    with engine.connect().execution_options(
        isolation_level="AUTOCOMMIT"
    ) as connection:

        for statement in indexes:
            index_name = (
                statement.split("IF NOT EXISTS")[1]
                .split()[0]
            )

            print(f"Creating/checking {index_name}...")

            try:
                connection.execute(text(statement))
                print(f"✓ {index_name}")
            except Exception as exc:
                print(f"✗ Failed: {index_name}")
                print(exc)
                raise

        print("\nRefreshing PostgreSQL statistics...\n")

        for table in tables_to_analyze:
            print(f"Analyzing {table}...")

            try:
                connection.execute(
                    text(f"ANALYZE {table}")
                )
                print(f"✓ {table}")
            except Exception as exc:
                print(f"✗ Failed to analyze {table}")
                print(exc)
                raise

    print("\n========================================")
    print("✓ Performance indexes setup complete!")
    print("========================================\n")


if __name__ == "__main__":
    main()