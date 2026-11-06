import getpass
import os

from werkzeug.security import generate_password_hash

from db_adapter import get_connection, initialize_database


SUPER_ADMIN_EMAIL = "mwendwafreddie@gmail.com"


def main():
    if not os.environ.get("STJAMES_POSTGRES_URL") and not os.environ.get("DATABASE_URL"):
        raise RuntimeError("Set STJAMES_POSTGRES_URL or DATABASE_URL before bootstrapping.")
    password = getpass.getpass("Set Super Admin password (minimum 12 characters): ")
    if len(password) < 12:
        raise ValueError("Password must contain at least 12 characters.")
    initialize_database()
    with get_connection() as connection:
        connection.execute(
            "INSERT INTO users (email, name, password_hash, role, enabled) "
            "VALUES (?, ?, ?, 'super_admin', 1) "
            "ON CONFLICT(email) DO UPDATE SET name = excluded.name, "
            "password_hash = excluded.password_hash, role = 'super_admin', enabled = 1",
            (
                SUPER_ADMIN_EMAIL,
                "St. James Super Admin",
                generate_password_hash(password),
            ),
        )
    print(f"Super Admin account is ready for {SUPER_ADMIN_EMAIL}.")


if __name__ == "__main__":
    main()
