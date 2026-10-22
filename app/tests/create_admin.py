import sys
import argparse
from dotenv import load_dotenv

# Load environment variables (.env)
load_dotenv()

from app import create_app, db
from app.auth.models import User, UserRole, UserStatus, ODCHCScheme


def create_or_update_admin(
    email: str,
    password: str,
    first_name: str = "Admin",
    last_name: str = "User",
    scheme: str = "bhcpfp",
):
    app = create_app()

    with app.app_context():
        email_clean = email.lower().strip()
        existing_user = User.query.filter_by(email=email_clean).first()

        scheme_enum = ODCHCScheme(scheme.lower()) if scheme.lower() in [s.value for s in ODCHCScheme] else ODCHCScheme.BHCPFP

        if existing_user:
            print(f"[*] Found existing user with email: {email_clean}")
            existing_user.first_name = first_name
            existing_user.last_name = last_name
            existing_user.role = UserRole.ADMIN
            existing_user.status = UserStatus.ACTIVE
            existing_user.scheme = scheme_enum
            existing_user.set_password(password)
            db.session.commit()
            print(f"[+] Successfully updated existing user to ACTIVE ADMIN.")
            user = existing_user
        else:
            print(f"[*] Creating new admin user with email: {email_clean}")
            user = User(
                first_name=first_name,
                last_name=last_name,
                email=email_clean,
                role=UserRole.ADMIN,
                status=UserStatus.ACTIVE,
                scheme=scheme_enum,
            )
            user.set_password(password)
            db.session.add(user)
            db.session.commit()
            print(f"[+] Successfully created new ACTIVE ADMIN user.")

        # Verify authentication
        auth_success, verified_user, msg = User.verify_user(email_clean, password)

        print("\n" + "=" * 50)
        print("ADMIN USER DETAILS")
        print("=" * 50)
        print(f"ID         : {user.id}")
        print(f"UUID       : {user.uuid}")
        print(f"Name       : {user.first_name} {user.last_name}")
        print(f"Email      : {user.email}")
        print(f"Role       : {user.role.value if hasattr(user.role, 'value') else user.role}")
        print(f"Status     : {user.status.value if hasattr(user.status, 'value') else user.status}")
        print(f"Scheme     : {user.scheme.value if hasattr(user.scheme, 'value') else user.scheme}")
        print(f"Auth Test  : {'PASSED' if auth_success else 'FAILED: ' + msg}")
        print("=" * 50)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Add or update an Admin user with password.")
    parser.add_argument("--email", default="admin@example.com", help="Admin email address")
    parser.add_argument("--password", default="Admin@12345", help="Admin password")
    parser.add_argument("--first-name", default="Admin", help="First name")
    parser.add_argument("--last-name", default="User", help="Last name")
    parser.add_argument("--scheme", default="bhcpfp", help="Scheme (bhcpfp, oranghis, abiyamo)")

    args = parser.parse_args()
    create_or_update_admin(
        email=args.email,
        password=args.password,
        first_name=args.first_name,
        last_name=args.last_name,
        scheme=args.scheme,
    )
