from app.encounter import encounter_bp
from flask.cli import with_appcontext
from flask import current_app
from app.encounter.disease_classifier import clean_diagnosis
import os
from app import db
from app.encounter.models import DiagnosisCache
from app.encounter.disease_classifier import warm_diagnosis_cache
import sqlalchemy as sa

lookup_cache = {
    "HTN": [ "HYPERTENSION (HTN)" ],
    "MF": [ "MALARIA" ],
    "MP": [ "MALARIA" ],
    "EF": [ "TYPHOID FEVER" ],
    "URTI": [ "REP. TRAC. INFEC. (RTI)" ],
    "ENTERITIS": [ "TYPHOID FEVER" ],
    "ENTERIC": [ "TYPHOID FEVER" ],
    "HEADACHE": [ "MIGRAINE" ],
    "DEHYDRATION": [ "OTHERS" ],
    "PYELONEPHRITIS": [ "NEPHRITIS & OTHER KIDNEY DIS." ],
    "RTI": [ "REP. TRAC. INFEC. (RTI)" ],
    "SPONDYLOSIS": [ "ARTRITIS /RHEUMATISM" ],
    "OSTEOARTHRITIS": [ "ARTRITIS /RHEUMATISM" ],
    "PUO": [ "MALARIA" ],
    "PUD": [ "ULCER" ],
    "SCD": [ "SICKLE CELL ANAEMIA" ],
    "HBSS":[  "SICKLE CELL ANAEMIA" ],
    "RTA": [ "R.T.A & OTHER ACC" ],
    "DM": [ "DIAB. MELLIT (DM)" ],
    "PYREXIA": [ "MALARIA" ],
    "DYSPEPSIA":[  "ULCER" ],
    "INSOMNIA": [ "ANXIETY" ],
    "NEUROPATHY": [ "OTHERS" ],
    "DERMATITIS": [ "DERMATITIS & OTHER SKIN DIS." ],
    "MALARIA FEVER": [ "MALARIA" ],
    "PLASMODIASIS": [ "MALARIA" ],
    "MYALGIA": [ "ARTRITIS /RHEUMATISM" ],
    "ARTHRALGIA": [ "ARTRITIS /RHEUMATISM" ],
    "PHARYNGITIS": [ "REP. TRAC. INFEC. (RTI)" ],
    "ARI": [ "REP. TRAC. INFEC. (RTI)" ],
    "GASTRITIS": [ "GASTRO ENT." ],
    "GASTROENTERITIS": [ "GASTRO ENT." ],
    "STRESS": [ "ANXIETY" ],
    "STRESS DISORDER": [ "ANXIETY" ],
    "VAGINITIS": [ "OTHERS" ],
    "PREGNANCY": [ "CYESIS" ],
    "NOMAL DEL": [ "NOMAL DEL." ],
    "S Delivery": [ "NOMAL DEL." ],
}


@encounter_bp.cli.command("load-diagnosis")
@with_appcontext
def load_diagnosis():
    file_path = current_app.config["DIAGNOSIS_FILE_PATH"]

    if not file_path or not os.path.exists(file_path):
        print(f"Error: Diagnosis file not found at '{file_path}'")
        return

    with open(file_path, "r", encoding="utf-8") as f:
        master_diagnosis_list = [
            line.strip().upper() for line in f if line.strip()
        ]

    diagnosis_mapping = {
        clean_diagnosis(diag): [diag] for diag in master_diagnosis_list
    }
    diagnosis = master_diagnosis_list
    lookup_cache.update(diagnosis_mapping)
    cache_record = db.session.scalar(sa.select(DiagnosisCache).where(DiagnosisCache.key=='global'))

    if not cache_record:
        cache_record = DiagnosisCache(canonical_diagnoses=diagnosis, cache=lookup_cache, key="global")
        db.session.add(cache_record)
    else:
        cache_record.canonical_diagnoses = diagnosis
        updated_cache =  dict(cache_record.cache or {})
        updated_cache.update(diagnosis_mapping)
        cache_record.cache = updated_cache
        db.session.add(cache_record)
    db.session.commit()
    print(f"successfully loaded {len(lookup_cache)} cache into the database")


@encounter_bp.cli.command("warm-cache")
@with_appcontext
def warm_cache():
    if warm_diagnosis_cache(force_refresh=True):
        print("Redis cache successfully warmed from database.")
    else:
        print("Failed to warm Redis cache. Check DB connection.")
