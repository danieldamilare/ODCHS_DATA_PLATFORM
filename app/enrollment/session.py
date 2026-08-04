import requests
from requests.adapters import HTTPAdapter
from flask import current_app


class TimeoutHTTPAdapter(HTTPAdapter):
    def __init__(self, *args, timeout=30, **kwargs):
        self.timeout = timeout
        super().__init__(*args, **kwargs)

    def send(self, request, **kwargs):
        if kwargs.get("timeout") is None:
            kwargs["timeout"] = self.timeout
        return super().send(request, **kwargs)


_session = None


def get_his_session():
    global _session
    if _session is not None:
        return _session

    his_config = current_app.config["HIS_SESSION_CONFIG"]
    session = requests.Session()
    session.cookies.set("user_id", his_config.get("user_id"))
    session.cookies.set("deployState", his_config.get("deployState"))
    session.cookies.set("staffType", his_config.get("staffType"))
    session.cookies.set("name", his_config.get("name"))
    session.cookies.set("emailAddress", his_config.get("emailAddress"))
    session.cookies.set("mobileNo", his_config.get("mobileNo"))
    session.cookies.set("organisation", his_config.get("organisation"))
    session.cookies.set("department", his_config.get("department"))
    session.cookies.set("jobtitle", his_config.get("jobtitle"))

    session.headers.update(
        {
            "Dnt": "1",
            "Origin": his_config.get("Origin"),
            "Referer": his_config.get("Referer"),
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
            "user_id": "1",
        }
    )

    MAX_POOL_CONNECTIONS = 25
    GLOBAL_TIMEOUT_SECONDS = 30

    custom_adapter = TimeoutHTTPAdapter(
        timeout=GLOBAL_TIMEOUT_SECONDS,
        pool_connections=MAX_POOL_CONNECTIONS,
        pool_maxsize=MAX_POOL_CONNECTIONS,
        max_retries=4
    )

    session.mount("http://", custom_adapter)
    session.mount("https://", custom_adapter)

    _session = session
    return session
