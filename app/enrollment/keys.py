class EnrollmentKeys:
    @classmethod
    def clean_id(cls, batch_id: int | str) -> str:
        return str(batch_id).removeprefix("enrollment:batch:").removeprefix("channel:").removeprefix("batch:")

    @classmethod
    def get_job_key(cls, batch_id: int | str) -> str:
        return f"enrollment:batch:{cls.clean_id(batch_id)}"

    @classmethod
    def get_job_channel(cls, batch_id: int | str) -> str:
        return f"enrollment:batch:channel:{cls.clean_id(batch_id)}"


class EnrollmentIdCardKeys:

    @classmethod
    def clean_id(cls, batch_id: int | str) -> str:
        return (
            str(batch_id)
            .removeprefix("enrollment:idcard:")
            .removeprefix("channel:batch_idcard:")
            .removeprefix("batch_idcard_status:")
            .removeprefix("batch_idcard:paths:")
            .removeprefix("batch_idcard:")
            .removeprefix("idcard:")
        )

    @classmethod
    def get_job_key(cls, batch_id: int | str) -> str:
        return f"idcard:batch:{cls.clean_id(batch_id)}"

    @classmethod
    def get_job_channel(cls, batch_id: int | str) -> str:
        return f"idcard:batch:channel:{cls.clean_id(batch_id)}"

    @classmethod
    def get_download_paths(cls, batch_id: int | str) -> str:
        return f"idcard:batch:paths:{cls.clean_id(batch_id)}"