import os
from app import kv
import hashlib

KEY_POOL = "gemini:api_keys"
LEASE = "gemini:lease"
TOTAL = "gemini:total_key"
LEASE_TRACKER = "gemini:lease_tracker"


def set_cooldown(api_key: str, cool_time: int = 60):
    keyhash = hashlib.md5(api_key.encode()).hexdigest()
    kv.setex(f"gemini:cooldown:{keyhash}", cool_time, "")


def is_cooling(api_key: str):
    keyhash = hashlib.md5(api_key.encode()).hexdigest()
    current = kv.get(f"gemini:cooldown:{keyhash}")
    return current is not None


def load_api_keys():
    t = os.getenv("TOTAL_KEY")
    print("Got total key", t)
    if not t:
        return
    total = int(t) + 1
    api_keys = [os.getenv(f"GOOGLE_API_KEY{i}") for i in range(1, total)]
    api_keys = [k for k in api_keys if k]

    kv.delete(KEY_POOL)
    kv.delete(LEASE)

    if not api_keys:
        return

    kv.set(TOTAL, len(api_keys))
    kv.rpush(KEY_POOL, *api_keys)


def get_key():
    total_api = int(kv.get(TOTAL) or 0)
    for i in range(total_api):
        candidate = kv.lmove(KEY_POOL, LEASE, "LEFT", "LEFT")
        if not candidate:
            break
        if is_cooling(candidate):
            kv.lrem(LEASE, 1, candidate)
            kv.rpush(KEY_POOL, candidate)
        else:
            keyhash = hashlib.md5(candidate.encode()).hexdigest()
            kv.setex(f"{LEASE_TRACKER}:{keyhash}", 600, "active")
            return candidate
    return None


def release_key(api_key: str, to_cool: bool = False, cooldown_time: int = 60):
    if not api_key:
        return
    if to_cool:
        set_cooldown(api_key, cooldown_time)

    keyhash = hashlib.md5(api_key.encode()).hexdigest()
    exist = kv.lrem(LEASE, 1, api_key)
    if exist:
        kv.delete(f"gemini:lease_tracker:{keyhash}")
        kv.rpush(KEY_POOL, api_key)
