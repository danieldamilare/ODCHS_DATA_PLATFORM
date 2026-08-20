import resend
import os
from flask import current_app
from app import celery_app


@celery_app.task(bind=True, max_retries=3)
def send_email(self, user_email: str, user_name: str, html_content: str, subject: str):
    try:
        resend.api_key = current_app.config.get("RESEND_API_KEY")
    except Exception:
        resend.api_key = os.getenv("RESEND_API_KEY")
    sender = current_app.config.get("EMAIL_SENDER") or os.getenv("EMAIL_SENDER")

    try:
        resend.Emails.send(
            {
                "from": sender,
                "to": [user_email],
                "subject": subject,
                "html": html_content,
            }
        )
    except Exception as exc:
        raise self.retry(exc=exc, countdown=30 * (self.request.retries + 1))

