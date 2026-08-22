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
        return {
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
