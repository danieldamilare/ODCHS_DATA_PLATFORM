import re
from typing import List, Any, Dict, Type
from app import kv
from app.encounter.models import DiagnosisCache
from app import db
from redis.exceptions import LockError
import sqlalchemy as sa
from concurrent.futures import ThreadPoolExecutor, as_completed
from pydantic import BaseModel, Field, create_model, ConfigDict
from enum import Enum
from app.encounter.llm.client import load_encounterllm_client
from rapidfuzz import fuzz, process
import json
import traceback

CACHE_KEY = "encounter:diagnosis:cache"
CANONICAL_KEY = "encounter:diagnosis:canonical"
LOCK = "encounter:diagnosis:lock"


def load_diagnosis_lines() -> List[str]:
    stmt = sa.select(DiagnosisCache).where(DiagnosisCache.key == "global")
    res: DiagnosisCache = db.session.scalar(stmt)
    return res.canonical_diagnoses


def get_diagnosis_validator() -> Type[BaseModel]:
    current_diagnoses = load_diagnosis_lines()
    unique_diagnoses = sorted({d.strip() for d in current_diagnoses if d and d.strip()})

    if not unique_diagnoses:
        unique_diagnoses = ["OTHERS"]

    DiagnosisEnum = Enum(
        "DiagnosisEnum", {f"DIAG_{i}": d for i, d in enumerate(unique_diagnoses)}
    )

    DynamicDiagnosisItem = create_model(
        "DiagnosisItem",
        __config__=ConfigDict(extra="forbid"),
        id=(int, Field(description="The exact input index provided")),
        result=(
            List[DiagnosisEnum],
            Field(..., description="Matched canonical diagnoses from the allowed list"),
        ),
    )

    DynamicDiagnosisValidator = create_model(
        "DiagnosisValidator",
        __config__=ConfigDict(extra="forbid"),
        diagnoses=(
            List[DynamicDiagnosisItem],
            Field(description="List of classified diagnoses"),
        ),
    )

    return DynamicDiagnosisValidator


_SYSTEM_PROMPT = """
You are a medical diagnosis classifier. Your only job is to map raw diagnosis strings to canonical diagnoses.

INPUT FORMAT:
You will receive a JSON array of objects, each with an "id" and a "text" field:
[{"id": 0, "text": "HTN/MF"}, {"id": 1, "text": "MALARIA + SEPSIS"}]

OUTPUT FORMAT:
Return output matching the JSON schema provided:
{"diagnoses": [{"id": 0, "result": ["HYPERTENSION (HTN)", "MALARIA"]}, {"id": 1, "result": ["MALARIA", "SEPSIS"]}]}

STRICT RULES:
1. Every term in "result" must match an allowed value in the JSON schema enum.
2. If no match exists, use "OTHERS" — never invent a diagnosis name.
3. Your output "diagnoses" list MUST contain exactly one entry per input object, preserving each "id".
4. Do NOT reorder, skip, or merge entries — every input "id" must appear exactly once in the output.
5. No duplicate canonical terms within a single "result" list.
6. Return an empty list [] in "result" for blank or whitespace-only input text.

ABBREVIATION & CLINICAL SYNONYM MAP (Not exhaustive):
HTN, ESSENTIAL HYPERTENSION, HIGH BP → HYPERTENSION (HTN)
MF, MP, MALERIA, PUO, HEADACHE, FEVER, BODY HOTNESS → MALARIA
EF, E/F, ENTERIC, ENTERIC FEVER → TYPHOID FEVER
URTI, RTI, RHINITIS, COUGH, CATARRH, SORE THROAT → REP. TRAC. INFEC. (RTI)
PUD, PUDx, P.U.D, PEPTIC ULCER, DYSPEPSIA, EPIGASTRIC PAIN, GASTRITIS → ULCER
DM, HYPERGLYCEMIA, GLYCEMIC CONTROL, DIABETES MELLITUS → DIAB. MELLIT (DM)
RTA, ACCIDENT → R.T.A & OTHER ACC
PCV -> OTHERS
LOW PCV, ANAEMIA, ANEMIA → ANEMIA
SCD, HBSS → SICKLE CELL ANAEMIA
SPONDYLOSIS, OSTEOARTHRITIS, MYALGIA, BODY PAIN, WAIST PAIN, BACK PAIN, LOW BACK PAIN, NECK PAIN, LUMBAGO → ARTRITIS /RHEUMATISM
URINARY TRACT INFECTION, URINARY TRACT INFEC, UTI → UTI
CVD → C.V.D.
CCF → C. C. F.

COMPOUND STRINGS RULE:
- Deconstruct every symptom/condition in a phrase independently.
- If a phrase has multiple conditions (e.g. "EPIGASTRIC TENDERNESS + HTN"), extract ALL of them (e.g. ["ULCER", "HYPERTENSION (HTN)"]). Do not stop at just the first or most prominent one.
- Correct typo before matching the diagnosis

TYPOS & LOCAL SHORTHAND:
- "DYSPERSIA", "DYSPEPSIA", "EPIGASTRIC PAIN/TENDERNESS", "GASTRITIS" → ULCER
- "MARGRINE" → MIGRAINE
- "U R T", "URTI", "UPPER RESPIRATORY", "CATARRH", "CATTAH", "COUGH" → REP. TRAC. INFEC. (RTI)
- "NEUROMUSCULOSKELETAL PAIN", "BODY PAIN", "WAIST PAIN", "BACK PAIN" → ARTRITIS /RHEUMATISM

BEFORE RESPONDING, VERIFY:
1. Output contains exactly one entry per input "id".
2. No "id" is duplicated or missing.
3. Every term in "result" strictly matches the schema enum values.
"""


