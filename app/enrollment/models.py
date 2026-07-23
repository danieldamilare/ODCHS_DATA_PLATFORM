from app import db
from enum import Enum
from datetime import datetime
import uuid


class BatchStatus(Enum):
    PROCESSING = "processing"
    DONE = "done"
    PARTIAL = "partial"
    FAILED = "failed"
    REVIEWED = "reviewed"  # if all forms in batch has been reviewed


class FormStatus(Enum):
    PENDING = "pending"  # not reviewed
    ENROLLED = "enrolled"  # successful enrolled
    FAILED = "failed"  # error from his when enrolling
    REJECTED = "rejected"  # user reject form while reviewing
    NEED_RESCAN = "need_rescan"
    ERROR = "error"


class Batch(db.Model):
    __tablename__ = "batches"
    id = db.Column(db.Integer, primary_key=True)
    uuid = db.Column(db.String, unique=True, default=lambda: str(uuid.uuid4()))
    total = db.Column(db.Integer, default=0)
    status = db.Column(db.Enum(BatchStatus), default=BatchStatus.PROCESSING)
    processed = db.Column(db.Integer, default=0)
    lga_no = db.Column(db.Integer, nullable=True)
    ward_no = db.Column(db.Integer, nullable=True)
    facility_no = db.Column(db.Integer, nullable=True)
    submitted_at = db.Column(db.DateTime, default=datetime.now)
    zip_hash = db.Column(db.Text, nullable=True, unique=True)
    forms = db.relationship("Form", backref="batch")


class Form(db.Model):
    __tablename__ = "forms"
    UPDATABLE_FIELDS = {
        "title",
        "surname",
        "firstname",
        "othername",
        "dob",
        "gender",
        "phone_number",
        "nin",
        "address",
        "category",
        "marital_status",
        "kin_firstname",
        "kin_surname",
        "kin_othername",
        "kin_relationship",
        "kin_phone_number",
        "kin_address",
        "passport_xmin",
        "passport_ymin",
        "passport_xmax",
        "passport_ymax",
        "lga_no",
        "ward_no",
        "facility_no",
    }

    sequence = db.Column(db.Integer)
    id = db.Column(db.Integer, primary_key=True)
    uuid = db.Column(db.String, default=lambda: str(uuid.uuid4()))
    img_path = db.Column(db.Text, nullable=False)
    passport_path = db.Column(db.Text)
    nin = db.Column(db.String(12))
    surname = db.Column(db.String)
    firstname = db.Column(db.String)
    othername = db.Column(db.String)
    dob = db.Column(db.String)
    address = db.Column(db.Text)
    gender = db.Column(db.String(6))
    phone_number = db.Column(db.String)
    settlement = db.Column(db.String(5))
    category = db.Column(db.String)
    marital_status = db.Column(db.String)
    batch_id = db.Column(db.Integer, db.ForeignKey("batches.id"))

    kin_firstname = db.Column(db.String)
    kin_othername = db.Column(db.String)
    kin_surname = db.Column(db.String)
    kin_relationship = db.Column(db.String)
    kin_phone_number = db.Column(db.String)
    kin_address = db.Column(db.String)
    lga_no = db.Column(db.Integer, nullable=False)
    ward_no = db.Column(db.Integer, nullable=False)
    facility_no = db.Column(db.Integer, nullable=False)

    status = db.Column(db.Enum(FormStatus), default=FormStatus.PENDING)
    reason = db.Column(db.String)
    title = db.Column(db.String)
    error_message = db.Column(db.String)
    enrolled_at = db.Column(db.DateTime, default=None)

    passport_xmin = db.Column(db.Integer, nullable=True)
    passport_ymin = db.Column(db.Integer, nullable=True)
    passport_xmax = db.Column(db.Integer, nullable=True)
    passport_ymax = db.Column(db.Integer, nullable=True)
