from app.enrollment.session import get_his_session
import time
from typing import Dict, Tuple, Optional
from dataclasses import dataclass

BASE = "https://odchc-his.org/administrator/functions"


@dataclass
class HisEnrolleeResult:
    success: bool
    msg: str
    payload: Optional[Dict]


def create_enrolle(data: Dict):
    print("Creating enrollee in create_enrollee")

    json_form = {
        "cooperateCode": "",
        "title": data["title"],
        "surname": data["surname"].title(),
        "othername": data["first_name"].title(),
        "middleName": data["other_name"].title(),
        "mobileNo": data["phone_number"],
        "mobileNo1": "",
        "emailAddress": "",
        "emailAddress1": "",
        "dob_MM_dd_yyyy": data["dob"],
        "address": data["address"].title(),
        "state_id": data["state_id"],
        "city_id": data["lga"],
        "picture_base64String": data["b64_passport"],
        "maritalStatus": data["marital_status"],
        "religion": None,
        "nationality": None,
        "ORIN": "",
        "plan_id": data["plan_id"],
        "tribe": None,
        "height": 0,
        "weight": 0,
        "bloodPressure": 0,
        "gender": data["gender"],
        "citizenCategoryCode": data["category"],
        "ageOfPregnancy": 0,
        "numberPreviousPreg": 0,
        "CaesareanHistory": "",
        "organization": "",
        "jobtitle": "",
        "bloodGroup": None,
        "Genotype": None,
        "category": "",
        "MDALGA": "",
        "present_lga": "",
        "government_id": "",
        "stateCode": "",
        "cadre": "",
        "gradeLevel": "",
        "firstAppointmentDate": "",
        "retirementDate": "",
        "originState": "Ondo",
        "originLGA": data["origin_lga"].title(),
        "ward_id": data["ward"],
        "provider_id": data["facility"],
        "occupation": None,
        "surgicalHistory": "",
        "levelOfEducation": None,
        "NIIN": data["nin"],
        "settlement": data["settlement"],
        "medicalHistory": [],
        "spoumedicalHistory": [],
        "childmedicalHistory_0": [],
        "childmedicalHistory_1": [],
        "childmedicalHistory_2": [],
        "childmedicalHistory_3": [],
        "nextOfKins": [
            {
                "firstname": data["next_of_kin"]["first_name"],
                "surname": data["next_of_kin"]["surname"],
                "otherName": data["next_of_kin"]["other_name"],
                "relationsipType": data["next_of_kin"]["relationship"],
                "mobileNo": data["next_of_kin"]["phone_number"],
                "contactAddress": data["next_of_kin"]["address"],
                "state": "Ondo",
                "city": data["origin_lga"].title(),
            }
        ],
        "spouses": [
            {
                "spouse_id": 0,
                "enrollee_id": 0,
                "surname": "",
                "firstName": "",
                "dob_MM_dd_yyyy": "",
                "pictureBase64String": "",
                "mobileNo": "",
                "Type_of_Study": "",
                "Department": "",
                "Course_of_Study": "",
                "Matriculation_number": "",
                "Year_of_Study": "",
                "Total_years_of_study": "",
                "present_lga": "",
                "maritalStatus": data["marital_status"],
                "religion": None,
                "tribe": None,
                "plan_id": "1",
                "latitude": 0,
                "longitude": 0,
                "nationality": None,
                "state_id": data["state_id"],
                "city_id": data["lga"],
                "provider_id": None,
                "height": 0,
                "weight": 0,
                "bloodPressure": "",
                "citizenCategoryCode": 0,
                "originState": "State of Origin",
                "originLGA": "LGA of Origin",
                "ward_id": data["ward"],
                "occupation": None,
                "NIIN": "",
                "settlement": "",
                "organization": "",
                "jobtitle": "",
                "category": "",
                "MDALGA": "",
                "government_id": "",
                "stateCode": "",
                "cadre": "",
                "gradeLevel": "",
                "firstAppointmentDate": "",
                "retirementDate": "",
                "bloodGroup": "",
                "Genotype": "",
                "ORIN": "",
                "association": "",
                "surgicalHistory": "",
                "levelOfEducation": None,
                "university": "",
            }
        ],
        "children": [],
    }
    url = f"{BASE}?createEnrollee"
    session = get_his_session()
    res = session.post(url, json=json_form, timeout=40)
    print("Gotten message from server", res.text)

    if res.status_code != 200:
        return HisEnrolleeResult(
            False, f"HTTP {res.status_code}: {res.text[:300]}", None
        )

    try:
        res_json = res.json()
    except ValueError:
        return HisEnrolleeResult(False, f"Non-JSON response: {res.text[:300]}", None)

    if not res_json.get("success", False):
        return HisEnrolleeResult(
            False, res_json.get("errorMsg", "Unknown error"), res_json
        )
    return HisEnrolleeResult(True, res_json.get("message"), res_json)


def create_enrolle_with_retry(payload: Dict, max_retries: int = 3) -> HisEnrolleeResult:
    last_result = HisEnrolleeResult(False, "", None)
    for attempt in range(max_retries + 1):
        result = create_enrolle(payload)
        if result.success == True or "already exist" in (result.msg or "").lower():
            result.success = True
            return result
        last_result = result
        if attempt < max_retries:
            time.sleep(3)
    return last_result
