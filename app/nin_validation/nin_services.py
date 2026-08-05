from app.nin_validation.nin_client import load_nin_client
from app.nin_validation.schema import NINBatchValidator
from app.nin_validation.utils import get_dataset_type
from datetime import date
from app import kv
import threading
from werkzeug.utils import secure_filename
import os
import uuid
from flask import current_app
from typing import Literal, Optional
import hashlib
import pandas as pd
from dataclasses import dataclass
# from app.nin_validation.tasks import process_nin_validation


@dataclass
class NINBatchResult:
    status: Literal["duplicate", "save_error", "success"]
    msg: str
    job_id: Optional[str] = None

class NINServices:
    def __init__(self):
        self.client = load_nin_client()
    def validate_nin(self, dob: date, nin: str):
        return self.client.validate_nin(dob, nin)

    def warmup(self):
        thr = threading.Thread(target=self.client.refresh_token, daemon=True)
        thr.start()

    def start_batch_validation(self, res: NINBatchValidator):
        file = res.batch_file
        checksum = hashlib.md5(file.read()).hexdigest()
        file.stream.seek(0)

        if kv.exists(checksum): # ooops you are only allowed one trial a day
            job_id = kv.get(checksum) 
            return NINBatchResult("duplicate", "You already submitted this document", job_id)

        data_type = get_dataset_type(file)
        dir_path = current_app.config['SCRATCH_FILE_PATH']
        file_name = secure_filename(file.file_name)
        try:

            if data_type != 'csv':
                df= pd.read_excel(file.stream)
                name = os.path.splitext(file_name)[0]
                new_path = os.path.join(dir_path, name) + ".csv"
                df.to_csv(new_path)
            else:
                new_path = os.path.join(dir_path, file_name)
                file.save(new_path)
        except OSError:
            return NINBatchResult("save_error", "Error occured while saving your file")
        job_id = str(uuid.uuid4())
        kv.set(checksum, job_id)
        kv.hset(job_id, mapping={"checksum": checksum,
                                   "path": new_path,
                                   "status": "Loading",

                                   })
        # process_nin_batch_validation.delay(job_id)
        return NINBatchResult("success", "NIN Batch Validation Job has successfully started")
