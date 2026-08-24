import re
import pandas as pd
import numpy as np
from typing import Optional, Dict
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from app.enrollment.his_client import HISClient
from app.encounter.disease_classifier import classify_diagnosis
import traceback


@dataclass
class DataFrameProcessResult:
    success: bool
    data: Optional[pd.DataFrame] = None
    err_msg: Optional[str] = None
    missing_sex_count: int = 0
    missing_age_count: int = 0


def get_ext(path: str):
    return os.path.splitext(path)[1].lower()


def read_into_df(file_path, sheet_name=0, nrows=None, header=0):
    ext = get_ext(file_path)
    if ext == ".csv":
        return pd.read_csv(file_path, nrows=nrows, header=header)
    else:
        engine = "odf" if ext == ".ods" else "calamine"
        return pd.read_excel(
            file_path, sheet_name=sheet_name, nrows=nrows, engine=engine, header=header
        )


def is_valid(val):
    s = str(val).strip().lower()
    return bool(s and s != "nan" and s != "none")


def merge_spilled_diagnosis(df: pd.DataFrame) -> pd.DataFrame:
    df = df.reset_index(drop=True)
    df["diagnosis"] = df["diagnosis"].astype(str).str.strip()
    df["client_name"] = df["client_name"].astype(str).str.strip()

    primary = df["client_name"].map(is_valid)
    group_id = primary.astype(int).cumsum()

    df = df[group_id > 0].copy()
    group_id = group_id[group_id > 0]

    valid_diag_mask = df["diagnosis"].map(is_valid)

    merged_diag = (
        df[valid_diag_mask]
        .groupby(group_id[valid_diag_mask])["diagnosis"]
        .apply(" ".join)
    )

    is_primary_row = primary[group_id > 0]
    result = df[is_primary_row].copy().reset_index(drop=True)

    primary_group_ids = group_id[is_primary_row].values
    result["diagnosis"] = [merged_diag.get(gid, "") for gid in primary_group_ids]
    result.reset_index(drop=True, inplace=True)
    result = result[result["diagnosis"].map(is_valid)]
    return result


def sanitize_sheet_name(name):
    """Removes invalid characters for Excel sheet names."""
    name = str(name)
    name = re.sub(r"[\\\/\?\*\[\]\:\']", "", name)
    return name[:31]


def sanitize_excel_value(value):
    if pd.isna(value):
        return np.nan

    if isinstance(value, str):
        value = value.replace("\x00", "")
        value = value.replace("\r", " ").replace("\n", " ").replace("\t", " ")
        value = "".join(char for char in value if ord(char) >= 32)
    return value


def parse_age_from_string(age_val):
    if pd.isna(age_val):
        return np.nan
    age_str = str(age_val).upper()
    numbers = re.findall(r"\d+\.?\d*", age_str)
    try:
        if not numbers:
            return np.nan
        age_num = float(numbers[0])
        if "MTH" in age_str or "MONTH" in age_str:
            return age_num / 12
        elif "DAY" in age_str:
            return age_num / 365
        else:
            return age_num
    except (ValueError, OverflowError):
        return np.nan


def categorize_age(age_val) -> Optional[str]:
    if pd.isna(age_val):
        return None
    if age_val < 1:
        return "<1"
    if age_val <= 5:
        return "1-5"
    if age_val <= 14:
        return "6-14"
    if age_val <= 19:
        return "15-19"
    if age_val <= 44:
        return "20-44"
    if age_val <= 64:
        return "45-64"
    return "65&AB"


