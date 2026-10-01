from app.enrollment.session import get_his_session
from typing import Dict, Optional, Any, List
from dateutil import parser, relativedelta

from dataclasses import dataclass
import requests
from tenacity import (
    retry,
    stop_after_attempt,
    retry_if_exception_type,
    wait_exponential,
)
from enum import Enum, auto
import base64
from mimetypes import guess_type
from datetime import datetime


BASE = "https://odchc-his.org/administrator/functions"


@dataclass
class HISIdCardResult:
    success: bool
    msg: str
    payload: Optional[Dict] = None


class HISEnrollStatus(Enum):
    CREATED = auto()
    ALREADY_EXISTS = auto()
    FAILED = auto()


@dataclass
class HISEnrollResult:
    status: HISEnrollStatus
    message: str
    payload: dict | None = None

    @property
    def success(self):
        return self.status in (
            HISEnrollStatus.CREATED,
            HISEnrollStatus.ALREADY_EXISTS,
        )


@dataclass
class HISEnrolleeDetails:
    disabled: bool
    enrollee_type: str
    policy_number: str
    facility: str
    ward: str
    lga: str
    surname: str
    firstname: str
    othername: str
    dob: Optional[datetime]
    gender: str

    @property
    def age(self) -> Optional[int]:
        if not self.dob:
            return None
        diff = relativedelta.relativedelta(datetime.now(), self.dob)
        return diff.years

    @classmethod
    def _parse_dob(cls, dob_str: Optional[str]) -> Optional[datetime]:
        if not dob_str:
            return None
        try:
            return parser.parse(dob_str)
        except Exception:
            return None

    @classmethod
    def from_dict(cls, item: Dict[str, Any]) -> "HISEnrolleeDetails":
        """Factory method to convert a single item from coop_Enrollee into the dataclass."""
        return cls(
            disabled=bool(item.get("disabled", False)),
            enrollee_type=item.get("enrollee_type", ""),
            policy_number=item.get("enrolleeNo", ""),
            facility=item.get("providerName", ""),
            ward=item.get("ward", ""),
            lga=item.get("city", ""),  
            surname=item.get("surname", ""),
            firstname=item.get("middleName", "").strip(),  
            othername=item.get("othername", ""),
            dob=cls._parse_dob(item.get("dob_MM_dd_yyyy")),
            gender=item.get("gender", ""),
        )

    @classmethod
    def from_response(cls, response_json: Dict[str, Any]) -> List["HISEnrolleeDetails"]:
        """Parses the entire response payload and returns a list of HISEnrolleeDetails."""
        records = response_json.get("coop_Enrollee", [])
        return [cls.from_dict(item) for item in records]


