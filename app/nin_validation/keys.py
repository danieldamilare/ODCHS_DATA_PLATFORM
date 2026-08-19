class NINKeys:
    @classmethod
    def clean_id(cls, job_id: str) -> str:
        return str(job_id).removeprefix("nin:batch:")

    @classmethod
    def get_job_key(cls, job_id: str) -> str:
        return f"nin:batch:{cls.clean_id(job_id)}"

    @classmethod
    def get_job_queue(cls, job_id: str) -> str:
        return f"nin:batch:queue:{cls.clean_id(job_id)}"

    @classmethod
    def get_job_processing_queue(cls, job_id: str, worker_no: int | str) -> str:
        return f"nin:batch:queue:processing:{cls.clean_id(job_id)}:{worker_no}"

    @classmethod
    def get_result_key(cls, job_id: str) -> str:
        return f"nin:batch:result:{cls.clean_id(job_id)}"

    @classmethod
    def get_job_channel(cls, job_id: str) -> str:
        return f"nin:batch:channel:{cls.clean_id(job_id)}"