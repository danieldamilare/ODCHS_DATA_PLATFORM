from app import db 
from uuid import uuid4
from enum import Enum
from datetime import datetime, timezone
from sqlalchemy import JSON


class JobType(str, Enum):
    ENCOUNTER = "encounter"
    ENROLLMENT = "enrollment"
    NINBATCH = "nin_batch"
    IDCARD = "id_card"


class JobStatus(str, Enum):
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class Jobs(db.Model):
    __tablename__ = "jobs"

    id = db.Column(db.Integer, primary_key=True)
    uuid = db.Column(db.String(36), unique=True, index=True, default=lambda: str(uuid4()))
    job_type = db.Column(db.Enum(JobType), index=True, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    created_by = db.Column(db.Integer, db.ForeignKey("user.id"), index=True, nullable=False)
    assigned_to = db.Column(db.Integer, db.ForeignKey("user.id"), index=True, nullable=True)
    details = db.Column(JSON, nullable=True)
    status = db.Column(db.Enum(JobStatus), default=JobStatus.PROCESSING, nullable=False)
    task_id = db.Column(db.String(64), nullable=True, index=True)
    finished_at = db.Column(db.DateTime(timezone=True), nullable=True)

    creator = db.relationship("User", foreign_keys=[created_by], backref="created_jobs")
    assignee = db.relationship("User", foreign_keys=[assigned_to], backref="assigned_jobs")

    def to_dict(self):
        return {
            "id": self.id,
            "uuid": self.uuid,
            "job_type": self.job_type.value if hasattr(self.job_type, "value") else str(self.job_type),
            "details": self.details,
            "status": self.status.value if hasattr(self.status, "value") else str(self.status),
            "task_id": self.task_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "created_by": self.creator.to_dict() if self.creator else None,
            "assigned_to": self.assignee.to_dict() if self.assignee else None,
        }