class HISClient:
    def __init__(self, base_url=BASE):
        self.session = get_his_session()
        self.base_url = base_url

    @retry(
        stop=stop_after_attempt(4),
        wait=wait_exponential(1, 3, 10),
        retry=retry_if_exception_type(IOError),
        reraise=True,
    )
    def _execute_post(
        self,
        endpoint: Optional[str] = None,
        param: Optional[Dict] = None,
        json_data: Optional[Dict] = None,
    ) -> Dict[str, Any]:

        url = self.base_url
        if endpoint:
            url = f"{self.base_url}?{endpoint}"
        try:
            if json_data is not None:
                res = self.session.post(url, json=json_data)
            else:
                res = self.session.post(url, data=param)
        except requests.RequestException:
            raise IOError("Error communication to his site")

        if not res.ok:
            raise IOError(
                f"HIS return a non 2xx status code :{res.status_code} Text: {res.text[:300]}"
            )
        try:
            return res.json()
        except ValueError:
            raise ValueError(f"HIS returned malformed non-JSON data {res.text[:300]}")

    @retry(
        stop=stop_after_attempt(4),
        wait=wait_exponential(1, 3, 10),
        retry=retry_if_exception_type(IOError),
        reraise=True,
    )
    def _execute_get(
        self, endpoint: Optional[str] = None, param: Optional[Dict] = None
    ) -> Dict[str, Any]:
        url = self.base_url
        if endpoint:
            url = f"{self.base_url}?{endpoint}"

        try:
            res = self.session.get(url, params=param)
        except requests.RequestException:
            raise IOError("Error communication to his site")

        if not res.ok:
            raise IOError(
                f"HIS return a non 2xx status code: {res.status_code} Text: {res.text[:300]}"
            )

        try:
            return res.json()
        except ValueError:
            raise ValueError(f"HIS return a malformed non-JSON data: {res.text[:300]}")

    def create_enrollee(self, data: Dict[str, Any]):
        payload = self._build_payload(data)

        try:
            res_json = self._execute_post("createEnrollee", json_data=payload)
        except ValueError as e:
            return HISEnrollResult(HISEnrollStatus.FAILED, str(e))
        except Exception as e:
            return HISEnrollResult(
                HISEnrollStatus.FAILED,
                f"Failed after maximum network retries: {str(e)}",
            )

        success = res_json.get("success", False)
        err_msg = res_json.get("errorMsg", "Unknown error")
        msg = res_json.get("message", "Successfully enrolled")

        if success:
            return HISEnrollResult(HISEnrollStatus.CREATED, msg, res_json)
        elif "exist" in err_msg.lower():
            return HISEnrollResult(HISEnrollStatus.ALREADY_EXISTS, err_msg, res_json)
        else:
            return HISEnrollResult(HISEnrollStatus.FAILED, err_msg, res_json)

    @retry(
        stop=stop_after_attempt(4),
        wait=wait_exponential(1, 3, 10),
        retry=retry_if_exception_type(IOError),
        reraise=True,
    )
    def _fetch_passport_bytes(self, passport_url: str) -> bytes:
        try:
            res = self.session.get(passport_url, timeout=30)
        except requests.RequestException as e:
            raise IOError(f"Error fetching passport image: {e}") from e
        if not res.ok:
            raise IOError(f"Passport fetch returned non-2xx status {res.status_code}")
        return res.content

    def fetch_passport(self, passport_url: str) -> str:
        if not passport_url:
            return ""
        try:
            content = self._fetch_passport_bytes(passport_url)
        except Exception:
            return ""
        encoded = base64.b64encode(content).decode("utf-8")
        mime_type, _ = guess_type(passport_url)
        return f"data:{mime_type or 'application/octet-stream'};base64,{encoded}"

    def fetch_id_details_from_his(self, enrollee_no: str):
        if not enrollee_no:
            return HISIdCardResult(False, "Empty enrollee id")
        try:
            res_json = self._execute_get("", param={"getIDCardInfo": enrollee_no})
        except ValueError as e:
            return HISIdCardResult(False, str(e))
        except Exception as e:
            return HISIdCardResult(False, str(e))
        if not res_json.get("success", False):
            return HISIdCardResult(False, res_json.get("errorMsg", "Unknown error"))
        res_json["passport_b64"] = self.fetch_passport(res_json.get("pixUrl", ""))
        return HISIdCardResult(
            True, res_json.get("message", "Successful got his_data"), res_json
        )

    def _build_payload(self, data: Dict[str, Any]):
        dependants_data = data.get("dependants") or []
        marital_status = str(data.get("marital_status") or "Single").strip()
        is_married = marital_status.lower() == "married"

        spouse_dpd = None
        children_dpds = []

        if is_married:
            for dpd in dependants_data:
                if dpd.get("is_spouse") and spouse_dpd is None:
                    spouse_dpd = dpd
                else:
                    children_dpds.append(dpd)
        else:
            children_dpds = list(dependants_data)

        # Build spouse array
        spouses = []
        if spouse_dpd:
            full_name = (spouse_dpd.get("name") or "").strip()
            name_parts = full_name.split(" ", 1)
            first_name = name_parts[0] if name_parts else ""
            surname = name_parts[1] if len(name_parts) > 1 else (data.get("surname") or "")
            dob_val = spouse_dpd.get("dob") or ""
            try:
                if dob_val:
                    from dateutil import parser
                    dob_formatted = parser.parse(dob_val).strftime("%m-%d-%Y")
                else:
                    dob_formatted = ""
            except Exception:
                dob_formatted = dob_val

            spouses.append({
                "Course_of_Study": "",
                "Department": "",
                "Genotype": "",
                "MDALGA": "",
                "Matriculation_number": "",
                "NIIN": "",
                "ORIN": "",
                "Total_years_of_study": "",
                "Type_of_Study": "",
                "Year_of_Study": "",
                "association": "",
                "birthCerticateBase64String": "",
                "bloodGroup": "",
                "bloodPressure": "",
                "cadre": "",
                "category": "",
                "spouse_id": 0,
                "enrollee_id": 0,
                "citizenCategoryCode": 0,
                "city_id": str(spouse_dpd.get("lga_no") or data.get("city_id") or data.get("lga") or "794"),
                "dob_MM_dd_yyyy": dob_formatted,
                "firstAppointmentDate": "",
                "firstName": first_name.title() if first_name else "",
                "gender": spouse_dpd.get("gender") or "Female",
                "government_id": "",
                "gradeLevel": "",
                "height": 0,
                "jobtitle": "",
                "latitude": 0,
                "levelOfEducation": "",
                "longitude": 0,
                "maritalStatus": "Married",
                "mobileNo": spouse_dpd.get("phone_number") or data.get("phone_number") or "",
                "nationality": "",
                "occupation": "",
                "organization": "",
                "originLGA": "-select lga-",
                "originState": "Ondo",
                "pictureBase64String": spouse_dpd.get("b64_passport") or "",
                "plan_id": str(data.get("plan_id") or "5"),
                "present_lga": "",
                "provider_id": str(spouse_dpd.get("facility_no") or data.get("facility") or data.get("provider_id") or ""),
                "religion": "",
                "retirementDate": "",
                "settlement": "",
                "stateCode": "",
                "state_id": str(data.get("state_id") or "29"),
                "surgicalHistory": "",
                "surname": surname.title() if surname else "",
                "tribe": "",
                "university": "",
                "ward_id": None,
                "weight": 0,
            })

        # Build children array
        children = []
        for child_dpd in children_dpds:
            full_name = (child_dpd.get("name") or "").strip()
            name_parts = full_name.split(" ", 1)
            first_name = name_parts[0] if name_parts else ""
            surname = name_parts[1] if len(name_parts) > 1 else (data.get("surname") or "")
            dob_val = child_dpd.get("dob") or ""
            try:
                if dob_val:
                    from dateutil import parser
                    dob_formatted = parser.parse(dob_val).strftime("%m-%d-%Y")
                else:
                    dob_formatted = ""
            except Exception:
                dob_formatted = dob_val

            child_dict = {
                "Course_of_Study": "",
                "Department": "",
                "Genotype": "",
                "MDALGA": "",
                "Matriculation_number": "",
                "NIIN": "",
                "ORIN": "",
                "Total_years_of_study": "",
                "Type_of_Study": "",
                "Year_of_Study": "",
                "association": "",
                "birthCerticateBase64String": "",
                "bloodGroup": "",
                "bloodPressure": "",
                "cadre": "",
                "category": "",
                "child_id": 0,
                "citizenCategoryCode": 0,
                "city_id": str(child_dpd.get("lga_no") or data.get("city_id") or data.get("lga") or "794"),
                "dob_MM_dd_yyyy": dob_formatted,
                "enrollee_id": 0,
                "firstAppointmentDate": "",
                "firstName": first_name.title() if first_name else "",
                "gender": child_dpd.get("gender") or "Male",
                "government_id": "",
                "gradeLevel": "",
                "height": 0,
                "jobtitle": "",
                "latitude": 0,
                "levelOfEducation": "",
                "longitude": 0,
                "maritalStatus": "Single",
                "mobileNo": child_dpd.get("phone_number") or data.get("phone_number") or "",
                "nationality": "",
                "occupation": "",
                "organization": "",
                "originLGA": "-select lga-",
                "originState": "Ondo",
                "pictureBase64String": child_dpd.get("b64_passport") or "",
                "plan_id": str(data.get("plan_id") or "5"),
                "present_lga": "",
                "provider_id": str(child_dpd.get("facility_no") or data.get("facility") or data.get("provider_id") or ""),
                "religion": "",
                "retirementDate": "",
                "settlement": "",
                "stateCode": "",
                "state_id": str(data.get("state_id") or "29"),
                "surgicalHistory": "",
                "surname": surname.title() if surname else "",
                "tribe": "",
                "university": "",
                "ward_id": None,
                "weight": 0,
            }
            children.append(child_dict)

        child_med_0 = []
        child_med_1 = []
        child_med_2 = []
        child_med_3 = []
        for i, ch_dpd in enumerate(children_dpds[:4]):
            if ch_dpd.get("medical_history"):
                med_item = [{"illness": ch_dpd.get("medical_history")}]
                if i == 0:
                    child_med_0 = med_item
                elif i == 1:
                    child_med_1 = med_item
                elif i == 2:
                    child_med_2 = med_item
                elif i == 3:
                    child_med_3 = med_item

        spouse_med = []
        if spouse_dpd and spouse_dpd.get("medical_history"):
            spouse_med = [{"illness": spouse_dpd.get("medical_history")}]

        return {
            "cooperateCode": "",
            "title": data.get("title", ""),
            "surname": (data.get("surname") or "").title(),
            "othername": (data.get("first_name") or "").title(),
            "middleName": (data.get("other_name") or "").title(),
            "mobileNo": data.get("phone_number", ""),
            "mobileNo1": "",
            "emailAddress": "",
            "emailAddress1": "",
            "dob_MM_dd_yyyy": data.get("dob", ""),
            "address": (data.get("address") or "").title(),
            "state_id": str(data.get("state_id", "29")),
            "city_id": str(data.get("lga", "")),
            "picture_base64String": data.get("b64_passport", ""),
            "maritalStatus": data.get("marital_status", "Single"),
            "religion": None,
            "nationality": None,
            "ORIN": "",
            "plan_id": str(data.get("plan_id", "1")),
            "tribe": None,
            "height": 0,
            "weight": 0,
            "bloodPressure": 0,
            "gender": data.get("gender", "Male"),
            "citizenCategoryCode": data.get("category") or 0,
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
            "government_id": data.get("employment_id", ""),
            "stateCode": "",
            "cadre": "",
            "gradeLevel": "",
            "firstAppointmentDate": "",
            "retirementDate": "",
            "originState": "Ondo",
            "originLGA": (data.get("origin_lga") or "").title(),
            "ward_id": data.get("ward"),
            "provider_id": str(data.get("facility") or ""),
            "occupation": None,
            "surgicalHistory": "",
            "levelOfEducation": None,
            "NIIN": data.get("nin", ""),
            "settlement": data.get("settlement", ""),
            "medicalHistory": [],
            "spoumedicalHistory": spouse_med,
            "childmedicalHistory_0": child_med_0,
            "childmedicalHistory_1": child_med_1,
            "childmedicalHistory_2": child_med_2,
            "childmedicalHistory_3": child_med_3,
            "nextOfKins": [
                {
                    "firstname": (data.get("next_of_kin") or {}).get("first_name", ""),
                    "surname": (data.get("next_of_kin") or {}).get("surname", ""),
                    "otherName": (data.get("next_of_kin") or {}).get("other_name", ""),
                    "relationsipType": (data.get("next_of_kin") or {}).get("relationship", ""),
                    "mobileNo": (data.get("next_of_kin") or {}).get("phone_number", ""),
                    "contactAddress": (data.get("next_of_kin") or {}).get("address", ""),
                    "state": "Ondo",
                    "city": (data.get("origin_lga") or "").title(),
                }
            ],
            "spouses": spouses,
            "children": children,
        }


    def fetch_enrollee_details(self, policy_number: str):
        original_policy_number = policy_number
        policy_number = policy_number[-1] + "0"
        params = {
            "getBeneficiariesDepend": "",
            "startDate": "",
            "endDate": "",
            "planType": "",
            "lga": "",
            "ward": "",
            "provider_id": "",
            "status": "active",
            "scname": policy_number,
        }
        try:
            result = self._execute_get(param=params)
            list_dict = HISEnrolleeDetails.from_response(result)
            for obj in list_dict:
                if obj.policy_number == original_policy_number:
                    return obj
            return None
        except Exception:
            return None
