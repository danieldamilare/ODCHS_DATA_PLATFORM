from app.admin import admin_bp
from flask.cli import with_appcontext
from app.auth.models import User, UserRole, UserStatus
from app import db
from app.admin.services import AdminServices
import click 

@admin_bp.cli.command("seed-admin-user",)
@with_appcontext
@click.option('--firstname', help="Admin first name", prompt="First Name: ")
@click.option('--lastname', help="Admin last name", prompt="Last Name: ")
@click.option('--email', help="Admin email", prompt="Email: ")
@click.option('--password', help= "Admin password", default=None,)
def seed_user(firstname, lastname, email, password):
    user = User(first_name= firstname, 
                last_name = lastname,
                email=email,
                role=UserRole.ADMIN)
    msg = ""

    if password:
        user.status = UserStatus.ACTIVE
        user.set_password(password)
        msg = f"Successfully created user: {firstname}, {lastname}"
        db.session.add(user)
        db.session.commit()
    else:
        db.session.add(user)
        db.session.commit()
        AdminServices().send_activation_email(user)
        msg = f"Created user and sent activation email to email address: {email}"

    click.echo(msg)