def clean_diagnosis(diagnosis: str):
    diagnosis = str(diagnosis)
    return (
        " ".join(x for x in re.sub(r"[^A-Za-z]", " ", diagnosis).split(" ") if x)
    ).upper()


def warm_diagnosis_cache(force_refresh: bool = False) -> bool:
    """Populate Redis cache from PostgreSQL. Can be called via CLI or lazily."""
    try:
        with kv.lock(LOCK, timeout=15, blocking_timeout=5):
            if not force_refresh and kv.exists(CACHE_KEY):
                return True
            stmt = sa.select(DiagnosisCache).where(DiagnosisCache.key == "global")
            result = db.session.scalar(stmt)
            if not result:
                return False

            formatted_cache = {
                k: json.dumps([v] if isinstance(v, str) else v)
                for k, v in (result.cache or {}).items()
            }

            if force_refresh:
                kv.delete(CACHE_KEY, CANONICAL_KEY)

            if formatted_cache:
                kv.hset(CACHE_KEY, mapping=formatted_cache)
            if result.canonical_diagnoses:
                mapping = {clean_diagnosis(k): k for k in result.canonical_diagnoses}
                kv.hset(CANONICAL_KEY, mapping=mapping)

            return True
    except LockError:
        return bool(kv.exists(CACHE_KEY))
    except Exception:
        return False


def serialize_from_redis_cache():
    lookup_cache = kv.hgetall(CACHE_KEY)
    for k, v in lookup_cache.items():
        lookup_cache[k] = json.loads(v)
    return lookup_cache


def _fuzzy_snap(term: str, canonicals: Dict[str, Any]) -> str:
    term_cleaned = clean_diagnosis(term)
    if term_cleaned in canonicals:
        return canonicals[term_cleaned]
    result = process.extractOne(
        term_cleaned, list(canonicals.keys()), scorer=fuzz.token_set_ratio
    )

    if result is None:
        return "OTHERS"

    match, score, _ = result
    if score >= 80:
        return canonicals[match]
    print("Can't found a fuzzy match for: ", term, "returning others...")
    return "OTHERS"


def _fuzzy_snap_list(terms: List[str], canonicals: Dict[str, Any]) -> List[str]:
    snapped = [_fuzzy_snap(t, canonicals) for t in terms if t and t.strip()]
    return snapped


def _classify_diagnosis(
    diagnosis_list: List[str], DiagnosisValidator: type[BaseModel]
) -> List[List[str]]:
    indexed = [{"id": i, "text": t} for i, t in enumerate(diagnosis_list)]
    client = load_encounterllm_client()
    response_format = {
        "type": "json_schema",
        "json_schema": {
            "name": "DiagnosisValidator",
            "strict": True,
            "schema": DiagnosisValidator.model_json_schema(),
        },
    }
    length = len(diagnosis_list)

    def diagnosis_validator(result: str) -> Any:
        response = DiagnosisValidator.model_validate_json(result)
        diagnoses = response.diagnoses
        id_result = {}
        for diagnosis in diagnoses:
            if diagnosis.id in id_result:
                raise ValueError(f"Duplicate id {diagnosis.id} in response")
            id_result[diagnosis.id] = [diag.value for diag in diagnosis.result]

        if len(id_result.keys()) != length:
            raise ValueError("Length Mismatch")
        return [id_result[i] for i in range(length)]

    prompt = (
        f"Classify these {length} diagnoses: {json.dumps(indexed)}\n"
        f"Return output matching the provided JSON schema explicitly"
    )
    return client.send_request(
        prompt=prompt,
        system_prompt=_SYSTEM_PROMPT,
        response_format=response_format,
        validator_callback=diagnosis_validator,
    )


def classify_diagnosis(diagnosis: List[str], batch_size: int = 10):
    if not diagnosis:
        return []
    if not kv.exists(CACHE_KEY):
        warm_diagnosis_cache()
    cache = serialize_from_redis_cache()
    canonicals = kv.hgetall(CANONICAL_KEY)

    values_to_search = list(
        {x for x in diagnosis if not cache.get(clean_diagnosis(x), "")}
    )
    batches = [
        values_to_search[i : i + batch_size]
        for i in range(0, len(values_to_search), batch_size)
    ]
    new_cache_entries: Dict[str, str] = {}
    diagnosis_validator = get_diagnosis_validator()
    if batches:
        with ThreadPoolExecutor(max_workers=min(20, len(batches))) as executor:
            futures = {
                executor.submit(_classify_diagnosis, batch, diagnosis_validator): batch
                for batch in batches
            }
            for future in as_completed(futures):
                batch = futures[future]
                try:
                    classified = future.result()
                    if classified:
                        for raw, proc in zip(batch, classified):
                            # print(raw, proc)
                            cleaned = clean_diagnosis(raw)
                            cache[cleaned] = _fuzzy_snap_list(proc, canonicals)
                            new_cache_entries[cleaned] = json.dumps(cache[cleaned])
                except Exception:
                    traceback.print_exc()
            if new_cache_entries:
                kv.hset(CACHE_KEY, mapping=new_cache_entries)

    total_classified = [
        cache.get(clean_diagnosis(raw), ["OTHERS"]) for raw in diagnosis
    ]
    return total_classified
