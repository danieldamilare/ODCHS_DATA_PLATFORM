import click
from app.enrollment import enrollment_bp
from app.enrollment.llm.keys import load_api_keys
from flask.cli import with_appcontext
from app import db


@enrollment_bp.cli.command("load-api-key")
def load_key():
    click.echo("Loading API keys...")
    load_api_keys()
    click.echo("Successfully loadead API keys")


@enrollment_bp.cli.command("db-init")
@with_appcontext
def db_init():
    click.echo("Creating database tables for ODCHS Platform...")
    db.create_all()
    click.echo("Successfully created app.db and generated all structural tables!")
