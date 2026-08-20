class EncounterKeys:
    RATE_LIMIT_PAUSE_KEY = "encounter:groq:rate_limit"

    @classmethod
    def clean_id(cls, job_id: str) -> str:
        return str(job_id).removeprefix("channel:encounter:").removeprefix("channel:").removeprefix("encounter:")

    @classmethod
    def get_job_key(cls, job_id: str) -> str:
        return f"encounter:{cls.clean_id(job_id)}"

    @classmethod
    def get_job_channel(cls, job_id: str) -> str:
        return f"encounter:channel:{cls.clean_id(job_id)}"

    @classmethod
    def get_jobs_hash_key(cls, job_id: str) -> str:
        return f"encounter:jobs:{cls.clean_id(job_id)}"

    @classmethod
    def get_current_job_key(cls, job_id: str) -> str:
        return f"encounter:current_job:{cls.clean_id(job_id)}"

    @classmethod
    def get_cache_key(cls, job_id: str, job_num: int | str) -> str:
        return f"encounter:cache:{cls.clean_id(job_id)}:{job_num}"

    @classmethod
    def get_metadata_key(cls, job_id: str, job_num: int | str) -> str:
        return f"encounter:metadata:{cls.clean_id(job_id)}:{job_num}"

    @classmethod
    def get_results_key(cls, job_id: str) -> str:
        return f"encounter:results:{cls.clean_id(job_id)}"