def load_clean_dataframe(file_path: str, metadata: Dict):
    try:
        facility_name = os.path.splitext(os.path.basename(file_path))[0]

        df = read_into_df(
            file_path=file_path,
            sheet_name=metadata["sheet_name"],
            header=int(metadata["header_row"]),
        )

        df.dropna(axis=0, how="all", inplace=True)
        columns = list(df.columns)

        for key, value in metadata["col"].items():
            columns[int(value)] = key

        columns = [
            re.sub(r"[^a-z0-9]", "_", col.lower().strip().replace(" ", "_"))
            for col in columns
        ]
        df.columns = columns
        df["facility"] = facility_name
        df.dropna(axis=1, how="all", inplace=True)
        df = merge_spilled_diagnosis(df)

        needed_column = ["policy_number", "age", "sex", "diagnosis", "client_name"]
        last_valid = df[needed_column].notna().any(axis=1)
        df = df[last_valid]
        df.reset_index(drop=True, inplace=True)
        df["s/n"] = range(1, len(df) + 1)  # use to mark index for us later to value

        if df.empty:

            return DataFrameProcessResult(
                success=False, err_msg=f"{file_path} is empty."
            )

        sex_raw = df["sex"].astype(str).str.strip().str.lower()
        missing_sex_mask = sex_raw.isin(["", "nan", "nat", "none", "null"])
        df["sex"] = np.where(sex_raw.str.contains("f"), "Female", "Male")
        df.loc[missing_sex_mask, "sex"] = np.nan
        df["age_numeric"] = df["age"].map(parse_age_from_string)
        missing_mask = df["age_numeric"].isna() | df["sex"].isna()

        to_find = df[missing_mask]
        to_find.reset_index(drop=True, inplace=True)

        missing_count = len(to_find)
        policy_numbers = to_find["policy_number"].tolist()
        found_count = 0
        if not to_find.empty:
            with ThreadPoolExecutor(max_workers=20) as executor:
                client = HISClient()
                result = executor.map(
                    client.fetch_enrollee_details, policy_numbers
                )  # map retains order

                for idx, res in enumerate(result):
                    if res is None:
                        continue
                    found_count += 1
                    s_n = to_find.loc[idx, "s/n"]
                    df.loc[df["s/n"] == s_n, "age_numeric"] = res.age
                    gender_clean = (
                        "Female" if "f" in str(res.gender).lower() else "Male"
                    )
                    df.loc[df["s/n"] == s_n, "sex"] = gender_clean

        remaining = missing_count - found_count

        sex_raw = df["sex"].astype(str).str.strip().str.lower()
        missing_sex_mask = sex_raw.isin(["", "nan", "nat", "none"])
        missing_age_mask = df["age_numeric"].isna()

        if remaining / len(df) > 0.5:
            return DataFrameProcessResult(
                success=False,
                err_msg=f"Rejected: Missing age exceeds 50% ({missing_age_mask.sum()}/{len(df)})",
                missing_sex_count=int(missing_sex_mask.sum()),
                missing_age_count=int(missing_age_mask.sum()),
            )

        if missing_sex_mask.any():
            known_sex = df.loc[~missing_sex_mask, "sex"]
            if known_sex.empty:
                weights = {"Male": 0.5, "Female": 0.5}
            else:
                counts = known_sex.value_counts(normalize=True)
                weights = counts.to_dict()
            choices = np.random.choice(
                list(weights.keys()),
                size=int(missing_sex_mask.sum()),
                p=list(weights.values()),
            )
            df.loc[missing_sex_mask, "sex"] = choices
        if missing_age_mask.any():
            age_median = df["age_numeric"].median()
            df.loc[missing_age_mask, "age_numeric"] = age_median
        df["age"] = df["age_numeric"].map(categorize_age)
        df.drop(columns=["age_numeric"], inplace=True)
        df["age"] = df["age"].astype("category")
        df["sex"] = df["sex"].astype("category")

        for col in df.select_dtypes(include="object").columns:
            df[col] = df[col].map(sanitize_excel_value)

        return DataFrameProcessResult(
            success=True,
            data=df,
            missing_sex_count=int(missing_sex_mask.sum()),
            missing_age_count=int(missing_age_mask.sum()),
        )
    except Exception as e:
        traceback.print_exc()
        return DataFrameProcessResult(success=False, err_msg=str(e))


def process_df(df: pd.DataFrame, master_diagnosis_list):
    age_order = ["<1", "1-5", "6-14", "15-19", "20-44", "45-64", "65&AB"]
    sex_order = ["Male", "Female"]
    all_cols = pd.MultiIndex.from_product([age_order, sex_order], names=["age", "sex"])
    df["s/n"] = range(1, len(df) + 1)

    try:
        enc_table = df.pivot_table(
            index="facility",
            columns=["age", "sex"],
            values="s/n",
            fill_value=np.nan,
            aggfunc="count",
            observed=True,
        )
        enc_table.index.name = "Facility"
        enc_table = enc_table.reindex(columns=all_cols, fill_value=np.nan)
        classified = classify_diagnosis(df["diagnosis"].tolist())
        df["classified_diagnosis"] = classified
        df = df.explode("classified_diagnosis").reset_index(drop=True)
        df["diagnosis"] = df["classified_diagnosis"]
        facility = df["facility"].iloc[0]

        report_table = df.pivot_table(
            index="diagnosis",
            columns=["age", "sex"],
            values="s/n",
            aggfunc="count",
            fill_value=np.nan,
            observed=True,
        )

        report_table = report_table.reindex(columns=all_cols, fill_value=np.nan)
        report_table = report_table.reindex(index=master_diagnosis_list)

        report_table[("Total", "Male")] = report_table.loc[
            :, (slice(None), "Male")
        ].sum(axis=1, min_count=1)
        report_table[("Total", "Female")] = report_table.loc[
            :, (slice(None), "Female")
        ].sum(axis=1, min_count=1)
        report_table[("Total", "Grand Total")] = report_table[
            [("Total", "Male"), ("Total", "Female")]
        ].sum(axis=1, min_count=1)
        return facility, enc_table, report_table
    except Exception:
        return None, None, None


def save_to_file(
    encounter_df: pd.DataFrame, utilization_list: Dict, output_filename: str
):
    used_sheet_names = set()

    try:
        with pd.ExcelWriter(output_filename, engine="openpyxl") as writer:

            print("Saving Encounter report...")

            encounter_df.to_excel(writer, sheet_name="Encounter Report")
            used_sheet_names.add("Encounter Report")

            print(f"Saving {len(utilization_list)} facility utilization reports...")

            for facility_name, report_df in utilization_list.items():
                base_name = sanitize_sheet_name(facility_name)
                if not base_name:
                    base_name = "Unnamed_Facility"
                sheet_name = base_name
                count = 1

                while sheet_name in used_sheet_names:
                    suffix = f"_{count}"
                    trunc_len = 31 - len(suffix)
                    sheet_name = f"{base_name[:trunc_len]}{suffix}"
                    count += 1

                    if count > 100:
                        print(
                            f" - Collision limit reached for {facility_name}. Using unique index."
                        )
                        sheet_name = f"Facility_{id(report_df) % 10000}"
                        break

                used_sheet_names.add(sheet_name)

                report_df.to_excel(writer, sheet_name=sheet_name)

        print(f"Successfully saved all reports to {output_filename}")

    except Exception as e:
        print(f"Critical Error during file save: {e}")
