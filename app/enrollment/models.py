from enum import Enum
from datetime import datetime
import uuid as uuid_tool
from app import db
from flask import url_for
from app.enrollment.dataloader import get_loader


class BatchStatus(Enum):
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class FormStatus(Enum):
    PENDING = "pending"
    READY = "ready"
    ENROLLED = "enrolled"  # Successfully pushed to the remote HIS pipeline
    FAILED = "failed"  # Error returned from the network API when enrolling
    REJECTED = "rejected"  # Explicitly marked bad by human validator
    NEED_RESCAN = "need_rescan"
    ERROR = "error"  # Local extraction or processing pipeline error
    ALREADY_EXIST = "already_exist"


class Batch(db.Model):
    __tablename__ = "batches"
    id = db.Column(db.Integer, primary_key=True)
    uuid = db.Column(db.String, unique=True, default=lambda: str(uuid_tool.uuid4()))
    total = db.Column(db.Integer, default=0)
    status = db.Column(db.Enum(BatchStatus), default=BatchStatus.PROCESSING)
    lga_no = db.Column(db.Integer, nullable=True)
    ward_no = db.Column(db.Integer, nullable=True)
    facility_no = db.Column(db.Integer, nullable=True)
    submitted_at = db.Column(db.DateTime, default=datetime.utcnow)
    state_code = db.Column(db.Integer, nullable=True)
    plan_id = db.Column(db.Integer, nullable=True)
    zip_hash = db.Column(db.Text, nullable=True, unique=True)
    forms = db.relationship("Form", backref="batch", lazy=True)

    def to_dict(self):
        loader = get_loader()
        return {
            "id": self.uuid,
            "total": self.total,
            "status": self.status.value,
            "plan": "BHCPFP",
            "state": "Ondo State",
            "lga_no": self.lga_no,
            "ward_no": self.ward_no,
            "facility_no": self.facility_no,
            "lga": (loader.reverse_lga or {})[str(self.lga_no)], 
            "ward": (loader.reverse_ward or {})[str(self.ward_no)],
            "facility":(loader.reverse_facility or {})[str(self.facility_no)],
            "submitted_at": (
                self.submitted_at.isoformat() if self.submitted_at else None
            ),
        }


class Form(db.Model):
    __tablename__ = "forms"

    UPDATABLE_FIELDS = {
        "title",
        "surname",
        "firstname",
        "othername",
        "dob",
        "settlement",
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
        "genotype",
        "occupation",
        "medical_history",
        "facility_no",
        "passport_path",
    }

    id = db.Column(db.Integer, primary_key=True)
    sequence = db.Column(db.Integer, index=True)
    uuid = db.Column(db.String, unique=True, default=lambda: str(uuid_tool.uuid4()))
    img_path = db.Column(db.Text, nullable=False)
    passport_path = db.Column(db.Text, nullable=True)
    nin = db.Column(db.String(11), nullable=True)
    surname = db.Column(db.String, nullable=True)
    firstname = db.Column(db.String, nullable=True)
    othername = db.Column(db.String, nullable=True)
    dob = db.Column(db.String, nullable=True)
    address = db.Column(db.Text, nullable=True)
    gender = db.Column(db.String(6), nullable=True)
    phone_number = db.Column(db.String, nullable=True)
    settlement = db.Column(db.String(5), nullable=True)
    category = db.Column(db.Integer, nullable=True)
    marital_status = db.Column(db.String(15), nullable=True)

    batch_id = db.Column(db.Integer, db.ForeignKey("batches.id"), nullable=False, index=True)
    # enrollee_number is returned from the HIS, useful if we add ID card generation
    enrollee_number = db.Column(db.String, nullable=True, index=True)
    genotype = db.Column(db.String(3), nullable=True)
    medical_history = db.Column(db.Text, nullable=True)

    # Sickle cell people are treated seperately, later we would add a way to identify them.
    # The HIS Site doesn't disaggregrate, but it allows a medical history list, we can pass sickle cell
    # also it allows genotype, we can send ss.
    # Hiv people are also treated specially, called (PLHIV - People living with HIV)
    # The HIS site does not treat it seperated, currently, after enrolling the data.
    # The staff retype hiv people details in a seperate google sheet
    # But again the HIS allows a medical history coluwn, we can add hiv to this, and avoid seperate storing
    # when we pull the data from the HIS, we filter by  medical history.
    # None of the genotype, medical are mandatory to fill by the HIS

    kin_firstname = db.Column(db.String, nullable=True)
    kin_othername = db.Column(db.String, nullable=True)
    kin_surname = db.Column(db.String, nullable=True)
    kin_relationship = db.Column(db.String, nullable=True)
    kin_phone_number = db.Column(db.String, nullable=True)
    kin_address = db.Column(db.String, nullable=True)
    lga_no = db.Column(db.Integer, nullable=True)
    ward_no = db.Column(db.Integer, nullable=True)
    facility_no = db.Column(db.Integer, nullable=True)
    occupation = db.Column(db.String, nullable=True)
    status = db.Column(db.Enum(FormStatus), default=FormStatus.PENDING)
    flagged = db.Column(db.Boolean, default=False, nullable=True)
    reason = db.Column(db.String, nullable=True)
    title = db.Column(db.String, nullable=True)
    error_message = db.Column(db.String, nullable=True)
    enrolled_at = db.Column(db.DateTime, default=None, nullable=True)

    passport_xmin = db.Column(db.Integer, nullable=True)
    passport_ymin = db.Column(db.Integer, nullable=True)
    passport_xmax = db.Column(db.Integer, nullable=True)
    passport_ymax = db.Column(db.Integer, nullable=True)
    updated_at = db.Column(
        db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    def to_dict(self):
        loader = get_loader()
        img_path = url_for(
            "enrollment.get_form_asset",
            asset_id=self.uuid,
            v=(int(self.updated_at.timestamp())),
        )
        if self.passport_path:
            passport_path = url_for(
                "enrollment.get_passport_asset",
                asset_id=self.uuid,
                v=int(self.updated_at.timestamp()),
            )
        else:
            passport_path = None
        return {
            "id": self.uuid,
            "sequence": self.sequence,
            "status": self.status.value,
            "img_path": img_path,
            "passport_path": passport_path,
            "reason": self.reason,
            "error_message": self.error_message,
            "title": self.title,
            "surname": self.surname,
            "firstname": self.firstname,
            "othername": self.othername,
            "dob": self.dob,
            "gender": self.gender,
            "phone_number": self.phone_number,
            "nin": self.nin,
            "address": self.address,
            "category": self.category,
            "marital_status": self.marital_status,
            "settlement": self.settlement,
            "lga": (loader.reverse_lga or {})[str(self.lga_no)], 
            "ward": (loader.reverse_ward or {})[str(self.ward_no)],
            "facility":(loader.reverse_facility or {})[str(self.facility_no)],
            "lga_no": self.lga_no,
            "ward_no": self.ward_no,
            "facility_no": self.facility_no,
            "genotype": self.genotype,
            "medical_history": self.medical_history,
            "flagged": self.flagged,
            "reason": self.reason,
            "occupation": self.occupation,
            "next_of_kin": {
                "firstname": self.kin_firstname,
                "surname": self.kin_surname,
                "othername": self.kin_othername,
                "relationship": self.kin_relationship,
                "phone_number": self.kin_phone_number,
                "address": self.kin_address,
            },
            "passport_coord": {
                "xmin": self.passport_xmin,
                "ymin": self.passport_ymin,
                "xmax": self.passport_xmax,
                "ymax": self.passport_ymax,
            },
        }
