import json
from app.enrollment.session import get_his_session
from app import kv
from typing import Optional, Dict
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://odchc-his.org/administrator/functions"


class DataLoader:
    state_code = 29
    titles = {"Mr": 3, "Mrs": 4, "Miss": 2}
    plan_id = 1  # BHCPF hardcoded
    STABLE_TTL = 100 * 60 * 60 * 24
    VOLATILE_TTL = 10 * 60 * 60 * 24
    plans = {}
    plan_id = {"SUNSHIS": 4, "ORANGHIS": 5, "BHCPFP": 1}

    def __init__(self):
        self.citizen_types: Optional[Dict] = None
        self.lgas: Optional[Dict] = None
        self.wards: Optional[Dict] = None
        self.facilities: Optional[Dict] = None
        self._all_facilities: Optional[Dict] = None
        self._all_reverse_facilities: Optional[Dict] = None
        # notice the his route uses raw string as Marital status so this is dead code
        # self.marital_status: Optional[Dict] = None
        self.reverse_lga: Optional[Dict] = None
        self.reverse_ward: Optional[Dict] = None
        self.reverse_facility: Optional[Dict] = None
        self.session = get_his_session()

    def load_all(self):
        """Safely loads all mappings, ensuring internal data availability."""
        self.load_citizen_types()
        # self.load_marital_status()
        self.load_lgas()
        self.load_wards()
        self.load_facilities()

    def get_plan_id(self, scheme) -> int:
        if scheme is None:
            return 1
        key = scheme.name if hasattr(scheme, "name") else str(scheme).upper()
        return self.plan_id.get(key, 1)
    
    def _fetch_facilities_for_plan(self, plan_id: int = 1):
        cached = kv.get(f"loader:facilities:{plan_id}")
        rev_cached = kv.get(f"loader:reverse_facilities:{plan_id}")
        if cached and rev_cached:
            return json.loads(cached), json.loads(rev_cached)

        res = self.session.get(f"{BASE}?getProvidersByWard=0&planid={plan_id}").json()
        providers = res.get("providers", [])

        fac_map = {}
        rev_fac_map = {}

        is_bhcpf = str(plan_id) == "1"

        for p in providers:
            key = p["providerName"].upper().strip()
            lga_name = (p.get("city") or "").upper().strip()

            if is_bhcpf:
                if not self.lgas or lga_name not in self.lgas:
                    continue
                lga_code = str(self.lgas[lga_name])
                ward_name = (p.get("ward") or "").upper().strip()

                if not self.wards or lga_code not in self.wards or ward_name not in self.wards[lga_code]:
                    continue

                ward_code = str(self.wards[lga_code][ward_name])
                fac_map.setdefault(ward_code, {})[key] = int(p["provider_id"])
            else:
                lga_code = None
                if self.lgas and lga_name in self.lgas:
                    lga_code = str(self.lgas[lga_name])
                elif self.lgas:
                    for lname, lcode in self.lgas.items():
                        if lname in lga_name or lga_name in lname:
                            lga_code = str(lcode)
                            break
                if lga_code:
                    fac_map.setdefault(lga_code, {})[key] = int(p["provider_id"])

            rev_fac_map[str(p["provider_id"])] = key

        kv.setex(f"loader:facilities:{plan_id}", self.VOLATILE_TTL, json.dumps(fac_map))
        kv.setex(f"loader:reverse_facilities:{plan_id}", self.VOLATILE_TTL, json.dumps(rev_fac_map))
        return fac_map, rev_fac_map

    def load_marital_status(self):

        cached = kv.get("loader:marital_status")
        if cached:
            self.marital_status = json.loads(cached)
            return

        res = self.session.get(f"{BASE}?listMStatus").json()
        marital_status = {
            dec["narration"].upper().strip(): int(dec["code"]) for dec in res["data"]
        }
        kv.setex("loader:marital_status", self.STABLE_TTL, json.dumps(marital_status))
        self.marital_status = marital_status


    def load_citizen_types(self):

        cached = kv.get("loader:citizen_types")
        if cached:
            self.citizen_types = json.loads(cached)
            return

        res = self.session.get(f"{BASE}?listCitiz").json()
        self.citizen_types = {
            d["narration"].upper().strip(): int(d["code"]) for d in res["data"]
        }
        kv.setex(
            "loader:citizen_types", self.STABLE_TTL, json.dumps(self.citizen_types)
        )


    def load_lgas(self):

        cached_lgas = kv.get("loader:lgas")
        cached_reverse = kv.get("loader:reverse_lga")

        if cached_lgas and cached_reverse:
            self.lgas = json.loads(cached_lgas)
            self.reverse_lga = json.loads(cached_reverse)
            return

        res = self.session.get(f"{BASE}?listCities={self.state_code}").json()
        self.lgas = {
            d["cityName"].upper().strip(): int(d["cityCode"]) for d in res["cities"]
        }
        self.reverse_lga = {v: k for k, v in self.lgas.items()}

        kv.setex("loader:lgas", self.STABLE_TTL, json.dumps(self.lgas))
        kv.setex("loader:reverse_lga", self.STABLE_TTL, json.dumps(self.reverse_lga))

    def _load_wards(self, lga_code):
        return self.session.get(f"{BASE}?listWard={lga_code}").json()

    def load_wards(self):

        cached_wards = kv.get("loader:wards")
        cached_reverse = kv.get("loader:reverse_ward")

        if cached_wards and cached_reverse:
            self.wards = json.loads(cached_wards)
            self.reverse_ward = json.loads(cached_reverse)
            return

        if self.lgas is None:
            self.load_lgas()

        self.wards = {}
        self.reverse_ward = {}
        count = min(20, len(self.lgas or {}))  # 20 workers since they are i/o
        with ThreadPoolExecutor(max_workers=count) as executor:
            results = {
                executor.submit(self._load_wards, lga_code): lga_code
                for lga_name, lga_code in self.lgas.items()
            }

            for future in as_completed(results):
                result = future.result()
                lga_key = str(results[future])
                self.wards[lga_key] = {
                    d["narration"].upper().strip(): int(d["code"])
                    for d in result["data"]
                }
                self.reverse_ward[lga_key] = {
                    v: k for k, v in self.wards[lga_key].items()
                }

        kv.setex("loader:wards", self.STABLE_TTL, json.dumps(self.wards))
        kv.setex("loader:reverse_ward", self.STABLE_TTL, json.dumps(self.reverse_ward))

    def load_facilities(self):
        if self.lgas is None:
            self.load_lgas()
        if self.wards is None:
            self.load_wards()
        active_plans = [1, 4, 5]

        self._all_facilities = {}
        self._all_reverse_facilities = {}
        combined_reverse = {}

        for pid in active_plans:
            facs, revs = self._fetch_facilities_for_plan(pid)
            self._all_facilities[pid] = facs
            self._all_reverse_facilities[pid] = revs
            combined_reverse.update(revs)

        # Keep self.facilities pointing to BHCPF (1) so existing legacy callers don't break
        self.facilities = self._all_facilities.get(1, {})
        self.reverse_facility = combined_reverse
    
    def get_facilities(self, plan_id: int = 1) -> dict:
        if not hasattr(self, "_all_facilities") or plan_id not in (self._all_facilities or {}):
            facs, _ = self._fetch_facilities_for_plan(plan_id)
            if self._all_facilities is None:
                self._all_facilities = {}
            self._all_facilities[plan_id] = facs
            return facs
        return self._all_facilities.get(plan_id, {})

    def get_reverse_facilities(self, plan_id: int = 1) -> dict:
        if not hasattr(self, "_all_reverse_facilities") or plan_id not in (self._all_reverse_facilities or {}):
            _, revs = self._fetch_facilities_for_plan(plan_id)
            if self._all_reverse_facilities is None:
                self._all_reverse_facilities = {}
            self._all_reverse_facilities[plan_id] = revs
            return revs
        return self._all_reverse_facilities.get(plan_id, {})


_loader_instance: Optional[DataLoader] = None


def get_loader() -> DataLoader:
    global _loader_instance
    if _loader_instance is None:
        _loader_instance = DataLoader()
        _loader_instance.load_all()
    return _loader_instance
