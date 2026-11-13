# Open Health Data

An open-source project for collecting a patient's own medical records, starting with blood work lab results, organizing them in one standardized format, and publishing them as an open dataset with interactive charts.

## Why

Medical records are scattered across hospitals, clinics and labs, each with its own test names, units and reference ranges. That makes it hard to see trends over time or compare results across sources. This project pulls a patient's records through the official patient-access APIs, standardizes them, and makes them easy to analyze and share for research.

## How it works

1. **Patient-authorized access.** The patient signs in through their health system's own patient portal (e.g. Epic MyChart) and approves access using the standard SMART on FHIR authorization flow. The app never sees or stores the patient's portal password.
2. **Download.** The app reads the patient's records through FHIR R4 APIs (labs, vitals, reports, conditions, medications, and similar). Access is **read-only**: the app never changes anything in the medical record.
3. **Local storage.** Raw responses are saved unchanged on the patient's own computer, then converted into a standardized format using LOINC codes for lab tests and standard units (UCUM).
4. **Publishing (optional, by the patient).** The patient chooses which data to publish. Identifiers such as dates of birth, addresses, record numbers and insurance IDs are removed before anything is published.

## Data format

Lab results are stored one row per result, including:

- collection date and time
- test name (standardized and as originally reported)
- LOINC code
- value, unit and any qualifier (such as "<" or ">")
- reference range (standardized and as reported by the lab)
- abnormal flag
- source health system

The format is compatible with existing open patient datasets, so data from different contributors can be combined.

## Status

Early development. Current work: the patient-authorized download tool and the data format for lab results.

## Privacy and consent

- Each person's data is downloaded only with that person's own authorization through their patient portal.
- Data is stored on the patient's own computer. Nothing is sent anywhere unless the patient chooses to publish it.
- Access tokens are kept in the computer's secure keychain and are never published.
- Anyone contributing data does so voluntarily and decides what to share.

## Terms of use

This software is provided "as is", without warranty of any kind. It is not a medical device and does not provide medical advice. Lab results and any charts or analyses produced by this project are for informational and research purposes only. Always consult a qualified healthcare professional about medical decisions.

Users are responsible for the data they choose to download and publish. Do not use this software to access records you are not authorized to access.

## Contact

Questions or issues: open an issue in this repository.
