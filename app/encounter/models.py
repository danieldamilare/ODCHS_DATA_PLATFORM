from app import db
from sqlalchemy import JSON
from sqlalchemy.ext.mutable import MutableDict, MutableList


class DiagnosisCache(db.Model):
    __tablename__ = "diagnosis_cache"

    id = db.Column(db.Integer, primary_key=True)
    canonical_diagnoses = db.Column(MutableList.as_mutable(JSON), default=list)
    cache = db.Column(MutableDict.as_mutable(JSON), default=dict)
    key = db.Column(db.String, unique=True, default="global")