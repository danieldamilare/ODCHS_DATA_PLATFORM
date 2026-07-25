import os
import time
import sys
import json
import requests
from app.enrollment.session import session
from app import kv
from typing import Optional, Dict

BASE = "https://odchc-his.org/administrator/functions"


class DataLoader:
    state_code = 29
    titles = {"Mr": 3, "Mrs": 4, "Miss": 2}
    plan_id = 1  # BHCPF hardcoded
    STABLE_TTL = 100 * 60 * 60 * 24
    VOLATILE_TTL = 10 * 60 * 60 * 24

    def __init__(self):
        self.citizen_types: Optional[Dict] = None
        self.lgas: Optional[Dict] = None
        self.wards: Optional[Dict] = None
        self.facilities: Optional[Dict] = None
        self.marital_status: Optional[Dict] = None
        self.reverse_lga: Optional[Dict] = None
        self.reverse_ward: Optional[Dict] = None
        self.reverse_facility: Optional[Dict] = None

    def load_all(self):
        """Safely loads all mappings, ensuring internal data availability."""
        self.load_citizen_types()
        self.load_marital_status()
        self.load_lgas()
        self.load_wards()
        self.load_facilities()

    def load_marital_status(self):
        if self.marital_status is not None:
            return

        cached = kv.get("loader:marital_status")
        if cached:
            self.marital_status = json.loads(cached)
            return

        res = session.get(f"{BASE}?listMStatus").json()
        marital_status = {
            dec["narration"].upper().strip(): int(dec["code"]) for dec in res["data"]
        }
        kv.setex("loader:marital_status", self.STABLE_TTL, json.dumps(marital_status))
        self.marital_status = marital_status

    def load_citizen_types(self):
        if self.citizen_types is not None:
            return

        cached = kv.get("loader:citizen_types")
        if cached:
            self.citizen_types = json.loads(cached)
            return

        res = session.get(f"{BASE}?listCitiz").json()
        self.citizen_types = {
            d["narration"].upper().strip(): int(d["code"]) for d in res["data"]
        }
        kv.setex(
            "loader:citizen_types", self.STABLE_TTL, json.dumps(self.citizen_types)
        )

    def load_lgas(self):
        if self.lgas is not None and self.reverse_lga is not None:
            return

        cached_lgas = kv.get("loader:lgas")
        cached_reverse = kv.get("loader:reverse_lga")

        if cached_lgas and cached_reverse:
            self.lgas = json.loads(cached_lgas)
            self.reverse_lga = json.loads(cached_reverse)
            return

        res = session.get(f"{BASE}?listCities={self.state_code}").json()
        self.lgas = {
            d["cityName"].upper().strip(): int(d["cityCode"]) for d in res["cities"]
        }
        self.reverse_lga = {v: k for k, v in self.lgas.items()}

        kv.setex("loader:lgas", self.STABLE_TTL, json.dumps(self.lgas))
        kv.setex("loader:reverse_lga", self.STABLE_TTL, json.dumps(self.reverse_lga))

    def load_wards(self):
        if self.wards is not None and self.reverse_ward is not None:
            return

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
        for lga_name, lga_code in self.lgas.items():
            res = session.get(f"{BASE}?listWard={lga_code}").json()
            lga_key = str(lga_code)

            self.wards[lga_key] = {
                d["narration"].upper().strip(): int(d["code"]) for d in res["data"]
            }
            self.reverse_ward[lga_key] = {v: k for k, v in self.wards[lga_key].items()}

        kv.setex("loader:wards", self.STABLE_TTL, json.dumps(self.wards))
        kv.setex("loader:reverse_ward", self.STABLE_TTL, json.dumps(self.reverse_ward))

    def load_facilities(self):
        if self.facilities is not None and self.reverse_facility is not None:
            return

        cached_fac = kv.get("loader:facilities")
        cached_rev_fac = kv.get("loader:reverse_facilities")

        if cached_fac and cached_rev_fac:
            self.facilities = json.loads(cached_fac)
            self.reverse_facility = json.loads(cached_rev_fac)
            return

        if self.lgas is None:
            self.load_lgas()
        if self.wards is None:
            self.load_wards()

        self.facilities = {}
        self.reverse_facility = {}
        res = session.get(f"{BASE}?getProvidersByWard=0&planid={self.plan_id}").json()
        providers = res["providers"]

        for p in providers:
            key = p["providerName"].upper().strip()
            lga_name = p["city"].upper().strip()

            if lga_name not in self.lgas:
                continue

            lga_code = str(self.lgas[lga_name])
            ward_name = p["ward"].upper().strip()

            if ward_name not in self.wards[lga_code]:
                continue

            ward_code = str(self.wards[lga_code][ward_name])

            self.facilities[ward_code] = self.facilities.get(ward_code, {})
            self.facilities[ward_code][key] = int(p["provider_id"])
            self.reverse_facility[str(p["provider_id"])] = key

        kv.setex("loader:facilities", self.VOLATILE_TTL, json.dumps(self.facilities))
        kv.setex(
            "loader:reverse_facilities",
            self.VOLATILE_TTL,
            json.dumps(self.reverse_facility),
        )


def get_loader() -> DataLoader:
    loader = DataLoader()
    loader.load_all()
    return loader

